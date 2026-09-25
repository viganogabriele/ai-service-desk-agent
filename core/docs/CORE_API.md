# Core API — Integration Contract

This document is **binding** for the Core. It defines how the triage engine is exposed to the rest of the product. `AGENTS.md` holds the non-negotiable rules; this file holds the detail. For the product this API serves, see `UI_CONCEPT.md` (context only).

## 1. Principles
- **The Core decides and remembers. It never acts externally.**
  - It makes no Jira calls, sends no notifications and manages no users.
  - External layers react to Core events.
- **One engine, two entry points.** The REST API and the CLI call the same `triage/` library.
- **Runs are immutable; overrides are append-only.** The current truth is derived: *effective state = the latest live run's decisions + overrides*.
- **Humans win.** Overridden fields are pinned across re-triage.
- **Consistency lives in the Core.** Team follows Service; Priority follows the matrix.
- **Everything is versioned.** Model, prompt, knowledge base (KB) and policy versions are recorded on every run.
- **Local first.** FastAPI + SQLite + an in-process worker queue + Server-Sent Events (SSE). No external infrastructure.

## 2. Layers and responsibilities

| Layer | Owns | Talks to the Core via |
|---|---|---|
| Ingestion/sync (outside the Core) | Pulling tickets from Jira, normalising them, writing effective state back to Jira, notifying people (e.g. paging for Highest priority) | `POST /tickets`, `POST /tickets/{id}/closure`, the event stream or webhooks |
| **Core** | Triage engine, decision store, overrides, knowledge base, policy, evaluations, metrics, event log | — |
| UI (cockpit) | Presentation and user identity | Read endpoints, review/KB/policy actions, the event stream |

For the hackathon demo, `POST /batches` with the challenge file stands in for the ingestion layer.

## 3. Entities

- **Ticket**
  - `ticket_id` (Core ID), `external_key` (e.g. the Jira key), `snapshots[]`.
  - Each snapshot has a `snapshot_id`, a `content_hash`, the normalised fields (same names as the challenge file) and a `received_at`.
- **Run**
  - `run_id`, `ticket_id`, `snapshot_id`.
  - `mode`: `live` | `shadow`.
  - `status`: `queued` | `running` | `completed` | `failed`.
  - `versions`: `{model, prompt, kb, policy}`.
  - `started_at`, `completed_at`, `error`.
  - `decisions{}`, `resolution_comment`, `lane`, `lane_reasons[]`, `audit_sampled`.
  - A run is never modified after it completes.
- **Decision**: one per field per run. See §4.
- **Override**
  - `override_id`, `ticket_id`, `field`, `old_value`, `new_value`.
  - `reason_code`, `note`, `actor`, `base_run_id`, `created_at`.
  - `forced` (bool) and `cascaded_from` (the override ID of the user action that caused it, if it is a derived change).
- **Acceptance**: `ticket_id`, `run_id`, `fields[]`, `actor`, `created_at`. It counts as a confirmed label.
- **KB version**
  - `kb_version`, `status`: `draft` | `published` | `live` | `retired`, `created_at`, `parent_version`, `changelog[]`.
  - The content is immutable once published: services, service→team map, criticality, service cards, patterns (text, service, resolver) and fallback assignees, plus their embeddings.
- **Proposal**
  - `proposal_id`, `type`: `add_pattern` | `amend_service_card` | `change_resolver` | `other`.
  - `payload`, `evidence` (ticket IDs, override IDs, counts), `status`: `open` | `approved` | `rejected`.
  - `decided_by`, `decided_at`, `target_kb_version`.
- **Policy version**
  - `policy_version`, `paused` (bool).
  - Per-field and per-service autonomy: `suggest_only` | `auto_above_threshold` | `full_auto`.
  - Thresholds, lane rules and the audit sample rate.
- **Event**: `seq` (monotonic), `event_id`, `type`, `occurred_at`, `ticket_id?`, `run_id?`, `payload`.

## 4. The decision record (what the UI sees)
Every predicted field in a run has this shape. The CLI writes the same records to `outputs/decisions_<runid>.json`.

```json
{
  "field": "assignee",
  "value": "jane.doe@intcom.com",
  "original_value": null,
  "effective_value": "jane.doe@intcom.com",
  "source": "pattern_match",
  "confidence": 0.82,
  "confidence_signals": {"retrieval_similarity": 0.71, "retrieval_margin": 0.18, "self_consistency": 1.0},
  "reason": "Best-matching historical pattern for this service is always resolved by this agent.",
  "rule_trace": null,
  "evidence": {
    "ticket_spans": [{"field": "Description", "start": 34, "end": 71, "text": "..."}],
    "patterns": [{"pattern_id": "p07", "similarity": 0.71, "service": "...", "resolver": "..."}],
    "service_card": "..."
  },
  "alternatives": [{"value": "john.roe@intcom.com", "score": 0.12, "source": "fallback"}],
  "flags": [],
  "pinned": false
}
```

- **`source`** is one of:
  - `rule`: Team (lookup) and Priority (matrix).
  - `pattern_match`: the assignee is the resolver of a matching pattern.
  - `ai_judgment`: work type, service, urgency, impact and resolution status.
  - `fallback`: the assignee is the most frequent training assignee for the service.
- **`rule_trace`**, for rule fields: e.g. `"matrix[urgency=High][impact=Medium] = High"` or `"team_of(Tax Reporting) = Tax & Reporting"`.
- **`alternatives`** are ranked runner-ups. The UI uses them to order its override dropdowns.
- **`flags`** can include:
  - `weak_match`, `generic_bucket`, `fallback_assignee`
  - `downgrade_on_critical`, `service_changed`, `work_type_changed`
  - `stale_comment`, `forced_inconsistent`, `conflict_with_override`
- **`pinned`** is true when a human override applies. `effective_value` then comes from that override.

**Resolution comment record**
- `text`: the full `"<assignee>: Resolution: …"` string.
- `segments[]`: each with `text` and `origin`, one of `ticket` | `exemplar` | `generated`.
- `exemplar_pattern_ids[]`.
- `unsupported_specifics[]`: named details that appear in neither the ticket nor the exemplars.
- `stale` (bool) and `edited_by?`.

**Ticket-level view** (`GET /tickets/{id}`) returns:
- the latest snapshot;
- the effective state;
- the latest live run, with its decisions and comment;
- `lane` and `lane_reasons[]`;
- `versions`;
- the history: runs, overrides, acceptances and conflicts, in time order.

## 5. Confidence and lanes

**Confidence** is computed from observable signals, never from the LLM rating itself alone.
- **AI fields:**
  - self-consistency agreement across N samples (N is configurable; 1 is allowed for speed, in which case this signal is omitted);
  - agreement between the LLM's service and the top-ranked service card;
  - the retrieval margin.
- **Pattern-match assignee:** the assignee follows the service. A service with one resolver inherits the service confidence. A service with several resolvers uses the mean pattern similarity per resolver and the margin between resolvers, capped by the service confidence.
- **Fallback assignee:** a low fixed ceiling (e.g. 0.2).
- **Rule fields:** inherit the minimum confidence of their inputs.
- Once acceptances and overrides accumulate, calibrate the scores against them (step 3).

**Lanes** are assigned at the end of each run. The first matching rule wins, and all matching reasons are recorded in `lane_reasons`.
1. `human_only`:
   - Priority is Highest on a critical service;
   - resolution status is `cancelled` because the input is nonsense;
   - `weak_match` on the service;
   - `downgrade_on_critical`.
2. `needs_review`:
   - any field is below its threshold;
   - `service_changed`, `work_type_changed` or `fallback_assignee`;
   - the policy says `suggest_only` for any affected field or service;
   - the policy is paused (the reason is recorded as `policy_paused`).
3. `auto_applied`: none of the above.

After the lane is assigned, a random `audit_sample_rate` share of `auto_applied` runs gets `audit_sampled = true`. These are shown for blind review; the metrics use them to estimate the true error rate.

## 6. Workflows

### A. A new ticket arrives
1. `POST /tickets` with `external_key` and the normalised fields. The `Idempotency-Key` header is `external_key` + `content_hash`.
   - Same hash → `200 OK` with the existing ticket; nothing is queued.
   - New hash → a new snapshot.
2. The Core queues a live run and returns `202 Accepted` with `{ticket_id, run_id}`.
3. The worker runs the pipeline under the currently live KB and policy.
   - On success: `run.completed` (with the lane).
   - On error: `run.failed`, retryable through `POST /tickets/{id}/retriage`.
4. The sync layer consumes `run.completed`.
   - `auto_applied` → it writes the effective state to Jira.
   - Otherwise → the ticket appears in the UI queue.
5. **Re-triage on a new snapshot:**
   - Pinned fields keep their override values.
   - If the new run's value differs from a pinned value, set the `conflict_with_override` flag on that decision and emit `decision.conflict`.
6. **Deleted tickets:** when the source no longer has a ticket (deleted in Jira, moved out of the project), the sync layer calls `DELETE /tickets/{id}`.
   - The Core removes the ticket with its snapshots, runs, overrides, acceptances, comments and closures, and emits `ticket.deleted`. Queued work for it is skipped.
   - The event log and the LLM usage ledger keep its history. A later `POST /tickets` with the same `external_key` starts a new ticket.
7. **Demo tickets:** `POST /demo/tickets` returns `{fields}`, a new open ticket in the challenge format that the model writes from a random live-KB scenario (never from the challenge file). The Core stores nothing; the sync layer files it in Jira, and it arrives through step 1 like any other ticket.

### B. Review and override
- **Queue:** `GET /queue?lane=needs_review&sort=risk`, where risk = (1 − min confidence) × priority weight × criticality weight.
- **Accept:** `POST /tickets/{id}/accept` with `{run_id, fields?: [...], actor}`. Leaving out `fields` accepts all of them.
- **Preview:** `POST /tickets/{id}/overrides/preview`. Same body as the commit. It returns the resulting effective state, every derived change, the new flags and warnings, and persists nothing.
- **Commit:** `POST /tickets/{id}/overrides` with this body:

  ```json
  {"base_run_id": "...", "actor": "...", "changes": [
    {"field": "service", "value": "Tax Reporting", "reason_code": "wrong_service", "note": "..."}
  ], "force": false}
  ```

  - If `base_run_id` is no longer the latest live run → `409 Conflict`, with the latest run in the response body.
  - Invalid values → `422 Unprocessable Entity`.
- **Cascade rules** (applied in the preview and the commit, and recorded as derived overrides):
  - **service** → team = lookup(service). If the current assignee isn't a resolver for the new service, flag `assignee_needs_review` and return ranked assignee alternatives. The comment is marked stale.
  - **urgency or impact** → priority = matrix(urgency, impact).
  - **priority** set directly → `422` unless `force: true` and a note is given. The stored value is flagged `forced_inconsistent`.
  - **resolution status** → the comment is marked stale.
  - **work type** → no cascade; recorded as a label.
- **Comment:**
  - `POST /tickets/{id}/resolution-comment/regenerate` produces a new comment for the effective state, and creates an internal comment-only run.
  - `PUT /tickets/{id}/resolution-comment` stores a human-edited comment.
- **Reason codes:** `wrong_service`, `wrong_work_type`, `wrong_assignee`, `resolver_unavailable`, `wrong_urgency`, `wrong_impact`, `wrong_resolution_status`, `inaccurate_comment`, `other` (a note is required for `other`).
- **Export:** `GET /tickets/{id}/export` and `GET /batches/{id}/export` return the effective state in the challenge-file structure, with the comment appended to "All Comments".

### C. The knowledge-base lifecycle
1. **Bootstrap:** `POST /kb/build` mines the training corpus and generates draft service cards → a `draft` version. A human reviews it. `POST /kb/versions/{v}/publish`, then `POST /kb/versions/{v}/promote` makes it live.
2. **Harvest:** `POST /tickets/{id}/closure` carries the final fields, the resolution note and the resolver. The Core scores the note (for root cause, action and verification present; filler like "Problem fixed." detected).
   - Specific → an `add_pattern` proposal.
   - Vague or missing → an entry on the KB health backlog (`GET /kb/health`).
3. **Learn from overrides:** a background job groups overrides by (reason code, original → new value, content similarity). When a group reaches `PROPOSAL_MIN_SUPPORT` (default 3, from distinct tickets), it creates an `amend_service_card` or `change_resolver` proposal, with the supporting ticket and override IDs as evidence. A single override never produces a KB change on its own.
4. **Decide:**
   - `POST /kb/proposals/{id}/approve`, optionally with an edited payload.
   - `POST /kb/proposals/{id}/reject`, with a reason.
5. **Publish:**
   - `POST /kb/versions` builds a new draft from the live version plus the approved proposals, and rebuilds the embeddings.
   - `POST /kb/versions/{v}/publish` freezes it.
   - Optionally run a shadow evaluation (D).
   - `POST /kb/versions/{v}/promote` makes it live.
   - To roll back, promote the previous version.
   - New runs use the live version from then on. Existing runs keep the version they recorded.

### D. Evaluation, policy and the kill switch
- **Shadow evaluation:**
  - `POST /evaluations` with `{versions: {model?, prompt?, kb?, policy?}, ticket_set: "gold" | "recent", days?}`.
  - It replays the tickets as shadow runs, which never change effective state or emit sync events.
  - `GET /evaluations/{id}` returns per-field agreement with the live version and with human-confirmed labels (acceptances + overrides), plus a list of disagreements.
- **Policy:**
  - `GET /policy`; `PUT /policy` creates a new version.
  - `POST /policy/preview` estimates the auto-apply rate and error rate on recent gold-labelled tickets (step 3+).
- **Kill switch:** `POST /policy/pause` and `POST /policy/resume`. While paused, triage still runs but nothing is auto-applied.

## 7. Endpoints

| Method | Path | Purpose | Step |
|---|---|---|---|
| GET | `/health` | Liveness, live KB/policy/model versions, queue depth | 1 |
| POST | `/tickets` | Import or update a ticket snapshot; queues a run | 1 |
| POST | `/batches` | Import a challenge-format file; returns `batch_id` and ticket IDs | 1 |
| GET | `/batches/{id}` / `/batches/{id}/export` | Batch progress / export in challenge format | 1 |
| GET | `/tickets` | List with filters (lane, service, flag, status); `?expand=view` adds each ticket's view (§4) under `view`, so a board needs one request | 1 |
| GET | `/tickets/{id}` | Ticket view (§4) | 1 |
| DELETE | `/tickets/{id}` | Remove a ticket the source no longer has (§6.A step 6) | 1 |
| POST | `/tickets/{id}/retriage` | Queue a new live run | 1 |
| GET | `/runs/{id}` | Run detail | 1 |
| GET | `/queue` | Risk-sorted review queue | 1 |
| POST | `/tickets/{id}/accept` | Confirm decisions | 1 |
| POST | `/tickets/{id}/overrides/preview` | Dry-run the cascade | 1 |
| POST | `/tickets/{id}/overrides` | Commit overrides | 1 |
| POST | `/tickets/{id}/resolution-comment/regenerate` | New comment for the effective state | 1 |
| PUT | `/tickets/{id}/resolution-comment` | Store a human-edited comment | 1 |
| GET | `/tickets/{id}/export` | Effective state in challenge format | 1 |
| GET | `/events/stream` | SSE; supports `Last-Event-ID` | 1 |
| GET | `/events` | Paged event log (`?after_seq=`) | 1 |
| POST | `/tickets/{id}/closure` | Final outcome from Jira, for harvesting | 2 |
| POST | `/kb/build` | Build a draft KB from the training corpus | 2 |
| GET/POST | `/kb/versions`, `/kb/versions/{v}` | List, view, create a draft | 2 |
| POST | `/kb/versions/{v}/publish` / `/promote` | Freeze / make live | 2 |
| GET | `/kb/proposals` | List proposals | 2 |
| POST | `/kb/proposals/{id}/approve` / `/reject` | Decide a proposal | 2 |
| GET | `/kb/health` | Vague or missing resolutions, generic-bucket items, gaps in pattern coverage | 2 |
| GET/PUT | `/policy` | View / new version | 2 |
| POST | `/policy/pause` / `/resume` | Kill switch | 2 |
| GET | `/metrics/{name}` | See §9 | 2 |
| GET | `/audit` | Search decisions, overrides and KB/policy changes | 2 |
| GET | `/usage?window=` | LLM tokens and estimated cost, see §9 | usage |
| POST/GET | `/evaluations`, `/evaluations/{id}` | Shadow evaluation | 3 |
| POST | `/demo/tickets` | Write a new challenge-style ticket for a demo; stores nothing | demo |
| POST | `/policy/preview` | Estimated impact of a policy change | 3 |

**Errors:** `404` unknown ID · `409` stale `base_run_id` or version conflict · `422` validation or consistency violation · `503` LLM backend unavailable (the run is marked failed and can be retried). Every error body has the shape `{"error": code, "message": ..., "details": {...}}`.

## 8. Events
The envelope is `{seq, event_id, type, occurred_at, ticket_id?, run_id?, payload}`. It is delivered over SSE (`/events/stream`, resumable with `Last-Event-ID` = `seq`), and also stored in `/events` for polling or replay. Shadow runs emit only `evaluation.*` events.

| Type | Payload (key fields) | Main consumer |
|---|---|---|
| `ticket.imported` | `external_key`, `snapshot_id` | UI |
| `ticket.deleted` | `external_key` | UI |
| `run.started` / `run.failed` | `mode`, `error?` | UI |
| `run.completed` | `lane`, `lane_reasons`, `changed_fields`, `audit_sampled` | Sync (auto-apply), UI, notifier |
| `decision.accepted` | `fields`, `actor` | UI, metrics |
| `decision.overridden` | `changes` (incl. derived), `actor`, `effective_state` | Sync (write-back), UI |
| `decision.conflict` | `field`, `pinned_value`, `new_run_value` | UI |
| `comment.updated` | `stale`, `origin` (`regenerated` / `edited`) | Sync, UI |
| `kb.proposal.created` / `kb.proposal.decided` | `proposal_id`, `type`, `status` | UI |
| `kb.version.published` / `kb.version.promoted` | `kb_version` | UI |
| `policy.updated` / `policy.paused` / `policy.resumed` | `policy_version` | UI, sync |
| `evaluation.completed` | `evaluation_id`, summary | UI |

## 9. Metrics (`GET /metrics/{name}?from=&to=&service=`)
All metrics are computed on request from runs, overrides, acceptances and audits.
- `override_rates`: by field, service and source.
- `automation_rate`: by lane over time.
- `service_confusion`: original versus effective service (first triage versus final).
- `calibration`: confidence bins versus acceptance rate.
- `generic_bucket_rate` and `fallback_rate`, over time.
- `coverage`: services with or without resolver patterns, in the live KB.
- `priority_integrity`: `forced_inconsistent` count, `downgrade_on_critical` count, distribution of critical-service incidents by priority.
- `audit_error_estimate`: error rate on audit-sampled tickets.
- `resolver_load`: open tickets per resolver, and pattern classes that have a single resolver.
- `emerging_issues` (step 3): clusters of recent tickets with weak best matches.

**LLM usage (`GET /usage?window=24h|7d|30d|90d`, default `30d`).** Every structured LLM call the API makes is written to the `llm_calls` ledger: provider, model, stage (from the output schema: `decision`, `self_consistency`, `evidence`, `resolution_note`, `demo_ticket`, `service_card`), purpose (`triage`, `comment`, `evaluation`, `demo`, `kb_build`), ticket and run, token counts, latency and outcome. Each attempt is its own row: `ok`; `retry` (billed, then rejected as invalid or truncated); `error` (no response); `cache_hit` (answered from the disk cache, so nothing was billed). Cost is priced when the call happens from `LLM_PRICES` in `config.py` (USD per million tokens, overridable with the `LLM_PRICES` environment variable). The prices are estimates, not invoices. Cached input tokens are billed at the cached rate; the difference is the prompt-cache saving. A cache hit saves what the original call cost. The response has `totals` (cost, savings split into `saved_prompt_cache` and `saved_response_cache`, calls, cache hits, retries and their cost, input, cached input, output and reasoning tokens, mean latency, `cost_per_triage_run`), a zero-filled `series` (hourly for `24h`, daily otherwise, UTC), and a `breakdown` by `model`, `provider`, `stage` and `purpose`, where each row has its share of the cost. The CLI does not record usage.

## 10. Concurrency, idempotency, storage
- **Imports** are idempotent on `external_key` + `content_hash`.
- **Overrides** use optimistic concurrency through `base_run_id`; KB and policy changes carry their parent version.
- **The worker queue** runs 1–2 concurrent LLM runs and processes them first in, first out, with `priority_hint` for re-triage requested by a human. The queue lives in memory; at startup the Core re-queues every live run still `queued` or `running`.
- **Storage:** SQLite `data/core.db`. JSON columns for decisions and evidence. An append-only `events` table. Embeddings stored per KB version under `artifacts/kb/<version>/`.
- **Migration from the CLI:** `POST /batches` with the challenge file must produce the same effective state as `python run.py triage` given the same versions and a warm cache.

## 11. Build phases
- **API step 1 (milestone 6):** tickets, batches, runs, the decision store, lanes, the queue, accept, overrides (preview, commit, cascades), comment regenerate/edit, export, events (SSE + log), health.
  - The KB is loaded from the CLI's `artifacts/` as version `v1`.
  - The policy is loaded from `config.py` as version `p1`.
- **API step 2 (milestone 7):** KB versions and promotion, closure harvesting, proposals, KB health, policy CRUD and pause, audit, the basic metrics.
- **Step 3 (milestone 8):** shadow evaluations, policy preview, calibration, emerging issues.

## 12. Implementation notes (milestones 6–7)
Details the implementation adds or pins down. §1–§11 are unchanged.

- **Extension event:** `kb.version.drafted` (`kb_version`, `actor`) is emitted when a draft is ready, because `POST /kb/build` runs in the background (it drafts service cards with the LLM) and returns `202` with `expected_version`.
- **`Idempotency-Key`** on `POST /tickets` is `external_key` immediately followed by the SHA-256 hex of the canonical JSON of `fields`. It is optional; a mismatching key is `422`.
- **Batch external keys:** a record's `Key` / `Issue key` when present, else `<runId or content hash>#NN`. Re-posting the same file is idempotent.
- **Comment-only runs:** `POST /tickets/{id}/resolution-comment/regenerate` queues a comment job (not a triage run). Its failure is reported as `run.failed` with `mode: "comment"`. A comment is `stale` when a `service` or `resolution` override was committed after it; `comment.updated` with `origin: null` announces that.
- **Closure body:** `{fields?, resolution_note, resolver, actor?}`; the response carries the note score (`root_cause`, `action`, `verification`, `filler`, `missing`, `specific`) and `outcome`: `proposal`, `backlog` or `duplicate`.
- **Proposal payloads:** `add_pattern {text, service, resolver}`; `amend_service_card {service, scope?, boundary?, confused_with, suggestion}` (the approver fills `scope` / `boundary`); `change_resolver {service, from, to}`. Approval validates the (optionally edited) payload immediately. Override learning groups by reason code and value transition (content similarity is not used yet) and proposes once per group; a rejected group returns only with more support.
- **KB versions** are directories `artifacts/kb/<version>/` with `manifest.json` (`status`, `parent_version`, `changelog`, `files` hashes). Promoting retires the previous live version; promoting a retired one is the rollback. `embeddings.npz` is a derived cache, rebuilt on first use and not part of the hashed content.
- **Policy** holds the lane policy: `field_thresholds`, `autonomy {default, fields, services}`, `audit_sample_rate`, `paused`. `PUT /policy` merges partial content onto the current version; pause and resume also create versions. Decision thresholds (assignee similarity, weak match) belong to the engine and stay in `config.py`.
- **SSE:** `GET /events/stream` also accepts `after_seq` and `max_events` (ends the stream after N events).
- **Audit:** `GET /audit?ticket_id=&actor=&type=<prefix>&from=&to=` searches the event log.
- **Metrics:** the step-2 set of §9 (`emerging_issues` is step 3 and returns `404`). `from` / `to` filter on run completion time, `service` on the effective service.

### Step 3 (milestone 8)
- **Shadow evaluations:** `POST /evaluations` returns `202 {evaluation_id, tickets}`; `GET /evaluations/{id}` returns `status` and `results`: `versions` (the resolved model/prompt/kb/policy), `per_field` (`agreement_live`, `agreement_label`), `summary` (`changed_decisions`, `changed_matching_labels`, `changed_against_labels`, `changed_unlabelled`, `failed`), `disagreements[]` (`ticket_id`, `field`, `shadow`, `live`, `label`) and `shadow_run_ids`. `kb` may name any stored version (drafts included, which is how a draft is evaluated before publishing); `policy` a stored policy version; `model` any Ollama model; `prompt` only the deployed prompt version (`422` otherwise). Shadow runs skip evidence and comments. The gold set = tickets with acceptances or overrides; human labels = the latest override per field, else the accepted run's value.
- **Policy preview:** `POST /policy/preview {content, days?}` re-assigns lanes on stored live runs (no LLM) under the current and the proposed policy: `auto_apply_rate` over recent tickets, `error_rate` over auto-applied gold tickets, and `tickets_changing_lane`. Nothing is persisted.
- **Calibration:** `GET /metrics/calibration` also returns `fitted`: a per-field isotonic map from raw confidence to the observed acceptance rate (fields with at least 20 reviewed decisions), with ECE before and after. Adopting it is explicit: `PUT /policy {"calibration": fitted.calibration}` (preview first). Runs under a calibrated policy store the calibrated `confidence` and keep the raw one as the `raw_confidence` signal; rule fields inherit calibrated inputs.
- **Emerging issues:** `GET /metrics/emerging_issues` clusters recent tickets whose best matches are weak (`weak_match`, or best pattern similarity below 0.65) by embedding similarity (cosine 0.80, at least 2 tickets per cluster).
