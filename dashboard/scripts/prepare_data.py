"""Build the dashboard's compact, reproducible data bundle from source files."""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
import json
import statistics


ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / "jira_first_20000_requested_fields_synthetic.json"
CHALLENGE = next(ROOT.glob("jira_hackathon_blind_eval_challenge_*.json"))
OUTPUT = Path(__file__).resolve().parents[1] / "public/dashboard-data.json"
PROPOSAL_FILE = Path(__file__).resolve().parents[1] / "data/proposals.json"
MODELS_FILE = Path(__file__).resolve().parents[1] / "data/models.json"
DEV_PREDICTIONS = ROOT / "output/dev_predictions.json"
DEV_REFERENCE = ROOT / "fixtures/dev_reference.json"

historical = json.loads(HISTORY.read_text())
challenge = json.loads(CHALLENGE.read_text())
status = Counter()
resolution = Counter()
work_type = Counter()
services = Counter()
teams = Counter()
entities = Counter()
weekly = Counter()
heatmap = [[0] * 24 for _ in range(7)]
created_dates = []
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
    teams[team] += 1
    for entity in ticket["Business Entity"]:
        entities[entity] += 1
    created = datetime.strptime(ticket["Created date"], "%Y-%m-%d %H:%M")
    created_dates.append(created.date())
    weekly[created.date() - timedelta(days=created.weekday())] += 1
    heatmap[created.weekday()][created.hour] += 1
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

first_day, last_day = min(created_dates), max(created_dates)
# Partial first and last weeks would bias the trend, so only complete Monday-start weeks are kept.
complete_weeks = sorted(
    week for week in weekly if week >= first_day and week + timedelta(days=6) <= last_day
)


def measured_models():
    """Model metrics from data/models.json, or from the saved local development run."""
    if MODELS_FILE.exists():
        return json.loads(MODELS_FILE.read_text())["models"], "file"
    if not DEV_PREDICTIONS.exists():
        return [], "none"
    predictions = json.loads(DEV_PREDICTIONS.read_text())["records"]
    reference = json.loads(DEV_REFERENCE.read_text())["records"] if DEV_REFERENCE.exists() else []
    latencies = sorted(
        (row["_triage"]["classification_seconds"] + row["_triage"]["comment_seconds"]) * 1000
        for row in predictions
    )
    model_id = predictions[0]["_triage"]["model"]
    holdout = None
    if len(reference) == len(predictions):
        pairs = list(zip(predictions, reference))
        holdout = {
            "n": len(pairs),
            "label": "labelled development fixtures",
            "accuracy": {
                "service": sum(
                    p["Affected Business or IT Services"][0] == r["Affected Business or IT Services"][0]
                    for p, r in pairs
                ) / len(pairs),
                "work_type": sum(p["Work type"] == r["Work type"] for p, r in pairs) / len(pairs),
            },
        }
    return [{
        "model_id": model_id,
        "label": "Local model (Ollama)",
        "kind": "local",
        "samples": len(latencies),
        "latency_ms_p50": round(statistics.median(latencies)),
        "latency_ms_p95": round(latencies[min(len(latencies) - 1, round(0.95 * (len(latencies) - 1)))]),
        "latency_ms_mean": round(statistics.fmean(latencies)),
        "cost_chf_per_ticket": None,
        "cost_note": "Local inference: hardware and energy cost not measured",
        "holdout": holdout,
    }], "dev_run"


models, models_source = measured_models()

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
        "service": services,
        "team": teams,
        "entity": entities,
        "first_day": first_day.isoformat(),
        "last_day": last_day.isoformat(),
        "days": (last_day - first_day).days + 1,
        "weekly": [{"week": week.isoformat(), "count": weekly[week]} for week in complete_weeks],
        "heatmap": heatmap,
    },
    "models": models,
    "models_source": models_source,
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
