<h1 align="center">
  <img src="dashboard/src/assets/logo.png" alt="TicketBuddy logo" width="96" height="96" />
  TicketBuddy
</h1>

<p align="center">AI triage for a service desk</p>

TicketBuddy reads incoming Jira service-desk tickets and proposes how an experienced L2 agent would handle them. For each ticket it proposes the work type, the affected service, the owning team, the assignee, the urgency, the impact, the priority, the resolution status and a draft resolution note. A person reviews the proposal before anything uncertain reaches Jira.

It was built for the [Swiss AI Weeks hackathon challenge](instructions.md). The challenge is sponsored by [SwissLife](https://github.com/Swiss-ai-Weeks/SwissLife-2026), pan-European asset manager. We received 20,000 synthetic historical tickets and a set of new "blind" tickets to triage. Some fields in the new tickets are wrong on purpose: misleading titles, the wrong service, inconsistent priorities.

## How a ticket is classified

![Classification pipeline: an algorithm finds similar past cases, the LLM decides five fields, fixed rules derive team, priority and assignee, an algorithm scores confidence and picks a lane, the LLM drafts the resolution note, and a human reviews it before Jira is updated](classification-pipeline.svg)

The pipeline uses a language model (LLM) only where the ticket has to be *understood* or *written*. Anything with one correct answer, such as a lookup, a table or a threshold, is computed by ordinary code. The code always produces the same result, and its decisions can be checked.

1. **Find similar past cases (algorithm).** A small embedding model turns the ticket's description and comments into a vector of numbers. Cosine similarity then finds the three closest past resolutions and the three best-matching service descriptions. The title is ignored because it is often misleading. This is a search, not a text generator.
2. **Read the ticket and decide (LLM).** The LLM receives the ticket, the service catalogue, the search results and the official urgency and impact definitions. It returns five fields: work type, service, urgency, impact and resolution status (`done`, `cancelled`, `clarification` or `cannot reproduce`). A JSON schema limits each field to its allowed values, so the model cannot invent a service. It also gives a one-sentence reason. A few extra sampled runs show whether it gives the same answer again. A separate short call quotes the phrases from the ticket that support each decision, and code checks that each quote really appears in the ticket.
3. **Apply the fixed rules (algorithm).** The LLM never predicts these three fields:
   - **Team** is looked up from the service. Each of the 20 services belongs to exactly one of 11 teams.
   - **Priority** comes from the official urgency × impact matrix.
   - **Assignee** is the person who wrote that service's past resolutions. If the service has no documented resolutions, the assignee falls back to the person most often assigned to that service in the past.
4. **Score confidence and pick a lane (algorithm).** Confidence comes only from signals we can observe: whether the extra runs agree, how clearly the search separated the top match, whether the LLM's service matches the closest service description and past fix, and whether the work type matches the ticket's request type. The LLM's opinion of its own answer is not used. A policy then sends the ticket to one of three lanes:
   - **auto-apply:** every field is above its threshold. A 10% sample of these tickets is audited.
   - **needs review:** at least one field is uncertain, or the proposal changes the reported service.
   - **human only:** risky cases, such as a highest-priority ticket on a critical service, or any cancellation.
5. **Draft the resolution note (LLM).** The LLM writes one or two sentences in the assignee's voice, based on similar past resolutions. Code rejects notes that mention a ticket ID that is not in the ticket. It also lists codes, numbers and names that appear in neither the ticket nor the examples, so the reviewer can check them.
6. **Human review (person).** An agent sees the proposal in the dashboard, with each field's reason, confidence and evidence. They accept it or correct it. A later AI run never overwrites a correction; if the new run disagrees, it raises a conflict instead.

### Why this split

We checked the training data and found that it cannot teach a classic supervised statistical classifier:

- The new tickets are free text, so a model trained on the templates would not generalise.
- Its priority, urgency, impact, resolution and assignee fields are not reliable enough to be trusted as always true.
- Its useful signal is structural. The service → team mapping is fully deterministic, and 21 detailed `Resolution:` comments each belong to one service and one resolver.

So the historical data becomes a **knowledge base**: the lookup tables and the examples the search step uses. The LLM handles the semantic reading. The official matrix and the business rules stay in code. The full list of data facts and rules is in [core/AGENTS.md](core/AGENTS.md).

## Architecture

```
Jira Cloud  <-->  backend (sync + gateway)  <-->  Core (triage engine + API)
                        ^
                        |
                    dashboard (React UI)
```

| Component | What it does | Stack |
| --- | --- | --- |
| [`core/`](core/) | The triage pipeline shown above, exposed as a REST API with an event stream. It decides and remembers (runs, decisions, overrides, knowledge-base versions, policy) but never calls Jira. | Python, FastAPI, SQLite, sentence-transformers; LLM through Ollama, Swisscom Apertus or OpenAI |
| [`backend/`](backend/) | The only component that talks to Jira. It copies tickets into Postgres, sends open tickets to the Core, writes approved results back to Jira and proxies the Core API for the UI. It also handles optional Atlassian sign-in. | Bun, Hono, Postgres, Zod |
| [`dashboard/`](dashboard/) | TicketBuddy UI: a priority queue, a list and a Kanban board, a ticket page with a human-in-the-loop classification sidebar, historical overview charts, a model playground and a usage page with the tokens and estimated cost of every LLM call. A "Simulate incoming ticket" button files a demo ticket, written by the Core from a knowledge-base scenario, and shows it arriving and being classified live. | React, TypeScript, Vite, TanStack Router/Query, Tailwind CSS v4 |
| [`jira/`](jira/) | Scripts that upload the challenge tickets to a Jira site and export results in the challenge format. | Python |

The Core's integration contract is [core/docs/CORE_API.md](core/docs/CORE_API.md), and its product concept is [core/docs/UI_CONCEPT.md](core/docs/UI_CONCEPT.md).

## Getting started

Each component has its own README with full details. This is the shortest path to a running system.

**Core** (from `core/`, Python 3.11+):

```sh
uv venv -p 3.11 .venv && source .venv/bin/activate
uv pip install -r requirements.txt
python run.py catalog                  # build the knowledge base from the training file
python run.py triage --out outputs/    # triage the challenge file from the command line
uvicorn api.main:app --reload          # or serve the API (docs at http://localhost:8000/docs)
```

By default the Core uses Ollama with `qwen2.5:7b` on the team's Mac mini (`OLLAMA_HOST`). Set `LLM_PROVIDER` and `TRIAGE_MODEL` to use another provider. OpenAI needs `OPENAI_API_KEY` and Swisscom Apertus needs `APERTUS_API_KEY`.

**Backend** (from `backend/`, needs Bun and Docker):

```sh
cp .env.example .env    # add your Jira credentials; set CORE_BASE_URL to the Core's URL
bun install
bun run db:up           # starts Postgres on 127.0.0.1:5434
bun run dev             # serves on 127.0.0.1:8787
```

**Dashboard** (from the repository root, needs pnpm):

```sh
pnpm install --dir dashboard
pnpm dev                # http://localhost:5173
```

The dashboard also works without the backend. It then falls back to a bundle built from the local JSON files.

## Results so far

This is how the pipeline scored on a frozen set of 300 labelled tickets, using one deterministic triage call per ticket. The set has 50 handwritten tickets and 250 tickets generated from the knowledge base.

| Model | Service | Work type | Resolution | Urgency | Impact | Priority | Assignee |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b` (local, Ollama) | 225/300 | 228/300 | 251/300 | 213/300 | 189/300 | 204/300 | 109/137 |
| `gpt-6-luna` (OpenAI) | 289/300 | 298/300 | 296/300 | 225/300 | 207/300 | 219/300 | 130/137 |

Read these numbers with their limits in mind:
- Urgency and impact labels involve judgment.
- The blind challenge tickets have no reference answers, so they cannot measure accuracy.

See [core/eval/](core/eval/README.md) for the method, per-ticket results and the Apertus runs.

## Ground rules

- **No hardcoded answers.** Nothing is keyed on specific challenge tickets. The challenge tickets are never used to build the knowledge base or tune prompts.
- **Consistency is enforced in the Core.** The team always follows the service, and the priority always follows the matrix. Overriding the priority directly requires an explicit reason.
- **Human corrections are final.** Overrides are append-only and pinned, and knowledge-base changes need human approval and a new version.
- **Runs are reproducible.** The final decision uses temperature 0, and LLM calls are cached. Each run records its model, prompt, knowledge-base and policy versions.

## Further reading

- [instructions.md](instructions.md): the official challenge specification, including the priority matrix and the list of critical services.
- [core/AGENTS.md](core/AGENTS.md): the verified data facts and the full pipeline rules.
- [core/docs/CORE_API.md](core/docs/CORE_API.md): the contract between the Core, the backend and the dashboard.
- [PRD.md](PRD.md): dashboard product requirements (in Italian).
