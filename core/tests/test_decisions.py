from triage import config
from triage.decisions import build_ai_decisions, original_values, priority_decision, snapshot_id, team_decision
from triage.schemas import TriageEvidence, TriageOutput, TriageSample

RECORD = {
    "Request type": "Machine Created Alert",
    "Summary": "Allocation rejects",
    "Description": "The matching adapter rejected every block allocation for the new broker.",
    "Affected Business or IT Services": ["Order Management"],
    "Service Team(s)": [],
    "Work type": "Service Request",
    "Urgency": "High",
    "Impact": "highest",
    "Priority": "Highest",
    "Assignee": None,
    "Resolution": None,
    "All Comments": [],
}
CORE = dict(reasoning="r", work_type="Incident", service="Trade Matching", urgency="High", impact="Medium", resolution="done")
FINAL = TriageOutput(**CORE)
EVIDENCE = TriageEvidence(service=["rejected every block allocation", "not in ticket"], impact=["the new broker"])
FIELDS = {k: v for k, v in CORE.items() if k != "reasoning"}
SAMPLES = [TriageSample(**FIELDS), TriageSample(**{**FIELDS, "service": "Order Management"}), TriageSample(**FIELDS)]
RETRIEVED = {
    "card_scores": {s: 0.5 for s in config.SERVICES} | {"Trade Matching": 0.78, "Order Management": 0.70},
    "cards": [{"service": "Trade Matching", "score": 0.78}, {"service": "Order Management", "score": 0.70},
              {"service": "Securities Settlement", "score": 0.66}],
    "patterns": [{"id": "P20", "service": "Trade Matching", "resolver": "q@intcom.com", "score": 0.80, "text": "t"}],
}


def _build():
    return build_ai_decisions(RECORD, FINAL, SAMPLES, RETRIEVED, EVIDENCE)


def test_original_values_normalised():
    o = original_values(RECORD)
    assert o["service"] == "Order Management" and o["impact"] == "Highest" and o["team"] is None and o["assignee"] is None


def test_ai_decisions_shape_and_signals():
    d = _build()
    assert list(d) == config.AI_FIELDS
    svc = d["service"]
    assert svc.source == "ai_judgment" and svc.value == svc.effective_value == "Trade Matching"
    assert svc.confidence_signals["self_consistency"] == 2 / 3
    assert svc.confidence_signals["card_agreement"] == 1.0 and svc.confidence_signals["pattern_agreement"] == 1.0
    assert "service_changed" in svc.flags
    assert [a.value for a in svc.alternatives][:2] == ["Order Management", "Securities Settlement"]
    assert svc.evidence.service_card == "Trade Matching" and svc.evidence.patterns[0].pattern_id == "P20"
    assert [s.text for s in svc.evidence.ticket_spans] == ["rejected every block allocation"]
    span = svc.evidence.ticket_spans[0]
    assert RECORD[span.field][span.start:span.end] == span.text


def test_flags_on_changes_and_downgrades():
    d = _build()
    assert "work_type_changed" in d["work_type"].flags
    assert "downgrade_on_critical" in d["impact"].flags        # Highest -> Medium on a critical service
    assert "downgrade_on_critical" not in d["urgency"].flags   # High -> High
    assert d["work_type"].confidence_signals == {"self_consistency": 1.0, "prior_agreement": 1.0}


def test_rule_decisions():
    d = _build()
    team = team_decision(d["service"], {"Trade Matching": "Investment Operations"}, original_values(RECORD))
    assert team.rule_trace == "team_of(Trade Matching) = Investment Operations"
    assert team.confidence == d["service"].confidence
    pr = priority_decision(d["urgency"], d["impact"], "Trade Matching", original_values(RECORD))
    assert pr.value == "High" and pr.rule_trace == "matrix[urgency=High][impact=Medium] = High"
    assert pr.confidence == min(d["urgency"].confidence, d["impact"].confidence)
    assert "downgrade_on_critical" in pr.flags  # Highest -> High


def test_snapshot_id_is_content_hash():
    assert snapshot_id(RECORD) == snapshot_id(dict(RECORD)) != snapshot_id({**RECORD, "Summary": "x"})


def test_no_evidence_means_no_spans():
    d = build_ai_decisions(RECORD, FINAL, SAMPLES, RETRIEVED, None)
    assert all(not r.evidence.ticket_spans for r in d.values())
