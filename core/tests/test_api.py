"""API step 1 (CORE_API §6-§8) against a fake engine: no LLM, inline worker."""
import json
import shutil
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from triage import config
from triage.calibration import calibrate
from triage.catalog import load_catalog
from triage.data import load_challenge_raw
from triage.decisions import original_values, priority_decision, team_decision
from triage.kb import KBStore
from triage.lanes import assign_lane
from triage.output import build_output
from triage.schemas import DecisionRecord, Evidence, PatternEvidence, ResolutionCommentRecord, RunRecord, RunVersions
from triage.triage import utc_now

CATALOG = load_catalog()
VERSIONS = RunVersions(model="fake", prompt="p", kb="v1-test", policy="p1-test")
DEFAULT = dict(service="Tax Reporting", work_type="Service Request", urgency="Low", impact="Low",
               resolution="done", conf=0.9)


class FakeEngine:
    """Deterministic runs built with the real triage builders; `plan[summary]` steers them.
    Owns a KB store (a copy of v1 under `kb_root`) like the real engine."""

    def __init__(self, kb_root=None, model="fake"):
        self.plan, self.model_plans, self.calls, self.model = {}, {}, 0, model
        if kb_root is not None:
            shutil.copytree(config.KB_DIR, kb_root / "v1", ignore=shutil.ignore_patterns("embeddings.npz"))
            self.kb_store = KBStore(kb_root)
            self.use_kb("v1")
        else:
            self.kb_store, self.kb_version, self.catalog, self.versions = None, "v1", CATALOG, VERSIONS

    def use_kb(self, version):
        self.catalog, self.cards = self.kb_store.load(version)
        self.kb_version, self.versions = version, VERSIONS.model_copy(update={"kb": version, "model": self.model})

    def variant(self, kb_version=None, model=None, comment=False, n_samples=None):
        v = FakeEngine.__new__(FakeEngine)
        v.plan, v.model_plans, v.calls, v.model = self.plan, self.model_plans, 0, model or self.model
        v.kb_store = self.kb_store
        v.use_kb(kb_version or self.kb_version)
        return v

    def embed(self, texts):
        words = sorted({w for t in texts for w in t.lower().split()})
        vecs = np.array([[t.lower().split().count(w) for w in words] for t in texts], dtype=float) + 1e-6
        return vecs / np.linalg.norm(vecs, axis=1, keepdims=True)

    def generate_cards(self, catalog):
        return {"version": 1, "model": "fake", "reviewed": False, "cards": [
            {"service": s, "team": t, "criticality": config.CRITICALITY[s], "scope": f"Scope of {s}.", "boundary": None,
             "pattern_ids": [p["id"] for p in catalog["patterns"] if p["service"] == s], "scope_source": "llm"}
            for s, t in catalog["service_team"].items()]}

    def run(self, fields, ticket_id, run_id, policy=None, policy_version=None):
        self.calls += 1
        p = {**DEFAULT, **self.plan.get(fields.get("Summary"), {}),
             **self.model_plans.get(self.model, {}).get(fields.get("Summary"), {})}
        if p.get("fail"):
            raise RuntimeError("LLM backend unavailable")
        original = original_values(fields)

        def ai(field, value):
            return DecisionRecord(field=field, value=value, original_value=original[field], effective_value=value,
                                  source="ai_judgment", confidence=p["conf"], reason="fake",
                                  flags=["service_changed"] if field == "service" and original["service"]
                                  and original["service"] != value else [])
        d = {f: ai(f, p[f]) for f in config.AI_FIELDS}
        d["service"] = d["service"].model_copy(update={"evidence": Evidence(patterns=[PatternEvidence(
            pattern_id=CATALOG["patterns"][0]["id"], similarity=p.get("sim", 0.8), service=CATALOG["patterns"][0]["service"],
            resolver=CATALOG["patterns"][0]["resolver"])])})
        d["team"] = team_decision(d["service"], CATALOG["service_team"], original)
        d["priority"] = priority_decision(d["urgency"], d["impact"], p["service"], original)
        fb = CATALOG["fallback_assignee"][p["service"]]["assignee"]
        resolvers = CATALOG["resolvers_by_service"].get(p["service"])
        who, source = (resolvers[0], "pattern_match") if resolvers else (fb, "fallback")
        d["assignee"] = DecisionRecord(field="assignee", value=who, effective_value=who, source=source,
                                       confidence=min(p["conf"], 0.2 if source == "fallback" else 1), reason="fake",
                                       flags=["fallback_assignee"] if source == "fallback" else [])
        d = calibrate(d, (policy or {}).get("calibration"))  # as run_ticket does
        lane, reasons, sampled = assign_lane(d, run_id, policy)
        versions = self.versions.model_copy(update={"policy": policy_version or "p?"})
        now = utc_now()
        return RunRecord(run_id=run_id, ticket_id=ticket_id, snapshot_id="x", status="completed", versions=versions,
                         started_at=now, completed_at=now, decisions=d, lane=lane, lane_reasons=reasons,
                         audit_sampled=sampled,
                         resolution_comment=ResolutionCommentRecord(text=f"{who}: Resolution: Handled {fields.get('Summary')}."))

    def demo_ticket(self):
        if self.plan.get("demo", {}).get("fail"):
            raise RuntimeError("LLM backend unavailable")
        return fields(summary="Demo ticket")

    def regenerate_comment(self, fields, decisions):
        who = decisions["assignee"].effective_value
        return ResolutionCommentRecord(text=f"{who}: Resolution: Regenerated for {decisions['service'].effective_value}.")


@pytest.fixture
def api(tmp_path):
    engine = FakeEngine(tmp_path / "kb")
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as client:
        client.engine = engine
        yield client


def fields(summary="License for tax tool", service="Regulatory Reporting", **kw):
    return {"Summary": summary, "Description": "desc", "Affected Business or IT Services": [service],
            "Service Team(s)": [], "Work type": "Incident", "Assignee": None, "Urgency": "High", "Impact": "High",
            "Priority": "Highest", "Resolution": None, "Status": "open", "All Comments": ["a@intcom.com: hi"], **kw}


def post(api, key="JIRA-1", **kw):
    r = api.post("/tickets", json={"external_key": key, "fields": fields(**kw)})
    assert r.status_code in (200, 202), r.text
    return r.json()


def view(api, tid):
    return api.get(f"/tickets/{tid}").json()


def types(api):
    return [e["type"] for e in api.get("/events").json()["events"]]


def test_health(api):
    body = api.get("/health").json()
    assert body["status"] == "ok" and body["kb_version"] == "v1" and body["versions"]["policy"] == "p1"
    assert body["queue_depth"] == 0 and body["policy_paused"] is False


def test_demo_ticket_is_written_but_not_stored(api):
    r = api.post("/demo/tickets")
    assert r.status_code == 200 and r.json()["fields"]["Summary"] == "Demo ticket"
    assert api.get("/tickets").json()["tickets"] == [] and api.engine.calls == 0 and types(api) == []


def test_demo_ticket_llm_failure_is_503(api):
    api.engine.plan["demo"] = {"fail": True}
    r = api.post("/demo/tickets")
    assert r.status_code == 503 and r.json()["error"] == "llm_unavailable"


def test_import_is_idempotent_and_new_snapshots_retriage(api):
    first = post(api)
    assert first["status"] == "queued"
    again = api.post("/tickets", json={"external_key": "JIRA-1", "fields": fields()})
    assert again.status_code == 200 and again.json()["status"] == "unchanged" and api.engine.calls == 1
    changed = post(api, Description="new info")
    assert changed["run_id"] != first["run_id"] and changed["ticket_id"] == first["ticket_id"] and api.engine.calls == 2
    assert types(api)[:4] == ["ticket.imported", "run.started", "run.completed", "ticket.imported"]


def test_idempotency_key_checked_and_error_shape(api):
    r = api.post("/tickets", json={"external_key": "K", "fields": fields()}, headers={"Idempotency-Key": "wrong"})
    assert r.status_code == 422 and set(r.json()) == {"error", "message", "details"}
    assert api.post("/tickets", json={"fields": {}}).json()["error"] == "validation_error"
    assert api.get("/tickets/t_nope").status_code == 404


def test_ticket_view(api):
    tid = post(api)["ticket_id"]
    v = view(api, tid)
    assert v["effective_state"]["team"]["effective_value"] == "Tax & Reporting"
    assert v["effective_state"]["priority"]["rule_trace"].startswith("matrix[")
    assert v["lane"] == "needs_review" and "service_changed" in v["lane_reasons"]
    assert v["resolution_comment"]["text"].endswith("Handled License for tax tool.")
    assert v["versions"]["model"] == "fake" and [h["type"] for h in v["history"]] == ["run"]


def test_list_tickets_expands_views_in_one_pass(api):
    """`GET /tickets?expand=view` carries what GET /tickets/{id} returns, for every ticket, and
    the number of SQL statements does not grow with the number of tickets (no N+1)."""
    api.engine.plan["Overridden"] = {"service": "Cash Management"}
    outs = [post(api, key=f"K{i}", summary="Overridden" if i == 2 else f"Ticket {i}") for i in range(6)]
    _override(api, outs[2], [{"field": "urgency", "value": "Highest", "reason_code": "wrong_urgency"}])
    api.post(f"/tickets/{outs[3]['ticket_id']}/accept", json={"run_id": outs[3]["run_id"], "actor": "lead@x"})
    api.engine.plan["Broken"] = {"fail": True}
    broken = post(api, key="K9", summary="Broken")

    statements = []
    api.app.state.core.db.conn.set_trace_callback(statements.append)
    try:
        rows = api.get("/tickets?expand=view").json()["tickets"]
        plain = api.get("/tickets").json()["tickets"]
    finally:
        api.app.state.core.db.conn.set_trace_callback(None)

    assert sorted(r["ticket_id"] for r in rows) == sorted(o["ticket_id"] for o in outs + [broken])
    assert [{k: v for k, v in r.items() if k != "view"} for r in rows] == plain
    by_id = {r["ticket_id"]: r for r in rows}
    for tid, row in by_id.items():
        assert row["view"] == view(api, tid)
    pinned, accepted, failed = (by_id[o["ticket_id"]] for o in (outs[2], outs[3], broken))
    assert pinned["view"]["effective_state"]["urgency"]["pinned"] and pinned["service"] == "Cash Management"
    assert [h["type"] for h in accepted["view"]["history"]] == ["run", "acceptance"]
    assert failed["view"]["effective_state"] is None and failed["run_status"] == "failed"
    assert len(statements) <= 20, statements
    assert api.get("/tickets?expand=nope").status_code == 422


def test_failed_run_is_retryable(api):
    api.engine.plan["Broken"] = {"fail": True}
    out = post(api, summary="Broken")
    assert api.get(f"/runs/{out['run_id']}").json()["status"] == "failed"
    assert "run.failed" in types(api) and view(api, out["ticket_id"])["effective_state"] is None
    api.engine.plan["Broken"] = {}
    r = api.post(f"/tickets/{out['ticket_id']}/retriage")
    assert r.status_code == 202 and api.get(f"/runs/{r.json()['run_id']}").json()["status"] == "completed"


def test_deleted_ticket_leaves_every_list_and_keeps_its_history(api):
    gone, kept = post(api, key="A"), post(api, key="B")
    api.post(f"/tickets/{gone['ticket_id']}/accept", json={"run_id": gone["run_id"], "actor": "lead@x"})
    r = api.delete(f"/tickets/{gone['ticket_id']}")
    assert r.status_code == 200 and r.json()["external_key"] == "A"
    assert r.json()["deleted"]["runs"] == 1 and r.json()["deleted"]["acceptances"] == 1
    assert [t["ticket_id"] for t in api.get("/tickets").json()["tickets"]] == [kept["ticket_id"]]
    assert [t["ticket_id"] for t in api.get("/queue").json()["tickets"]] == [kept["ticket_id"]]
    assert api.get(f"/tickets/{gone['ticket_id']}").status_code == 404
    assert api.delete(f"/tickets/{gone['ticket_id']}").status_code == 404
    assert types(api)[-1] == "ticket.deleted" and "decision.accepted" in types(api)
    again = post(api, key="A")
    assert again["status"] == "queued" and again["ticket_id"] != gone["ticket_id"]


def test_work_queued_for_a_deleted_ticket_is_skipped(api):
    out = post(api)
    core = api.app.state.core
    run_id = core.db.create_run(out["ticket_id"], view(api, out["ticket_id"])["latest_run"]["snapshot_id"])
    api.delete(f"/tickets/{out['ticket_id']}")
    calls = api.engine.calls
    assert core.process_run(run_id) is None and core.process_comment(out["ticket_id"]) is None
    assert api.engine.calls == calls and types(api)[-1] == "ticket.deleted"


def test_runs_queued_before_a_restart_are_resumed(tmp_path):
    from api.db import Database

    db = Database(tmp_path / "core.db")
    tid = db.create_ticket("A")
    run_id = db.create_run(tid, db.add_snapshot(tid, "h", fields()))
    db.conn.close()
    with TestClient(create_app(tmp_path / "core.db", engine=FakeEngine(tmp_path / "kb"), workers=0)) as client:
        assert client.get(f"/runs/{run_id}").json()["status"] == "completed"
        assert client.get("/health").json()["queue_depth"] == 0


def test_queue_risk_sort_and_accept(api):
    api.engine.plan["Critical outage"] = {"service": "NAV Calculation", "urgency": "High", "impact": "High", "conf": 0.4}
    low = post(api, key="A")
    # Reported levels below the prediction, so no downgrade_on_critical sends it to human_only.
    high = post(api, key="B", summary="Critical outage", service="Fund Pricing", Urgency="Low", Impact="Low",
                Priority="Low")
    q = api.get("/queue?lane=needs_review&sort=risk").json()["tickets"]
    assert [t["ticket_id"] for t in q] == [high["ticket_id"], low["ticket_id"]]
    r = api.post(f"/tickets/{high['ticket_id']}/accept", json={"run_id": high["run_id"], "actor": "lead@x"})
    assert r.status_code == 200 and r.json()["fields"] == list(view(api, high["ticket_id"])["effective_state"])
    assert [t["ticket_id"] for t in api.get("/queue").json()["tickets"]] == [low["ticket_id"]]
    stale = api.post(f"/tickets/{low['ticket_id']}/accept", json={"run_id": "r_old", "actor": "x"})
    assert stale.status_code == 409 and stale.json()["details"]["latest_run"]["run_id"] == low["run_id"]
    assert "decision.accepted" in types(api)


def _override(api, out, changes, force=False, preview=False):
    path = f"/tickets/{out['ticket_id']}/overrides" + ("/preview" if preview else "")
    return api.post(path, json={"base_run_id": out["run_id"], "actor": "agent@x", "changes": changes, "force": force})


def test_service_override_preview_then_commit_cascades(api):
    out = post(api)
    change = [{"field": "service", "value": "NAV Calculation", "reason_code": "wrong_service"}]
    pv = _override(api, out, change, preview=True).json()
    assert pv["effective"]["team"] == "Valuation & Pricing" and pv["comment_stale"] is True
    assert "assignee_needs_review" in pv["flags"]["assignee"]
    fb = CATALOG["fallback_assignee"]["NAV Calculation"]["assignee"]
    assert any(a["value"] == fb for a in pv["assignee_alternatives"])
    assert view(api, out["ticket_id"])["effective_state"]["service"]["pinned"] is False  # preview persists nothing

    body = _override(api, out, change).json()
    derived = [o for o in body["overrides"] if o["cascaded_from"]]
    assert [o["field"] for o in derived] == ["team"] and derived[0]["cascaded_from"] == body["overrides"][0]["override_id"]
    v = view(api, out["ticket_id"])
    eff = v["effective_state"]
    assert eff["service"]["pinned"] and eff["service"]["effective_value"] == "NAV Calculation"
    assert eff["team"]["effective_value"] == "Valuation & Pricing" and "assignee_needs_review" in eff["assignee"]["flags"]
    assert v["resolution_comment"]["stale"] is True and "stale_comment" in eff["resolution"]["flags"]
    assert {"decision.overridden", "comment.updated"} <= set(types(api))


def test_urgency_override_recomputes_priority(api):
    out = post(api)
    body = _override(api, out, [{"field": "urgency", "value": "Highest", "reason_code": "wrong_urgency"}]).json()
    assert body["effective_state"]["priority"] == "Medium"  # matrix[Highest][Low]
    assert [o["field"] for o in body["overrides"]] == ["urgency", "priority"]


def test_priority_edit_needs_force_and_note(api):
    out = post(api)
    change = {"field": "priority", "value": "Highest", "reason_code": "other"}
    assert _override(api, out, [{**change, "note": "exec call"}]).status_code == 422
    assert _override(api, out, [change], force=True).status_code == 422
    ok = _override(api, out, [{**change, "note": "exec call"}], force=True)
    assert ok.status_code == 200
    assert "forced_inconsistent" in view(api, out["ticket_id"])["effective_state"]["priority"]["flags"]


@pytest.mark.parametrize("change,code", [
    ({"field": "service", "value": "Bloomberg", "reason_code": "wrong_service"}, "invalid_value"),
    ({"field": "team", "value": "Service Desk", "reason_code": "other", "note": "n"}, "team_follows_service"),
    ({"field": "urgency", "value": "High", "reason_code": "other"}, "note_required"),
    ({"field": "urgency", "value": "High", "reason_code": "because"}, "invalid_reason_code"),
])
def test_invalid_overrides_rejected(api, change, code):
    r = _override(api, post(api), [change])
    assert r.status_code == 422 and r.json()["error"] == code


def test_stale_base_run_is_409(api):
    out = post(api)
    api.post(f"/tickets/{out['ticket_id']}/retriage")
    r = _override(api, out, [{"field": "urgency", "value": "High", "reason_code": "wrong_urgency"}])
    assert r.status_code == 409 and r.json()["error"] == "stale_run"


def test_override_is_pinned_across_retriage_and_conflict_emitted(api):
    out = post(api)
    _override(api, out, [{"field": "service", "value": "Cash Management", "reason_code": "wrong_service"}])
    new = api.post(f"/tickets/{out['ticket_id']}/retriage").json()
    run = api.get(f"/runs/{new['run_id']}").json()
    assert "conflict_with_override" in run["decisions"]["service"]["flags"]
    eff = view(api, out["ticket_id"])["effective_state"]
    assert eff["service"]["effective_value"] == "Cash Management" and eff["service"]["value"] == "Tax Reporting"
    conflict = [e for e in api.get("/events").json()["events"] if e["type"] == "decision.conflict"]
    assert conflict[0]["payload"] == {"field": "service", "pinned_value": "Cash Management", "new_run_value": "Tax Reporting"}


def test_comment_edit_and_regenerate(api):
    out = post(api)
    _override(api, out, [{"field": "resolution", "value": "cancelled", "reason_code": "wrong_resolution_status"}])
    assert view(api, out["ticket_id"])["resolution_comment"]["stale"] is True
    r = api.post(f"/tickets/{out['ticket_id']}/resolution-comment/regenerate")
    assert r.status_code == 202
    c = view(api, out["ticket_id"])["resolution_comment"]
    assert c["stale"] is False and c["text"].endswith("Regenerated for Tax Reporting.")
    bad = api.put(f"/tickets/{out['ticket_id']}/resolution-comment", json={"text": "Problem fixed.", "actor": "a@x"})
    assert bad.status_code == 422
    text = "tania.gupta@intcom.com: Resolution: Closed as a duplicate of the licence request raised last week."
    ok = api.put(f"/tickets/{out['ticket_id']}/resolution-comment", json={"text": text, "actor": "a@x"})
    assert ok.status_code == 200 and view(api, out["ticket_id"])["resolution_comment"]["edited_by"] == "a@x"
    origins = [e["payload"]["origin"] for e in api.get("/events").json()["events"] if e["type"] == "comment.updated"]
    assert origins == [None, "regenerated", "edited"]


def test_ticket_export_is_challenge_record_with_effective_state(api):
    out = post(api)
    _override(api, out, [{"field": "impact", "value": "Medium", "reason_code": "wrong_impact"}])
    rec = api.get(f"/tickets/{out['ticket_id']}/export").json()
    assert list(rec) == list(fields())
    assert rec["Impact"] == "Medium" and rec["Priority"] == "Low" and rec["Status"] == "done"
    assert rec["Affected Business or IT Services"] == ["Tax Reporting"] and rec["All Comments"][-1].endswith("tax tool.")


def test_batch_export_matches_cli_output(api):
    """CORE_API §10: POST /batches with the challenge file = `run.py triage` for the same engine."""
    raw = load_challenge_raw()
    body = api.post("/batches", json=raw).json()
    assert len(body["tickets"]) == len(raw["records"])
    status = api.get(f"/batches/{body['batch_id']}").json()
    assert status["by_status"] == {"completed": len(raw["records"])}
    exported = api.get(f"/batches/{body['batch_id']}/export").json()
    cli_runs = [api.engine.run(r, f"R{i}", f"x-R{i}") for i, r in enumerate(raw["records"])]
    assert exported == json.loads(json.dumps(build_output(raw, cli_runs)))
    again = api.post("/batches", json=raw).json()
    assert all(t["status"] == "unchanged" for t in again["tickets"])


def test_events_paging_and_sse(api):
    post(api)
    page = api.get("/events?after_seq=0&limit=2").json()
    assert [e["seq"] for e in page["events"]] == [1, 2] and page["next_seq"] == 2
    with api.stream("GET", "/events/stream?max_events=3", headers={"Last-Event-ID": "0"}) as r:
        text = "".join(r.iter_text())
    assert text.count("event: ") == 3 and "id: 1" in text and "event: run.completed" in text


def test_threaded_workers_process_runs(tmp_path):
    with TestClient(create_app(tmp_path / "t.db", engine=FakeEngine(tmp_path / "kb"), workers=1)) as client:
        out = client.post("/tickets", json={"external_key": "T", "fields": fields()}).json()
        for _ in range(100):
            if client.get(f"/runs/{out['run_id']}").json()["status"] == "completed":
                break
            time.sleep(0.05)
        assert client.get(f"/runs/{out['run_id']}").json()["status"] == "completed"
