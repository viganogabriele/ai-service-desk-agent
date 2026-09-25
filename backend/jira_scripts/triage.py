"""Plug your model in here.

loop.py calls triage(ticket) with a dict shaped like a challenge record
("Summary", "Description", "Affected Business or IT Services", ...) and expects
a dict back with the keys shown in baseline_triage(). Everything Jira-specific
stays in loop.py, so this file only has to be smart.
"""

from backend.jira_scripts.jira_client import rank

# README matrix. Rows: urgency rank 0..4 (Critical..Lowest).
# Columns: impact rank 0..4 (Major/Widespread .. No direct impact).
PRIORITY_MATRIX = [
    ["Highest", "Highest", "High",   "Medium", "Medium"],
    ["Highest", "High",    "High",   "Medium", "Low"],
    ["High",    "High",    "Medium", "Low",    "Low"],
    ["Medium",  "Medium",  "Low",    "Low",    "Lowest"],
    ["Medium",  "Low",     "Low",    "Lowest", "Lowest"],
]


def priority_from(urgency, impact):
    u, i = rank(urgency), rank(impact)
    if u is None or i is None:
        return None
    return PRIORITY_MATRIX[u][i]


def triage(ticket):
    # TODO: replace with your real pipeline (retrieval over the 20k tickets + LLM).
    return baseline_triage(ticket)


def baseline_triage(ticket):
    """Dumb placeholder so the loop runs end to end: keeps what the ticket
    already says and only fixes Priority. Your model should beat this easily."""
    service = (ticket.get("Affected Business or IT Services") or [None])[0]
    urgency = ticket.get("Urgency") or "Medium"
    impact = ticket.get("Impact") or "Medium"
    return {
        "work_type": ticket.get("Work type"),          # "Incident" | "Service Request"
        "service": service,                            # one of the 20 services
        "team": (ticket.get("Service Team(s)") or ["Service Desk"])[0],
        "assignee": ticket.get("Assignee"),            # e.g. "oliver.varga@intcom.com"
        "urgency": urgency,
        "impact": impact,
        "priority": priority_from(urgency, impact),    # loop.py recomputes this anyway
        "resolution": "done",                          # done | cancelled | clarification | cannot reproduce
        "resolution_comment": (
            f"Placeholder triage for {service}. Replace baseline_triage() with the real model."
        ),
    }
