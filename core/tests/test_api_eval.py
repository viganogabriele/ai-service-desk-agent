"""API step 3 (CORE_API §5, §6D, §9): shadow evaluations, policy preview, calibration
adoption and emerging issues. Fake engine, inline worker."""
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from tests.test_api import FakeEngine, fields, post

AUTO = {"service": "Tax Reporting", "Work type": "Service Request", "Urgency": "Low", "Impact": "Low", "Priority": "Low"}


@pytest.fixture
def api(tmp_path):
    engine = FakeEngine(tmp_path / "kb")
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as client:
        client.engine = engine
        yield client


def event_types(api):
    return [e["type"] for e in api.get("/events?limit=1000").json()["events"]]


def override(api, out, field, value, reason):
    return api.post(f"/tickets/{out['ticket_id']}/overrides", json={
        "base_run_id": out["run_id"], "actor": "agent@x", "changes": [{"field": field, "value": value, "reason_code": reason}]})


def test_shadow_evaluation_compares_and_never_touches_effective_state(api):
    a = post(api, key="A", summary="Cash issue")
    override(api, a, "service", "Cash Management", "wrong_service")
    b = post(api, key="B")
    api.post(f"/tickets/{b['ticket_id']}/accept", json={"run_id": b["run_id"], "actor": "a@x"})
    post(api, key="C")  # no labels: not in the gold set
    before = {t: api.get(f"/tickets/{t}").json() for t in (a["ticket_id"], b["ticket_id"])}
    n_events = len(event_types(api))
    api.engine.model_plans["better"] = {"Cash issue": {"service": "Cash Management"}}

    r = api.post("/evaluations", json={"versions": {"model": "better"}, "ticket_set": "gold"})
    assert r.status_code == 202 and r.json()["tickets"] == 2
    ev = api.get(f"/evaluations/{r.json()['evaluation_id']}").json()
    res = ev["results"]
    assert ev["status"] == "completed" and res["versions"]["model"] == "better"
    assert res["summary"]["changed_matching_labels"] >= 1 and res["summary"]["failed"] == 0
    assert res["per_field"]["service"]["agreement_label"] == 1.0  # both labelled services now match
    assert {"ticket_id": a["ticket_id"], "field": "service", "shadow": "Cash Management", "live": "Tax Reporting",
            "label": "Cash Management"} in res["disagreements"]
    shadow = api.get(f"/runs/{res['shadow_run_ids'][0]}").json()
    assert shadow["mode"] == "shadow"
    for t, v in before.items():  # effective state, latest live run and lane untouched
        after = api.get(f"/tickets/{t}").json()
        assert after["effective_state"] == v["effective_state"] and after["latest_run"] == v["latest_run"]
    assert event_types(api)[n_events:] == ["evaluation.completed"]  # no run.* / sync events


def test_evaluation_validation(api):
    post(api)
    assert api.post("/evaluations", json={"versions": {"temperature": 1}}).status_code == 422
    assert api.post("/evaluations", json={"ticket_set": "all"}).status_code == 422
    assert api.post("/evaluations", json={"versions": {"kb": "v9"}}).status_code == 404
    assert api.post("/evaluations", json={"versions": {"policy": "p9"}}).status_code == 404
    assert api.post("/evaluations", json={"versions": {"prompt": "other"}}).json()["error"] == "unknown_prompt_version"
    assert api.get("/evaluations/e_nope").status_code == 404


def test_shadow_evaluation_of_a_draft_kb_on_recent_tickets(api):
    post(api, key="A")
    api.post("/kb/versions", json={"actor": "owner@x"})  # v2 draft
    ev = api.post("/evaluations", json={"versions": {"kb": "v2"}, "ticket_set": "recent", "days": 7}).json()
    res = api.get(f"/evaluations/{ev['evaluation_id']}").json()["results"]
    assert ev["tickets"] == 1 and res["versions"]["kb"] == "v2" and res["summary"]["changed_decisions"] == 0
    assert api.get("/health").json()["kb_version"] == "v1"  # evaluating a version never promotes it


def test_policy_preview(api):
    good = post(api, key="G", **AUTO)
    bad = post(api, key="B", **AUTO)
    api.post(f"/tickets/{good['ticket_id']}/accept", json={"run_id": good["run_id"], "actor": "a@x"})
    override(api, bad, "impact", "Medium", "wrong_impact")
    assert api.get(f"/runs/{good['run_id']}").json()["lane"] == "auto_applied"
    out = api.post("/policy/preview", json={"content": {"field_thresholds": {"service": 0.95}}}).json()
    assert out["current"]["auto_applied"] == 2 and out["current"]["auto_apply_rate"] == 1.0
    assert out["current"]["error_rate"] == 0.5  # one of the two auto-applied gold tickets was corrected
    assert out["proposed"]["auto_applied"] == 0 and out["tickets_changing_lane"] == 2
    assert api.get("/policy").json()["policy_version"] == "p1"  # preview persists nothing
    assert api.post("/policy/preview", json={"content": {"paused": "yes"}}).status_code == 422


def test_calibration_fit_adopt_and_preview(api):
    for i in range(24):  # 24 reviewed service decisions at raw 0.9: half accepted, half corrected
        out = post(api, key=f"K{i}", summary=f"ticket {i}", **AUTO)
        if i % 2:
            api.post(f"/tickets/{out['ticket_id']}/accept", json={"run_id": out["run_id"], "actor": "a@x"})
        else:
            override(api, out, "service", "Cash Management", "wrong_service")
    fitted = api.get("/metrics/calibration").json()["value"]["fitted"]
    assert fitted["calibration"]["service"] == [[0.9, 0.5]] and fitted["report"]["service"]["ece_before"] == pytest.approx(0.4)
    preview = api.post("/policy/preview", json={"content": {"calibration": fitted["calibration"]}}).json()
    assert preview["proposed"]["auto_applied"] < preview["current"]["auto_applied"]  # 0.5 < 0.6 threshold
    adopted = api.put("/policy", json={"actor": "owner@x", "content": {"calibration": fitted["calibration"]}}).json()
    new = post(api, key="NEW", summary="fresh", **AUTO)
    run = api.get(f"/runs/{new['run_id']}").json()
    svc = run["decisions"]["service"]
    assert svc["confidence"] == 0.5 and svc["confidence_signals"]["raw_confidence"] == 0.9
    assert run["versions"]["policy"] == adopted["policy_version"] and "below_threshold:service" in run["lane_reasons"]
    bad = {"calibration": {"service": [[0.5, 0.9], [1.0, 0.1]]}}
    assert api.put("/policy", json={"actor": "o", "content": bad}).status_code == 422


def test_emerging_issues_cluster_weak_matches(api):
    for i, summary in enumerate(["Unknown vendor feed", "Unknown vendor feed ", "Unknown vendor feed  ", "Other thing"]):
        api.engine.plan[summary] = {"sim": 0.3}
        text = "new vendor feed drops the fx rates file every night" if i < 3 else "printer on floor 3 jams"
        api.post("/tickets", json={"external_key": f"W{i}", "fields": fields(summary=summary, Description=text)})
    post(api, key="STRONG")  # a normal ticket with a strong match is not weak
    value = api.get("/metrics/emerging_issues").json()["value"]
    assert value["weak_tickets"] == 4
    [cluster] = value["clusters"]
    assert cluster["size"] == 3 and "vendor feed" in cluster["example"]
