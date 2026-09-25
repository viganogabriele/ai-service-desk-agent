"""Demo tickets (triage/generate.py) with a scripted writer instead of the LLM."""
import random

from triage import config
from triage.catalog import load_catalog, load_service_cards
from triage.data import load_challenge_raw
from triage.generate import DevTicket, adjacent, demo_ticket, names_service
from triage.priority import compute_priority

CATALOG, CARDS = load_catalog(), load_service_cards()
LEAKY = DevTicket(request_type="Human Created Incident", summary="Everything is down",
                  description="Broken: " + ", ".join(config.SERVICES), comments=["Still broken."],
                  work_type="Incident", urgency="High", impact="High")
CLEAN = LEAKY.model_copy(update={"description": "The morning NAV run stopped with a timeout for three funds."})


def writer(*replies):
    calls = []

    def chat(messages, model, temperature, seed):
        calls.append(messages)
        return replies[min(len(calls), len(replies)) - 1]
    chat.calls = calls
    return chat


def test_service_name_check():
    t = DevTicket(request_type="Human Created Incident", summary="SimCorp job failed",
                  description="x" * 50, work_type="Incident", urgency="High", impact="High")
    assert names_service(t, "SimCorp Dimension")
    assert not names_service(t, "Trade Matching")


def test_adjacent_service_prefers_same_team():
    catalog = {"service_team": {"A": "T1", "B": "T1", "C": "T2"}}
    assert adjacent(random.Random(0), "A", catalog) == "B"


def test_demo_tickets_have_the_challenge_shape():
    keys = set(load_challenge_raw()["records"][0])
    for seed in range(40):
        rec = demo_ticket(CATALOG, CARDS, random.Random(seed), chat=writer(CLEAN))
        assert set(rec) == keys
        assert rec["Status"] == "open" and rec["Assignee"] is None and rec["Resolution"] is None
        assert rec["Service Team(s)"] == [] and rec["Affected Business or IT Services"][0] in config.SERVICES
        assert rec["Request type"] in config.REQUEST_TYPE_PRIOR and rec["Work type"] in config.WORK_TYPES
        assert rec["Priority"] == compute_priority(rec["Urgency"], rec["Impact"])
        assert all(c.split(": ", 1)[0].count("@") == 1 for c in rec["All Comments"])


def test_a_ticket_that_names_its_service_is_rewritten():
    for seed in range(40):
        chat = writer(LEAKY, CLEAN)
        rec = demo_ticket(CATALOG, CARDS, random.Random(seed), chat=chat)
        if rec["Request type"] == "Nonsense / Unclear Input":  # no service to give away
            assert len(chat.calls) == 1
        else:
            assert len(chat.calls) == 2 and rec["Description"] == CLEAN.description
