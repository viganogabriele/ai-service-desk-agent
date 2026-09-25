"""The live loop: find untriaged tickets, run triage(), write the result back.

    python loop.py --once --dry-run   # show what it would do, change nothing
    python loop.py --once             # process what's there now, then exit
    python loop.py                    # keep polling (for the live demo)
    python loop.py --only-challenge   # only the uploaded challenge tickets

Results are also saved to triage_results.json.
"""

import argparse
import json
import os
import time

import backend.jira_scripts.config as config
from backend.jira_scripts.jira_client import Jira, JiraError, adf_to_text, find_work_type, match_option, option_label
from backend.jira_scripts.triage import priority_from, triage

F = config.FIELDS
READ_FIELDS = ["summary", "description", "issuetype", "labels", "priority", "status",
               "comment", "created", *F.values()]


def jql(only_challenge):
    q = (f'project = {config.PROJECT_KEY} AND statusCategory != Done '
         f'AND (labels IS EMPTY OR labels != "{config.TRIAGED_LABEL}")')
    if only_challenge:
        q += f' AND labels = "{config.UPLOAD_LABEL}"'
    return q + " ORDER BY created ASC"


def label_of(v):
    if isinstance(v, dict):
        return option_label(v)
    if isinstance(v, list):
        return [label_of(x) for x in v]
    return v


def to_ticket(issue):
    """Jira issue -> dict shaped like a challenge record, so triage() sees familiar input."""
    f = issue["fields"]
    wt = f["issuetype"]["name"].lower()
    work_type = "Service Request" if "service request" in wt else "Incident" if "incident" in wt else f["issuetype"]["name"]

    def one(fid):
        v = label_of(f.get(fid))
        return [v] if v and not isinstance(v, list) else (v or [])

    return {
        "Key": issue["key"],
        "Work type": work_type,
        "Summary": f.get("summary"),
        "Description": adf_to_text(f.get("description")).strip(),
        "Affected Business or IT Services": one(F["affected_service"]),
        "Business Entity": one(F["business_entity"]),
        "Service Team(s)": one(F["service_team"]),
        "Reporter": f.get(F["original_reporter"]),
        "Assignee": f.get(F["proposed_assignee"]),
        "Priority": label_of(f.get("priority")),
        "Urgency": label_of(f.get(F["urgency"])),
        "Impact": label_of(f.get(F["impact"])),
        "Created date": f.get("created"),
        "Status": f["status"]["name"],
        "All Comments": [adf_to_text(c["body"]).strip() for c in (f.get("comment") or {}).get("comments", [])],
    }


def process(j, issue, types, dry):
    key = issue["key"]
    ticket = to_ticket(issue)
    pred = triage(ticket)
    notes = []

    # 1. Work type. Often refused when the two types use different workflows.
    target = find_work_type(types, pred.get("work_type") or ticket["Work type"])
    if target and target["id"] != issue["fields"]["issuetype"]["id"]:
        if dry:
            notes.append(f"would change work type to {target['name']}")
        else:
            try:
                j.update_issue(key, fields={"issuetype": {"id": target["id"]}})
                notes.append(f"work type changed to {target['name']}")
            except JiraError as e:
                notes.append(f"work type should be {pred['work_type']} (Jira refused the change: {e.status})")

    # 2. Fields, validated against what the edit screen allows
    edit = j.call("GET", f"/rest/api/3/issue/{key}/editmeta")["fields"]

    def select(fid, value):
        opt = match_option(value, (edit.get(fid) or {}).get("allowedValues"))
        if not opt:
            notes.append(f"could not set {fid} to '{value}'")
        return opt

    fields = {}
    for fid, value in [(F["affected_service"], pred.get("service")),
                       (F["service_team"], pred.get("team"))]:
        if value and (opt := select(fid, value)):
            fields[fid] = {"id": opt["id"]}
    if pred.get("assignee"):
        fields[F["proposed_assignee"]] = pred["assignee"]

    # Urgency/Impact first, then Priority from what was ACTUALLY written,
    # so the three stay consistent even if Jira's option names differ from ours.
    u = select(F["urgency"], pred.get("urgency")) if pred.get("urgency") else None
    i = select(F["impact"], pred.get("impact")) if pred.get("impact") else None
    if u:
        fields[F["urgency"]] = {"id": u["id"]}
    if i:
        fields[F["impact"]] = {"id": i["id"]}
    prio_name = priority_from(option_label(u), option_label(i)) if u and i else pred.get("priority")
    if prio_name and (p := select("priority", prio_name)):
        fields["priority"] = {"id": p["id"]}

    summary = (f"AI triage: {pred.get('work_type')} | {pred.get('service')} | {pred.get('team')} | "
               f"{pred.get('assignee')} | urgency {option_label(u) or '-'}, impact {option_label(i) or '-'} "
               f"-> priority {prio_name} | resolution {pred.get('resolution')}")
    if notes:
        summary += "\nNotes: " + "; ".join(notes)

    if dry:
        print(f"{key} DRY RUN\n  {summary}\n  fields: {json.dumps(fields)}")
        return pred

    j.update_issue(key, fields=fields)

    # 3. Comments: the resolution note, plus an agent-only summary of the decisions
    if pred.get("resolution_comment"):
        j.add_comment(key, pred["resolution_comment"])
    j.add_comment(key, summary, internal=True)

    # 4. Resolve with the chosen resolution
    res = config.RESOLUTIONS.get((pred.get("resolution") or "").lower())
    if res:
        trans = [t for t in j.transitions(key)
                 if "resolved" in t["to"]["name"].lower() or "resolve" in t["name"].lower()]
        if trans:
            try:
                j.transition(key, trans[0]["id"], fields={"resolution": {"name": res}})
            except JiraError as e:
                print(f"  {key}: could not resolve ({e.status}), left open")
        else:
            print(f"  {key}: no 'Resolve' transition from status {ticket['Status']}, left open")

    # 5. Mark as done so the loop never picks it up again
    j.update_issue(key, update={"labels": [{"add": config.TRIAGED_LABEL}]})
    print(f"{key} triaged: {summary.splitlines()[0]}")
    return pred


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only-challenge", action="store_true")
    args = ap.parse_args()

    j = Jira()
    types = j.work_types()
    results = json.load(open("triage_results.json")) if os.path.exists("triage_results.json") else {}
    failed = set()  # don't hammer a broken ticket every poll

    print("Watching:", jql(args.only_challenge))
    while True:
        for issue in j.search(jql(args.only_challenge), READ_FIELDS):
            if issue["key"] in failed or (args.dry_run and issue["key"] in results):
                continue
            try:
                results[issue["key"]] = process(j, issue, types, args.dry_run)
            except JiraError as e:
                print(f"{issue['key']} FAILED: {e}")
                failed.add(issue["key"])
        if not args.dry_run:
            json.dump(results, open("triage_results.json", "w"), indent=2, ensure_ascii=False)
        if args.once:
            break
        time.sleep(config.POLL_SECONDS)


if __name__ == "__main__":
    main()
