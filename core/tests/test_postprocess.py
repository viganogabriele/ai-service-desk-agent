"""Milestone 3: assignee rule, lanes, output in the challenge structure."""
import json

import pytest

from triage import config
from triage.catalog import build_catalog
from triage.data import load_challenge_raw
from triage.decisions import assignee_alternatives, assignee_decision, original_values
from triage.lanes import assign_lane, audit_sampled
from triage.output import build_output, predictions_from_run
from triage.schemas import DecisionRecord, ResolutionCommentRecord, RunRecord


@pytest.fixture(scope="module")
def catalog(training):
    return build_catalog(training)


def _svc(service, conf=0.9, flags=()):
    return DecisionRecord(field="service", value=service, effective_value=service, source="ai_judgment",
                          confidence=conf, reason="r", flags=list(flags))


def _retrieved(catalog, top_id, top_score):
    scores = {p["id"]: 0.5 for p in catalog["patterns"]} | {top_id: top_score}
    top = next(p for p in catalog["patterns"] if p["id"] == top_id)
    return {"patterns": [{**top, "score": top_score}], "pattern_scores": scores}


def _pid(catalog, service, resolver=None):
    return next(p["id"] for p in catalog["patterns"] if p["service"] == service and (resolver is None or p["resolver"] == resolver))


ORIG = original_values({})


def test_pattern_match_assignee(catalog):
    pid = _pid(catalog, "Trade Matching")
    d = assignee_decision(_svc("Trade Matching"), _retrieved(catalog, pid, 0.85), catalog, ORIG)
    assert d.source == "pattern_match" and d.value == "quinn.anderson@intcom.com"
    assert d.flags == [] and d.confidence_signals["unique_resolver"] == 1.0
    assert d.confidence == 0.9  # a single-resolver service is as sure as the service itself
    assert {p.service for p in d.evidence.patterns} == {"Trade Matching"}


def test_securities_settlement_resolver_follows_the_pattern(catalog):
    for resolver in ("xena.schmidt@intcom.com", "ursula.klassen@intcom.com"):
        pid = _pid(catalog, "Securities Settlement", resolver)
        d = assignee_decision(_svc("Securities Settlement"), _retrieved(catalog, pid, 0.8), catalog, ORIG)
        assert d.value == resolver


def test_assignee_follows_the_service_not_the_top_pattern(catalog):
    # Weak similarity, or a closer pattern from another service, no longer drops a
    # service with a documented resolver to the (random) fallback.
    pid = _pid(catalog, "Trade Matching")
    weak = assignee_decision(_svc("Trade Matching"), _retrieved(catalog, pid, config.ASSIGNEE_SIM_THRESHOLD - 0.2),
                             catalog, ORIG)
    other = assignee_decision(_svc("Order Management"), _retrieved(catalog, pid, 0.95), catalog, ORIG)
    assert (weak.source, weak.value) == ("pattern_match", "quinn.anderson@intcom.com")
    assert (other.source, other.value) == ("pattern_match", "victor.hamon@intcom.com")


def _settlement_scores(catalog, xena: list[float], ursula: float) -> dict:
    ids = [p["id"] for p in catalog["patterns"] if p["service"] == "Securities Settlement"]
    by = {p["id"]: p["resolver"] for p in catalog["patterns"]}
    xs = iter(xena)
    scores = {pid: (next(xs) if by[pid] == "xena.schmidt@intcom.com" else ursula) for pid in ids}
    return {"patterns": [], "pattern_scores": {p["id"]: 0.5 for p in catalog["patterns"]} | scores}


def test_securities_settlement_resolver_is_the_best_on_average(catalog):
    # One xena pattern beats ursula's only pattern, but xena's patterns are weaker on average.
    d = assignee_decision(_svc("Securities Settlement"), _settlement_scores(catalog, [0.72, 0.56], 0.66), catalog, ORIG)
    assert d.value == "ursula.klassen@intcom.com"
    close = _settlement_scores(catalog, [0.80, 0.80], 0.79)
    clear = _settlement_scores(catalog, [0.80, 0.80], 0.50)
    d_close, d_clear = (assignee_decision(_svc("Securities Settlement", 1.0), r, catalog, ORIG) for r in (close, clear))
    assert d_close.value == d_clear.value == "xena.schmidt@intcom.com"
    assert d_close.confidence_signals["retrieval_margin"] == pytest.approx(0.01)
    assert d_close.confidence < d_clear.confidence


def test_fallback_only_for_services_without_resolver(catalog):
    pid = _pid(catalog, "Trade Matching")
    d = assignee_decision(_svc("NAV Calculation"), _retrieved(catalog, pid, 0.95), catalog, ORIG)
    assert d.source == "fallback" and d.value == catalog["fallback_assignee"]["NAV Calculation"]["assignee"]
    assert "fallback_assignee" in d.flags and d.confidence <= config.FALLBACK_CONFIDENCE
    assert "no documented resolver" in d.reason


def test_alternatives_only_from_pattern_resolvers(catalog):
    pid = _pid(catalog, "Securities Settlement", "xena.schmidt@intcom.com")
    d = assignee_decision(_svc("Securities Settlement"), _retrieved(catalog, pid, 0.8), catalog, ORIG)
    values = [a.value for a in d.alternatives]
    assert values[0] == "ursula.klassen@intcom.com"               # same service first
    assert values[-1] == catalog["fallback_assignee"]["Securities Settlement"]["assignee"]
    resolvers = {p["resolver"] for p in catalog["patterns"]}
    assert all(a.value in resolvers or a.source == "fallback" for a in d.alternatives)
    # A service without patterns: the fallback is the value, no alternatives at all.
    assert assignee_alternatives("NAV Calculation", "x", catalog, {}) == []


def _decisions(**over):
    def rec(field, value, source="ai_judgment", conf=0.9, flags=(), trace=None):
        return DecisionRecord(field=field, value=value, effective_value=value, source=source, confidence=conf,
                              reason="r", flags=list(flags), rule_trace=trace)
    d = {
        "work_type": rec("work_type", "Incident"), "service": rec("service", "Tax Reporting"),
        "urgency": rec("urgency", "Low"), "impact": rec("impact", "Low"), "resolution": rec("resolution", "done"),
        "team": rec("team", "Tax & Reporting", "rule", trace="t"), "priority": rec("priority", "Low", "rule", trace="t"),
        "assignee": rec("assignee", "tania.gupta@intcom.com", "pattern_match"),
    }
    for field, kw in over.items():
        d[field] = rec(field, kw.pop("value", d[field].value), kw.pop("source", d[field].source),
                       trace=d[field].rule_trace, **kw)
    return d


def test_lanes():
    assert assign_lane(_decisions(), "r1")[:2] == ("auto_applied", [])
    lane, reasons, sampled = assign_lane(_decisions(service={"flags": ["service_changed"]}), "r1")
    assert lane == "needs_review" and reasons == ["service_changed"] and sampled is False
    assert assign_lane(_decisions(urgency={"conf": 0.3}), "r")[1] == ["below_threshold:urgency"]
    assert assign_lane(_decisions(resolution={"value": "cancelled"}), "r")[0] == "human_only"
    lane, reasons, _ = assign_lane(_decisions(service={"value": "NAV Calculation", "flags": ["service_changed"]},
                                              priority={"value": "Highest"}), "r")
    assert lane == "human_only" and reasons == ["priority_highest_on_critical", "service_changed"]
    assert assign_lane(_decisions(impact={"flags": ["downgrade_on_critical"]}), "r")[0] == "human_only"


def test_policy_pause_and_suggest_only(monkeypatch):
    monkeypatch.setattr(config, "POLICY_PAUSED", True)
    assert assign_lane(_decisions(), "r")[:2] == ("needs_review", ["policy_paused"])
    monkeypatch.setattr(config, "POLICY_PAUSED", False)
    monkeypatch.setattr(config, "AUTONOMY_SERVICES", {"Tax Reporting": "suggest_only"})
    assert assign_lane(_decisions(), "r")[0] == "needs_review"


def test_audit_sampling_is_deterministic_and_near_rate():
    ids = [f"run-{i}" for i in range(2000)]
    share = sum(audit_sampled(i) for i in ids) / len(ids)
    assert abs(share - config.AUDIT_SAMPLE_RATE) < 0.03
    assert [audit_sampled(i) for i in ids[:50]] == [audit_sampled(i) for i in ids[:50]]


def _run(tid, decisions=None, comment=None, status="completed"):
    return RunRecord(run_id="r", ticket_id=tid, snapshot_id="s", status=status, started_at="now",
                     versions={"model": "m", "prompt": "p", "kb": "k", "policy": "po"},
                     decisions=decisions or {}, resolution_comment=comment, error=None if decisions else "boom")


def test_predictions_and_output_keep_challenge_structure():
    raw = load_challenge_raw()
    runs = [_run(f"R{i}", _decisions()) for i in range(len(raw["records"]))]
    runs[1] = _run("R1", status="failed")
    comment = ResolutionCommentRecord(text="tania.gupta@intcom.com: Resolution: Granted the entitlement and verified access.")
    runs[2] = _run("R2", _decisions(), comment)
    out = build_output(raw, runs)
    first = out["records"][0]
    assert first["Affected Business or IT Services"] == ["Tax Reporting"] and first["Service Team(s)"] == ["Tax & Reporting"]
    assert first["Priority"] == "Low" and first["Resolution"] == "done" and first["Status"] == "done"
    assert out["records"][1] == raw["records"][1]                      # failed run: untouched
    assert out["records"][2]["All Comments"] == raw["records"][2]["All Comments"] + [comment.text]
    assert first["All Comments"] == raw["records"][0]["All Comments"]  # no comment yet: untouched
    assert [list(r) for r in out["records"]] == [list(r) for r in raw["records"]]
    assert {k: v for k, v in out.items() if k != "records"} == {k: v for k, v in raw.items() if k != "records"}
    json.dumps(out)
    assert predictions_from_run(_run("x", status="failed")) == {}
