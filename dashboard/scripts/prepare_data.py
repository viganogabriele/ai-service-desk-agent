"""Build the dashboard's compact, reproducible data bundle from source files."""

from collections import Counter, defaultdict
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / "jira_first_20000_requested_fields_synthetic.json"
CHALLENGE = next(ROOT.glob("jira_hackathon_blind_eval_challenge_*.json"))
OUTPUT = Path(__file__).resolve().parents[1] / "public/dashboard-data.json"
PROPOSAL_FILE = Path(__file__).resolve().parents[1] / "data/proposals.json"

historical = json.loads(HISTORY.read_text())
challenge = json.loads(CHALLENGE.read_text())
status = Counter()
resolution = Counter()
work_type = Counter()
services = Counter()
assignees = defaultdict(Counter)
similar = defaultdict(list)

for index, ticket in enumerate(historical):
    status[ticket["Status"].lower()] += 1
    work_type[ticket["Work type"]] += 1
    if ticket["Status"].lower() == "done":
        resolution[ticket["Resolution"].lower()] += 1
    service = ticket["Affected Business or IT Services"][0]
    services[service] += 1
    team = ticket["Service Team(s)"][0]
    if ticket["Assignee"]:
        assignees[team][ticket["Assignee"]] += 1
    if len(similar[service]) < 3:
        similar[service].append({"historical_index": index, **ticket})

proposals = []
for index, ticket in enumerate(challenge["records"]):
    service = ticket["Affected Business or IT Services"][0]
    team = next(row["Service Team(s)"][0] for row in similar[service])
    candidates = [
        {"email": email, "historical_count": count}
        for email, count in assignees[team].most_common(3)
    ]
    assignee = candidates[0]["email"] if candidates else ""
    proposals.append({
        "ticket_id": f"CH-{index + 1:02}",
        "model_id": "mock-v1",
        "generated_at": "2026-09-24T10:00:00Z",
        "proposal": {
            "work_type": ticket["Work type"],
            "service": service,
            "assignee_candidates": candidates,
            "urgency": ticket["Urgency"].title(),
            "impact": ticket["Impact"].title(),
            "resolution": "clarification" if ticket["Request type"] == "Nonsense / Unclear Input" else "done",
            "resolution_comment": f"{assignee}: Please review the request details and confirm the appropriate next action for {service}.",
        },
        "confidence": {"work_type": 0.65, "service": 0.65},
        "rationale": "MOCK: starting proposal mirrors the declared ticket fields; operator verification is required.",
        "similar_tickets": [
            {
                "historical_index": row["historical_index"],
                "summary": row["Summary"],
                "service": service,
                "resolution": row["Resolution"],
                "last_comment": row["All Comments"][-1] if row["All Comments"] else "",
                "similarity": None,
            }
            for row in similar[service]
        ],
    })

mock = not PROPOSAL_FILE.exists()
if not mock:
    supplied = json.loads(PROPOSAL_FILE.read_text())["proposals"]
    indexed = {item["ticket_id"]: item for item in supplied}
    expected = {item["ticket_id"] for item in proposals}
    if set(indexed) != expected:
        raise ValueError("data/proposals.json must contain exactly CH-01 through CH-20")
    proposals = [indexed[item["ticket_id"]] for item in proposals]

bundle = {
    "mock": mock,
    "historical": {
        "total": len(historical),
        "status": status,
        "resolution": resolution,
        "work_type": work_type,
        "generic_bucket": services["Emailed Support Tickets"],
    },
    "challenge": challenge["records"],
    "proposals": proposals,
    "assignees": sorted({email for counts in assignees.values() for email in counts}),
    "historical_examples": {
        str(index): historical[index]
        for index in {
            item["historical_index"]
            for proposal in proposals
            for item in proposal.get("similar_tickets", [])
        }
        if 0 <= index < len(historical)
    },
}
OUTPUT.write_text(json.dumps(bundle, separators=(",", ":")))
print(f"Prepared {len(historical)} historical tickets and {len(proposals)} challenge proposals")
