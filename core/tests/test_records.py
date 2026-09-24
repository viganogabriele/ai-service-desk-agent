"""CORE_API §4 decision record, resolution-comment record and run record."""
import pytest
from pydantic import ValidationError

from triage.schemas import DecisionRecord, DecisionsFile, ResolutionCommentRecord, RunRecord, TicketSpan

AI = dict(field="service", value="Tax Reporting", effective_value="Tax Reporting", source="ai_judgment",
          confidence=0.7, reason="r")
RULE = dict(field="priority", value="High", effective_value="High", source="rule", confidence=0.5, reason="r",
            rule_trace="matrix[urgency=High][impact=Medium] = High")


def test_valid_records_round_trip():
    for d in (AI, RULE, dict(field="assignee", value="a@intcom.com", effective_value="a@intcom.com",
                             source="fallback", confidence=0.2, reason="r", flags=["fallback_assignee"])):
        rec = DecisionRecord(**d)
        assert DecisionRecord.model_validate_json(rec.model_dump_json()) == rec


def test_decision_record_has_core_api_keys():
    keys = set(DecisionRecord(**AI).model_dump())
    assert keys == {"field", "value", "original_value", "effective_value", "source", "confidence",
                    "confidence_signals", "reason", "rule_trace", "evidence", "alternatives", "flags", "pinned"}
    assert set(DecisionRecord(**AI).model_dump()["evidence"]) == {"ticket_spans", "patterns", "service_card"}


@pytest.mark.parametrize("bad", [
    dict(field="severity"),                                  # unknown field
    dict(value="Bloomberg", effective_value="Bloomberg"),    # invalid service
    dict(source="rule", rule_trace="x"),                     # service is never a rule field
    dict(rule_trace="team_of(x) = y"),                       # trace only on rule fields
    dict(confidence=1.2),
    dict(flags=["looks_odd"]),
    dict(effective_value="Cash Management"),                 # differs while not pinned
    dict(alternatives=[{"value": "x", "score": 2, "source": "ai_judgment"}]),
])
def test_decision_record_rejects(bad):
    with pytest.raises(ValidationError):
        DecisionRecord(**{**AI, **bad})


def test_rule_needs_trace_and_levels_are_checked():
    with pytest.raises(ValidationError):
        DecisionRecord(**{**RULE, "rule_trace": None})
    with pytest.raises(ValidationError):
        DecisionRecord(**{**RULE, "value": "high", "effective_value": "high"})


def test_pinned_allows_effective_value_from_override():
    rec = DecisionRecord(**{**AI, "pinned": True, "effective_value": "Cash Management"})
    assert rec.effective_value == "Cash Management"


def test_ticket_span_length_must_match():
    TicketSpan(field="Description", start=4, end=9, text="hello")
    with pytest.raises(ValidationError):
        TicketSpan(field="Description", start=4, end=12, text="hello")


def test_resolution_comment_record():
    text = "a@intcom.com: Resolution: Cleared the lock on the staging table and reran the sync."
    segs = [{"text": "Resolution: Cleared the lock on ", "origin": "exemplar"},
            {"text": "the staging table", "origin": "ticket"},
            {"text": " and reran the sync.", "origin": "generated"}]
    rec = ResolutionCommentRecord(text=text, segments=segs, exemplar_pattern_ids=["P16"])
    assert rec.stale is False and rec.edited_by is None
    for bad in (dict(text="Resolution: no assignee"), dict(text="a@intcom.com: Problem fixed."),
                dict(text="a@intcom.com: Resolution: Problem fixed."),
                dict(text=text, segments=segs[:2])):
        with pytest.raises(ValidationError):
            ResolutionCommentRecord(**bad)


def test_run_record_keys_must_match_fields():
    base = dict(run_id="r", ticket_id="t", snapshot_id="s", status="completed", started_at="now",
                versions={"model": "m", "prompt": "p", "kb": "k", "policy": "po"})
    RunRecord(**base, decisions={"service": DecisionRecord(**AI)})
    with pytest.raises(ValidationError):
        RunRecord(**base, decisions={"team": DecisionRecord(**AI)})
    DecisionsFile(run_id="r", created_at="now", source_file="f", versions=base["versions"], runs=[RunRecord(**base)])
