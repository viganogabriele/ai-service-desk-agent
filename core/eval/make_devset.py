"""Generate a labelled dev set of challenge-style tickets with the LLM.

Built only from the KB (training-mined patterns + reviewed service cards) and generic
domain knowledge - never from the challenge file. Labels come from the source:
service/assignee from the pattern (or the card for services without patterns),
resolution from the scenario; work type/urgency/impact are the generator's own and soft.

    python eval/make_devset.py            # writes eval/devset.json (cached, reproducible)
"""
import json
import random
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from triage import config  # noqa: E402
from triage.catalog import load_catalog, load_service_cards  # noqa: E402
from triage.llm import chat_structured  # noqa: E402
from triage.priority import compute_priority  # noqa: E402

OUT_PATH = config.ROOT / "eval" / "devset.json"
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


def _card(cards: dict, service: str) -> dict:
    return next(c for c in cards["cards"] if c["service"] == service)


MISLEADING_TITLE = ("Give it a misleading title about the kind of ticket: if it is really an outage or error, "
                    "make the title sound like a routine request; if it is really a request, make the title sound "
                    "like an urgent outage. The description must still describe the real situation accurately.\n")


def _scenario_prompt(kind: str, service: str, card: dict, pattern: dict | None, misleading_title: bool) -> str:
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


def _adjacent(rng: random.Random, service: str, catalog: dict) -> str:
    team = catalog["service_team"][service]
    same_team = [s for s, t in catalog["service_team"].items() if t == team and s != service]
    others = [s for s in config.SERVICES if s != service]
    return rng.choice(same_team or others)


def _names_service(ticket: DevTicket, service: str) -> bool:
    text = " ".join([ticket.summary, ticket.description, *ticket.comments]).lower()
    return service.lower() in text or any(w in text for w in GIVEAWAYS.get(service, []))


def _generate(user: str, rng: random.Random, avoid: list[str]) -> DevTicket:
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
        t = chat_structured([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], DevTicket,
                            temperature=GEN_TEMPERATURE, seed=seed)
        if not any(_names_service(t, s) for s in avoid):
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


def _request_type(tid: str, kind: str, work_type: str, misleading_title: bool = False) -> str:
    if misleading_title:  # README: titles can be misleading about the work type
        return "Misclassified Service Request Title" if work_type == "Incident" else "Misclassified Incident Title"
    if kind == "clarification":  # a person asking for something, never a machine alert
        return "Access to a Service" if work_type == "Service Request" else "Human Created Incident"
    options = REQUEST_TYPES.get(kind) or REQUEST_TYPES[work_type]
    return random.Random(f"request-type-{tid}").choice(options)  # own RNG: generation seeds stay unchanged


def _record(tid: str, t: DevTicket, reported: str, rng: random.Random, label: dict, names_service: bool,
            misleading_title: bool = False) -> dict:
    u, i = rng.choice(config.LEVELS), rng.choice(config.LEVELS)  # reported levels are unreliable, like the challenge
    authors = ["alex.meier", "sofia.lind", "marc.dupont", "eva.keller", "jonas.berg"]
    return {
        "id": tid,
        "Work type": rng.choice(config.WORK_TYPES),
        "Request type": _request_type(tid, label["kind"], t.work_type, misleading_title),
        "Summary": t.summary,
        "Description": t.description,
        "Affected Business or IT Services": [reported],
        "Business Entity": [rng.choice(ENTITIES)],
        "Business Critical for Entity": [],
        "Service Team(s)": [],
        "Assignee": None,
        "Priority": compute_priority(u, i),
        "Urgency": u,
        "Impact": i,
        "Resolution": None,
        "Status": "open",
        "All Comments": [f"{rng.choice(authors)}@intcom.com: {c}" for c in t.comments],
        "_label": {**label, "work_type": t.work_type, "urgency": t.urgency, "impact": t.impact,
                   "names_service": names_service, "misleading_title": misleading_title},
    }


def build_devset(catalog: dict, cards: dict, seed: int = 7) -> list[dict]:
    """Every ticket draws from its own RNG (seeded by its id), so editing one scenario
    never changes the generation seeds - and the cache hits - of the others."""
    fallback = {s: v["assignee"] for s, v in catalog["fallback_assignee"].items()}
    records = []

    def add(kind, svc, reported, label, pattern=None, misleading=False, prompt=None):
        tid = f"D{len(records) + 1:03d}"
        rng = random.Random(f"{seed}-{tid}")
        user = prompt or _scenario_prompt(kind, svc, _card(cards, svc), pattern, misleading)
        avoid = [s for s in (svc, reported) if s and s != config.CATCH_ALL_SERVICE and kind != "nonsense"]
        t = _generate(user, rng, avoid)
        records.append(_record(tid, t, reported, rng, {**label, "kind": kind}, bool(svc) and _names_service(t, svc),
                               misleading))

    # Variant 0 of each scenario: wrong (adjacent) reported service + a title misleading about the
    # work type, with an accurate description (as in the README). Variant 1: plain.
    for p in catalog["patterns"]:
        svc = p["service"]
        label = {"service": svc, "resolution": "done", "assignee": p["resolver"], "assignee_source": "pattern_match",
                 "source_pattern": p["id"]}
        pick = random.Random(f"{seed}-reported-{p['id']}")
        add("pattern", svc, _adjacent(pick, svc, catalog), label, pattern=p, misleading=True)
        add("pattern", svc, pick.choice([svc, config.CATCH_ALL_SERVICE]), label, pattern=p)

    no_pattern = [s for s in config.SERVICES if s not in catalog["resolvers_by_service"] and s != config.CATCH_ALL_SERVICE]
    for svc in no_pattern:
        label = {"service": svc, "resolution": "done", "assignee": fallback[svc], "assignee_source": "fallback",
                 "source_pattern": None}
        pick = random.Random(f"{seed}-reported-{svc}")
        add("card", svc, _adjacent(pick, svc, catalog), label, misleading=True)
        add("card", svc, pick.choice([svc, config.CATCH_ALL_SERVICE]), label)

    pick = random.Random(f"{seed}-special")
    candidates = [s for s in config.SERVICES if s != config.CATCH_ALL_SERVICE]
    for kind, resolution in (("clarification", "clarification"), ("cannot_reproduce", "cannot reproduce")):
        for svc in pick.sample(candidates, 3):
            add(kind, svc, _adjacent(pick, svc, catalog),
                {"service": svc, "resolution": resolution, "assignee": None, "assignee_source": None, "source_pattern": None})
    for _ in range(3):
        add("nonsense", None, pick.choice(config.SERVICES),
            {"service": config.CATCH_ALL_SERVICE, "resolution": "cancelled", "assignee": None, "assignee_source": None,
             "source_pattern": None}, prompt=NONSENSE_PROMPT)
    return records


def main() -> None:
    catalog, cards = load_catalog(), load_service_cards()
    records = build_devset(catalog, cards)
    OUT_PATH.write_text(json.dumps({
        "note": "LLM-generated dev set (eval/make_devset.py) from the KB only, never from the challenge. "
                "service/assignee/resolution labels are firm; work_type/urgency/impact are the generator's (soft). "
                "Optimistic: the same model writes and solves these tickets.",
        "model": config.TRIAGE_MODEL,
        "records": records,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    kinds = {}
    for r in records:
        kinds[r["_label"]["kind"]] = kinds.get(r["_label"]["kind"], 0) + 1
    leaks = sum(r["_label"]["names_service"] for r in records)
    print(f"Wrote {OUT_PATH.relative_to(config.ROOT)}: {len(records)} tickets {kinds}; {leaks} still name their service")


if __name__ == "__main__":
    main()
