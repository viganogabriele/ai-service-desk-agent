"""Core application service: storage, queueing and events around the triage library.
Every decision and every state rule comes from triage/ (run_ticket, state, lanes)."""
import hashlib
import json

from triage import config
from triage.schemas import RunRecord
from triage.state import STALES_COMMENT, StateError, apply_changes, effective_decisions, effective_record
from triage.triage import utc_now

from api.db import Database

CHALLENGE_FIELDS = set(config.DECISION_FIELDS.values())


def content_hash(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _not_found(kind: str, id_: str) -> StateError:
    return StateError(404, "not_found", f"unknown {kind} {id_}", {kind: id_})


class Core:
    def __init__(self, db: Database, engine, submit=None):
        self.db, self.engine = db, engine
        self.catalog = engine.catalog
        self.submit = submit or (lambda kind, priority, **kw: None)  # set by the worker pool

    # -- import -----------------------------------------------------------------------
    def import_ticket(self, external_key: str, fields: dict, idempotency_key: str | None = None,
                      priority: int = 1) -> tuple[int, dict]:
        """202 + queued run for a new ticket or a new snapshot; 200 + nothing queued when the
        (external_key, content_hash) pair is already known."""
        if not external_key:
            raise StateError(422, "invalid_ticket", "external_key is required")
        h = content_hash(fields)
        if idempotency_key is not None and idempotency_key != f"{external_key}{h}":
            raise StateError(422, "idempotency_key_mismatch", "Idempotency-Key must be external_key + content_hash",
                             {"expected_suffix": h})
        ticket = self.db.ticket_by_key(external_key)
        ticket_id = ticket["ticket_id"] if ticket else self.db.create_ticket(external_key)
        existing = self.db.snapshot_by_hash(ticket_id, h)
        if existing:
            runs = self.db.runs_for(ticket_id)
            return 200, {"ticket_id": ticket_id, "snapshot_id": existing["snapshot_id"],
                         "run_id": runs[-1]["run_id"] if runs else None, "status": "unchanged"}
        snapshot_id = self.db.add_snapshot(ticket_id, h, fields)
        self.db.append_event("ticket.imported", {"external_key": external_key, "snapshot_id": snapshot_id},
                             ticket_id=ticket_id)
        run_id = self.enqueue_run(ticket_id, snapshot_id, priority)
        return 202, {"ticket_id": ticket_id, "snapshot_id": snapshot_id, "run_id": run_id, "status": "queued"}

    def import_batch(self, raw: dict) -> dict:
        records = raw.get("records")
        if not isinstance(records, list):
            raise StateError(422, "invalid_batch", "a challenge-format object with a 'records' list is required")
        meta = {k: v for k, v in raw.items() if k != "records"}
        source = str(raw.get("runId") or content_hash(meta)[:10])
        results = []
        for i, rec in enumerate(records):
            key = str(rec.get("Key") or rec.get("Issue key") or f"{source}#{i + 1:02d}")
            _, body = self.import_ticket(key, rec)
            results.append({"external_key": key, **body})
        batch_id = self.db.create_batch(meta, [r["ticket_id"] for r in results])
        return {"batch_id": batch_id, "tickets": results}

    # -- runs -------------------------------------------------------------------------
    def enqueue_run(self, ticket_id: str, snapshot_id: str, priority: int = 1) -> str:
        run_id = self.db.create_run(ticket_id, snapshot_id)
        self.submit("run", priority, run_id=run_id)
        return run_id

    def retriage(self, ticket_id: str) -> dict:
        snap = self._snapshot(ticket_id)
        return {"ticket_id": ticket_id, "run_id": self.enqueue_run(ticket_id, snap["snapshot_id"], priority=0)}

    def process_run(self, run_id: str) -> RunRecord:
        """Worker entry point: run the engine, pin-check against overrides, store, emit."""
        row = self.db.run_row(run_id)
        ticket_id = row["ticket_id"]
        fields = self.db.snapshot(row["snapshot_id"])["fields"]
        previous = self._effective_values(ticket_id)
        self.db.set_run_status(run_id, "running")
        self.db.append_event("run.started", {"mode": row["mode"]}, ticket_id=ticket_id, run_id=run_id)
        try:
            record = self.engine.run(fields, ticket_id, run_id)
        except Exception as e:  # noqa: BLE001 - e.g. the LLM backend is down: failed, retryable
            record = RunRecord(run_id=run_id, ticket_id=ticket_id, snapshot_id=row["snapshot_id"], status="failed",
                               versions=self.engine.versions, started_at=utc_now(), completed_at=utc_now(),
                               error=f"{type(e).__name__}: {e}")
        record = record.model_copy(update={"snapshot_id": row["snapshot_id"]})
        conflicts = []
        if record.status == "completed":
            record, conflicts = self._flag_conflicts(ticket_id, record)
        self.db.finish_run(record)
        if record.status != "completed":
            self.db.append_event("run.failed", {"mode": row["mode"], "error": record.error},
                                 ticket_id=ticket_id, run_id=run_id)
            return record
        if record.resolution_comment is not None:
            self.db.add_comment(ticket_id, record.resolution_comment, "generated", run_id=run_id)
        for c in conflicts:
            self.db.append_event("decision.conflict", c, ticket_id=ticket_id, run_id=run_id)
        now = self._effective_values(ticket_id)
        base = previous or {f: d.original_value for f, d in record.decisions.items()}
        self.db.append_event("run.completed", {
            "lane": record.lane, "lane_reasons": record.lane_reasons, "audit_sampled": record.audit_sampled,
            "changed_fields": [f for f in now if now[f] != base.get(f)],
        }, ticket_id=ticket_id, run_id=run_id)
        return record

    def _flag_conflicts(self, ticket_id: str, record: RunRecord) -> tuple[RunRecord, list[dict]]:
        """Pinned fields keep their override; a disagreeing new run value is flagged
        conflict_with_override (before the run is stored, so the run stays immutable)."""
        latest = {}
        for o in self.db.overrides_for(ticket_id):
            latest[o["field"]] = o["new_value"]
        decisions, conflicts = dict(record.decisions), []
        for field, pinned in latest.items():
            d = decisions.get(field)
            if d is not None and d.value != pinned:
                decisions[field] = d.model_copy(update={"flags": d.flags + ["conflict_with_override"]})
                conflicts.append({"field": field, "pinned_value": pinned, "new_run_value": d.value})
        return record.model_copy(update={"decisions": decisions}), conflicts

    # -- effective state -------------------------------------------------------------
    def _snapshot(self, ticket_id: str) -> dict:
        if not self.db.ticket(ticket_id):
            raise _not_found("ticket", ticket_id)
        return self.db.latest_snapshot(ticket_id)

    def effective(self, ticket_id: str):
        """(latest live run, effective decisions, effective comment) or (None, None, None)."""
        self._snapshot(ticket_id)
        run = self.db.latest_live_run(ticket_id)
        if run is None:
            return None, None, None
        overrides = self.db.overrides_for(ticket_id)
        eff = effective_decisions(run, overrides, self.catalog)
        comment = self._comment(ticket_id, overrides)
        if comment is not None and comment.stale and "stale_comment" not in eff["resolution"].flags:
            eff["resolution"] = eff["resolution"].model_copy(update={"flags": eff["resolution"].flags + ["stale_comment"]})
        return run, eff, comment

    def _comment(self, ticket_id: str, overrides: list[dict]):
        row = self.db.latest_comment(ticket_id)
        if row is None:
            return None
        stale = any(o["field"] in STALES_COMMENT and o["seq"] > row["seq"] for o in overrides)
        return row["record"].model_copy(update={"stale": stale})

    def _effective_values(self, ticket_id: str) -> dict | None:
        run, eff, _ = self.effective(ticket_id)
        return {f: d.effective_value for f, d in eff.items()} if run else None

    def ticket_view(self, ticket_id: str) -> dict:
        ticket, snap = self.db.ticket(ticket_id), self._snapshot(ticket_id)
        run, eff, comment = self.effective(ticket_id)
        history = (
            [{"type": "run", "at": r["created_at"], "run_id": r["run_id"], "status": r["status"], "mode": r["mode"]}
             for r in self.db.runs_for(ticket_id)]
            + [{"type": "override", "at": o["created_at"], **o} for o in self.db.overrides_for(ticket_id)]
            + [{"type": "acceptance", "at": a["created_at"], **a} for a in self.db.acceptances_for(ticket_id)]
            + [{"type": "conflict", "at": e["occurred_at"], "run_id": e["run_id"], **e["payload"]}
               for e in self.db.events_for(ticket_id) if e["type"] == "decision.conflict"]
        )
        history.sort(key=lambda h: h["at"])
        return {
            "ticket_id": ticket_id, "external_key": ticket["external_key"],
            "snapshot": {k: snap[k] for k in ("snapshot_id", "content_hash", "received_at", "fields")},
            "effective_state": {f: d.model_dump() for f, d in eff.items()} if eff else None,
            "latest_run": run.model_dump() if run else None,
            "resolution_comment": comment.model_dump() if comment else None,
            "lane": run.lane if run else None, "lane_reasons": run.lane_reasons if run else [],
            "versions": run.versions.model_dump() if run else None,
            "history": history,
        }

    def summary(self, ticket_id: str) -> dict:
        run, eff, _ = self.effective(ticket_id)
        runs = self.db.runs_for(ticket_id)
        row = {"ticket_id": ticket_id, "external_key": self.db.ticket(ticket_id)["external_key"],
               "run_status": runs[-1]["status"] if runs else None, "lane": run.lane if run else None}
        if eff:
            row.update({f: d.effective_value for f, d in eff.items()})
            row["min_confidence"] = min(d.confidence for d in eff.values())
            row["flags"] = sorted({fl for d in eff.values() for fl in d.flags})
            row["risk"] = self._risk(eff)
        return row

    def list_tickets(self, lane=None, service=None, flag=None, status=None) -> list[dict]:
        rows = [self.summary(t) for t in self.db.ticket_ids()]
        return [r for r in rows
                if (lane is None or r["lane"] == lane) and (service is None or r.get("service") == service)
                and (flag is None or flag in r.get("flags", [])) and (status is None or r["run_status"] == status)]

    def _risk(self, eff: dict) -> float:
        crit = config.CRITICALITY.get(eff["service"].effective_value, "Non-Critical")
        return round((1 - min(d.confidence for d in eff.values()))
                     * config.PRIORITY_WEIGHTS.get(eff["priority"].effective_value, 1)
                     * config.CRITICALITY_WEIGHTS[crit], 4)

    def queue(self, lane: str = "needs_review", sort: str = "risk") -> list[dict]:
        """Tickets whose latest live run is in `lane` and has not been reviewed yet
        (no acceptance of, and no override based on, that run)."""
        out = []
        for row in self.list_tickets(lane=lane):
            run = self.db.latest_live_run(row["ticket_id"])
            reviewed = any(a["run_id"] == run.run_id for a in self.db.acceptances_for(row["ticket_id"])) or \
                any(o["base_run_id"] == run.run_id for o in self.db.overrides_for(row["ticket_id"]))
            if not reviewed:
                out.append(row)
        if sort == "risk":
            out.sort(key=lambda r: -r.get("risk", 0))
        return out

    # -- review -----------------------------------------------------------------------
    def _require_latest(self, ticket_id: str, run_id: str) -> RunRecord:
        run = self.db.latest_live_run(ticket_id)
        if run is None:
            raise StateError(409, "no_completed_run", "the ticket has no completed run yet")
        if run.run_id != run_id:
            raise StateError(409, "stale_run", "base run is no longer the latest live run",
                             {"latest_run": run.model_dump()})
        return run

    def accept(self, ticket_id: str, run_id: str, fields: list[str] | None, actor: str) -> dict:
        self._snapshot(ticket_id)
        run = self._require_latest(ticket_id, run_id)
        fields = fields or list(run.decisions)
        unknown = [f for f in fields if f not in run.decisions]
        if unknown:
            raise StateError(422, "invalid_field", "unknown fields", {"fields": unknown})
        acc = self.db.add_acceptance(ticket_id, run_id, fields, actor)
        self.db.append_event("decision.accepted", {"fields": fields, "actor": actor}, ticket_id=ticket_id, run_id=run_id)
        return acc

    def preview(self, ticket_id: str, body: dict) -> dict:
        self._snapshot(ticket_id)
        run = self._require_latest(ticket_id, body.get("base_run_id"))
        _, eff, _ = self.effective(ticket_id)
        scores = {p.pattern_id: p.similarity for p in run.decisions["service"].evidence.patterns}
        return apply_changes(eff, body.get("changes") or [], bool(body.get("force")), self.catalog, scores)

    def commit(self, ticket_id: str, body: dict) -> dict:
        if not body.get("actor"):
            raise StateError(422, "actor_required", "actor is required on every write")
        result = self.preview(ticket_id, body)
        stored = self.db.add_overrides(ticket_id, body["base_run_id"], body["actor"], result["changes"])
        _, eff, comment = self.effective(ticket_id)
        effective_state = {f: d.effective_value for f, d in eff.items()}
        self.db.append_event("decision.overridden", {"changes": stored, "actor": body["actor"],
                                                     "effective_state": effective_state},
                             ticket_id=ticket_id, run_id=body["base_run_id"])
        if result["comment_stale"] and comment is not None:
            self.db.append_event("comment.updated", {"stale": True, "origin": None}, ticket_id=ticket_id)
        return {**result, "overrides": stored, "effective_state": effective_state}

    def request_comment(self, ticket_id: str) -> dict:
        run, _, _ = self.effective(ticket_id)
        if run is None:
            raise StateError(409, "no_completed_run", "the ticket has no completed run yet")
        self.submit("comment", 0, ticket_id=ticket_id)
        return {"ticket_id": ticket_id, "status": "queued"}

    def process_comment(self, ticket_id: str) -> None:
        run, eff, _ = self.effective(ticket_id)
        try:
            record = self.engine.regenerate_comment(self.db.latest_snapshot(ticket_id)["fields"], eff)
        except Exception as e:  # noqa: BLE001
            self.db.append_event("run.failed", {"mode": "comment", "error": f"{type(e).__name__}: {e}"},
                                 ticket_id=ticket_id)
            return
        self.db.add_comment(ticket_id, record, "regenerated", run_id=run.run_id)
        self.db.append_event("comment.updated", {"stale": False, "origin": "regenerated"}, ticket_id=ticket_id)

    def edit_comment(self, ticket_id: str, text: str, actor: str) -> dict:
        from triage.schemas import ResolutionCommentRecord

        if not actor:
            raise StateError(422, "actor_required", "actor is required on every write")
        self._snapshot(ticket_id)
        try:
            record = ResolutionCommentRecord(text=text, edited_by=actor)
        except ValueError as e:
            raise StateError(422, "invalid_comment", str(e)) from e
        stored = self.db.add_comment(ticket_id, record, "edited", actor=actor)
        self.db.append_event("comment.updated", {"stale": False, "origin": "edited"}, ticket_id=ticket_id)
        return {**stored, "record": record.model_dump()}

    # -- export -----------------------------------------------------------------------
    def export_ticket(self, ticket_id: str) -> dict:
        fields = self._snapshot(ticket_id)["fields"]
        run, eff, comment = self.effective(ticket_id)
        return effective_record(fields, run, eff, comment) if run else fields

    def batch_status(self, batch_id: str) -> dict:
        batch = self.db.batch(batch_id)
        if not batch:
            raise _not_found("batch", batch_id)
        rows = [self.summary(t) for t in batch["ticket_ids"]]
        count = lambda key: {v: sum(r[key] == v for r in rows) for v in {r[key] for r in rows}}  # noqa: E731
        return {"batch_id": batch_id, "total": len(rows), "by_status": count("run_status"), "by_lane": count("lane"),
                "ticket_ids": batch["ticket_ids"]}

    def export_batch(self, batch_id: str) -> dict:
        batch = self.db.batch(batch_id)
        if not batch:
            raise _not_found("batch", batch_id)
        return {**batch["meta"], "records": [self.export_ticket(t) for t in batch["ticket_ids"]]}
