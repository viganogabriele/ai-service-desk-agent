# TicketBuddy: AI ticket triage for Jira Service Management

TicketBuddy triages Jira service desk tickets the way an experienced L2 agent would. For each ticket it predicts the work type, the affected service, the service team, the assignee, urgency, impact and priority, the resolution status, and a draft resolution comment in the assignee's voice. Operators review those proposals in a dashboard; their assignments, resolutions and corrections are written back to Jira.

The challenge brief, the priority matrix and the critical-service list are in [core/README.md](core/README.md).

## How it works

```
Jira ⇄ backend (Bun + Hono, Postgres) ⇄ Core (Python, FastAPI + LLM)
            ▲
            └── dashboard (React)
```

- **Core** ([`core/`](core/)) is the triage engine. It reads each ticket, retrieves similar resolution patterns and service cards with local embeddings, asks an LLM for a structured decision, then applies the deterministic rules. It stores runs, decisions, human overrides and knowledge-base versions, and never calls Jira itself.
- **Backend** ([`backend/`](backend/)) is the only component that talks to Jira. It syncs tickets into Postgres, sends new ones to the Core, writes approved decisions back to Jira and proxies the Core API for the dashboard.
- **Dashboard** ([`dashboard/`](dashboard/)) is the operator's cockpit: a priority queue, list and Kanban views, a ticket page showing the evidence behind every field, historical KPIs, and a playground for comparing models.

## What the data taught us

The 20,000 training tickets are synthetic and deliberately noisy, so the pipeline only learns from the signals that hold up:

- **Service → team is deterministic** (20 services, 11 teams), so the team is looked up, never predicted.
- **Priority always comes from the urgency × impact matrix.** The model never predicts it directly.
- **Training assignee, priority, urgency, impact and resolution labels are noise.** The assignee's entropy given the service is 4.88 bits, against a maximum of 4.91. None of these fields are used as supervision.
- **The real assignee signal is in the comments.** Each of the 21 `Resolution:` patterns has a single author and belongs to one service. The assignee is the resolver of the service's patterns, with a labelled fallback for the ten services that have none.
- **Titles and reported services are often wrong on purpose.** The model reads the description and comments, and the reported values are hidden from the prompt.

Every field carries its source (rule, pattern match, AI judgment or fallback), a confidence taken from observable signals such as self-consistency and retrieval margin, exact quotes from the ticket as evidence, and ranked alternatives. Low-confidence or risky tickets go to human review; every `cancelled` ticket does.

## Results

On a frozen 300-ticket comparison set (50 handwritten tickets and 250 generated ones, none derived from the challenge tickets), with one deterministic triage call per ticket. Figures are exact-match counts out of 300:

| Model | Service | Work type | Resolution | Urgency | Impact | Priority | Assignee |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-6-luna` (OpenAI) | 289 | 298 | 296 | 225 | 207 | 219 | 130 / 137 |
| `qwen2.5:7b` (local Ollama) | 225 | 228 | 251 | 213 | 189 | 204 | 109 / 137 |

Luna wrote the 250 generated tickets, so its score on those is optimistic; the 50 handwritten cases are the independent check. Details, per-ticket predictions and the commands to reproduce them are in [core/eval/](core/eval/README.md).

## Running it

Each component has its own setup; start them in this order.

**Core** (Python 3.11+), from `core/`:

```sh
uv venv -p 3.11 .venv && source .venv/bin/activate && uv pip install -r requirements.txt
python run.py catalog                 # mine the catalog from the training data
python run.py triage --out outputs/   # triage the challenge file from the command line
uvicorn api.main:app                  # or serve the API, docs at http://localhost:8000/docs
pytest -q
```

`LLM_PROVIDER` (`ollama`, `openai` or `swisscom`) and `TRIAGE_MODEL` select the model. Cloud providers read `OPENAI_API_KEY` or `APERTUS_API_KEY` from the Core's environment.

**Backend** (Bun, Docker for Postgres), from `backend/`:

```sh
cp .env.example .env    # add the Jira credentials, and CORE_BASE_URL=http://127.0.0.1:8000
bun install
bun run db:up
bun run dev             # http://127.0.0.1:8787
```

**Dashboard** (Node.js 22.18+, pnpm, Python 3 for the data scripts), from the repository root:

```sh
pnpm install --dir dashboard
pnpm dev                # http://localhost:5173
```

Without the backend, the dashboard falls back to a bundle built from the challenge files, so the UI can be demoed offline.

## Documentation

- [core/docs/CORE_API.md](core/docs/CORE_API.md): the Core's API and decision-record contract.
- [core/docs/UI_CONCEPT.md](core/docs/UI_CONCEPT.md): the product concept behind the Core's design.
- [core/AGENTS.md](core/AGENTS.md): the full pipeline, data findings and design rules.
- [backend/CLAUDE.md](backend/CLAUDE.md): the sync layer and its architecture.
- [dashboard/README.md](dashboard/README.md): data sources, pages, the model playground and browser tests.
- [PRD.md](PRD.md): the dashboard's product requirements (in Italian).
- [jira/README.md](jira/README.md): scripts to load the challenge tickets into Jira and export the submission.
