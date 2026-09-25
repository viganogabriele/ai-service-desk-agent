"""Export the tickets from Jira back into the challenge format.

    python export.py challenge.json                 # writes submission.json
    python export.py challenge.json -o out.json

Reads Jira as the source of truth, so manual fixes made in Jira are included.
Needs uploaded.json (written by upload.py) to put tickets back in the original order.
"""

import argparse
import json
import os

import config
from jira_client import Jira, adf_to_text, option_label, rank
from loop import label_of
from upload import load_records

F = config.FIELDS
LEVELS = ["Highest", "High", "Medium", "Low", "Lowest"]  # challenge vocabulary


def to_level(jira_label):
    """'Significant / Large' -> 'High', 'Critical' -> 'Highest', etc."""
    r = rank(jira_label)
    return LEVELS[r] if r is not None else jira_label


def resolution_text(comments, original):
    """Last public comment that wasn't part of the original ticket."""
    for c in reversed(comments):
        text = adf_to_text(c["body"]).strip()
        if c.get("jsdPublic") is False or text.startswith("AI triage:"):
            continue
        if text not in original:
            return text
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="the original challenge file")
    ap.add_argument("-o", "--out", default="submission.json")
    args = ap.parse_args()

    records = load_records(args.file)
    key_to_idx = json.load(open("uploaded.json"))
    preds = json.load(open("triage_results.json")) if os.path.exists("triage_results.json") else {}

    j = Jira()
    fields = ["issuetype", "priority", "resolution", "status", "comment", *F.values()]
    issues = {i["key"]: i for i in j.search(
        f'project = {config.PROJECT_KEY} AND labels = "{config.UPLOAD_LABEL}"', fields)}

    out = []
    for key, idx in sorted(key_to_idx.items(), key=lambda kv: kv[1]):
        rec = dict(records[idx])
        issue = issues.get(key)
        if not issue:
            print(f"!! {key} not found in Jira, exported unchanged")
            out.append(rec)
            continue
        f = issue["fields"]
        pred = preds.get(key, {})

        # Jira may have refused a work type change, so the prediction wins here
        wt = f["issuetype"]["name"].lower()
        jira_wt = "Service Request" if "service request" in wt else "Incident"
        rec["Work type"] = pred.get("work_type") or jira_wt

        service = label_of(f.get(F["affected_service"]))
        team = label_of(f.get(F["service_team"]))
        rec["Affected Business or IT Services"] = [service] if service else []
        rec["Service Team(s)"] = [team] if team else []
        rec["Assignee"] = f.get(F["proposed_assignee"])
        rec["Urgency"] = to_level(option_label(f.get(F["urgency"]) or {})) or None
        rec["Impact"] = to_level(option_label(f.get(F["impact"]) or {})) or None
        rec["Priority"] = option_label(f.get("priority") or {}) or None
        res = option_label(f.get("resolution") or {})
        rec["Resolution"] = res.lower() or None
        rec["Status"] = "done" if res else rec.get("Status")

        comments = (f.get("comment") or {}).get("comments", [])
        text = resolution_text(comments, set(rec.get("All Comments") or []))
        rec["Resolution text"] = text or pred.get("resolution_comment")
        out.append(rec)

    json.dump(out, open(args.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"Exported {len(out)} tickets to {args.out}")


if __name__ == "__main__":
    main()
