# AGENTS.md — Jira Ticket Triage Classifier (Swiss AI Weeks / SwissLife-2026)

## Mission
Build a local, fast, reproducible pipeline that triages the 20 challenge tickets the way an experienced L2 agent would. For each ticket it predicts:

- Work type
- Affected Business or IT Services
- Service Team(s)
- Assignee
- Urgency, Impact and Priority
- Resolution status
- A resolution comment written in the assignee's voice

Speed to a working MVP matters more than sophistication. Get a complete end-to-end run first, then improve one field at a time.

Read `README.md` before doing anything. It is the source of truth for the task, the Priority matrix and the critical-service list.

## Hard rules
1. **Never hardcode answers for challenge tickets.** No per-ticket lookups, no manual edits of outputs, no rules keyed on specific challenge text or IDs. Improve prompts, catalog or logic, then rerun.
2. **Never use challenge tickets to build the catalog or service cards.** Catalog and cards come from the training data plus generic domain knowledge only.
3. **Do not learn from the training Priority, Urgency, Impact, Resolution or Assignee fields.** They are random noise (verified; see Data facts).
4. **Priority is always computed from Urgency and Impact with the matrix.** It is never predicted directly.
5. **Team is always looked up from the Service.** It is never predicted.
6. Everything runs locally. No cloud LLM calls unless the user explicitly asks. The team's self-hosted Ollama on the Mac mini (reached over Tailscale) counts as local.
7. Runs must be reproducible: temperature 0 for the final pass, cached LLM calls, versioned artifacts.

## Data facts (already verified, do not re-derive)
- **Training file:** `jira_first_20000_requested_fields_synthetic.json`, a JSON list of 20,000 tickets.
- **Challenge file:** match `jira_hackathon_*challenge*.json` with a glob, because the actual filename differs from the one named in the README. It is a JSON object; the tickets are under `records` (20 tickets).
- **The training data is heavily templated.** It has only 173 distinct descriptions and 79 distinct comment texts (about 10 templates × 20 services). The challenge tickets are rich free text. Consequences:
  - Statistical classifiers trained on this data won't generalise to the challenge tickets.
  - The LLM does the semantic reading.
  - The training data provides the catalog.
- **Service → Team is 100% deterministic** (20 services, 11 teams). "Emailed Support Tickets" → "Service Desk" is the generic catch-all bucket (27% of training).
- **Assignee in training is random.** Its conditional entropy given service is about 4.88 bits, against a maximum of 4.91 bits.
- **The real assignee signal is in the comments.**
  - There are 21 distinct comments starting with `Resolution: ` (rich, domain-specific fixes).
  - Each pattern is always authored by the same person, and belongs to exactly one service.
  - These patterns cover 10 services. Securities Settlement has two resolvers, depending on the problem type.
  - Four of the resolvers never appear in the Assignee field at all.
  - Treat the pattern author as "the actual assignee implied by the ticket content".
  - The pattern depends only on the service, never on the ticket template: every description template of a pattern service (access, licence, alert, misrouted…) carries that service's patterns in roughly equal shares. So the resolver is a function of the service, and the assignee is exactly as accurate as the service.
- **Services with no resolver pattern:** Portfolio Accounting, Trading Platform, Fund Pricing, NAV Calculation, Rimes Data Feed, Risk & Compliance Monitoring, Identity & Access Management, SharePoint & File Storage, CRM & Client Portal, Emailed Support Tickets. For these, fall back to the most frequent training assignee for the service, and label the result `fallback`.
- **Resolution status in training is uniformly random.** "Problem fixed." (about 5.8k occurrences) is vague filler and must never be copied. So are the five `Resolution recorded: …` comments (for example "service restored.", about 4.8k occurrences, random authors and services); they are not patterns.
- **Licence and access requests are filed under the target application's service** in training ("New license requested for Tax Reporting" → Tax Reporting), not under Identity & Access Management.
- **Resolvers are not exclusive to one service.** xena.schmidt resolves SimCorp Dimension and Securities Settlement; ursula.klassen resolves Corporate Actions and Securities Settlement. The assignee follows the matched pattern, never the person.
- **Fallback assignees are close to a coin flip** (top vs runner-up often differ by 1–3 tickets; Client Reporting is a three-way tie, broken alphabetically).
- **Casing and fields differ between the files.**
  - Training values are lowercase (`low`); challenge values are Title Case (`Low`). Output Title Case.
  - The challenge has fields that training lacks: `Request type`, `Business Critical for Entity`, `Severity`, `Linked issues` and `Due date`. Keep them unchanged in the output.

## Vocabulary and mappings
- **Levels (Urgency and Impact):** Highest, High, Medium, Low, Lowest.
- **README matrix mapping.** This is an assumption, so keep it in `config.py`:
  - Urgency: Highest = Critical, High = High, Medium = Medium, Low = Low, Lowest = Lowest.
  - Impact: Highest = Major/Widespread, High = Significant/Large, Medium = Moderate/Limited, Low = Minor/Localized, Lowest = No direct impact.
- **Priority matrix.** Rows are Urgency; columns are Impact from Highest to Lowest.
  - Highest: Highest, Highest, High, Medium, Medium
  - High: Highest, High, High, Medium, Low
  - Medium: High, High, Medium, Low, Low
  - Low: Medium, Medium, Low, Low, Lowest
  - Lowest: Medium, Low, Low, Lowest, Lowest
- **Resolution status:** done, cancelled, clarification, cannot reproduce.
- **Request type → Work type prior.** This is a strong hint, not a rule; the LLM may override it with a stated reason.
  - Machine Created Alert, Human Created Incident, Misclassified Service Request Title → Incident
  - New License, Access to a Service, Access Removal, Misclassified Incident Title → Service Request
  - Email / 3rd Party Warning, Nonsense / Unclear Input → ambiguous; decide from the content
- **Critical services:** see the README list. Criticality feeds the Urgency/Impact judgment.

## Pipeline (per ticket)
1. **Catalog (built once, cached in `artifacts/kb/<version>/`, currently `v1`, with a `manifest.json`: status, changelog, file hashes). A published or live version is immutable; changing content means a new `KB_VERSION`.**
   - The Service → Team map.
   - The resolution-pattern library: text, service, resolver.
   - The fallback assignee per service.
   - A service card per service: name, team, criticality, patterns, and a one-line scope (plus an optional boundary line naming a confusable service). The scope line is generated once by the LLM from the service name plus its patterns, saved to `artifacts/service_cards.json`, and reviewed by the human. The loader refuses cards until `"reviewed": true` is set.
2. **Retrieval.** Embed description + comments (not the title: titles are misleading on purpose) with `BAAI/bge-small-en-v1.5` (sentence-transformers, CPU). Take the top 3 resolution patterns and the top 3 service cards by cosine similarity using numpy. Do not use a vector DB.
3. **Triage LLM call (structured output).**
   - Output fields: `reasoning` (first, at most 2 short sentences), `work_type`, `service` (enum of the 20 services), `urgency`, `impact`, `resolution`.
   - Evidence comes from a separate small call whose context is only the ticket text and the final decisions (so it can only quote the ticket); code locates each quote and keeps exact matches as `ticket_spans`. `EVIDENCE_ENABLED` / `--evidence` switch it; evaluation runs skip it.
   - The prompt includes all 20 service cards (with the top 3 retrieved ones named), the retrieved patterns, the Request-type prior, the README urgency/impact definitions and the criticality list.
   - The reported service, urgency, impact and priority are not shown (`SHOW_REPORTED_*` flags in `config.py`): the 7b model anchored on them. They are still used as `original_value` and for flags.
   - Instructions: trust the description over the title. Use "Emailed Support Tickets" only when no specific service can be identified.
   - Self-consistency: the final values come from the temperature-0 call; `SELF_CONSISTENCY_N` extra samples at `SAMPLE_TEMPERATURE` with fixed seeds (cached), with the decision fields only and no reasoning, provide the agreement signal.
   - Speed (measured on the Mac mini, qwen2.5:7b): generation dominates at about 21 tokens/s; prompt evaluation is cached across calls with the same prefix; the server handles one request at a time, so `LLM_CONCURRENCY` (default 2) only overlaps client work.
   - Resolution rubric:
     - cancelled = nonsense or misrouted, nothing actionable
     - clarification = plausible need, but required details are missing
     - cannot reproduce = transient or self-cleared alert with no evidence found
     - done = otherwise
4. **Deterministic post-processing.**
   - Team = lookup(service).
   - Priority = matrix(urgency, impact).
   - Assignee follows the chosen service, not the top pattern: a service with one resolver gets that resolver (confidence = service confidence); Securities Settlement picks the resolver whose patterns there have the highest mean similarity (confidence from the margin between resolvers); a service without patterns gets the fallback. The old rule (top pattern in the same service and at or above `ASSIGNEE_SIM_THRESHOLD`) scored 30/60 on the dev set, against 38/60 for this rule (59/60 when the service is right). `ASSIGNEE_SIM_THRESHOLD` now only scales the similarity confidence signal.
   - Assignee `alternatives` come only from pattern resolvers (same service first, then same team); a service without patterns lists only its fallback. Other training assignees are random and are never offered.
   - Lanes (`triage/lanes.py`, thresholds and autonomy in `config.py` as policy `p1`): every `cancelled` ticket goes to `human_only` (the triage output does not separate nonsense from misrouted; cancelling is the riskiest status to automate).
5. **Resolution comment LLM call.**
   - Inputs: the ticket, the final service and status, and the top 2 same-service patterns as exemplars. For services without patterns, use same-team patterns as style-only exemplars.
   - Output: 1–2 sentences, past tense, starting with `Resolution: `. It names the root cause or action, the fix and the verification, reuses concrete details from the ticket, and matches the status.
   - Never write "Problem fixed." and never invent ticket IDs.
   - Final form: `"<assignee>: Resolution: …"`, appended to "All Comments".
   - Implementation (`triage/resolution.py`): written in the assignee's voice with status-specific guidance; if the team has no patterns either, the overall top-2 patterns are style-only exemplars. A comment containing a ticket ID absent from the ticket is regenerated with another seed. The record's `segments` are attributed in code (a run of >= 3 words found in the ticket is `ticket`, else in an exemplar `exemplar`, else `generated`), and `unsupported_specifics` lists codes, numbers, times and proper nouns found in neither source. `COMMENT_ENABLED` / `--no-comment` switch it; evaluation runs skip it.
6. **Output.**
   - Write the same structure as the challenge file with the fields filled.
   - Set Status to `done` once a resolution is assigned.
   - Values are Title Case, except the resolution vocabulary, which is lowercase.

Every predicted field also carries provenance: `source` (rule | pattern_match | ai_judgment | fallback), `confidence`, a one-sentence `reason`, `evidence` and ranked `alternatives`. Use the decision-record schema in `docs/CORE_API.md` from the start, even in CLI mode. Write the records to a sidecar file `outputs/decisions_<runid>.json`, so the API and the UI can consume the same structure later.

## Core service boundary
The pipeline above is the engine. It is later exposed as a local REST API plus an event stream. The full contract is in `docs/CORE_API.md`. `docs/UI_CONCEPT.md` describes the product the API serves; it is context only, and you do not build the UI.

Non-negotiable rules for the Core:
1. **The Core decides and remembers; it never acts externally.**
   - No Jira calls, no notifications, no user management.
   - An external sync layer imports tickets and writes changes back; it reacts to Core events.
   - The actor ID for every human action comes from the caller.
2. **One engine, two entry points.** The API layer (`api/`) is thin and calls the same `triage/` functions as the CLI. No pipeline logic lives in `api/`.
3. **Runs are never edited after creation; overrides are append-only.** Effective state = the latest run's decisions with overrides layered on top.
4. **Human overrides are pinned.** Re-triage never silently changes an overridden field. If a new run disagrees with an override, emit `decision.conflict` instead.
5. **Consistency is enforced by the Core, not the UI.**
   - Team always follows Service.
   - Priority always follows the matrix.
   - A direct Priority edit is rejected unless it is explicitly forced with a reason; forced values are flagged `forced_inconsistent`.
6. **Knowledge-base versions are immutable.**
   - Changes only happen through proposals, human approval, a new version, and explicit promotion.
   - Nothing in the knowledge base updates itself.
7. **Every run records its versions** (model, prompt, knowledge base, policy). Shadow runs never touch effective state and never emit sync-relevant events.
8. **Confidence comes from observable signals**: self-consistency, retrieval margin, and agreement between the LLM's service and the best-matching service card (plus agreement with a strong top pattern, and with the Request-type prior for work type). It never comes from the LLM rating itself alone.
9. **API work starts only after the CLI pipeline works end to end.** The hackathon score comes from the pipeline.

## Stack
- Python 3.11+, with pandas, numpy, pydantic v2, sentence-transformers, ollama (Python client) and pytest.
- **LLM:** Ollama on the team Mac mini (`OLLAMA_HOST`, default `http://100.87.163.97:11434`). Current default model `qwen2.5:7b`; prefer `qwen2.5:14b` if the hardware allows. The model is configurable with the `TRIAGE_MODEL` environment variable. Requests send `num_ctx` 8192, since Ollama's 4096 default silently truncates the triage prompt.
- **Structured output:** `ollama.chat(..., format=Model.model_json_schema(), options={"temperature": 0})`, then `Model.model_validate_json(...)`. Retry up to 2 times on validation failure.
- **LLM cache:** a JSON or diskcache store keyed by a hash of (model, prompt, schema), so reruns are instant.
- **API (from milestone 6 on):**
  - FastAPI, with the OpenAPI spec generated automatically.
  - SQLite through the standard `sqlite3` module or SQLModel. Keep it to one file: `data/core.db`.
  - An in-process background queue with 1–2 workers, because a local LLM can't usefully handle more concurrent calls than that.
  - `sse-starlette` for the event stream, and `httpx` for API tests.

## Layout
```
triage/
  config.py        paths, model, thresholds, level mapping, criticality, matrix
  data.py          load training + challenge (glob)
  catalog.py       mine service→team, patterns, fallback assignee; build service cards
  retrieval.py     embeddings + top-k
  schemas.py       pydantic models (LLM outputs, decision records, run records)
  confidence.py    confidence from observable signals (CORE_API §5)
  evidence.py      locate LLM evidence quotes as character spans
  decisions.py     build decision records (CORE_API §4)
  lanes.py         lane assignment + audit sampling (CORE_API §5)
  state.py         effective state, override validation and cascades (CORE_API §6B)
  engine.py        loaded KB + policy + model, called by the API workers
  kb.py            KB version store, applying proposals, closure-note scoring, learning from overrides
  policy.py        lane policy versions (thresholds, autonomy, audit rate, pause)
  metrics.py       CORE_API §9 metrics as pure functions (incl. emerging issues)
  usage.py         LLM usage ledger: token counts, prices (config.LLM_PRICES), GET /usage summary
  calibration.py   isotonic confidence calibration against human outcomes (adopted via policy)
  evaluation.py    scoring for labelled files (hand-written, dev set)
  llm.py           Ollama wrapper: structured calls, retries, cache
  priority.py      matrix lookup
  triage.py        per-ticket pipeline (steps 2–4)
  resolution.py    resolution comment generation (step 5)
run.py             CLI: build catalog, triage challenge, write outputs
eval/
  handwritten.json hand-written labelled challenge-style tickets (seed of the dev set)
  make_devset.py   synthetic challenge-style dev tickets from patterns (known labels)
  evaluate.py      per-field accuracy on the dev set
tests/             pytest
artifacts/         cached catalog, service cards, embeddings
outputs/           triaged file + decision sidecar
api/               (milestone 6+) thin FastAPI layer; no pipeline logic
  main.py          app factory, error shape, /health, startup (load live KB version)
  core.py          service layer: storage, queueing, events around triage/ (no decisions made here)
  db.py            SQLite schema + repositories
  worker.py        background run queue
  events.py        event log + SSE stream
  routers/         tickets.py, review.py, kb.py, policy.py (+ /preview), metrics.py (+ /audit), evaluations.py
docs/
  CORE_API.md      Core integration contract (binding)
  UI_CONCEPT.md    product/UI concept (context only)
```

## Commands
- Setup: `uv venv -p 3.11 .venv && source .venv/bin/activate && uv pip install -r requirements.txt`; the model is pulled on the Mac mini (`ollama pull qwen2.5:7b`)
- Build the catalog: `python run.py catalog`
- Generate service-card drafts (then human review): `python run.py cards` (`--force` overwrites reviewed cards)
- Triage the hand-written labelled tickets: `python run.py sample`
- Triage: `python run.py triage --out outputs/` (defaults to the challenge glob; `--file` for another challenge-format file, `--limit N`, `--samples N`, `--no-evidence`). Writes `<stem>_triaged_<runid>.json` and `decisions_<runid>.json`, and prints a summary table with lanes. With `--samples 0`, urgency/impact/resolution have no observable signal (confidence 0.5, below threshold), so nothing is auto-applied.
- Dev-set evaluation: `python eval/make_devset.py && python eval/evaluate.py` (`--samples N`, `--evidence`; `python run.py sample --file eval/devset.json` is the same)
- Tests: `pytest -q`
- API (milestone 6+): `uvicorn api.main:app --reload`, docs at `http://localhost:8000/docs`. `API_DB_PATH` overrides `data/core.db`. `Idempotency-Key` on `POST /tickets` is `external_key` immediately followed by the SHA-256 of the fields. Tests use `create_app(..., engine=FakeEngine(), workers=0)` (inline worker).

## Testing and evaluation
- **Unit tests (must pass):**
  - All 25 priority matrix cells.
  - Service → Team is 1:1 in the training data.
  - 21 patterns, each with a single resolver.
  - LLM output schemas reject invalid services and levels.
  - The output file keeps the challenge structure.
- **Dev set (`eval/devset.json`):**
  - About 70 LLM-generated challenge-style tickets from the KB only: 2 per resolution pattern (one misrouted with a misleading title), 2 per service without patterns (from its card), plus clarification, cannot-reproduce and nonsense tickets. The service is never named (checked in code).
  - Tickets derived from the training records are not useful here: without their resolution comment they are generic templates that name the service, and some training services are wrong on purpose.
  - Labels come from the source pattern.
  - Use it to tune the prompts. Report per-field accuracy; the assignee is reported split by whether the service was right, since it follows the service.
  - The numbers are optimistic, because the same model writes and solves these tickets.
- The 20 challenge tickets are a final run, not a tuning loop.

## Working conventions
- Plan briefly before coding. Build in milestones:
  1. setup + catalog + tests
  2. retrieval + triage call
  3. post-processing + output
  4. resolution comments
  5. dev-set evaluation
  6. API step 1: tickets, batches, runs, decisions, lanes, accept, overrides (preview, commit, cascades), export, event stream. See `docs/CORE_API.md`.
  7. API step 2: knowledge-base versions and promotion, closure harvesting, proposals, policy and pause, basic metrics
  8. Later: shadow evaluations, policy preview, emerging issues, calibration
- After each milestone: run it, fix failures, and summarise in 3 lines.
- Keep functions small and pure where possible; thresholds live in `config.py`.
- Log per-ticket decisions with provenance; print a compact summary table at the end of each run.
- Don't add frameworks (LangChain, vector DBs, fine-tuning) without asking.
