"""Build the dashboard's compact, reproducible data bundle from source files.

AI proposals are read from solver output only; nothing is generated here:
1. `dashboard/data/proposals.json` (`Proposal` in `src/domain.ts`, checked by `validate()`), if present;
2. otherwise the saved triage PoC output `dashboard/fixtures/triaged.json`, if it matches the incoming tickets;
3. otherwise no proposals, and the UI shows the reporter-declared values.
"""

from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
import json
import math
import re


ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = Path(__file__).resolve().parents[1]
DATA = ROOT / "backend/jira_scripts/data"
HISTORY = DATA / "jira_first_20000_requested_fields_synthetic.json"
CHALLENGE = DATA / "challenge_blind.json"
OUTPUT = DASHBOARD / "public/dashboard-data.json"
PROPOSAL_FILE = DASHBOARD / "data/proposals.json"
SOLVER_OUTPUT = DASHBOARD / "fixtures/triaged.json"
LEVELS = ["Highest", "High", "Medium", "Low", "Lowest"]
RESOLUTIONS = ["done", "cancelled", "clarification", "cannot reproduce"]
# Minimum TF-IDF cosine similarity for a historical resolution to be offered as a reference.
SIMILARITY_FLOOR = 0.08
STOPWORDS = set(
    "the and for with that this from are was were has have had not but been into after before "
    "will can our their its his her they them you your all any per via than then also only need "
    "needs requested request".split()
)

historical = json.loads(HISTORY.read_text())
challenge = json.loads(CHALLENGE.read_text())["records"]


def level(value, where):
    match = next((item for item in LEVELS if item.lower() == str(value).lower()), None)
    if match is None:
        raise ValueError(f"{where}: unknown level {value!r}")
    return match


def ticket_id(index):
    return f"CH-{index + 1:02}"


for position, record in enumerate(challenge):
    record["Urgency"] = level(record["Urgency"], f"{ticket_id(position)} declared urgency")
    record["Impact"] = level(record["Impact"], f"{ticket_id(position)} declared impact")


# Historical aggregates -------------------------------------------------------------------------
status = Counter()
resolution = Counter()
work_type = Counter()
services = Counter()
teams = Counter()
weekly = Counter()
created_dates = []

for ticket in historical:
    status[ticket["Status"].lower()] += 1
    work_type[ticket["Work type"]] += 1
    if ticket["Status"].lower() == "done":
        resolution[ticket["Resolution"].lower()] += 1
    services[ticket["Affected Business or IT Services"][0]] += 1
    teams[ticket["Service Team(s)"][0]] += 1
    created = datetime.strptime(ticket["Created date"], "%Y-%m-%d %H:%M").date()
    created_dates.append(created)
    weekly[created - timedelta(days=created.weekday())] += 1

first_day, last_day = min(created_dates), max(created_dates)
# Partial first and last weeks would bias the trend, so only complete Monday-start weeks are kept.
complete_weeks = sorted(
    week for week in weekly if week >= first_day and week + timedelta(days=6) <= last_day
)


# Proposals -------------------------------------------------------------------------------------
def from_solver_output(records):
    """Map saved triage PoC records onto the `Proposal` shape that `validate()` checks."""
    proposals = []
    for index, (row, source) in enumerate(zip(records, challenge)):
        if row["Summary"] != source["Summary"]:
            raise ValueError(f"{SOLVER_OUTPUT} record {index} does not match the incoming ticket")
        triage = row["_triage"]
        assignee = row.get("Assignee") or ""
        support = triage.get("historical_assignee_support") or 0
        proposals.append({
            "ticket_id": ticket_id(index),
            "model_id": triage["model"],
            "latency_ms": round((triage["classification_seconds"] + triage["comment_seconds"]) * 1000),
            "cost_chf": None,
            "proposal": {
                "work_type": row["Work type"],
                "service": row["Affected Business or IT Services"][0],
                "assignee_candidates": [{
                    "email": assignee,
                    "historical_count": round(triage["historical_assignee_vote_share"] * support),
                    "support": support,
                }] if assignee else [],
                "urgency": level(row["Urgency"], f"{ticket_id(index)} urgency"),
                "impact": level(row["Impact"], f"{ticket_id(index)} impact"),
                "resolution": row["Resolution"],
                "resolution_comment": row.get("Resolution text") or "",
            },
            "rationale": triage.get("reason") or "",
            "review_flags": triage.get("review_flags") or [],
            "content_clues": triage.get("content_clues") or [],
        })
    return proposals


def validate(proposal):
    body = proposal["proposal"]
    body["urgency"] = level(body["urgency"], f"{proposal['ticket_id']} urgency")
    body["impact"] = level(body["impact"], f"{proposal['ticket_id']} impact")
    if body["resolution"] not in RESOLUTIONS:
        raise ValueError(f"{proposal['ticket_id']}: unknown resolution {body['resolution']!r}")
    # Proposal comments are `email: text`; the dashboard stores the text and the assignee separately.
    comment = body.get("resolution_comment") or ""
    prefix = f"{body['assignee_candidates'][0]['email']}:" if body.get("assignee_candidates") else ""
    if prefix and comment.startswith(prefix):
        body["resolution_comment"] = comment[len(prefix):].strip()
    proposal.setdefault("review_flags", [])
    proposal.setdefault("rationale", "")
    return proposal


if PROPOSAL_FILE.exists():
    supplied = {item["ticket_id"]: item for item in json.loads(PROPOSAL_FILE.read_text())["proposals"]}
    proposals = [validate(supplied[ticket_id(i)]) if ticket_id(i) in supplied else None for i in range(len(challenge))]
    proposal_source = {"kind": "file", "path": "dashboard/data/proposals.json"}
elif SOLVER_OUTPUT.exists():
    records = json.loads(SOLVER_OUTPUT.read_text())["records"]
    if len(records) != len(challenge):
        raise ValueError(f"{SOLVER_OUTPUT} has {len(records)} records for {len(challenge)} tickets")
    proposals = [validate(item) for item in from_solver_output(records)]
    proposal_source = {"kind": "solver_output", "path": "dashboard/fixtures/triaged.json"}
else:
    proposals = [None] * len(challenge)
    proposal_source = {"kind": "none", "path": None}


# Similar resolved tickets ----------------------------------------------------------------------
def narrative(ticket):
    """The documented fix: the last `Resolution:` comment on a ticket resolved as done."""
    for comment in reversed(ticket["All Comments"]):
        body = comment.split(":", 1)[1].strip() if ":" in comment else comment
        if body.lower().startswith("resolution:"):
            return body.split(":", 1)[1].strip()
    return None


def tokens(text):
    return [word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in STOPWORDS]


resolved = []
for index, ticket in enumerate(historical):
    if ticket["Resolution"] == "done" and (text := narrative(ticket)):
        resolved.append((index, ticket, text))

narrative_use = Counter(text for _, _, text in resolved)
documents = [tokens(f"{t['Summary']} {t['Description']} {text}") for _, t, text in resolved]
document_frequency = Counter(word for words in documents for word in set(words))
idf = {word: math.log(len(documents) / (1 + count)) for word, count in document_frequency.items()}


def vector(words):
    counts = Counter(words)
    weights = {w: (1 + math.log(n)) * idf.get(w, math.log(len(documents))) for w, n in counts.items()}
    norm = math.sqrt(sum(value * value for value in weights.values())) or 1
    return {word: value / norm for word, value in weights.items()}


vectors = [vector(words) for words in documents]
similar = {}
for index, ticket in enumerate(challenge):
    query = vector(tokens(" ".join([ticket["Summary"], ticket["Description"], *ticket["All Comments"]])))
    scored = sorted(
        ((sum(query.get(word, 0) * value for word, value in item.items()), position)
         for position, item in enumerate(vectors)),
        reverse=True,
    )
    matches, seen = [], set()
    for score, position in scored:
        if score < SIMILARITY_FLOOR or len(matches) == 6:
            break
        historical_index, source, text = resolved[position]
        if text in seen:
            continue
        seen.add(text)
        matches.append({
            "historical_index": historical_index,
            "summary": source["Summary"],
            "service": source["Affected Business or IT Services"][0],
            "resolution_date": source.get("Resolution date"),
            "resolution_text": text,
            "times_used": narrative_use[text],
            "similarity": round(score, 3),
        })
    similar[ticket_id(index)] = matches

assignees = sorted({ticket["Assignee"] for ticket in historical if ticket["Assignee"]})

bundle = {
    "historical": {
        "total": len(historical),
        "status": status,
        "resolution": resolution,
        "work_type": work_type,
        "generic_bucket": services["Emailed Support Tickets"],
        "service": services,
        "team": teams,
        "first_day": first_day.isoformat(),
        "last_day": last_day.isoformat(),
        "days": (last_day - first_day).days + 1,
        "weekly": [{"week": week.isoformat(), "count": weekly[week]} for week in complete_weeks],
    },
    "challenge": challenge,
    "proposals": proposals,
    "proposal_source": proposal_source,
    "similar": similar,
    "assignees": assignees,
    "historical_examples": {
        str(item["historical_index"]): historical[item["historical_index"]]
        for matches in similar.values()
        for item in matches
    },
}
OUTPUT.write_text(json.dumps(bundle, separators=(",", ":")))
print(
    f"Prepared {len(historical)} historical tickets, {len(challenge)} incoming tickets, "
    f"{sum(p is not None for p in proposals)} AI proposals ({proposal_source['kind']})"
)
