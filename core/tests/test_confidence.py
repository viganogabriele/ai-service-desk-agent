import pytest

from triage import config
from triage.confidence import (
    ai_field_signals,
    assignee_confidence,
    combine,
    margin,
    rule_confidence,
    self_consistency,
    vote_alternatives,
)

CTX = {"card_scores": {"Trade Matching": 0.78, "Order Management": 0.70, "Cash Management": 0.60},
       "top_pattern": {"service": "Trade Matching", "score": 0.80}, "prior": "Incident"}


def test_self_consistency_and_margin():
    assert self_consistency("a", ["a", "b", "a"]) == pytest.approx(2 / 3)
    assert self_consistency("a", []) is None
    assert margin([0.5, 0.8, 0.7]) == pytest.approx(0.1)
    assert margin([0.5]) == 0.0


def test_service_signals_agree():
    s = ai_field_signals("service", "Trade Matching", ["Trade Matching"] * 3, CTX)
    assert s == {"self_consistency": 1.0, "card_agreement": 1.0, "retrieval_margin": pytest.approx(0.08),
                 "pattern_agreement": 1.0}
    assert combine(s) > 0.9


def test_service_disagreeing_with_card_and_pattern_is_low():
    # The H01 failure mode: LLM says Order Management, retrieval says Trade Matching.
    s = ai_field_signals("service", "Order Management", ["Order Management", "Trade Matching", "Order Management"], CTX)
    assert s["card_agreement"] == 0.0 and s["pattern_agreement"] == 0.0
    assert combine(s) < 0.5


def test_weak_top_pattern_does_not_vote():
    ctx = {**CTX, "top_pattern": {"service": "Trade Matching", "score": config.PATTERN_AGREEMENT_MIN_SIM - 0.01}}
    assert "pattern_agreement" not in ai_field_signals("service", "Trade Matching", [], ctx)


def test_work_type_prior_and_other_fields():
    assert ai_field_signals("work_type", "Incident", [], CTX) == {"prior_agreement": 1.0}
    assert ai_field_signals("urgency", "High", ["High", "Medium"], CTX) == {"self_consistency": 0.5}
    assert ai_field_signals("urgency", "High", [], CTX) == {}


def test_combine_normalises_and_handles_no_signals():
    assert combine({}) == config.NO_SIGNAL_CONFIDENCE
    assert combine({"retrieval_margin": 1.0}) == 1.0  # clipped
    assert combine({"retrieval_margin": config.RETRIEVAL_MARGIN_SCALE / 2}) == pytest.approx(0.5)
    assert combine({"self_consistency": 1.0, "card_agreement": 0.0}) == pytest.approx(0.5)


def test_assignee_and_rule_confidence():
    assert assignee_confidence("fallback", {}, 0.9) == config.FALLBACK_CONFIDENCE
    assert assignee_confidence("fallback", {}, 0.1) == 0.1
    strong = {"retrieval_similarity": 0.95, "retrieval_margin": 0.2}
    assert assignee_confidence("pattern_match", strong, 0.6) == 0.6  # capped by service
    assert assignee_confidence("pattern_match", strong, 1.0) > 0.8
    assert rule_confidence([0.7, 0.4]) == 0.4


def test_vote_alternatives():
    assert vote_alternatives("a", ["a", "b", "b", "c"]) == [("b", 0.5), ("c", 0.25)]
