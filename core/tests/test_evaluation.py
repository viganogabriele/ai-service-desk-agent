import json

from triage.evaluation import load_labelled, score
from triage.schemas import DecisionRecord, Evidence, PatternEvidence, RunRecord

V = {"model": "m", "prompt": "p", "kb": "k", "policy": "po"}


def _run(tid, service, conf, top=("P20", "q@intcom.com", "Trade Matching", 0.8)):
    ai = lambda f, v, **kw: DecisionRecord(field=f, value=v, effective_value=v, source="ai_judgment",  # noqa: E731
                                           confidence=conf, reason="r", **kw)
    ev = Evidence(patterns=[PatternEvidence(pattern_id=top[0], resolver=top[1], service=top[2], similarity=top[3])])
    d = {"service": ai("service", service, evidence=ev), "work_type": ai("work_type", "Incident"),
         "resolution": ai("resolution", "done"), "urgency": ai("urgency", "High"), "impact": ai("impact", "High")}
    d["priority"] = DecisionRecord(field="priority", value="High", effective_value="High", source="rule",
                                   confidence=conf, reason="r", rule_trace="t")
    return RunRecord(run_id="r", ticket_id=tid, snapshot_id="s", status="completed", started_at="now", versions=V,
                     decisions=d)


def test_score_counts_fields_confidence_and_patterns():
    label = {"service": "Trade Matching", "work_type": "Incident", "resolution": "done", "urgency": "High",
             "impact": "Medium", "priority": "High", "kind": "pattern", "assignee": "q@intcom.com",
             "assignee_source": "pattern_match", "source_pattern": "P20"}
    runs = [_run("A", "Trade Matching", 0.9), _run("B", "Order Management", 0.3)]
    res = score(runs, [("A", {}, label), ("B", {}, label)])
    assert res["fields"]["service"] == (1, 2) and res["fields"]["impact"] == (0, 2)
    assert res["conf"] == {"right": [0.9], "wrong": [0.3]}
    assert res["top_pattern"]["pattern_hit"] == 2 and res["top_pattern"]["resolver_hit"] == 2
    assert res["by_kind"]["pattern"] == (1, 2)
    # No assignee decisions in these runs: every labelled assignee is a miss, split by service.
    assert res["assignee_service_right"] == (0, 1) and res["assignee_service_wrong"] == (0, 1)


def test_failed_runs_are_counted_not_scored():
    failed = RunRecord(run_id="r", ticket_id="X", snapshot_id="s", status="failed", started_at="now", versions=V,
                       error="boom")
    res = score([failed], [("X", {}, {"service": "Trade Matching"})])
    assert res["failed"] == 1 and res["fields"]["service"] == (0, 0)


def test_load_labelled_strips_labels_and_adds_priority(tmp_path):
    p = tmp_path / "f.json"
    p.write_text(json.dumps({"records": [{"id": "H1", "Summary": "s", "_label": {"urgency": "High", "impact": "Low"}}]}))
    [(tid, ticket, label)] = load_labelled(p)
    assert tid == "H1" and ticket == {"Summary": "s"} and label["priority"] == "Medium"
