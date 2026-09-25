"""Blind tests (api/blind_tests.py): a judge's file in, the filled file out, live state
untouched. Fake engine, inline worker, provider keys stubbed in the environment."""
import json

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from triage import config
from triage.data import load_challenge_raw
from tests.test_api import FakeEngine


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("APERTUS_API_KEY", "test-key")
    engine = FakeEngine(tmp_path / "kb")
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as client:
        client.engine = engine
        yield client


@pytest.fixture(scope="module")
def raw():
    return load_challenge_raw()


def start(api, raw, **extra):
    r = api.post("/blind-tests", json={"input": raw, "source": "blind.json", **extra})
    assert r.status_code == 202, r.text
    return r.json()


def test_blind_test_fills_the_file_for_both_pipelines(api, raw):
    before = json.dumps(raw, sort_keys=True)
    created = start(api, raw)
    assert created["tickets"] == 20 and created["skipped"] == []
    assert [p["key"] for p in created["pipelines"]] == ["submission", "reference"]
    assert created["pipelines"][0]["model"] == config.BLIND_TEST_MODEL

    test = api.get(f"/blind-tests/{created['blind_test_id']}").json()
    assert test["status"] == "completed" and test["source"] == "blind.json" and test["input"] == raw
    submission, reference = test["pipelines"]
    assert submission["status"] == "completed" and submission["seconds"] is not None
    assert submission["progress"] == {"total": 20, "queued": 0, "running": 0, "completed": 20, "failed": 0}
    assert submission["versions"]["model"] == config.BLIND_TEST_MODEL
    assert reference["versions"]["model"] == config.BLIND_TEST_REFERENCE_MODEL
    assert "runs" not in submission and "run_ids" not in submission  # internal bookkeeping stays inside

    out = submission["output"]
    assert list(out) == list(raw) and json.dumps(raw, sort_keys=True) == before
    assert {k: v for k, v in out.items() if k != "records"} == {k: v for k, v in raw.items() if k != "records"}
    for filled, original in zip(out["records"], raw["records"]):
        assert list(filled) == list(original)
        assert filled["Affected Business or IT Services"] == ["Tax Reporting"]
        assert filled["Service Team(s)"] == ["Tax & Reporting"]
        assert filled["Status"] == "done" and filled["Resolution"] == "done" and filled["Priority"] == "Low"
        assert filled["All Comments"][:-1] == original["All Comments"]
        assert filled["All Comments"][-1].split(": ", 1)[1].startswith("Resolution: ")
        for key in original:
            if key not in config.PREDICTED_FIELDS:
                assert filled[key] == original[key]

    ticket = submission["tickets"][0]
    assert ticket["key"] == "R01" and ticket["summary"] == raw["records"][0]["Summary"]
    assert ticket["status"] == "completed" and ticket["seconds"] is not None and ticket["latency_ms"] == 0
    assert submission["usage"]["calls"] == 0 and submission["usage"]["cost"] == 0
    # Live state: no tickets, no runs, no events.
    assert api.get("/tickets").json()["tickets"] == []
    assert api.get("/events").json()["events"] == []


def test_usage_is_summed_from_the_ledger_per_pipeline(api, raw):
    created = start(api, raw)
    bid = created["blind_test_id"]
    db = api.app.state.core.db
    call = {"provider": "openai", "model": "gpt-6-luna", "stage": "decision", "purpose": "blind_test",
            "outcome": "ok", "ticket_id": "R01", "input_tokens": 1000, "cached_input_tokens": 200, "output_tokens": 100,
            "reasoning_tokens": 50, "latency_ms": 1500, "cost": 0.01, "saved": 0.0, "priced": True}
    db.add_llm_call({**call, "run_id": f"{bid}-submission-01"})
    db.add_llm_call({**call, "run_id": f"{bid}-submission-01", "stage": "resolution_note", "latency_ms": 500})
    db.add_llm_call({**call, "run_id": f"{bid}-submission-02", "outcome": "cache_hit", "cost": 0.0, "saved": 0.01,
                     "latency_ms": None})
    db.add_llm_call({**call, "run_id": f"{bid}-reference-01", "provider": "swisscom", "cost": 0.2})

    submission, reference = api.get(f"/blind-tests/{bid}").json()["pipelines"]
    assert submission["usage"]["calls"] == 2 and submission["usage"]["cache_hits"] == 1
    assert submission["usage"]["cost"] == pytest.approx(0.02) and submission["usage"]["tokens"] == 2200
    assert submission["usage"]["latency_ms"] == 2000 and submission["usage"]["currency"] == "USD"
    assert submission["tickets"][0]["latency_ms"] == 2000 and submission["tickets"][1]["latency_ms"] == 0
    assert reference["usage"]["calls"] == 1 and reference["usage"]["cost"] == pytest.approx(0.2)


def test_reference_is_skipped_without_its_key(api, raw, monkeypatch):
    monkeypatch.delenv("APERTUS_API_KEY")
    created = start(api, raw)
    assert [p["key"] for p in created["pipelines"]] == ["submission"]
    assert created["skipped"][0]["key"] == "reference" and "APERTUS_API_KEY" in created["skipped"][0]["reason"]
    test = api.get(f"/blind-tests/{created['blind_test_id']}").json()
    assert test["status"] == "completed" and len(test["pipelines"]) == 1 and test["skipped"] == created["skipped"]


def test_submission_model_needs_its_key(api, raw, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    r = api.post("/blind-tests", json={"input": raw})
    assert r.status_code == 503 and r.json()["error"] == "provider_not_configured"


def test_input_validation(api, raw):
    assert api.post("/blind-tests", json={}).status_code == 422
    assert api.post("/blind-tests", json={"input": []}).status_code == 422
    assert api.post("/blind-tests", json={"input": {"records": []}}).status_code == 422
    bad = {**raw, "records": [{k: v for k, v in raw["records"][0].items() if k != "Assignee"}]}
    r = api.post("/blind-tests", json={"input": bad})
    assert r.status_code == 422 and r.json()["details"] == {"index": 0, "missing": ["Assignee"]}
    too_many = {**raw, "records": raw["records"] * 11}
    assert api.post("/blind-tests", json={"input": too_many}).status_code == 422
    assert api.get("/blind-tests/bt_nope").status_code == 404


def test_a_failed_ticket_keeps_its_record_and_the_rest_completes(api, raw):
    broken = raw["records"][3]["Summary"]
    api.engine.plan[broken] = {"fail": True}
    created = start(api, raw)
    submission = api.get(f"/blind-tests/{created['blind_test_id']}").json()["pipelines"][0]
    assert submission["status"] == "completed"
    assert submission["progress"]["failed"] == 1 and submission["progress"]["completed"] == 19
    failed = submission["tickets"][3]
    assert failed["status"] == "failed" and "LLM backend unavailable" in failed["error"]
    assert submission["output"]["records"][3] == raw["records"][3]
    assert submission["output"]["records"][4]["Status"] == "done"


def test_unfinished_pipelines_fail_on_restart(tmp_path, monkeypatch, raw):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("APERTUS_API_KEY", raising=False)
    engine = FakeEngine(tmp_path / "kb")
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as api:
        bid = start(api, raw)["blind_test_id"]
        pipe = api.app.state.core.db.blind_test_pipeline(bid, "submission")
        api.app.state.core.db.save_blind_test_pipeline(bid, {**pipe, "status": "running", "output": None})
    with TestClient(create_app(tmp_path / "core.db", engine=engine, workers=0)) as api:
        test = api.get(f"/blind-tests/{bid}").json()
        assert test["status"] == "failed" and "restarted" in test["pipelines"][0]["error"]
