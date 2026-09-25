"""Core application service: storage, queueing and events around the triage library.
Every decision and every state rule comes from triage/ (run_ticket, state, lanes)."""
import hashlib
import json
from functools import cached_property

from triage import config, usage
from triage.schemas import RunRecord
from triage.state import STALES_COMMENT, StateError, apply_changes, effective_decisions, effective_record
from triage.triage import utc_now

from api.db import Database

CHALLENGE_FIELDS = set(config.DECISION_FIELDS.values())


def content_hash(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _not_found(kind: str, id_: str) -> StateError:
    return StateError(404, "not_found", f"unknown {kind} {id_}", {kind: id_})


def _comment_record(row: dict | None, overrides: list[dict]):
    """The stored comment, marked stale when a later override touched a field it depends on."""
    if row is None:
        return None
    stale = any(o["field"] in STALES_COMMENT and o["seq"] > row["seq"] for o in overrides)
    return row["record"].model_copy(update={"stale": stale})


class _Facts:
    """Per-ticket state for the list endpoints, read one table at a time instead of several
    queries per ticket. Every table is loaded on first use and reused for the whole request."""

    def __init__(self, core: "Core"):
        self._core, self._db = core, core.db
        self._state: dict[str, tuple] = {}

    @cached_property
    def tickets(self) -> list[dict]:
        return self._db.tickets_all()

    @cached_property
    def snapshots(self) -> dict[str, dict]:
        return self._db.latest_snapshots()

    @cached_property
    def runs(self) -> dict:
        return self._db.latest_live_runs()

    @cached_property
    def run_status(self) -> dict[str, str]:
        return self._db.latest_run_status()

    @cached_property
    def run_rows(self) -> dict[str, list[dict]]:
        return self._db.runs_all()

    @cached_property
    def overrides(self) -> dict[str, list[dict]]:
        return self._db.overrides_all()

    @cached_property
    def acceptances(self) -> dict[str, list[dict]]:
        return self._db.acceptances_all()

    @cached_property
    def comments(self) -> dict[str, dict]:
        return self._db.latest_comments()

    @cached_property
    def conflicts(self) -> dict[str, list[dict]]:
        return self._db.conflicts_all()

    @cached_property
    def closures(self) -> dict[str, list[dict]]:
        return self._db.closures_all()

    def state(self, ticket_id: str) -> tuple:
        """(latest live run, effective decisions, effective comment), as Core.effective."""
        if ticket_id not in self._state:
            self._state[ticket_id] = self._core._effective_from(
                self.runs.get(ticket_id), self.overrides.get(ticket_id, []), self.comments.get(ticket_id))
        return self._state[ticket_id]


class Core:
    def __init__(self, db: Database, engine, submit=None):
        self.db, self.engine = db, engine
        self.submit = submit or (lambda kind, priority, **kw: None)  # set by the worker pool
        self._training_health = None

    @property
    def catalog(self) -> dict:
        return self.engine.catalog  # follows KB promotion

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
            return 200, {"ticket_id": ticket_id, "snapshot_id": existing["snapshot_id"],
                         "run_id": self.db.latest_live_run_id(ticket_id), "status": "unchanged"}
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

    def delete_ticket(self, ticket_id: str) -> dict:
        """The ticket no longer exists at the source: drop it and its state. The event log and
        the usage ledger keep its history; queued work for it is skipped."""
        ticket = self.db.ticket(ticket_id)
        if not ticket:
            raise _not_found("ticket", ticket_id)
        deleted = self.db.delete_ticket(ticket_id)
        self.db.append_event("ticket.deleted", {"external_key": ticket["external_key"]}, ticket_id=ticket_id)
        return {"ticket_id": ticket_id, "external_key": ticket["external_key"], "status": "deleted",
                "deleted": deleted}

    # -- runs -------------------------------------------------------------------------
    def enqueue_run(self, ticket_id: str, snapshot_id: str, priority: int = 1) -> str:
        run_id = self.db.create_run(ticket_id, snapshot_id)
        self.submit("run", priority, run_id=run_id)
        return run_id

    def retriage(self, ticket_id: str) -> dict:
        snap = self._snapshot(ticket_id)
        return {"ticket_id": ticket_id, "run_id": self.enqueue_run(ticket_id, snap["snapshot_id"], priority=0)}

    def process_run(self, run_id: str) -> RunRecord | None:
        """Worker entry point: run the engine, pin-check against overrides, store, emit.
        None when the ticket was deleted before the run started."""
        row = self.db.run_row(run_id)
        if row is None:
            return None
        ticket_id = row["ticket_id"]
        fields = self.db.snapshot(row["snapshot_id"])["fields"]
        previous = self._effective_values(ticket_id)
        self.db.set_run_status(run_id, "running")
        self.db.append_event("run.started", {"mode": row["mode"]}, ticket_id=ticket_id, run_id=run_id)
        policy = self.policy()
        try:
            with usage.tagged(purpose="triage", ticket_id=ticket_id, run_id=run_id):
                record = self.engine.run(fields, ticket_id, run_id, policy=policy["content"],
                                         policy_version=policy["policy_version"])
        except Exception as e:  # noqa: BLE001 - e.g. the LLM backend is down: failed, retryable
            record = RunRecord(run_id=run_id, ticket_id=ticket_id, snapshot_id=row["snapshot_id"], status="failed",
                               versions=self.engine.versions, started_at=utc_now(), completed_at=utc_now(),
                               error=f"{type(e).__name__}: {e}")
        record = record.model_copy(update={"snapshot_id": row["snapshot_id"]})
        conflicts = []
        if record.status == "completed":
            record, conflicts = self._flag_conflicts(ticket_id, record)
        if not self.db.finish_run(record):  # deleted while it ran: store and emit nothing
            return record
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
        return self._effective_from(run, self.db.overrides_for(ticket_id), self.db.latest_comment(ticket_id))

    def _effective_from(self, run: RunRecord | None, overrides: list[dict], comment_row: dict | None):
        """Effective state from already loaded rows: the run's decisions with overrides pinned
        on top, and the comment flagged stale when an override outdated it."""
        if run is None:
            return None, None, None
        eff = effective_decisions(run, overrides, self.catalog)
        comment = _comment_record(comment_row, overrides)
        if comment is not None and comment.stale and "stale_comment" not in eff["resolution"].flags:
            eff["resolution"] = eff["resolution"].model_copy(update={"flags": eff["resolution"].flags + ["stale_comment"]})
        return run, eff, comment

    def _effective_values(self, ticket_id: str) -> dict | None:
        run, eff, _ = self.effective(ticket_id)
        return {f: d.effective_value for f, d in eff.items()} if run else None

    def ticket_view(self, ticket_id: str) -> dict:
        ticket, snap = self.db.ticket(ticket_id), self._snapshot(ticket_id)
        run, overrides = self.db.latest_live_run(ticket_id), self.db.overrides_for(ticket_id)
        state = self._effective_from(run, overrides, self.db.latest_comment(ticket_id) if run else None)
        return self._view(ticket, snap, state, self.db.runs_for(ticket_id), overrides,
                          self.db.acceptances_for(ticket_id), self.db.conflicts_for(ticket_id))

    @staticmethod
    def _view(ticket: dict, snap: dict, state: tuple, runs: list[dict], overrides: list[dict],
              acceptances: list[dict], conflicts: list[dict]) -> dict:
        run, eff, comment = state
        history = (
            [{"type": "run", "at": r["created_at"], "run_id": r["run_id"], "status": r["status"], "mode": r["mode"]}
             for r in runs]
            + [{"type": "override", "at": o["created_at"], **o} for o in overrides]
            + [{"type": "acceptance", "at": a["created_at"], **a} for a in acceptances]
            + [{"type": "conflict", "at": e["occurred_at"], "run_id": e["run_id"], **e["payload"]} for e in conflicts]
        )
        history.sort(key=lambda h: h["at"])
        return {
            "ticket_id": ticket["ticket_id"], "external_key": ticket["external_key"],
            "snapshot": {k: snap[k] for k in ("snapshot_id", "content_hash", "received_at", "fields")},
            "effective_state": {f: d.model_dump() for f, d in eff.items()} if eff else None,
            "latest_run": run.model_dump() if run else None,
            "resolution_comment": comment.model_dump() if comment else None,
            "lane": run.lane if run else None, "lane_reasons": run.lane_reasons if run else [],
            "versions": run.versions.model_dump() if run else None,
            "history": history,
        }

    def summary(self, ticket_id: str) -> dict:
        ticket = self.db.ticket(ticket_id)
        if ticket is None:
            raise _not_found("ticket", ticket_id)
        runs = self.db.runs_for(ticket_id)
        return self._summary(ticket, self.effective(ticket_id), runs[-1]["status"] if runs else None)

    def _summary(self, ticket: dict, state: tuple, run_status: str | None) -> dict:
        run, eff, _ = state
        row = {"ticket_id": ticket["ticket_id"], "external_key": ticket["external_key"],
               "run_status": run_status, "lane": run.lane if run else None}
        if eff:
            row.update({f: d.effective_value for f, d in eff.items()})
            row["min_confidence"] = min(d.confidence for d in eff.values())
            row["flags"] = sorted({fl for d in eff.values() for fl in d.flags})
            row["risk"] = self._risk(eff)
        return row

    def _summaries(self, facts: _Facts, only: set[str] | None = None) -> list[dict]:
        """One summary row per ticket (in ticket order), from the bulk-loaded facts."""
        tickets = facts.tickets if only is None else [t for t in facts.tickets if t["ticket_id"] in only]
        return [self._summary(t, facts.state(t["ticket_id"]), facts.run_status.get(t["ticket_id"])) for t in tickets]

    @staticmethod
    def _filter(rows: list[dict], lane=None, service=None, flag=None, status=None) -> list[dict]:
        return [r for r in rows
                if (lane is None or r["lane"] == lane) and (service is None or r.get("service") == service)
                and (flag is None or flag in r.get("flags", [])) and (status is None or r["run_status"] == status)]

    def list_tickets(self, lane=None, service=None, flag=None, status=None, expand=None) -> list[dict]:
        """Summaries, filtered; `expand="view"` adds each ticket's view (as GET /tickets/{id})
        under `view`, so a client needs one request for the whole board instead of one per ticket."""
        if expand not in (None, "view"):
            raise StateError(422, "invalid_expand", "expand must be 'view'", {"expand": expand})
        facts = _Facts(self)
        rows = self._filter(self._summaries(facts), lane, service, flag, status)
        if expand == "view":
            tickets = {t["ticket_id"]: t for t in facts.tickets}
            for row in rows:
                tid = row["ticket_id"]
                snap = facts.snapshots.get(tid)
                row["view"] = self._view(tickets[tid], snap, facts.state(tid), facts.run_rows.get(tid, []),
                                         facts.overrides.get(tid, []), facts.acceptances.get(tid, []),
                                         facts.conflicts.get(tid, [])) if snap else None
        return rows

    def _risk(self, eff: dict) -> float:
        crit = config.CRITICALITY.get(eff["service"].effective_value, "Non-Critical")
        return round((1 - min(d.confidence for d in eff.values()))
                     * config.PRIORITY_WEIGHTS.get(eff["priority"].effective_value, 1)
                     * config.CRITICALITY_WEIGHTS[crit], 4)

    def queue(self, lane: str = "needs_review", sort: str = "risk") -> list[dict]:
        """Tickets whose latest live run is in `lane` and has not been reviewed yet
        (no acceptance of, and no override based on, that run)."""
        facts, out = _Facts(self), []
        for row in self._filter(self._summaries(facts), lane=lane):
            tid = row["ticket_id"]
            run = facts.state(tid)[0]
            reviewed = any(a["run_id"] == run.run_id for a in facts.acceptances.get(tid, [])) or \
                any(o["base_run_id"] == run.run_id for o in facts.overrides.get(tid, []))
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
        self.learn_from_overrides()
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
        if not self.db.ticket(ticket_id):  # deleted after the comment was requested
            return
        run, eff, _ = self.effective(ticket_id)
        try:
            with usage.tagged(purpose="comment", ticket_id=ticket_id, run_id=run.run_id):
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
        rows = self._summaries(_Facts(self), only=set(batch["ticket_ids"]))
        count = lambda key: {v: sum(r[key] == v for r in rows) for v in {r[key] for r in rows}}  # noqa: E731
        return {"batch_id": batch_id, "total": len(rows), "by_status": count("run_status"), "by_lane": count("lane"),
                "ticket_ids": batch["ticket_ids"]}

    def export_batch(self, batch_id: str) -> dict:
        batch = self.db.batch(batch_id)
        if not batch:
            raise _not_found("batch", batch_id)
        return {**batch["meta"], "records": [self.export_ticket(t) for t in batch["ticket_ids"]]}

    # -- policy (CORE_API §6D) ----------------------------------------------------------
    def policy(self) -> dict:
        """The current policy version; p1 (from config.py) is created on first use."""
        from triage.policy import default_policy

        current = self.db.latest_policy()
        if current is None:
            current = self.db.add_policy(default_policy(), None, "system", ["p1: loaded from config.py"])
        return current

    def put_policy(self, content: dict, actor: str, note: str | None = None, event: str = "policy.updated") -> dict:
        from triage.policy import validate_policy

        if not actor:
            raise StateError(422, "actor_required", "actor is required on every write")
        parent = self.policy()
        policy = validate_policy({**parent["content"], **content})
        new = self.db.add_policy(policy, parent["policy_version"], actor,
                                 [note or f"{event.split('.')[1]} by {actor}"])
        self.db.append_event(event, {"policy_version": new["policy_version"], "actor": actor})
        return new

    def set_paused(self, paused: bool, actor: str, note: str | None = None) -> dict:
        return self.put_policy({"paused": paused}, actor, note, "policy.paused" if paused else "policy.resumed")

    # -- knowledge base (CORE_API §6C) ---------------------------------------------------
    @property
    def kb(self):
        return self.engine.kb_store

    def kb_versions(self) -> list[dict]:
        return self.kb.versions()

    def kb_version(self, version: str) -> dict:
        manifest = self.kb.manifest(version)
        catalog, cards = self.kb.load(version)
        return {**manifest, "live": version == self.engine.kb_version,
                "content": {"services": catalog["service_team"], "criticality": catalog["criticality"],
                            "patterns": catalog["patterns"], "fallback_assignee": catalog["fallback_assignee"],
                            "service_cards": cards["cards"]}}

    def request_kb_build(self, actor: str) -> dict:
        if not actor:
            raise StateError(422, "actor_required", "actor is required on every write")
        expected = self.kb.next_version()  # before submitting: an inline worker builds it immediately
        self.submit("kb_build", 1, actor=actor)
        return {"status": "building", "expected_version": expected}

    def process_kb_build(self, actor: str) -> dict:
        """Mine the training corpus and draft service cards (LLM) -> a draft version."""
        from triage.catalog import build_catalog

        catalog = build_catalog()
        with usage.tagged(purpose="kb_build"):
            cards = self.engine.generate_cards(catalog)
        m = self.kb.create_draft(catalog, cards, parent=None, actor=actor, created_at=utc_now(),
                                 changelog=["bootstrap: catalog mined from the training corpus, draft service cards"])
        self.db.append_event("kb.version.drafted", {"kb_version": m["kb_version"], "actor": actor})
        return m

    def new_kb_draft(self, actor: str) -> dict:
        """Live version + approved (not yet applied) proposals -> a new draft."""
        from triage.kb import apply_proposals

        if not actor:
            raise StateError(422, "actor_required", "actor is required on every write")
        live = self.engine.kb_version
        catalog, cards = self.kb.load(live)
        approved = [p for p in self.db.proposals("approved") if not p["target_kb_version"]]
        catalog, cards, changelog = apply_proposals(catalog, cards, approved)
        m = self.kb.create_draft(catalog, cards, parent=live, actor=actor, created_at=utc_now(),
                                 changelog=changelog or ["no approved proposals: copy of the live version"])
        self.db.target_proposals([p["proposal_id"] for p in approved], m["kb_version"])
        self.db.append_event("kb.version.drafted", {"kb_version": m["kb_version"], "actor": actor})
        return m

    def publish_kb(self, version: str, actor: str) -> dict:
        m = self.kb.publish(version, actor)
        self.db.append_event("kb.version.published", {"kb_version": version, "actor": actor})
        return m

    def promote_kb(self, version: str, actor: str) -> dict:
        m, previous = self.kb.promote(version, actor)
        self.engine.use_kb(version)
        self.db.append_event("kb.version.promoted", {"kb_version": version, "previous": previous, "actor": actor})
        return m

    # -- closures, proposals, learning ------------------------------------------------
    def closure(self, ticket_id: str, body: dict) -> dict:
        """Final outcome from Jira: score the note; a specific note becomes an add_pattern
        proposal, a vague or missing one lands on the KB health backlog."""
        from triage.kb import score_note

        self._snapshot(ticket_id)
        _, eff, _ = self.effective(ticket_id)
        final = body.get("fields") or {}
        services = final.get("Affected Business or IT Services")
        service = (services[0] if services else None) or (eff["service"].effective_value if eff else None)
        note, resolver = body.get("resolution_note"), body.get("resolver")
        score = score_note(note)
        proposal_id, outcome = None, "backlog"
        if score["specific"] and service in config.SERVICES and resolver:
            text = note.strip() if note.strip().startswith(config.RESOLUTION_PREFIX) else config.RESOLUTION_PREFIX + note.strip()
            known = {p["text"] for p in self.catalog["patterns"]} | \
                {p["payload"].get("text") for p in self.db.proposals() if p["type"] == "add_pattern"}
            if text in known:
                outcome = "duplicate"
            else:
                prop = self.db.add_proposal("add_pattern", {"text": text, "service": service, "resolver": resolver},
                                            {"ticket_ids": [ticket_id], "count": 1})
                proposal_id, outcome = prop["proposal_id"], "proposal"
                self.db.append_event("kb.proposal.created", {"proposal_id": proposal_id, "type": "add_pattern",
                                                             "status": "open"}, ticket_id=ticket_id)
        return self.db.add_closure(ticket_id, final, note, resolver, body.get("actor"), score, outcome, proposal_id)

    def learn_from_overrides(self) -> list[dict]:
        """Groups of >= PROPOSAL_MIN_SUPPORT distinct tickets with the same correction become
        a proposal (once per group; a rejected group returns only with more support)."""
        from triage.kb import PROPOSAL_MIN_SUPPORT, override_groups, proposal_from_group

        facts, overrides = _Facts(self), []
        for t in facts.tickets:
            ov = facts.overrides.get(t["ticket_id"])
            if ov:
                _, eff, _ = facts.state(t["ticket_id"])
                overrides += [{**o, "service": eff["service"].effective_value} for o in ov]
        existing = {}
        for p in self.db.proposals():
            if p["signature"]:
                existing.setdefault(p["signature"], []).append(p)
        created = []
        for sig, g in override_groups(overrides).items():
            if len(g["tickets"]) < PROPOSAL_MIN_SUPPORT:
                continue
            prior = existing.get(sig, [])
            if any(p["status"] != "rejected" for p in prior) or \
                    any(p["evidence"]["count"] >= len(g["tickets"]) for p in prior):
                continue
            prop = proposal_from_group(sig, g)
            p = self.db.add_proposal(prop["type"], prop["payload"], prop["evidence"], sig)
            self.db.append_event("kb.proposal.created", {"proposal_id": p["proposal_id"], "type": p["type"],
                                                         "status": "open"})
            created.append(p)
        return created

    def proposals(self, status: str | None = None) -> list[dict]:
        return self.db.proposals(status)

    def decide_proposal(self, proposal_id: str, approve: bool, actor: str, note: str | None = None,
                        payload: dict | None = None) -> dict:
        from triage.kb import apply_proposals

        if not actor:
            raise StateError(422, "actor_required", "actor is required on every write")
        p = self.db.proposal(proposal_id)
        if p is None:
            raise _not_found("proposal", proposal_id)
        if p["status"] != "open":
            raise StateError(409, "version_conflict", f"proposal is already {p['status']}")
        if not approve and not note:
            raise StateError(422, "note_required", "a rejection needs a reason")
        if approve:  # dry-run the (possibly edited) payload so a bad one fails now, not at build time
            apply_proposals(self.catalog, {"cards": [dict(c, pattern_ids=list(c["pattern_ids"]))
                                                     for c in self.engine.cards["cards"]]},
                            [{**p, "payload": payload or p["payload"]}])
        decided = self.db.decide_proposal(proposal_id, "approved" if approve else "rejected", actor, note, payload)
        self.db.append_event("kb.proposal.decided", {"proposal_id": proposal_id, "type": p["type"],
                                                     "status": decided["status"], "actor": actor})
        return decided

    def kb_health(self) -> dict:
        if self._training_health is None:
            self._training_health = _training_health()
        closures = self.db.closures()
        backlog = [{"ticket_id": c["ticket_id"], "closure_id": c["closure_id"], "note": c["note"],
                    "reason": "missing" if c["score"]["missing"] else "vague"}
                   for c in closures if c["outcome"] == "backlog"]
        generic = [t["ticket_id"] for t in self.list_tickets(service=config.CATCH_ALL_SERVICE)]
        with_patterns = set(self.catalog["resolvers_by_service"])
        return {"kb_version": self.engine.kb_version, "training_corpus": self._training_health,
                "closure_backlog": backlog, "generic_bucket_tickets": generic,
                "services_without_patterns": sorted(s for s in self.catalog["service_team"] if s not in with_patterns)}

    # -- audit & metrics -------------------------------------------------------------------
    def audit(self, ticket_id=None, actor=None, type_prefix=None, since=None, until=None, limit=200) -> list[dict]:
        return self.db.search_events(ticket_id, actor, type_prefix, since, until, limit)

    def metric(self, name: str, since=None, until=None, service=None) -> dict:
        from triage import metrics

        if name not in metrics.METRICS:
            raise StateError(404, "unknown_metric", f"unknown metric {name}", {"available": list(metrics.METRICS)})
        loaded, completed, facts = _Facts(self), self.db.completed_live_runs(), []
        for t in loaded.tickets:
            tid = t["ticket_id"]
            _, eff, _ = loaded.state(tid)
            if service and (not eff or eff["service"].effective_value != service):
                continue
            runs = [r for r in completed.get(tid, []) if (not since or (r.completed_at or "") >= since)
                    and (not until or (r.completed_at or "") <= until)]
            facts.append({"ticket_id": tid, "runs": runs, "overrides": loaded.overrides.get(tid, []),
                          "acceptances": loaded.acceptances.get(tid, []), "closures": loaded.closures.get(tid, []),
                          "effective": eff if runs else None})
        from triage.retrieval import ticket_text

        text_of = lambda tid: ticket_text(loaded.snapshots[tid]["fields"])  # noqa: E731
        value = metrics.compute(name, [f for f in facts if f["runs"] or name == "resolver_load"], self.catalog,
                                embed=self.engine.embed, text_of=text_of)
        return {"metric": name, "from": since, "to": until, "service": service, "value": value}

    def usage_summary(self, window: str) -> dict:
        import datetime as dt

        now = dt.datetime.now(dt.timezone.utc)
        try:
            since, _ = usage.window_bounds(window, now)
        except ValueError as e:
            raise StateError(422, "invalid_window", str(e), {"available": list(usage.WINDOWS)}) from e
        return usage.summarize(self.db.llm_calls_since(since), window, now)

    # -- human labels, shadow evaluations, policy preview (step 3) -----------------------
    def human_labels(self, ticket_id: str) -> dict[str, str]:
        """Human-confirmed values per field: the latest override (derived ones included),
        else the value of a run a human accepted for that field."""
        labels = {}
        for a in self.db.acceptances_for(ticket_id):
            run = self.db.run(a["run_id"])
            labels.update({f: run.decisions[f].value for f in a["fields"] if f in run.decisions})
        for o in self.db.overrides_for(ticket_id):
            labels[o["field"]] = o["new_value"]
        return labels

    def human_labels_all(self, ticket_ids: list[str]) -> dict[str, dict[str, str]]:
        """human_labels for many tickets, from one read per table."""
        acceptances, overrides = self.db.acceptances_all(), self.db.overrides_all()
        runs = self.db.runs_by_id({a["run_id"] for tid in ticket_ids for a in acceptances.get(tid, [])})
        out = {}
        for tid in ticket_ids:
            labels = {}
            for a in acceptances.get(tid, []):
                run = runs[a["run_id"]]
                labels.update({f: run.decisions[f].value for f in a["fields"] if f in run.decisions})
            for o in overrides.get(tid, []):
                labels[o["field"]] = o["new_value"]
            out[tid] = labels
        return out

    def _gold(self) -> list[str]:
        return self.db.reviewed_ticket_ids()

    def _recent(self, days: int, latest: dict[str, RunRecord] | None = None) -> list[str]:
        """Tickets whose latest live run completed in the last `days`, in ticket order."""
        import datetime as dt

        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat(timespec="seconds")
        latest = self.db.latest_live_runs() if latest is None else latest
        return [t for t in self.db.ticket_ids()
                if (r := latest.get(t)) is not None and (r.completed_at or "") >= cutoff]

    def create_evaluation(self, body: dict) -> dict:
        """Queue a shadow evaluation: replay a ticket set under other versions. Shadow runs
        never change effective state and emit only evaluation.* events."""
        versions, ticket_set = body.get("versions") or {}, body.get("ticket_set", "gold")
        unknown = set(versions) - {"model", "prompt", "kb", "policy"}
        if unknown or ticket_set not in ("gold", "recent"):
            raise StateError(422, "invalid_evaluation", "versions keys: model, prompt, kb, policy; "
                                                        "ticket_set: gold | recent", {"unknown": sorted(unknown)})
        if versions.get("kb"):
            self.kb.manifest(versions["kb"])  # 404 when unknown
        if versions.get("policy") and not self.db.policy_version(versions["policy"]):
            raise _not_found("policy version", versions["policy"])
        if versions.get("prompt") and versions["prompt"] != self.engine.versions.prompt:
            raise StateError(422, "unknown_prompt_version", "only the deployed prompt version can be evaluated",
                             {"available": [self.engine.versions.prompt]})
        if versions.get("model"):
            from triage.llm import require_provider_key, resolve_model

            try:
                provider, _ = resolve_model(versions["model"])
            except (ValueError, AttributeError) as exc:
                raise StateError(422, "invalid_model", "Use a model name, optionally prefixed with openai/, swisscom/ or ollama/.") from exc
            try:
                require_provider_key(provider)
            except ValueError as exc:
                raise StateError(503, "provider_not_configured", str(exc)) from exc
        tickets = self._gold() if ticket_set == "gold" else self._recent(int(body.get("days") or 30))
        tickets = [t for t in tickets if self.db.latest_live_run(t) is not None]
        eid = self.db.add_evaluation(body, versions, tickets)
        self.submit("evaluation", 2, evaluation_id=eid)
        return {"evaluation_id": eid, "status": "queued", "tickets": len(tickets)}

    def process_evaluation(self, evaluation_id: str) -> dict:
        ev = self.db.evaluation(evaluation_id)
        req = ev["versions"]
        engine = self.engine.variant(kb_version=req.get("kb"), model=req.get("model"))
        policy = self.db.policy_version(req["policy"]) if req.get("policy") else self.policy()
        per_field = {f: {"n": 0, "agree_live": 0, "n_labelled": 0, "agree_label": 0} for f in config.DECISION_FIELDS}
        disagreements, run_ids, failed = [], [], 0
        changed = changed_match = changed_disagree = 0
        for tid in ev["ticket_ids"]:
            snap = self.db.latest_snapshot(tid)
            run_id = self.db.create_run(tid, snap["snapshot_id"], mode="shadow")
            try:
                with usage.tagged(purpose="evaluation", ticket_id=tid, run_id=run_id):
                    record = engine.run(snap["fields"], tid, run_id, policy=policy["content"],
                                        policy_version=policy["policy_version"])
            except Exception as e:  # noqa: BLE001
                record = RunRecord(run_id=run_id, ticket_id=tid, snapshot_id=snap["snapshot_id"], status="failed",
                                   versions=engine.versions, started_at=utc_now(), error=f"{type(e).__name__}: {e}")
            record = record.model_copy(update={"mode": "shadow", "snapshot_id": snap["snapshot_id"]})
            self.db.finish_run(record)
            run_ids.append(run_id)
            if record.status != "completed":
                failed += 1
                continue
            live, labels = self.db.latest_live_run(tid), self.human_labels(tid)
            for field, d in record.decisions.items():
                live_value, label = live.decisions[field].value, labels.get(field)
                stats = per_field[field]
                stats["n"] += 1
                stats["agree_live"] += d.value == live_value
                if label is not None:
                    stats["n_labelled"] += 1
                    stats["agree_label"] += d.value == label
                if d.value != live_value:
                    changed += 1
                    changed_match += label is not None and d.value == label
                    changed_disagree += label is not None and d.value != label
                if d.value != live_value or (label is not None and d.value != label):
                    disagreements.append({"ticket_id": tid, "field": field, "shadow": d.value, "live": live_value,
                                          "label": label})
        results = {
            "versions": {**engine.versions.model_dump(), "policy": policy["policy_version"]},
            "per_field": {f: {**v, "agreement_live": round(v["agree_live"] / v["n"], 4) if v["n"] else None,
                              "agreement_label": round(v["agree_label"] / v["n_labelled"], 4) if v["n_labelled"] else None}
                          for f, v in per_field.items()},
            "summary": {"tickets": len(ev["ticket_ids"]), "failed": failed, "changed_decisions": changed,
                        "changed_matching_labels": changed_match, "changed_against_labels": changed_disagree,
                        "changed_unlabelled": changed - changed_match - changed_disagree},
            "disagreements": disagreements, "shadow_run_ids": run_ids,
        }
        self.db.finish_evaluation(evaluation_id, "completed", results)
        self.db.append_event("evaluation.completed", {"evaluation_id": evaluation_id, "summary": results["summary"]})
        return results

    def evaluation(self, evaluation_id: str) -> dict:
        ev = self.db.evaluation(evaluation_id)
        if not ev:
            raise _not_found("evaluation", evaluation_id)
        return ev

    # -- blind tests (api/blind_tests.py) -------------------------------------------------
    def create_blind_test(self, body: dict) -> dict:
        from api import blind_tests

        return blind_tests.create(self, body)

    def process_blind_test(self, blind_test_id: str, pipeline: str) -> dict:
        from api import blind_tests

        return blind_tests.process(self, blind_test_id, pipeline)

    def blind_test(self, blind_test_id: str) -> dict:
        from api import blind_tests

        return blind_tests.view(self, blind_test_id)

    def policy_preview(self, content: dict, days: int = 30) -> dict:
        """Estimated auto-apply rate (recent tickets) and error rate (auto-applied gold
        tickets whose decisions disagree with human labels) for the current and a proposed
        policy. Deterministic: lanes are re-assigned on stored runs, no LLM calls."""
        from triage.calibration import recalibrate
        from triage.lanes import assign_lane
        from triage.policy import validate_policy

        current = self.policy()
        proposed = validate_policy({**current["content"], **content})
        latest = self.db.latest_live_runs()
        recent, gold = self._recent(days, latest), set(self._gold())
        labels_of = self.human_labels_all([tid for tid in recent if tid in gold])

        def estimate(policy: dict) -> dict:
            auto = errors = gold_auto = 0
            lanes = {}
            for tid in recent:
                run = latest[tid]
                decisions = recalibrate(run.decisions, policy["calibration"])
                lane, _, _ = assign_lane(decisions, run.run_id, policy)
                lanes[tid] = lane
                if lane != "auto_applied":
                    continue
                auto += 1
                if tid in gold:
                    gold_auto += 1
                    labels = labels_of[tid]
                    errors += any(labels.get(f, d.value) != d.value for f, d in run.decisions.items())
            n = len(recent)
            return {"tickets": n, "auto_applied": auto, "auto_apply_rate": round(auto / n, 4) if n else None,
                    "gold_auto_applied": gold_auto, "errors": errors,
                    "error_rate": round(errors / gold_auto, 4) if gold_auto else None, "_lanes": lanes}

        now, then = estimate(current["content"]), estimate(proposed)
        moved = sum(now["_lanes"][t] != then["_lanes"][t] for t in recent)
        return {"days": days, "current": {"policy_version": current["policy_version"],
                                          **{k: v for k, v in now.items() if k != "_lanes"}},
                "proposed": {"policy": proposed, **{k: v for k, v in then.items() if k != "_lanes"}},
                "tickets_changing_lane": moved}


def _training_health() -> dict:
    """Vague and missing resolutions in the training corpus (the historical backlog)."""
    from collections import Counter

    from triage.catalog import split_comment
    from triage.data import load_training

    vague, missing, total = Counter(), Counter(), Counter()
    for r in load_training():
        svc = (r.get("Affected Business or IT Services") or ["?"])[0]
        total[svc] += 1
        texts = [split_comment(c)[1] for c in r.get("All Comments") or []]
        if any(t.startswith(config.RESOLUTION_PREFIX) for t in texts):
            continue
        if any(t == "Problem fixed." or t.startswith("Resolution recorded:") for t in texts):
            vague[svc] += 1
        else:
            missing[svc] += 1
    return {"tickets": sum(total.values()), "vague": sum(vague.values()), "missing": sum(missing.values()),
            "by_service": {s: {"vague": vague[s], "missing": missing[s], "total": total[s]} for s in sorted(total)}}
