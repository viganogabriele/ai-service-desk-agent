"""Challenge-style tickets written by the LLM, for the dev set (eval/make_devset.py) and demos.

Built only from the KB (training-mined patterns + reviewed service cards) and generic
domain knowledge - never from the challenge file."""
import random
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from triage import config
from triage.llm import chat_structured
from triage.priority import compute_priority

GEN_TEMPERATURE = 0.8
ENTITIES = ["Switzerland", "France", "Luxembourg", "Germany", "Nordics"]
# Product words that give the service away as surely as its name.
GIVEAWAYS = {"SimCorp Dimension": ["simcorp"], "Rimes Data Feed": ["rimes"],
             "SharePoint & File Storage": ["sharepoint"], "Outlook & Email": ["outlook"]}


class DevTicket(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_type: Literal[tuple(config.REQUEST_TYPE_PRIOR)]
    summary: str = Field(min_length=5, max_length=120)
    description: str = Field(min_length=40, max_length=900)
    comments: list[str] = Field(default_factory=list, max_length=2)
    work_type: Literal[tuple(config.WORK_TYPES)]
    urgency: Literal[tuple(config.LEVELS)]
    impact: Literal[tuple(config.LEVELS)]


SYSTEM = """You write realistic Jira service-desk tickets for a pan-European asset manager (Switzerland, France, Luxembourg, Germany, Nordics), as a reporter would: concrete systems, funds, amounts, times, error messages, what was tried. 60-150 words of description, plus 0-2 short follow-up comments from colleagues.
Never mention the name of the affected IT service or of any support team; describe the symptoms and the business activity instead.
Also give your own honest assessment of work_type, urgency and impact.
Urgency levels: """ + "; ".join(f"{k}={v}" for k, v in config.URGENCY_DEFINITIONS.items()) + """
Impact levels: """ + "; ".join(f"{k}={v}" for k, v in config.IMPACT_DEFINITIONS.items())


def card(cards: dict, service: str) -> dict:
    return next(c for c in cards["cards"] if c["service"] == service)


MISLEADING_TITLE = ("Give it a misleading title about the kind of ticket: if it is really an outage or error, "
                    "make the title sound like a routine request; if it is really a request, make the title sound "
                    "like an urgent outage. The description must still describe the real situation accurately.\n")


def scenario_prompt(kind: str, service: str, card: dict, pattern: dict | None, misleading_title: bool) -> str:
    base = f"The ticket concerns work handled by this area (do not name it): {card['scope']}\n"
    if kind == "pattern":
        base += ("The problem or request must be one that was later fixed like this (do not mention the fix, "
                 f"the reporter does not know it yet): {pattern['text'][len(config.RESOLUTION_PREFIX):]}\n")
    elif kind == "card":
        base += "Invent a typical, actionable problem or request within that area.\n"
    elif kind == "clarification":
        base += ("The reporter asks for something plausible in that area but leaves out essential details "
                 "(which system, which role or fund, who approves), so support cannot act yet.\n")
    elif kind == "cannot_reproduce":
        base += ("It is an automated monitoring alert that had already cleared by itself when someone looked; "
                 "a colleague's comment confirms no errors or impact were found.\n")
    if misleading_title:
        base += MISLEADING_TITLE
    return base + "Return the ticket as JSON."


NONSENSE_PROMPT = ("Write an accidental or nonsense ticket: a pocket-sent message, a test, or unrelated chatter, "
                   "with nothing actionable. Keep the description short but at least 40 characters. Return JSON.")


def adjacent(rng: random.Random, service: str, catalog: dict) -> str:
    team = catalog["service_team"][service]
    same_team = [s for s, t in catalog["service_team"].items() if t == team and s != service]
    others = [s for s in config.SERVICES if s != service]
    return rng.choice(same_team or others)


def names_service(ticket: DevTicket, service: str) -> bool:
    text = " ".join([ticket.summary, ticket.description, *ticket.comments]).lower()
    return service.lower() in text or any(w in text for w in GIVEAWAYS.get(service, []))


def generate(user: str, rng: random.Random, avoid: list[str], chat=chat_structured) -> DevTicket:
    """Retry until the ticket names none of the `avoid` services: its
    true service, and the wrong reported one (that must only live in the reported field)."""
    forbidden = sorted({word for service in avoid for word in [service, *GIVEAWAYS.get(service, [])]})
    extra_rng = None
    for attempt in range(12):
        if attempt == 4:
            extra_rng = random.Random(repr(rng.getstate()))
        seed = (extra_rng or rng).randrange(1, 10**6)
        prompt = user
        if attempt >= 4:
            prompt += "\nDo not use any of these service or product names: " + ", ".join(forbidden)
        t = chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], DevTicket,
                 temperature=GEN_TEMPERATURE, seed=seed)
        if not any(names_service(t, s) for s in avoid):
            return t
    raise RuntimeError(f"Could not generate a ticket without naming {avoid}")


# The 7b picks request types poorly (e.g. "New License" for a price-feed incident), so the
# request type is set here from the ticket kind and the generated work type.
REQUEST_TYPES = {
    "nonsense": ["Nonsense / Unclear Input"],
    "cannot_reproduce": ["Machine Created Alert"],
    "Incident": ["Machine Created Alert", "Human Created Incident", "Email / 3rd Party Warning"],
    "Service Request": ["New License", "Access to a Service"],
}


def request_type(rng: random.Random, kind: str, work_type: str, misleading_title: bool = False) -> str:
    if misleading_title:  # README: titles can be misleading about the work type
        return "Misclassified Service Request Title" if work_type == "Incident" else "Misclassified Incident Title"
    if kind == "clarification":  # a person asking for something, never a machine alert
        return "Access to a Service" if work_type == "Service Request" else "Human Created Incident"
    return rng.choice(REQUEST_TYPES.get(kind) or REQUEST_TYPES[work_type])


# Demo tickets: roughly the mix of the challenge's request types, most of them actionable.
DEMO_KINDS = {"pattern": 5, "card": 2, "clarification": 1, "cannot_reproduce": 1, "nonsense": 1}
DEMO_MISLEADING_SHARE = 0.2
DEMO_WRONG_SERVICE_SHARE = 0.5
DEMO_PEOPLE = ["alex.meier", "sofia.lind", "marc.dupont", "eva.keller", "jonas.berg", "clara.rossi",
               "lukas.wagner", "ines.moreau"]
# Reporter accounts the training data uses for alerts.
DEMO_SYSTEM_ACCOUNTS = ["sa_accounting@intcom.com", "sa_securities@intcom.com"]


def _reporter(rng: random.Random, request: str) -> str:
    if request == "Machine Created Alert":
        return rng.choice(DEMO_SYSTEM_ACCOUNTS)
    if request == "Email / 3rd Party Warning":
        return f"info@extcom_{rng.randint(1, 30):02d}.com"
    return f"{rng.choice(DEMO_PEOPLE)}@intcom.com"


def demo_ticket(catalog: dict, cards: dict, rng: random.Random, chat=chat_structured,
                now: datetime | None = None) -> dict:
    """One new open ticket in the challenge format, from a random KB scenario. Like the challenge,
    the reported service, work type and levels are the reporter's and often wrong; team, assignee
    and resolution are empty."""
    now = now or datetime.now()
    kind = rng.choices(list(DEMO_KINDS), weights=list(DEMO_KINDS.values()))[0]
    misleading = kind in ("pattern", "card") and rng.random() < DEMO_MISLEADING_SHARE
    pattern = rng.choice(catalog["patterns"]) if kind == "pattern" else None
    if pattern:
        service = pattern["service"]
    elif kind == "nonsense":
        service = None
    else:
        service = rng.choice([s for s in config.SERVICES if s != config.CATCH_ALL_SERVICE])

    if service is None:
        prompt, reported = NONSENSE_PROMPT, rng.choice(config.SERVICES)
    else:
        prompt = scenario_prompt(kind, service, card(cards, service), pattern, misleading)
        reported = adjacent(rng, service, catalog) if rng.random() < DEMO_WRONG_SERVICE_SHARE else service
    prompt += f"\nToday is {now:%A %d %B %Y}; any dates in the ticket are around today."
    avoid = [s for s in (service, reported) if s and s != config.CATCH_ALL_SERVICE and kind != "nonsense"]
    t = generate(prompt, rng, avoid, chat=chat)

    request = request_type(rng, kind, t.work_type, misleading)
    reporter = _reporter(rng, request)
    commenter = reporter if reporter.split("@")[0] in DEMO_PEOPLE else f"{rng.choice(DEMO_PEOPLE)}@intcom.com"
    # A misleading title also misleads the reporter's choice of work type.
    work_type = next(w for w in config.WORK_TYPES if w != t.work_type) if misleading else t.work_type
    urgency, impact = rng.choice(config.LEVELS), rng.choice(config.LEVELS)
    return {
        "Work type": work_type,
        "Request type": request,
        "Summary": t.summary,
        "Description": t.description,
        "Affected Business or IT Services": [reported],
        "Business Entity": [rng.choice(ENTITIES)],
        "Business Critical for Entity": [],
        "Service Team(s)": [],
        "Reporter": reporter,
        "Assignee": None,
        "Priority": compute_priority(urgency, impact),
        "Urgency": urgency,
        "Impact": impact,
        "Severity": None,
        "Created date": now.strftime("%Y-%m-%d %H:%M"),
        "Status": "open",
        "Linked issues": [],
        "Resolution": None,
        "Due date": None,
        "Resolution date": None,
        "All Comments": [f"{commenter}: {c}" for c in t.comments],
    }
