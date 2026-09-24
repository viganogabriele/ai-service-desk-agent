"""API step 2 (CORE_API §6C, §6D, §9): KB lifecycle, closures, proposals, learning from
overrides, policy + pause, audit and metrics. Fake engine, inline worker, temp KB store."""
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from tests.test_api import FakeEngine, fields, post

SPECIFIC = ("Traced the rejection to a stale withholding tax rate table; corrected the rates, "
            "reprocessed the quarterly extract and verified the totals matched the tax pack.")


@pytest.fixture
def api(tmp_path):
    engine = FakeEngine(tmp_path / "kb")
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as client:
        client.engine = engine
        yield client


def events(api, prefix=""):
    return [e for e in api.get("/events?limit=1000").json()["events"] if e["type"].startswith(prefix)]


def close(api, tid, note, resolver="tania.gupta@intcom.com", service="Tax Reporting"):
    return api.post(f"/tickets/{tid}/closure", json={"fields": {"Affected Business or IT Services": [service]},
                                                     "resolution_note": note, "resolver": resolver, "actor": "jira-sync"})


def test_kb_versions_listing_and_detail(api):
    body = api.get("/kb/versions").json()
    assert body["live"] == "v1" and [v["kb_version"] for v in body["versions"]] == ["v1"]
    v1 = api.get("/kb/versions/v1").json()
    assert v1["status"] == "live" and len(v1["content"]["patterns"]) == 21 and len(v1["content"]["service_cards"]) == 20
    assert api.get("/kb/versions/v9").status_code == 404


def test_closure_harvesting(api):
    tid = post(api)["ticket_id"]
    good = close(api, tid, SPECIFIC).json()
    assert good["outcome"] == "proposal" and good["score"]["specific"] and good["proposal_id"]
    assert close(api, tid, "Problem fixed.").json()["outcome"] == "backlog"
    assert close(api, tid, None).json()["score"]["missing"] is True
    assert close(api, tid, SPECIFIC).json()["outcome"] == "duplicate"  # already proposed
    known = api.get("/kb/versions/v1").json()["content"]["patterns"][0]
    assert close(api, tid, known["text"], known["resolver"], known["service"]).json()["outcome"] == "duplicate"
    [p] = api.get("/kb/proposals?status=open").json()["proposals"]
    assert p["type"] == "add_pattern" and p["payload"]["service"] == "Tax Reporting" and p["evidence"]["ticket_ids"] == [tid]
    health = api.get("/kb/health").json()
    assert {b["reason"] for b in health["closure_backlog"]} == {"vague", "missing"}
    assert health["training_corpus"]["tickets"] == 20000 and health["training_corpus"]["vague"] > 0
    assert "NAV Calculation" in health["services_without_patterns"]


def test_proposal_decisions(api):
    tid = post(api)["ticket_id"]
    pid = close(api, tid, SPECIFIC).json()["proposal_id"]
    assert api.post(f"/kb/proposals/{pid}/reject", json={"actor": "owner@x"}).status_code == 422  # reason needed
    bad = {"text": "x", "service": "Nope", "resolver": "a@x"}
    assert api.post(f"/kb/proposals/{pid}/approve", json={"actor": "owner@x", "payload": bad}).status_code == 422
    edited = {"text": SPECIFIC, "service": "Tax Reporting", "resolver": "tania.gupta@intcom.com"}
    ok = api.post(f"/kb/proposals/{pid}/approve", json={"actor": "owner@x", "payload": edited})
    assert ok.status_code == 200 and ok.json()["status"] == "approved" and ok.json()["decided_by"] == "owner@x"
    assert api.post(f"/kb/proposals/{pid}/approve", json={"actor": "owner@x"}).status_code == 409
    assert [e["payload"]["status"] for e in events(api, "kb.proposal")] == ["open", "approved"]


def test_draft_publish_promote_and_rollback(api):
    tid = post(api)["ticket_id"]
    pid = close(api, tid, SPECIFIC).json()["proposal_id"]
    api.post(f"/kb/proposals/{pid}/approve", json={"actor": "owner@x"})
    draft = api.post("/kb/versions", json={"actor": "owner@x"}).json()
    assert draft["kb_version"] == "v2" and draft["status"] == "draft" and draft["parent_version"] == "v1"
    assert any(pid in line for line in draft["changelog"])
    v2 = api.get("/kb/versions/v2").json()["content"]
    assert len(v2["patterns"]) == 22 and v2["patterns"][-1]["id"] == "P22"
    assert api.get("/kb/proposals").json()["proposals"][0]["target_kb_version"] == "v2"
    assert api.post("/kb/versions/v2/promote", json={"actor": "o"}).status_code == 409  # drafts cannot go live
    assert api.post("/kb/versions/v2/publish", json={"actor": "o"}).json()["status"] == "published"
    assert api.post("/kb/versions/v2/publish", json={"actor": "o"}).status_code == 409  # frozen
    assert api.post("/kb/versions/v2/promote", json={"actor": "o"}).json()["status"] == "live"
    statuses = {v["kb_version"]: v["status"] for v in api.get("/kb/versions").json()["versions"]}
    assert statuses == {"v1": "retired", "v2": "live"} and api.engine.kb_version == "v2"
    run = api.get(f"/runs/{api.post(f'/tickets/{tid}/retriage').json()['run_id']}").json()
    assert run["versions"]["kb"] == "v2"  # new runs use the promoted version
    api.post("/kb/versions/v1/promote", json={"actor": "o"})  # rollback
    assert api.get("/health").json()["kb_version"] == "v1"
    assert [e["type"] for e in events(api, "kb.version")] == ["kb.version.drafted", "kb.version.published",
                                                              "kb.version.promoted", "kb.version.promoted"]


def test_kb_build_bootstraps_a_draft(api):
    r = api.post("/kb/build", json={"actor": "owner@x"})
    assert r.status_code == 202 and r.json()["expected_version"] == "v2"
    v2 = api.get("/kb/versions/v2").json()
    assert v2["status"] == "draft" and v2["parent_version"] is None
    assert len(v2["content"]["patterns"]) == 21 and v2["content"]["service_cards"][0]["scope"].startswith("Scope of")


def _wrong_service(api, key, old="Tax Reporting", new="Cash Management"):
    out = post(api, key=key)
    return api.post(f"/tickets/{out['ticket_id']}/overrides", json={
        "base_run_id": out["run_id"], "actor": "agent@x",
        "changes": [{"field": "service", "value": new, "reason_code": "wrong_service"}]})


def test_repeated_overrides_become_one_proposal(api):
    _wrong_service(api, "A")
    _wrong_service(api, "B")
    assert api.get("/kb/proposals").json()["proposals"] == []  # below PROPOSAL_MIN_SUPPORT
    _wrong_service(api, "C")
    [p] = api.get("/kb/proposals").json()["proposals"]
    assert p["type"] == "amend_service_card" and p["payload"]["service"] == "Cash Management"
    assert p["evidence"]["count"] == 3 and len(p["evidence"]["override_ids"]) == 3
    _wrong_service(api, "D")
    assert len(api.get("/kb/proposals").json()["proposals"]) == 1  # one per group


def test_resolver_change_proposal_applies_to_new_draft(api):
    for key in ("A", "B", "C"):
        out = post(api, key=key)
        api.post(f"/tickets/{out['ticket_id']}/overrides", json={
            "base_run_id": out["run_id"], "actor": "lead@x",
            "changes": [{"field": "assignee", "value": "new.person@intcom.com", "reason_code": "resolver_unavailable"}]})
    [p] = api.get("/kb/proposals").json()["proposals"]
    assert p["type"] == "change_resolver" and p["payload"] == {
        "service": "Tax Reporting", "from": "tania.gupta@intcom.com", "to": "new.person@intcom.com"}
    api.post(f"/kb/proposals/{p['proposal_id']}/approve", json={"actor": "owner@x"})
    api.post("/kb/versions", json={"actor": "owner@x"})
    v2 = api.get("/kb/versions/v2").json()["content"]
    assert {x["resolver"] for x in v2["patterns"] if x["service"] == "Tax Reporting"} == {"new.person@intcom.com"}


def test_policy_versions_pause_and_resume(api):
    assert api.get("/policy").json()["policy_version"] == "p1"
    p2 = api.put("/policy", json={"actor": "admin@x", "content": {"field_thresholds": {"service": 0.8}}}).json()
    assert p2["policy_version"] == "p2" and p2["parent_version"] == "p1" and p2["content"]["field_thresholds"]["service"] == 0.8
    assert api.put("/policy", json={"actor": "a", "content": {"autonomy": {"default": "yolo"}}}).status_code == 422
    assert api.put("/policy", json={"actor": "a", "content": {"bogus": 1}}).status_code == 422
    paused = api.post("/policy/pause", json={"actor": "admin@x", "note": "incident"}).json()
    assert paused["content"]["paused"] and api.get("/health").json()["policy_paused"] is True
    out = post(api, key="P")
    run = api.get(f"/runs/{out['run_id']}").json()
    assert "policy_paused" in run["lane_reasons"] and run["versions"]["policy"] == "p3"
    assert api.post("/policy/resume", json={"actor": "admin@x"}).json()["content"]["paused"] is False
    assert [e["type"] for e in events(api, "policy.")] == ["policy.updated", "policy.paused", "policy.resumed"]


def test_audit_filters(api):
    _wrong_service(api, "A")
    api.post("/policy/pause", json={"actor": "admin@x"})
    assert {e["type"] for e in api.get("/audit?actor=agent@x").json()["events"]} == {"decision.overridden"}
    assert [e["type"] for e in api.get("/audit?type=policy.").json()["events"]] == ["policy.paused"]


def test_metrics(api):
    api.put("/policy", json={"actor": "a", "content": {"audit_sample_rate": 1.0}})
    # An auto-applied, audit-sampled run: reported values match the prediction, confident, pattern assignee.
    auto = post(api, key="AUTO", service="Tax Reporting", **{"Work type": "Service Request", "Urgency": "Low",
                                                             "Impact": "Low", "Priority": "Low"})
    run = api.get(f"/runs/{auto['run_id']}").json()
    assert run["lane"] == "auto_applied" and run["audit_sampled"] is True
    api.post(f"/tickets/{auto['ticket_id']}/overrides", json={"base_run_id": auto["run_id"], "actor": "auditor@x",
             "changes": [{"field": "impact", "value": "Medium", "reason_code": "wrong_impact"}]})
    other = post(api, key="B")
    api.post(f"/tickets/{other['ticket_id']}/accept", json={"run_id": other["run_id"], "actor": "a@x"})
    _wrong_service(api, "C")
    get = lambda name, q="": api.get(f"/metrics/{name}{q}").json()["value"]  # noqa: E731
    rates = get("override_rates")
    assert rates["field"]["impact"]["count"] == 1 and rates["field"]["service"]["count"] == 1
    assert get("automation_rate")["total"]["auto_applied"] == 1
    assert get("service_confusion")["changed"] == 1
    assert sum(b["total"] for b in get("calibration")["bins"]) == 8 + 2  # 8 accepted fields + 2 overridden
    assert get("generic_bucket_rate")["total"]["count"] == 0 and get("fallback_rate")["total"]["total"] == 3
    assert "NAV Calculation" in get("coverage")["without_patterns"]
    assert set(get("priority_integrity")) == {"forced_inconsistent", "downgrade_on_critical", "critical_incidents_by_priority"}
    assert get("audit_error_estimate") == {"sampled": 1, "reviewed": 1, "count": 1, "total": 1, "rate": 1.0}
    assert get("resolver_load")["open_by_resolver"]
    assert get("override_rates", "?service=Cash Management")["field"]["service"]["count"] == 1
    assert get("automation_rate", "?from=2999-01-01")["total"] == {}
    assert api.get("/metrics/emerging_issues").status_code == 200 and api.get("/metrics/nope").status_code == 404
