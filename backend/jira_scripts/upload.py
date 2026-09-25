"""Upload the challenge tickets into the SUP space.

    python upload.py challenge.json --dry-run      # show what would be sent
    python upload.py challenge.json --limit 2      # try two tickets first
    python upload.py challenge.json                # all of them

Safe to re-run: tickets already uploaded (by their challenge-NN label) are skipped.
Writes uploaded.json mapping Jira keys to the original record index.
"""

import argparse
import json

import config
from jira_client import Jira, JiraError, adf, find_work_type, match_option

F = config.FIELDS


def load_records(path):
    data = json.load(open(path, encoding="utf-8"))
    return data["records"] if isinstance(data, dict) else data


def build_fields(rec, idx, issuetype, meta, warn):
    """Challenge record -> Jira create payload. `meta` = createmeta fields for this work type."""

    def allowed(fid):
        return (meta.get(fid) or {}).get("allowedValues")

    def select(fid, value):
        if fid not in meta:
            warn(f"{fid} not on create screen, skipped")
            return None
        opt = match_option(value, allowed(fid))
        if not opt:
            warn(f"'{value}' not an option of {fid}, skipped")
            return None
        return {"id": opt["id"]}

    # Things Jira can't store natively go in a footer, so the model still sees them
    footer = [
        f"Original request type: {rec.get('Request type') or '-'}",
        f"Original created date: {rec.get('Created date') or '-'}",
        f"Original status: {rec.get('Status') or '-'}",
    ]
    if rec.get("Linked issues"):
        footer.append("Linked issues: " + ", ".join(rec["Linked issues"]))
    description = (rec.get("Description") or "") + "\n\n---\n" + "\n".join(footer)

    fields = {
        "project": {"key": config.PROJECT_KEY},
        "issuetype": {"id": issuetype["id"]},
        "summary": rec["Summary"][:254],
        "description": adf(description),
        "labels": [config.UPLOAD_LABEL, f"challenge-{idx:02d}"],
    }

    service = (rec.get("Affected Business or IT Services") or [None])[0]
    if service:
        fields[F["affected_service"]] = select(F["affected_service"], service)
    team = (rec.get("Service Team(s)") or [None])[0]
    if team:
        fields[F["service_team"]] = select(F["service_team"], team)
    entities = [select(F["business_entity"], e) for e in rec.get("Business Entity") or []]
    if any(entities):
        fields[F["business_entity"]] = [e for e in entities if e]
    if rec.get("Urgency"):
        fields[F["urgency"]] = select(F["urgency"], rec["Urgency"])
    if rec.get("Impact"):
        fields[F["impact"]] = select(F["impact"], rec["Impact"])
    if rec.get("Priority"):
        fields["priority"] = select("priority", rec["Priority"])
    if rec.get("Reporter"):
        fields[F["original_reporter"]] = rec["Reporter"]
    if rec.get("Assignee"):
        fields[F["proposed_assignee"]] = rec["Assignee"]

    return {k: v for k, v in fields.items() if v is not None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    records = load_records(args.file)
    if args.limit:
        records = records[: args.limit]

    j = Jira()
    types = j.work_types()
    meta_cache = {}

    already = {}
    for issue in j.search(f'project = {config.PROJECT_KEY} AND labels = "{config.UPLOAD_LABEL}"', ["labels"]):
        for lab in issue["fields"]["labels"]:
            if lab.startswith("challenge-"):
                already[lab] = issue["key"]

    uploaded = {}
    for idx, rec in enumerate(records):
        tag = f"challenge-{idx:02d}"
        if tag in already:
            print(f"[{idx:02d}] already uploaded as {already[tag]}, skipping")
            uploaded[already[tag]] = idx
            continue

        it = find_work_type(types, rec.get("Work type") or "Incident")
        if not it:
            print(f"[{idx:02d}] no Jira work type for '{rec.get('Work type')}', skipping")
            continue
        if it["id"] not in meta_cache:
            meta_cache[it["id"]] = j.create_fields(it["id"])

        warnings = []
        fields = build_fields(rec, idx, it, meta_cache[it["id"]], warnings.append)
        for w in warnings:
            print(f"[{idx:02d}]   warning: {w}")

        if args.dry_run:
            print(f"[{idx:02d}] DRY RUN {rec['Summary'][:60]}")
            print(json.dumps({k: v for k, v in fields.items() if k != "description"}, indent=2))
            continue

        try:
            key = j.create_issue(fields)["key"]
        except JiraError as e:
            print(f"[{idx:02d}] FAILED: {e}")
            continue
        for c in rec.get("All Comments") or []:
            j.add_comment(key, c)
        uploaded[key] = idx
        print(f"[{idx:02d}] created {key}: {rec['Summary'][:60]}")

    if not args.dry_run:
        json.dump(uploaded, open("uploaded.json", "w"), indent=2)
        print(f"\nDone. {len(uploaded)} tickets in Jira, mapping saved to uploaded.json")


if __name__ == "__main__":
    main()
