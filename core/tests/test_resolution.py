import pytest

from triage import config
from triage.catalog import build_catalog
from triage.resolution import (
    attribute_segments,
    build_comment_messages,
    generate_comment,
    pick_exemplars,
    unsupported_specifics,
)
from triage.schemas import DecisionRecord, ResolutionComment


@pytest.fixture(scope="module")
def catalog(training):
    return build_catalog(training)


def test_same_service_exemplars_ranked_by_similarity(catalog):
    ids = [p["id"] for p in catalog["patterns"] if p["service"] == "Securities Settlement"]
    scores = {ids[0]: 0.2, ids[1]: 0.9, ids[2]: 0.5}
    ex, style_only = pick_exemplars("Securities Settlement", catalog, scores)
    assert [p["id"] for p in ex] == [ids[1], ids[2]] and style_only is False


def test_style_only_exemplars_from_team_then_anywhere(catalog):
    ex, style_only = pick_exemplars("Identity & Access Management", catalog, {})
    assert style_only and all(catalog["service_team"][p["service"]] == "Enterprise Applications" for p in ex)
    ex, style_only = pick_exemplars("NAV Calculation", catalog, {})  # Valuation & Pricing has no patterns
    assert style_only and len(ex) == 2


def test_segments_concatenate_and_attribute():
    body = "Resolution: Cleared the stuck acknowledgements on the settlement queue for the Frankfurt custodian and confirmed matching."
    ticket = "Our Frankfurt custodian status feed is delayed; the settlement queue for the Frankfurt custodian looks stuck."
    exemplar = "Resolution: Reviewed the settlement message queue, cleared several stuck acknowledgements, and replayed."
    segs = attribute_segments(body, ticket, [exemplar])
    assert "".join(s.text for s in segs) == body
    origins = {s.origin for s in segs}
    assert {"ticket", "exemplar", "generated"} >= origins and "ticket" in origins
    assert segs[0].origin == "exemplar" and segs[0].text.startswith("Resolution:")
    assert any(s.origin == "ticket" and "Frankfurt custodian" in s.text for s in segs)


def test_unsupported_specifics():
    body = "Replayed 42 trades via SWIFT for Bloomberg at 09:15 after the fix in Frankfurt."
    found = unsupported_specifics(body, ["Trades failed at 09:15 at the Frankfurt custodian.", "Replayed via SWIFT."])
    assert found == ["42", "Bloomberg"]


def _decisions(service="Securities Settlement", status="done"):
    def rec(field, value, source="ai_judgment", trace=None):
        return DecisionRecord(field=field, value=value, effective_value=value, source=source, confidence=0.9,
                              reason="r", rule_trace=trace)
    return {"service": rec("service", service), "resolution": rec("resolution", status),
            "team": rec("team", "Securities Operations", "rule", "t"),
            "assignee": rec("assignee", "ursula.klassen@intcom.com", "pattern_match")}


RECORD = {"Summary": "Custodian late", "Description": "The Frankfurt custodian sent status updates late for SETT-77.",
          "All Comments": ["a@intcom.com: fail-chasing already sent"]}


def test_comment_prompt_voice_status_and_rules(catalog):
    ex, style_only = pick_exemplars("Securities Settlement", catalog, {})
    sys_msg, user = (m["content"] for m in build_comment_messages(
        RECORD, "Securities Settlement", "Securities Operations", "clarification", "ursula.klassen@intcom.com", ex, style_only))
    assert "Ursula Klassen" in sys_msg and '"clarification"' in sys_msg and "missing details" in sys_msg
    assert "Problem fixed." in sys_msg and "never invent ticket numbers" in sys_msg
    assert ex[0]["text"] in user and "fail-chasing already sent" in user and "a@intcom.com" not in user


def test_generate_comment_record_and_ticket_id_guard(catalog):
    replies = iter(["Resolution: Matched late status updates for ABC-123 and paused fail-chasing.",
                    "Resolution: Paused fail-chasing for SETT-77 while the Frankfurt custodian caught up, then matched the updates."])
    seeds = []

    def chat(messages, model_cls, seed):
        seeds.append(seed)
        return ResolutionComment(text=next(replies))

    rec = generate_comment(RECORD, _decisions(), {"pattern_scores": {}}, catalog, chat=chat)
    assert rec.text.startswith("ursula.klassen@intcom.com: Resolution: Paused fail-chasing for SETT-77")
    assert len(seeds) == 2 and seeds[0] != seeds[1]  # the invented ABC-123 was retried
    assert "".join(s.text for s in rec.segments) == rec.text.split(": ", 1)[1]
    assert rec.exemplar_pattern_ids and rec.stale is False
