"""Everything specific to your Jira site lives here."""

PROJECT_KEY = "SUP"

# Custom field ids from /rest/api/3/field
FIELDS = {
    "affected_service": "customfield_10059",
    "service_team": "customfield_10060",
    "business_entity": "customfield_10061",
    "proposed_assignee": "customfield_10062",
    "original_reporter": "customfield_10063",
    "urgency": "customfield_10053",
    "impact": "customfield_10004",
}

# Work type names in the challenge data -> words to look for in Jira's work type names
WORK_TYPES = {
    "Incident": "incident",
    "Service Request": "service request",
}

# Labels
UPLOAD_LABEL = "hackathon-challenge"  # every ticket we upload or want triaged
TRIAGED_LABEL = "ai-triaged"          # added by the loop once a ticket is done

# Resolution vocabulary from the training data -> Jira resolution names
RESOLUTIONS = {
    "done": "Done",
    "cancelled": "Cancelled",
    "clarification": "Clarification",
    "cannot reproduce": "Cannot Reproduce",
}

POLL_SECONDS = 10
