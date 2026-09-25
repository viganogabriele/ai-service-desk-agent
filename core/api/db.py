"""SQLite store (data/core.db): tickets, snapshots, runs, overrides, acceptances, comments,
batches, the append-only event log and the LLM usage ledger. JSON columns for records. Thread-safe via one lock."""
import json
import sqlite3
import threading
import uuid
from pathlib import Path

from triage.schemas import ResolutionCommentRecord, RunRecord
from triage.triage import utc_now

SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY, external_key TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, content_hash TEXT NOT NULL,
  fields TEXT NOT NULL, received_at TEXT NOT NULL, UNIQUE (ticket_id, content_hash));
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, mode TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT);
CREATE TABLE IF NOT EXISTS overrides (
  override_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, field TEXT NOT NULL, old_value TEXT,
  new_value TEXT, reason_code TEXT NOT NULL, note TEXT, actor TEXT NOT NULL, base_run_id TEXT NOT NULL,
  created_at TEXT NOT NULL, forced INTEGER NOT NULL DEFAULT 0, cascaded_from TEXT, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS acceptances (
  acceptance_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, run_id TEXT NOT NULL, fields TEXT NOT NULL,
  actor TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, run_id TEXT, record TEXT NOT NULL,
  origin TEXT NOT NULL, actor TEXT, created_at TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS batches (
  batch_id TEXT PRIMARY KEY, meta TEXT NOT NULL, ticket_ids TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL,
  ticket_id TEXT, run_id TEXT, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS closures (
  closure_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, fields TEXT NOT NULL, note TEXT, resolver TEXT,
  actor TEXT, score TEXT NOT NULL, outcome TEXT NOT NULL, proposal_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  proposal_id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, evidence TEXT NOT NULL,
  status TEXT NOT NULL, signature TEXT, created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT,
  decision_note TEXT, target_kb_version TEXT);
CREATE TABLE IF NOT EXISTS evaluations (
  evaluation_id TEXT PRIMARY KEY, request TEXT NOT NULL, versions TEXT NOT NULL, ticket_ids TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, results TEXT);
CREATE TABLE IF NOT EXISTS policies (
  policy_version TEXT PRIMARY KEY, content TEXT NOT NULL, parent_version TEXT, created_at TEXT NOT NULL,
  actor TEXT, changelog TEXT NOT NULL, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS llm_calls (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  stage TEXT NOT NULL, purpose TEXT NOT NULL, outcome TEXT NOT NULL, ticket_id TEXT, run_id TEXT,
  input_tokens INTEGER NOT NULL, cached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL, latency_ms INTEGER, cost REAL NOT NULL, saved REAL NOT NULL,
  priced INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS llm_calls_time ON llm_calls (occurred_at);
CREATE INDEX IF NOT EXISTS runs_ticket_idx ON runs (ticket_id);
CREATE INDEX IF NOT EXISTS overrides_ticket_idx ON overrides (ticket_id, seq);
CREATE INDEX IF NOT EXISTS acceptances_ticket_idx ON acceptances (ticket_id);
CREATE INDEX IF NOT EXISTS comments_ticket_idx ON comments (ticket_id, seq);
CREATE INDEX IF NOT EXISTS events_ticket_idx ON events (ticket_id, seq);
CREATE INDEX IF NOT EXISTS closures_ticket_idx ON closures (ticket_id);
"""

LLM_CALL_COLUMNS = ("occurred_at", "provider", "model", "stage", "purpose", "outcome", "ticket_id", "run_id",
                    "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens", "latency_ms",
                    "cost", "saved", "priced")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Database:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)

    # -- helpers ------------------------------------------------------------
    def _one(self, sql: str, args=()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def _all(self, sql: str, args=()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def _write(self, sql: str, args=()) -> int:
        with self.lock, self.conn:
            return self.conn.execute(sql, args).lastrowid

    def _bump(self) -> int:
        """Next value of the global sequence shared by overrides and comments (call inside
        a transaction), so 'was this comment written before that override?' is exact."""
        self.conn.execute("INSERT INTO counters VALUES ('global', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1")
        return self.conn.execute("SELECT value FROM counters WHERE name = 'global'").fetchone()[0]

    # -- tickets & snapshots -------------------------------------------------
    def ticket_by_key(self, external_key: str) -> dict | None:
        row = self._one("SELECT * FROM tickets WHERE external_key = ?", (external_key,))
        return dict(row) if row else None

    def ticket(self, ticket_id: str) -> dict | None:
        row = self._one("SELECT * FROM tickets WHERE ticket_id = ?", (ticket_id,))
        return dict(row) if row else None

    def create_ticket(self, external_key: str) -> str:
        tid = new_id("t")
        self._write("INSERT INTO tickets VALUES (?, ?, ?)", (tid, external_key, utc_now()))
        return tid

    def ticket_ids(self) -> list[str]:
        return [r[0] for r in self._all("SELECT ticket_id FROM tickets ORDER BY created_at, ticket_id")]

    def tickets_all(self) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM tickets ORDER BY created_at, ticket_id")]

    def reviewed_ticket_ids(self) -> list[str]:
        """Tickets with at least one acceptance or override, in ticket order."""
        return [r[0] for r in self._all(
            "SELECT ticket_id FROM tickets WHERE ticket_id IN "
            "(SELECT ticket_id FROM acceptances UNION SELECT ticket_id FROM overrides) ORDER BY created_at, ticket_id")]

    def snapshot_by_hash(self, ticket_id: str, content_hash: str) -> dict | None:
        row = self._one("SELECT * FROM snapshots WHERE ticket_id = ? AND content_hash = ?", (ticket_id, content_hash))
        return self._snapshot(row)

    def add_snapshot(self, ticket_id: str, content_hash: str, fields: dict) -> str:
        sid = new_id("s")
        self._write("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)",
                    (sid, ticket_id, content_hash, json.dumps(fields, ensure_ascii=False), utc_now()))
        return sid

    def latest_snapshot(self, ticket_id: str) -> dict | None:
        row = self._one("SELECT * FROM snapshots WHERE ticket_id = ? ORDER BY rowid DESC LIMIT 1", (ticket_id,))
        return self._snapshot(row)

    def snapshot(self, snapshot_id: str) -> dict | None:
        return self._snapshot(self._one("SELECT * FROM snapshots WHERE snapshot_id = ?", (snapshot_id,)))

    def latest_snapshots(self) -> dict[str, dict]:
        """The latest snapshot of every ticket, by ticket_id."""
        rows = self._all("SELECT * FROM snapshots WHERE rowid IN (SELECT MAX(rowid) FROM snapshots GROUP BY ticket_id)")
        return {r["ticket_id"]: self._snapshot(r) for r in rows}

    @staticmethod
    def _snapshot(row) -> dict | None:
        return {**dict(row), "fields": json.loads(row["fields"])} if row else None

    # -- runs -----------------------------------------------------------------
    def create_run(self, ticket_id: str, snapshot_id: str, mode: str = "live") -> str:
        rid = new_id("r")
        self._write("INSERT INTO runs VALUES (?, ?, ?, ?, 'queued', ?, NULL)", (rid, ticket_id, snapshot_id, mode, utc_now()))
        return rid

    def set_run_status(self, run_id: str, status: str) -> None:
        self._write("UPDATE runs SET status = ? WHERE run_id = ? AND status NOT IN ('completed', 'failed')",
                    (status, run_id))

    def finish_run(self, record: RunRecord) -> None:
        """Store the final record once; a finished run is never modified again."""
        self._write("UPDATE runs SET status = ?, record = ? WHERE run_id = ? AND status NOT IN ('completed', 'failed')",
                    (record.status, record.model_dump_json(), record.run_id))

    def run_row(self, run_id: str) -> dict | None:
        row = self._one("SELECT * FROM runs WHERE run_id = ?", (run_id,))
        return dict(row) if row else None

    def run(self, run_id: str) -> RunRecord | None:
        row = self._one("SELECT record FROM runs WHERE run_id = ?", (run_id,))
        return RunRecord.model_validate_json(row[0]) if row and row[0] else None

    RUN_COLUMNS = "run_id, ticket_id, snapshot_id, mode, status, created_at"

    def runs_for(self, ticket_id: str) -> list[dict]:
        """The ticket's runs, oldest first, without the record blob (history rows)."""
        return [dict(r) for r in self._all(f"SELECT {self.RUN_COLUMNS} FROM runs WHERE ticket_id = ? ORDER BY rowid",
                                           (ticket_id,))]

    def runs_all(self) -> dict[str, list[dict]]:
        """Every ticket's runs (history rows, oldest first), by ticket_id."""
        out: dict[str, list[dict]] = {}
        for r in self._all(f"SELECT {self.RUN_COLUMNS} FROM runs ORDER BY rowid"):
            out.setdefault(r["ticket_id"], []).append(dict(r))
        return out

    def latest_live_run_id(self, ticket_id: str) -> str | None:
        """The latest live run of any status."""
        row = self._one("SELECT run_id FROM runs WHERE ticket_id = ? AND mode = 'live' ORDER BY rowid DESC LIMIT 1",
                        (ticket_id,))
        return row[0] if row else None

    def latest_live_run(self, ticket_id: str) -> RunRecord | None:
        """The latest completed live run: the base of the effective state."""
        row = self._one("SELECT record FROM runs WHERE ticket_id = ? AND mode = 'live' AND status = 'completed' "
                        "ORDER BY rowid DESC LIMIT 1", (ticket_id,))
        return RunRecord.model_validate_json(row[0]) if row else None

    def latest_live_runs(self) -> dict[str, RunRecord]:
        """The latest completed live run of every ticket that has one, by ticket_id."""
        rows = self._all("SELECT ticket_id, record FROM runs WHERE rowid IN "
                         "(SELECT MAX(rowid) FROM runs WHERE mode = 'live' AND status = 'completed' GROUP BY ticket_id)")
        return {r["ticket_id"]: RunRecord.model_validate_json(r["record"]) for r in rows}

    def completed_live_runs(self) -> dict[str, list[RunRecord]]:
        """Every completed live run (oldest first), by ticket_id: the input of the metrics."""
        out: dict[str, list[RunRecord]] = {}
        for r in self._all("SELECT ticket_id, record FROM runs WHERE mode = 'live' AND status = 'completed' ORDER BY rowid"):
            out.setdefault(r["ticket_id"], []).append(RunRecord.model_validate_json(r["record"]))
        return out

    def latest_run_status(self) -> dict[str, str]:
        """The status of every ticket's most recent run of any mode, by ticket_id."""
        rows = self._all("SELECT ticket_id, status FROM runs WHERE rowid IN (SELECT MAX(rowid) FROM runs GROUP BY ticket_id)")
        return {r["ticket_id"]: r["status"] for r in rows}

    def runs_by_id(self, run_ids) -> dict[str, RunRecord]:
        ids = list(run_ids)
        if not ids:
            return {}
        rows = self._all(f"SELECT run_id, record FROM runs WHERE run_id IN ({','.join('?' * len(ids))}) AND record IS NOT NULL",
                         tuple(ids))
        return {r["run_id"]: RunRecord.model_validate_json(r["record"]) for r in rows}

    def queue_depth(self) -> int:
        return self._one("SELECT COUNT(*) FROM runs WHERE status IN ('queued', 'running')")[0]

    # -- overrides, acceptances, comments --------------------------------------
    def add_overrides(self, ticket_id: str, base_run_id: str, actor: str, changes: list[dict]) -> list[dict]:
        """Append user + derived overrides atomically; derived ones point at their cause."""
        now, stored = utc_now(), []
        with self.lock, self.conn:
            for ch in changes:
                oid = new_id("o")
                cause = stored[ch["cascaded_from"]]["override_id"] if ch["cascaded_from"] is not None else None
                seq = self._bump()
                self.conn.execute("INSERT INTO overrides VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                  (oid, ticket_id, ch["field"], ch["old_value"], ch["new_value"], ch["reason_code"],
                                   ch.get("note"), actor, base_run_id, now, int(ch.get("forced", False)), cause, seq))
                stored.append({**ch, "override_id": oid, "cascaded_from": cause, "actor": actor,
                               "base_run_id": base_run_id, "created_at": now, "seq": seq})
        return stored

    def overrides_for(self, ticket_id: str) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM overrides WHERE ticket_id = ? ORDER BY seq", (ticket_id,))]

    def overrides_all(self) -> dict[str, list[dict]]:
        """Every override in creation order, by ticket_id (only tickets that have any)."""
        out: dict[str, list[dict]] = {}
        for r in self._all("SELECT * FROM overrides ORDER BY seq"):
            out.setdefault(r["ticket_id"], []).append(dict(r))
        return out

    def add_acceptance(self, ticket_id: str, run_id: str, fields: list[str], actor: str) -> dict:
        aid, now = new_id("a"), utc_now()
        self._write("INSERT INTO acceptances VALUES (?, ?, ?, ?, ?, ?)", (aid, ticket_id, run_id, json.dumps(fields), actor, now))
        return {"acceptance_id": aid, "ticket_id": ticket_id, "run_id": run_id, "fields": fields, "actor": actor,
                "created_at": now}

    def acceptances_for(self, ticket_id: str) -> list[dict]:
        return [{**dict(r), "fields": json.loads(r["fields"])}
                for r in self._all("SELECT * FROM acceptances WHERE ticket_id = ? ORDER BY rowid", (ticket_id,))]

    def acceptances_all(self) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for r in self._all("SELECT * FROM acceptances ORDER BY rowid"):
            out.setdefault(r["ticket_id"], []).append({**dict(r), "fields": json.loads(r["fields"])})
        return out

    def add_comment(self, ticket_id: str, record: ResolutionCommentRecord, origin: str, run_id: str | None = None,
                    actor: str | None = None) -> dict:
        cid, now = new_id("c"), utc_now()
        with self.lock, self.conn:
            seq = self._bump()
            self.conn.execute("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                              (cid, ticket_id, run_id, record.model_dump_json(), origin, actor, now, seq))
        return {"comment_id": cid, "origin": origin, "created_at": now, "seq": seq}

    def latest_comment(self, ticket_id: str) -> dict | None:
        row = self._one("SELECT * FROM comments WHERE ticket_id = ? ORDER BY seq DESC LIMIT 1", (ticket_id,))
        return self._comment(row) if row else None

    def latest_comments(self) -> dict[str, dict]:
        """The latest comment of every ticket that has one, by ticket_id."""
        rows = self._all("SELECT * FROM comments WHERE seq IN (SELECT MAX(seq) FROM comments GROUP BY ticket_id)")
        return {r["ticket_id"]: self._comment(r) for r in rows}

    @staticmethod
    def _comment(row) -> dict:
        return {**dict(row), "record": ResolutionCommentRecord.model_validate_json(row["record"])}

    # -- batches --------------------------------------------------------------
    def create_batch(self, meta: dict, ticket_ids: list[str]) -> str:
        bid = new_id("b")
        self._write("INSERT INTO batches VALUES (?, ?, ?, ?)",
                    (bid, json.dumps(meta, ensure_ascii=False), json.dumps(ticket_ids), utc_now()))
        return bid

    def batch(self, batch_id: str) -> dict | None:
        row = self._one("SELECT * FROM batches WHERE batch_id = ?", (batch_id,))
        return {**dict(row), "meta": json.loads(row["meta"]), "ticket_ids": json.loads(row["ticket_ids"])} if row else None

    # -- events ---------------------------------------------------------------
    def append_event(self, type_: str, payload: dict, ticket_id: str | None = None, run_id: str | None = None) -> dict:
        eid, now = new_id("ev"), utc_now()
        seq = self._write("INSERT INTO events (event_id, type, occurred_at, ticket_id, run_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
                          (eid, type_, now, ticket_id, run_id, json.dumps(payload, ensure_ascii=False)))
        return {"seq": seq, "event_id": eid, "type": type_, "occurred_at": now, "ticket_id": ticket_id,
                "run_id": run_id, "payload": payload}

    def events_after(self, seq: int, limit: int = 100) -> list[dict]:
        rows = self._all("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", (seq, limit))
        return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]

    def events_for(self, ticket_id: str) -> list[dict]:
        rows = self._all("SELECT * FROM events WHERE ticket_id = ? ORDER BY seq", (ticket_id,))
        return [self._event(r) for r in rows]

    def conflicts_for(self, ticket_id: str) -> list[dict]:
        rows = self._all("SELECT * FROM events WHERE ticket_id = ? AND type = 'decision.conflict' ORDER BY seq", (ticket_id,))
        return [self._event(r) for r in rows]

    def conflicts_all(self) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for r in self._all("SELECT * FROM events WHERE type = 'decision.conflict' ORDER BY seq"):
            out.setdefault(r["ticket_id"], []).append(self._event(r))
        return out

    def search_events(self, ticket_id: str | None = None, actor: str | None = None, type_prefix: str | None = None,
                      since: str | None = None, until: str | None = None, limit: int = 200) -> list[dict]:
        """The last `limit` events matching every given filter, oldest first (the audit trail)."""
        where, args = [], []
        if ticket_id:
            where.append("ticket_id = ?")
            args.append(ticket_id)
        if type_prefix:
            where.append("substr(type, 1, ?) = ?")
            args += [len(type_prefix), type_prefix]
        if actor:
            where.append("json_extract(payload, '$.actor') = ?")
            args.append(actor)
        if since:
            where.append("occurred_at >= ?")
            args.append(since)
        if until:
            where.append("occurred_at <= ?")
            args.append(until)
        sql = "SELECT * FROM events" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY seq DESC LIMIT ?"
        rows = self._all(sql, (*args, limit))
        return [self._event(r) for r in reversed(rows)]

    @staticmethod
    def _event(row) -> dict:
        return {**dict(row), "payload": json.loads(row["payload"])}

    # -- closures & proposals (KB lifecycle) ------------------------------------------
    def add_closure(self, ticket_id: str, fields: dict, note: str | None, resolver: str | None, actor: str | None,
                    score: dict, outcome: str, proposal_id: str | None) -> dict:
        cid, now = new_id("cl"), utc_now()
        self._write("INSERT INTO closures VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (cid, ticket_id, json.dumps(fields, ensure_ascii=False), note, resolver, actor, json.dumps(score),
                     outcome, proposal_id, now))
        return {"closure_id": cid, "ticket_id": ticket_id, "score": score, "outcome": outcome,
                "proposal_id": proposal_id, "created_at": now}

    def closures(self, ticket_id: str | None = None) -> list[dict]:
        sql, args = ("SELECT * FROM closures WHERE ticket_id = ? ORDER BY rowid", (ticket_id,)) if ticket_id \
            else ("SELECT * FROM closures ORDER BY rowid", ())
        return [self._closure(r) for r in self._all(sql, args)]

    def closures_all(self) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for r in self._all("SELECT * FROM closures ORDER BY rowid"):
            out.setdefault(r["ticket_id"], []).append(self._closure(r))
        return out

    @staticmethod
    def _closure(row) -> dict:
        return {**dict(row), "fields": json.loads(row["fields"]), "score": json.loads(row["score"])}

    def add_proposal(self, type_: str, payload: dict, evidence: dict, signature: str | None = None) -> dict:
        pid, now = new_id("pr"), utc_now()
        self._write("INSERT INTO proposals VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL)",
                    (pid, type_, json.dumps(payload, ensure_ascii=False), json.dumps(evidence), signature, now))
        return self.proposal(pid)

    def proposal(self, proposal_id: str) -> dict | None:
        row = self._one("SELECT * FROM proposals WHERE proposal_id = ?", (proposal_id,))
        return self._proposal(row) if row else None

    @staticmethod
    def _proposal(row) -> dict:
        return {**dict(row), "payload": json.loads(row["payload"]), "evidence": json.loads(row["evidence"])}

    def proposals(self, status: str | None = None) -> list[dict]:
        sql, args = ("SELECT * FROM proposals WHERE status = ? ORDER BY rowid", (status,)) if status \
            else ("SELECT * FROM proposals ORDER BY rowid", ())
        return [self._proposal(r) for r in self._all(sql, args)]

    def decide_proposal(self, proposal_id: str, status: str, actor: str, note: str | None,
                        payload: dict | None = None) -> dict:
        with self.lock, self.conn:
            if payload is not None:
                self.conn.execute("UPDATE proposals SET payload = ? WHERE proposal_id = ?",
                                  (json.dumps(payload, ensure_ascii=False), proposal_id))
            self.conn.execute("UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? "
                              "WHERE proposal_id = ? AND status = 'open'", (status, actor, utc_now(), note, proposal_id))
        return self.proposal(proposal_id)

    def target_proposals(self, proposal_ids: list[str], kb_version: str) -> None:
        with self.lock, self.conn:
            self.conn.executemany("UPDATE proposals SET target_kb_version = ? WHERE proposal_id = ?",
                                  [(kb_version, p) for p in proposal_ids])

    # -- policy versions ---------------------------------------------------------------
    def latest_policy(self) -> dict | None:
        row = self._one("SELECT * FROM policies ORDER BY n DESC LIMIT 1")
        return {**dict(row), "content": json.loads(row["content"]), "changelog": json.loads(row["changelog"])} if row else None

    def add_policy(self, content: dict, parent: str | None, actor: str | None, changelog: list[str]) -> dict:
        with self.lock, self.conn:
            n = self.conn.execute("SELECT COALESCE(MAX(n), 0) + 1 FROM policies").fetchone()[0]
            self.conn.execute("INSERT INTO policies VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (f"p{n}", json.dumps(content), parent, utc_now(), actor, json.dumps(changelog), n))
        return self.latest_policy()

    # -- LLM usage ledger ---------------------------------------------------------------
    def add_llm_call(self, call: dict) -> None:
        row = {"occurred_at": utc_now(), **call, "priced": int(call["priced"])}
        self._write(f"INSERT INTO llm_calls ({', '.join(LLM_CALL_COLUMNS)}) VALUES ({', '.join('?' * len(LLM_CALL_COLUMNS))})",
                    tuple(row[c] for c in LLM_CALL_COLUMNS))

    def llm_calls_since(self, since: str) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM llm_calls WHERE occurred_at >= ? ORDER BY seq", (since,))]

    # -- evaluations (shadow) ---------------------------------------------------------
    def add_evaluation(self, request: dict, versions: dict, ticket_ids: list[str]) -> str:
        eid = new_id("e")
        self._write("INSERT INTO evaluations VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL)",
                    (eid, json.dumps(request), json.dumps(versions), json.dumps(ticket_ids), utc_now()))
        return eid

    def finish_evaluation(self, evaluation_id: str, status: str, results: dict) -> None:
        self._write("UPDATE evaluations SET status = ?, completed_at = ?, results = ? WHERE evaluation_id = ?",
                    (status, utc_now(), json.dumps(results, ensure_ascii=False), evaluation_id))

    def evaluation(self, evaluation_id: str) -> dict | None:
        row = self._one("SELECT * FROM evaluations WHERE evaluation_id = ?", (evaluation_id,))
        if not row:
            return None
        return {**dict(row), "request": json.loads(row["request"]), "versions": json.loads(row["versions"]),
                "ticket_ids": json.loads(row["ticket_ids"]), "results": json.loads(row["results"]) if row["results"] else None}

    def policy_version(self, version: str) -> dict | None:
        row = self._one("SELECT * FROM policies WHERE policy_version = ?", (version,))
        return {**dict(row), "content": json.loads(row["content"]), "changelog": json.loads(row["changelog"])} if row else None
