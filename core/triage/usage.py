"""LLM usage ledger: token counts per call, priced from config.LLM_PRICES, and the
windowed summary behind GET /usage. llm.chat_structured reports every attempt here;
the API installs a sink that stores them, and tags calls with what they were for."""
import contextlib
import contextvars
import datetime as dt
from collections import defaultdict

from triage import config

# Pipeline step of a call, from its output schema.
STAGES = {"TriageOutput": "decision", "TriageSample": "self_consistency", "TriageEvidence": "evidence",
          "ResolutionComment": "resolution_note", "DevTicket": "demo_ticket", "ServiceScope": "service_card"}
WINDOWS = {"24h": ("hour", 24), "7d": ("day", 7), "30d": ("day", 30), "90d": ("day", 90)}
TOKEN_FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens")

_tags: contextvars.ContextVar[dict] = contextvars.ContextVar("usage_tags", default={})
_sink = None


def set_sink(sink) -> None:
    """`sink(call: dict)` receives every recorded call; None stops recording (the CLI default)."""
    global _sink
    _sink = sink


@contextlib.contextmanager
def tagged(**tags):
    """Attribute the calls made inside the block: purpose, ticket_id, run_id."""
    token = _tags.set({**_tags.get(), **tags})
    try:
        yield
    finally:
        _tags.reset(token)


def tokens(provider: str, response) -> dict:
    """Normalise one provider response to the ledger's token fields."""
    if provider == "ollama":
        return {"input_tokens": _field(response, "prompt_eval_count") or 0, "cached_input_tokens": 0,
                "output_tokens": _field(response, "eval_count") or 0, "reasoning_tokens": 0}
    usage = _field(response, "usage") or {}
    if provider == "openai":  # Responses API
        return {"input_tokens": usage.get("input_tokens") or 0,
                "cached_input_tokens": (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0,
                "output_tokens": usage.get("output_tokens") or 0,
                "reasoning_tokens": (usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0}
    return {"input_tokens": usage.get("prompt_tokens") or 0,  # OpenAI-compatible chat completions
            "cached_input_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0,
            "output_tokens": usage.get("completion_tokens") or 0,
            "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0}


def _field(response, key: str):
    """Ollama returns a subscriptable model, the HTTP providers a dict."""
    try:
        return response[key]
    except (KeyError, TypeError, AttributeError):
        return None


def price(provider: str, model: str) -> dict | None:
    return config.LLM_PRICES.get(f"{provider}/{model}") or config.LLM_PRICES.get(f"{provider}/*")


def cost(provider: str, model: str, counts: dict) -> tuple[float, float]:
    """(cost, prompt-cache saving) in USAGE_CURRENCY. Cached input tokens are part of
    input_tokens, billed at the cached rate; reasoning tokens are part of output_tokens."""
    p = price(provider, model)
    if p is None:
        return 0.0, 0.0
    cached = counts["cached_input_tokens"]
    uncached = counts["input_tokens"] - cached
    billed = uncached * p["input"] + cached * p["cached_input"] + counts["output_tokens"] * p["output"]
    return billed / 1e6, cached * (p["input"] - p["cached_input"]) / 1e6


def record(provider: str, model: str, schema: str, outcome: str, counts: dict | None = None,
           latency_ms: int | None = None) -> None:
    """One attempt. outcome: ok | retry (billed, but rejected: invalid or truncated) |
    error (no response) | cache_hit (answered from the disk cache: nothing billed, the
    tokens it would have cost are the saving)."""
    if _sink is None:
        return
    counts = {f: int((counts or {}).get(f) or 0) for f in TOKEN_FIELDS}
    billed, saved = cost(provider, model, counts)
    if outcome == "cache_hit":
        billed, saved = 0.0, billed
    tags = _tags.get()
    _sink({"provider": provider, "model": model, "stage": STAGES.get(schema, schema), "outcome": outcome,
           "purpose": tags.get("purpose", "other"), "ticket_id": tags.get("ticket_id"), "run_id": tags.get("run_id"),
           **counts, "latency_ms": latency_ms, "cost": round(billed, 8), "saved": round(saved, 8),
           "priced": price(provider, model) is not None})


def window_bounds(window: str, now: dt.datetime) -> tuple[str, list[str]]:
    """(start timestamp, bucket keys oldest first). Hour keys are 'YYYY-MM-DDTHH', day keys 'YYYY-MM-DD'."""
    if window not in WINDOWS:
        raise ValueError(f"window must be one of {', '.join(WINDOWS)}")
    unit, n = WINDOWS[window]
    now = now.astimezone(dt.timezone.utc)
    if unit == "hour":
        last = now.replace(minute=0, second=0, microsecond=0)
        starts = [last - dt.timedelta(hours=i) for i in reversed(range(n))]
        keys = [s.strftime("%Y-%m-%dT%H") for s in starts]
    else:
        last = now.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [last - dt.timedelta(days=i) for i in reversed(range(n))]
        keys = [s.strftime("%Y-%m-%d") for s in starts]
    return starts[0].isoformat(timespec="seconds"), keys


def _bucket_key(occurred_at: str, unit: str) -> str:
    return occurred_at[:13] if unit == "hour" else occurred_at[:10]


def _empty() -> dict:
    return {"cost": 0.0, "saved": 0.0, "calls": 0, "cache_hits": 0, "retries": 0, "errors": 0,
            **{f: 0 for f in TOKEN_FIELDS}}


def _add(acc: dict, call: dict) -> None:
    acc["cost"] += call["cost"]
    acc["saved"] += call["saved"]
    if call["outcome"] == "cache_hit":
        acc["cache_hits"] += 1
        return  # a cache hit processed nothing: its tokens are only the saving
    acc["calls"] += 1
    acc["retries"] += call["outcome"] == "retry"
    acc["errors"] += call["outcome"] == "error"
    for f in TOKEN_FIELDS:
        acc[f] += call[f]


def _finish(acc: dict, total_cost: float) -> dict:
    return {**acc, "cost": round(acc["cost"], 6), "saved": round(acc["saved"], 6),
            "tokens": acc["input_tokens"] + acc["output_tokens"],
            "share": round(acc["cost"] / total_cost, 4) if total_cost else None}


def _rows(groups: dict[str, dict], total_cost: float, extra=None) -> list[dict]:
    rows = [{"key": k, **(extra(k) if extra else {}), **_finish(v, total_cost)} for k, v in groups.items()]
    return sorted(rows, key=lambda r: (-r["cost"], -r["tokens"], r["key"]))


def totals(calls: list[dict]) -> dict:
    """Cost, counts and tokens of a set of calls, plus the model time they took: the sum of
    the latencies of the calls that reached a provider (a cache hit took no model time)."""
    acc = _empty()
    for c in calls:
        _add(acc, c)
    out = _finish(acc, 0.0)
    out.pop("share")
    out["latency_ms"] = sum(c["latency_ms"] or 0 for c in calls if c["outcome"] != "cache_hit")
    return out


def summarize(calls: list[dict], window: str, now: dt.datetime) -> dict:
    """Totals, a zero-filled series and breakdowns by model, provider, stage and purpose
    for the calls in the window (calls outside it are ignored)."""
    start, keys = window_bounds(window, now)
    unit = WINDOWS[window][0]
    calls = [c for c in calls if c["occurred_at"] >= start]
    total, series = _empty(), {k: _empty() for k in keys}
    groups = {dim: defaultdict(_empty) for dim in ("model", "provider", "stage", "purpose")}
    priced, prompt_saved, retry_cost, triage_cost, runs = {}, 0.0, 0.0, 0.0, set()
    for c in calls:
        _add(total, c)
        if (key := _bucket_key(c["occurred_at"], unit)) in series:
            _add(series[key], c)
        qualified = f"{c['provider']}/{c['model']}"
        for dim, value in (("model", qualified), ("provider", c["provider"]), ("stage", c["stage"]),
                           ("purpose", c["purpose"])):
            _add(groups[dim][value], c)
        priced[qualified] = bool(c["priced"])
        if c["outcome"] != "cache_hit":
            prompt_saved += c["saved"]
        if c["outcome"] == "retry":
            retry_cost += c["cost"]
        if c["purpose"] == "triage" and c["run_id"]:
            triage_cost += c["cost"]
            runs.add(c["run_id"])
    cost_total = total["cost"]
    totals = _finish(total, cost_total)
    totals.update(
        uncached_input_tokens=total["input_tokens"] - total["cached_input_tokens"],
        saved_prompt_cache=round(prompt_saved, 6), saved_response_cache=round(total["saved"] - prompt_saved, 6),
        retry_cost=round(retry_cost, 6), triage_runs=len(runs),
        cost_per_triage_run=round(triage_cost / len(runs), 6) if runs else None)
    latencies = [c["latency_ms"] for c in calls if c["outcome"] == "ok" and c["latency_ms"] is not None]
    totals["latency_ms_mean"] = round(sum(latencies) / len(latencies)) if latencies else None

    def model_info(key: str) -> dict:
        provider, _, model = key.partition("/")
        return {"provider": provider, "model": model, "priced": priced[key], "price": price(provider, model)}

    return {
        "window": window, "bucket": unit, "from": start, "to": now.astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
        "currency": config.USAGE_CURRENCY, "totals": totals,
        "series": [{"start": k, **_finish(v, cost_total)} for k, v in series.items()],
        "breakdown": {"model": _rows(groups["model"], cost_total, model_info),
                      **{dim: _rows(groups[dim], cost_total) for dim in ("provider", "stage", "purpose")}},
    }
