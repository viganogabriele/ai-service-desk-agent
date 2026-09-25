"""LLM usage ledger: token normalisation, pricing, recording from chat_structured, the
windowed summary and GET /usage."""
import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from api.main import create_app
from triage import config, usage
from triage.llm import chat_structured
from tests.test_api import FakeEngine
from tests.test_llm import MSG, FakeClient

NOW = dt.datetime(2026, 9, 25, 14, 30, tzinfo=dt.timezone.utc)
PRICES = {"openai/luna": {"input": 2.0, "cached_input": 0.5, "output": 10.0}, "ollama/*": {"input": 0, "cached_input": 0, "output": 0}}


class Out(BaseModel):
    level: str


@pytest.fixture
def ledger(monkeypatch):
    calls = []
    monkeypatch.setattr(config, "LLM_PRICES", PRICES)
    usage.set_sink(calls.append)
    yield calls
    usage.set_sink(None)


def call(occurred_at, cost=0.0, outcome="ok", model="luna", provider="openai", stage="decision", purpose="triage",
         run_id="r1", input_tokens=100, cached_input_tokens=0, output_tokens=10, saved=0.0):
    return {"occurred_at": occurred_at, "provider": provider, "model": model, "stage": stage, "purpose": purpose,
            "outcome": outcome, "ticket_id": "t1", "run_id": run_id, "input_tokens": input_tokens,
            "cached_input_tokens": cached_input_tokens, "output_tokens": output_tokens, "reasoning_tokens": 0,
            "latency_ms": 1000, "cost": cost, "saved": saved, "priced": True}


def test_tokens_normalise_each_provider():
    assert usage.tokens("ollama", {"prompt_eval_count": 900, "eval_count": 40}) == {
        "input_tokens": 900, "cached_input_tokens": 0, "output_tokens": 40, "reasoning_tokens": 0}
    openai = {"usage": {"input_tokens": 1000, "input_tokens_details": {"cached_tokens": 600}, "output_tokens": 300,
                        "output_tokens_details": {"reasoning_tokens": 250}}}
    assert usage.tokens("openai", openai) == {
        "input_tokens": 1000, "cached_input_tokens": 600, "output_tokens": 300, "reasoning_tokens": 250}
    assert usage.tokens("swisscom", {"usage": {"prompt_tokens": 50, "completion_tokens": 5}})["output_tokens"] == 5
    assert usage.tokens("swisscom", {"usage": None})["input_tokens"] == 0


def test_cost_bills_cached_input_at_the_cached_rate(monkeypatch):
    monkeypatch.setattr(config, "LLM_PRICES", PRICES)
    counts = {"input_tokens": 1_000_000, "cached_input_tokens": 400_000, "output_tokens": 100_000, "reasoning_tokens": 0}
    billed, saved = usage.cost("openai", "luna", counts)
    assert billed == pytest.approx(0.6 * 2.0 + 0.4 * 0.5 + 0.1 * 10.0)
    assert saved == pytest.approx(0.4 * 1.5)
    assert usage.cost("openai", "unknown", counts) == (0.0, 0.0)
    assert usage.cost("ollama", "qwen2.5:7b", counts) == (0.0, 0.0)


def test_chat_structured_records_attempts_and_cache_hits(tmp_path, ledger):
    reply = lambda content: {"message": {"content": content}, "prompt_eval_count": 1000, "eval_count": 20}  # noqa: E731
    client = FakeClient([reply("{}"), reply(json.dumps({"level": "Low"}))])
    with usage.tagged(purpose="triage", ticket_id="t1", run_id="r1"):
        chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=client)
        chat_structured(MSG, Out, model="m", cache_dir=tmp_path, client=FakeClient([]))
    assert [c["outcome"] for c in ledger] == ["retry", "ok", "cache_hit"]
    assert all(c["purpose"] == "triage" and c["run_id"] == "r1" and c["stage"] == "Out" for c in ledger)
    assert ledger[2]["input_tokens"] == 1000 and ledger[2]["cost"] == 0  # replayed from the cache file


def test_cache_hit_saves_what_the_call_would_cost(ledger):
    counts = {"input_tokens": 1_000_000, "cached_input_tokens": 0, "output_tokens": 0}
    usage.record("openai", "luna", "TriageOutput", "cache_hit", counts)
    usage.record("openai", "luna", "TriageSample", "ok", counts)
    assert (ledger[0]["cost"], ledger[0]["saved"], ledger[0]["stage"]) == (0.0, 2.0, "decision")
    assert (ledger[1]["cost"], ledger[1]["stage"]) == (2.0, "self_consistency")
    assert ledger[0]["purpose"] == "other"  # untagged


def test_summary_buckets_totals_and_breakdowns():
    calls = [
        call("2026-09-25T14:00:00+00:00", cost=0.30, run_id="r1"),
        call("2026-09-25T14:05:00+00:00", cost=0.10, outcome="retry", run_id="r1"),
        call("2026-09-24T09:00:00+00:00", cost=0.20, run_id="r2", cached_input_tokens=40, saved=0.01),
        call("2026-09-24T09:01:00+00:00", provider="ollama", model="qwen2.5:7b", stage="resolution_note"),
        call("2026-09-23T09:00:00+00:00", outcome="cache_hit", saved=0.05, purpose="evaluation", run_id="r9"),
        call("2026-06-01T09:00:00+00:00", cost=9.99),  # outside 30 days
    ]
    s = usage.summarize(calls, "30d", NOW)
    t = s["totals"]
    assert len(s["series"]) == 30 and s["series"][-1]["start"] == "2026-09-25"
    assert s["series"][-1]["cost"] == pytest.approx(0.40) and s["series"][0]["calls"] == 0
    assert t["cost"] == pytest.approx(0.60) and t["calls"] == 4 and t["cache_hits"] == 1 and t["retries"] == 1
    assert t["input_tokens"] == 400 and t["uncached_input_tokens"] == 360  # the cache hit processed nothing
    assert t["saved_prompt_cache"] == pytest.approx(0.01) and t["saved_response_cache"] == pytest.approx(0.05)
    assert t["retry_cost"] == pytest.approx(0.10)
    assert t["triage_runs"] == 2 and t["cost_per_triage_run"] == pytest.approx(0.30)
    models = s["breakdown"]["model"]
    assert [m["key"] for m in models] == ["openai/luna", "ollama/qwen2.5:7b"]
    assert models[0]["share"] == pytest.approx(1.0) and models[0]["provider"] == "openai"
    assert {r["key"] for r in s["breakdown"]["purpose"]} == {"triage", "evaluation"}


def test_summary_24h_uses_hour_buckets():
    s = usage.summarize([call("2026-09-25T14:10:00+00:00", cost=1.0)], "24h", NOW)
    assert s["bucket"] == "hour" and len(s["series"]) == 24
    assert (s["series"][-1]["start"], s["series"][-1]["cost"]) == ("2026-09-25T14", 1.0)
    with pytest.raises(ValueError):
        usage.window_bounds("1y", NOW)


def test_usage_endpoint(tmp_path):
    with TestClient(create_app(tmp_path / "core.db", engine=FakeEngine(tmp_path / "kb"), workers=0)) as client:
        empty = client.get("/usage").json()
        assert empty["window"] == "30d" and empty["totals"]["calls"] == 0 and len(empty["series"]) == 30
        with usage.tagged(purpose="demo"):
            usage.record("ollama", "qwen2.5:7b", "DevTicket", "ok", {"input_tokens": 500, "output_tokens": 300})
        body = client.get("/usage", params={"window": "7d"}).json()
        assert body["totals"]["calls"] == 1 and body["totals"]["tokens"] == 800
        assert body["breakdown"]["stage"][0]["key"] == "demo_ticket"
        assert body["breakdown"]["purpose"][0]["key"] == "demo"
        bad = client.get("/usage", params={"window": "1y"})
        assert bad.status_code == 422 and bad.json()["error"] == "invalid_window"
