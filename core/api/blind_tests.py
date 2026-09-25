"""Blind tests: a judge uploads a challenge-format file and gets it back with the
predictions filled in, exactly as `python run.py triage` writes it. The submission model
(config.BLIND_TEST_MODEL) always runs; a reference model runs alongside when its key is set.
Nothing touches live state: no tickets, snapshots or runs are created, and no events are
emitted. Only the LLM usage ledger records the calls, tagged `blind_test`."""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from triage import config, usage
from triage.llm import require_provider_key, resolve_model
from triage.output import build_output
from triage.schemas import RunRecord
from triage.state import StateError
from triage.triage import utc_now

SUBMISSION, REFERENCE = "submission", "reference"


def ticket_keys(records: list[dict]) -> list[str]:
    """The same identifiers as the CLI: the record's key, else its position."""
    return [str(r.get("Key") or r.get("Issue key") or f"R{i + 1:02d}") for i, r in enumerate(records)]


def validate_input(raw) -> dict:
    """A challenge-format object whose records carry every field the output writes back,
    so the filled file keeps the input's structure (triage.output.fill_challenge)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("records"), list) or not raw["records"]:
        raise StateError(422, "invalid_blind_test", "input must be a challenge-format object with a non-empty 'records' list")
    if len(raw["records"]) > config.BLIND_TEST_MAX_RECORDS:
        raise StateError(422, "invalid_blind_test", f"at most {config.BLIND_TEST_MAX_RECORDS} records per blind test",
                         {"records": len(raw["records"])})
    for i, record in enumerate(raw["records"]):
        if not isinstance(record, dict):
            raise StateError(422, "invalid_blind_test", f"records[{i}] is not an object", {"index": i})
        missing = [f for f in config.PREDICTED_FIELDS if f not in record]
        if missing:
            raise StateError(422, "invalid_blind_test", f"records[{i}] lacks {', '.join(missing)}",
                             {"index": i, "missing": missing})
        if not isinstance(record["All Comments"], list):
            raise StateError(422, "invalid_blind_test", f"records[{i}]: 'All Comments' must be a list", {"index": i})
    return raw


def _pipeline(key: str, model: str, records: list[dict]) -> dict:
    return {"key": key, "model": model, "status": "queued", "started_at": None, "completed_at": None, "seconds": None,
            "tickets": [{"key": k, "summary": r.get("Summary"), "status": "queued", "seconds": None, "error": None}
                        for k, r in zip(ticket_keys(records), records)],
            "run_ids": [], "versions": None, "output": None, "runs": None, "error": None}


def create(core, body: dict) -> dict:
    raw = validate_input((body or {}).get("input"))
    source = (body or {}).get("source")
    try:
        provider, _ = resolve_model(config.BLIND_TEST_MODEL)
        require_provider_key(provider)
    except ValueError as exc:
        raise StateError(503, "provider_not_configured", str(exc)) from exc
    pipelines, skipped = [_pipeline(SUBMISSION, config.BLIND_TEST_MODEL, raw["records"])], []
    reference = config.BLIND_TEST_REFERENCE_MODEL
    if reference and reference != config.BLIND_TEST_MODEL:
        try:
            require_provider_key(resolve_model(reference)[0])
            pipelines.append(_pipeline(REFERENCE, reference, raw["records"]))
        except ValueError as exc:
            skipped.append({"key": REFERENCE, "model": reference, "reason": str(exc)})
    blind_test_id = core.db.add_blind_test(source if isinstance(source, str) else None, raw, pipelines, skipped)
    for p in pipelines:
        core.submit("blind_test", 2, blind_test_id=blind_test_id, pipeline=p["key"])
    return {"blind_test_id": blind_test_id, "status": "queued", "tickets": len(raw["records"]),
            "pipelines": [{"key": p["key"], "model": p["model"]} for p in pipelines], "skipped": skipped}


def process(core, blind_test_id: str, key: str) -> dict:
    """Worker entry point for one pipeline: triage every record, then fill the file."""
    test = core.db.blind_test(blind_test_id)
    pipe = core.db.blind_test_pipeline(blind_test_id, key)
    records = test["input"]["records"]
    pipe["run_ids"] = [f"{blind_test_id}-{key}-{i + 1:02d}" for i in range(len(records))]
    lock, runs = threading.Lock(), [None] * len(records)
    started = time.monotonic()

    def save(**changes) -> None:
        with lock:
            pipe.update(changes)
            core.db.save_blind_test_pipeline(blind_test_id, pipe)

    def ticket(i: int, **changes) -> None:
        with lock:
            pipe["tickets"][i].update(changes)
            core.db.save_blind_test_pipeline(blind_test_id, pipe)

    try:
        engine = core.engine.variant(model=pipe["model"], comment=True, n_samples=config.BLIND_TEST_SAMPLES)
        policy = core.policy()
        provider, _ = resolve_model(pipe["model"])
        workers = config.LLM_CONCURRENCY if provider == "ollama" else config.BLIND_TEST_CONCURRENCY
        save(status="running", started_at=utc_now(), versions=engine.versions.model_dump())
    except Exception as e:  # noqa: BLE001 - e.g. an unknown model: nothing ran
        save(status="failed", completed_at=utc_now(), error=f"{type(e).__name__}: {e}")
        return pipe

    def one(i: int) -> None:
        tid, run_id, record = pipe["tickets"][i]["key"], pipe["run_ids"][i], records[i]
        ticket(i, status="running")
        t0 = time.monotonic()
        try:
            # Tagged here, in the thread that makes the calls: context variables do not cross threads.
            with usage.tagged(purpose="blind_test", ticket_id=tid, run_id=run_id):
                run = engine.run(record, tid, run_id, policy=policy["content"], policy_version=policy["policy_version"])
        except Exception as e:  # noqa: BLE001 - recorded on the ticket; the others keep going
            run = RunRecord(run_id=run_id, ticket_id=tid, snapshot_id="blind", status="failed", versions=engine.versions,
                            started_at=utc_now(), completed_at=utc_now(), error=f"{type(e).__name__}: {e}")
        runs[i] = run
        ticket(i, status=run.status, seconds=round(time.monotonic() - t0, 3), error=run.error)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(one, range(len(records))))
    save(status="completed", completed_at=utc_now(), seconds=round(time.monotonic() - started, 3),
         output=build_output(test["input"], runs), runs=[r.model_dump() for r in runs])
    return pipe


def _progress(tickets: list[dict]) -> dict:
    counts = {s: 0 for s in ("queued", "running", "completed", "failed")}
    for t in tickets:
        counts[t["status"]] += 1
    return {"total": len(tickets), **counts}


def view(core, blind_test_id: str) -> dict:
    test = core.db.blind_test(blind_test_id)
    if not test:
        raise StateError(404, "not_found", f"unknown blind test {blind_test_id}", {"blind_test": blind_test_id})
    pipelines = []
    for pipe in test["pipelines"]:
        calls = core.db.llm_calls_for_runs(pipe["run_ids"])
        by_run = {}
        for c in calls:
            by_run.setdefault(c["run_id"], []).append(c)
        tickets = [{**t, "latency_ms": usage.totals(by_run.get(run_id, []))["latency_ms"]}
                   for t, run_id in zip(pipe["tickets"], pipe["run_ids"] or [None] * len(pipe["tickets"]))]
        pipelines.append({**{k: v for k, v in pipe.items() if k not in ("runs", "run_ids")}, "tickets": tickets,
                          "progress": _progress(pipe["tickets"]),
                          "usage": {**usage.totals(calls), "currency": config.USAGE_CURRENCY}})
    statuses = {p["status"] for p in pipelines}
    status = "running" if statuses & {"queued", "running"} else "failed" if statuses == {"failed"} else "completed"
    return {"blind_test_id": blind_test_id, "created_at": test["created_at"], "source": test["source"],
            "status": status, "tickets": len(test["input"]["records"]), "input": test["input"],
            "pipelines": pipelines, "skipped": test["skipped"]}
