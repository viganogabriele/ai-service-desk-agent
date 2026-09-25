# AI Ticket Triage Dashboard

Phase 1 of the [dashboard PRD](../PRD.md), built with Vite+ / React / TypeScript, TanStack Router and Query, and Tailwind CSS v4. The existing Python prototype remains at the repository root.

```sh
pnpm install --dir dashboard
pnpm dev
pnpm build
pnpm lint
```

The app is **TicketBuddy**; its visual design follows the [TicketBuddy Figma file](https://www.figma.com/design/P6yzcAFDS0q93hAAk9iagw/TicketBuddy): a top bar with the logo and a toggle bar for the three views (Priority, List, Kanban), blue for navigation and section titles, red, yellow and green priority marks, yellow for the primary action, Poppins for headings and Inter for body text. When the backend at `VITE_BACKEND_URL` is unreachable the app falls back to `public/dashboard-data.json` and keeps status changes in the browser, so the UI can be run and demoed without Jira.

Run the last three commands from the repository root. The matching commands also work inside `dashboard/`. Python 3 is required for `scripts/prepare_data.py`; `dev` and `build` run it automatically. It reads the historical and challenge JSON files at the repository root and writes a compact bundle to `public/dashboard-data.json`. That bundle is generated and is not committed.

## Data sources

`scripts/prepare_data.py` builds `public/dashboard-data.json` from files only; nothing is generated or simulated.

- **Historical tickets** (`jira_first_20000_requested_fields_synthetic.json`): every Overview figure, the weekly intake and its linear projection, and the similar-resolution index.
- **Incoming tickets** (`jira_hackathon_blind_eval_challenge_*.json`): the ticket queue. Declared urgency and impact are validated at preparation time.
- **AI suggestions**: `dashboard/data/proposals.json` in the PRD §3.1 contract if present, otherwise the triage PoC output `output/triaged.json`. Without either, tickets start from the reporter-declared values and no AI element is shown. The dashboard does not classify tickets itself.
- **Live AI suggestions from the Core**: when the backend has `CORE_BASE_URL`, the dashboard reads the Core's effective state for every ticket through the backend's `/core` proxy, with each field's reason, confidence and evidence. Assign, resolve and ask-the-reporter are written to Jira first, then recorded in the Core as overrides (changed fields) and acceptances (the rest), as actor `dashboard`. The backend does not write those overrides back to Jira again. Without the Core the dashboard runs on Jira data alone. Moving a ticket between Awaiting review and In progress (board drag or the ticket page) runs the matching Jira transition through the backend.
- **Per-field reasons**: a proposal in `proposals.json` may carry `explanations` (one `{ reason, confidence, evidence[] }` per triage field and for `resolution_comment`). Without it, the ticket page assembles each hover note from the proposal itself: the model's reason, what the reporter declared, the content clues the solver found and the assignee's historical support. Nothing is generated.
- **Similar resolved tickets**: TF-IDF similarity between the incoming ticket and historical tickets resolved as done that carry a documented `Resolution:` comment. They appear in the resolve step only for the ticket's current service and above a 10% similarity threshold.

Triage decisions and the operator action log persist in browser local storage. **Export triaged tickets** and **Clear all review data** are in the Tickets page menu.

## Styling

Everything is styled with Tailwind v4 utilities; there are no component CSS classes. `src/index.css` holds only the design tokens in `@theme`, the light-theme overrides, a minimal base layer and a few `@utility` classes that no built-in utility covers (the card-strip edge fade, checkbox marks, the `details` height animation). Each token is both a CSS variable (`var(--color-primary)`) and a utility (`bg-primary`, `text-muted`, `border-ring`, `rounded-card`, `shadow-float`, `px-page`).

- **Colours:** `primary` is the blue accent (`primary-text`, `primary-hover`, `primary-subtle`, `ring`) and `accent` the yellow priority mark (`action` for the primary button). Surfaces are `background`, `shell`, `surface`, `elevated` and `field`. Text is `foreground`, `strong`, `secondary`, `muted` and `nav`. Lines are `border`, `border-hover` and `divider`, fills are `hover`, `active` and `row`, and status colours are `success`, `warning`, `danger` and `info`. Charts use `chart-1` to `chart-5`. The light theme overrides the same variables on `html[data-theme="light"]`.
- **Scales:** the default palette, type scale, radii and breakpoints are reset, so only these tokens exist. `--spacing` is 4px, so `p-4` is 16px even though `text-base`, the body size, is 13px. Font sizes carry no line-height. `page`, `section`, `card-gap` and `card-pad` are named spacings that tighten on smaller screens. Layout-specific values such as grid templates (`grid-cols-workspace`) and viewport-relative heights (`max-h-rail`) are tokens as well.
- **Shadows:** Tailwind inlines shadow values into utilities, so the themed ones (`shadow-card`, `shadow-popover`, `shadow-float`) point at `--elevation-*` variables, which switch with the theme.

Shared pieces live in `src/components/ui/`: `Button` / `buttonVariants` (also for router links), `Badge`, `Dot`, `Pill`, `Card` and its parts, `Empty`, the `Section*` headings, `Tile*`, `Field`, `Textarea`, `Checkbox`, `Kbd`. They follow shadcn/ui conventions (`cn`, `class-variance-authority`) without depending on shadcn. Use `cn()` from `src/lib/utils.ts` to merge classes. It knows the custom scales and `@utility` classes, so overrides passed through `className` replace the defaults instead of stacking with them. Add a new token name there when you add one to `@theme`.

## Lint and formatting

`pnpm lint` runs Oxlint with the vendored generic rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` and `@shadcn/lint`'s `no-arbitrary-values` rule. The anti-slop repository's `.oxlintrc.json` contains only `oxc/no-accumulating-spread`; its README documents the full vendored plugin rule set. Both are merged in `oxlint.config.ts`. Effect-specific rules were omitted because this project does not use Effect. No ESLint or Prettier is installed.

`pnpm --dir dashboard format` runs Oxfmt and then Oxlint's spacing autofix. Generated TanStack route code is excluded from Oxfmt because it is regenerated by the router plugin.

## Pages

**Overview** (`/overview`) shows historical figures (daily volume, open backlog, share of closed tickets actually resolved, generic-service share), weekly intake with an 8-week linear projection, how tickets ended, tickets by service and team, and the incoming queue by priority and status. The AI triage card appears only when suggestions exist; operator agreement and corrections appear only after operators assign, resolve or question tickets that had an AI suggestion.

**Tickets** (`/tickets`, also the home page) opens in the **Priority View**: a row of cards for the tickets that need action now (high priority, or medium priority on a critical service, not yet routed), each with its priority, status, service, reporter and one note, then the whole queue as a table ordered by priority with open tickets first. `?view=table` is the list with search, filters and bulk assignment; `?view=board` is the Kanban board with columns Awaiting review, In progress, Assigned, Waiting for reporter and Resolved. Cards can be dragged between columns; moving to Resolved or Waiting for reporter asks for the comment first. A ticket page keeps the reading load down: the request text (folded past a few lines), comments and Jira details behind disclosures, then two numbered steps. Step 1 is the **Classification** sidebar on the right; step 2 chooses the next step (resolve with a note, ask the reporter, or assign to the service team) from three option cards. Every triage field is a tag whose style says who owns the value: AI suggestion (accent sparkle), confirmed by you (check), changed by you (person), declared by the reporter when there is no suggestion, and derived (dashed: team and priority). Hover a tag for the model's reason and evidence; click it to change the value, confirm the suggestion or restore it. One button confirms the remaining suggestions. The resolution note starts as the AI draft, tinted amber until you approve or edit it. Priority is always calculated from urgency and impact. Every action can be undone from the confirmation notice. `J`/`K` move between tickets.

**Ask a stronger model** appears only when `VITE_PREMIUM_SOLVER_URL` points to a second triage PoC instance (`python -m triage_poc --model <larger model> serve --port 8766`). The operator hint is appended to the ticket comments. Failures show a plain message and change nothing.

## Model playground and end-to-end tests

Open **Model playground** (the flask in the header), or go to `/playground` after `pnpm dev`.
The page works independently of the ticket queue and starts with the checked-in Qwen 4B development
run. `scripts/prepare_playground.py` reads `output/dev_predictions.json`, `fixtures/dev_input.json`
and `fixtures/dev_reference.json` to generate its data. Those six cases have labels for **service
and work type only**. The displayed timings are saved observations, with no recorded hardware or
run date. They are not fresh inference or a comparison against the Core pipeline.

To evaluate models, start the backend with its Core connection configured, then choose OpenAI API, Apertus (Swisscom API), or Ollama for each model.
Enter the exact model IDs available to your account; “Compare with” is optional. The playground uses `VITE_BACKEND_URL` (default
`http://127.0.0.1:8787`) and the existing `/core/evaluations` and `/core/runs` endpoints. Reviewed
tickets use available human acceptances and overrides as labels. Recent tickets cover the last
30 days and may be unlabelled. Runs are shadow evaluations: they do not modify effective ticket
state or write to Jira. Models are queued separately, so review activity during a comparison can
change the labels or ticket membership; compare the exported ticket IDs and versions as well as
scores. The deployed model's cache can affect elapsed times.

The comparison table shows label agreement, label counts, mean and p95 time, failures and status.
Select a run for field scores, per-ticket timings and filterable disagreements. Label agreement
is weighted by the number of labelled decisions, not averaged across fields. Failed tickets are
reported separately and excluded from quality and latency denominators; unlabelled fields never
receive an accuracy score. p95 uses the nearest-rank method. Core elapsed times have one-second
precision. Token use and cost are unavailable in the current API.

The most recent 12 evaluation IDs persist in this browser, scoped to the backend URL. Results
remain in the Core and polling resumes when the page reopens. Export downloads the selected run,
versions, ticket IDs, field metrics, disagreements, source and available timings as JSON.

Run the browser suite from the repository root:

```sh
pnpm --dir dashboard install
pnpm --dir dashboard exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:ui
pnpm test:e2e:report
```

The default suite starts its own local app on port 4173. It exercises desktop and mobile layouts,
light and dark themes, the real saved artifact, export, navigation, two-model submissions,
polling, reload recovery, missing labels, empty sets and API failures. Live API responses are
intercepted with deterministic fixtures; these tests verify the browser workflow, not model
quality. Failed tests retain screenshots and [Playwright traces](https://playwright.dev/docs/trace-viewer).
The HTML report and its theme screenshots are local generated artifacts.

To test the full browser → gateway → Core → provider API path, start those services with at least
one reviewed ticket and run:

```sh
E2E_LIVE_PROVIDER=openai E2E_LIVE_MODEL=gpt-6-luna pnpm --dir dashboard exec playwright test e2e/live-model.spec.ts --project desktop
```

This opt-in test allows 30 minutes, requires a nonempty labelled result with no failed tickets,
and saves `live-evaluation.json` in its test output directory. It is skipped in the default suite.


### OpenAI and Apertus credentials

Export `OPENAI_API_KEY` and `APERTUS_API_KEY` in the environment of the **Python Core** before
starting it. Keys are never entered into the dashboard or stored in browser history. Missing
keys produce a setup error before an evaluation is queued. Key presence does not prove that the
account has access to a model; authentication, model availability and rate-limit failures are
reported by the provider during execution.

OpenAI uses the [Responses API](https://developers.openai.com/api/docs/guides/reasoning), with
`store: false` and the existing configured reasoning effort/mode (high/standard by default).
The playground starts with the repository's tested `gpt-6-luna` model. Apertus uses the existing
Swisscom Swiss AI Weeks endpoint and `swiss-ai/Apertus-v1.5-70B`. For a different Apertus hosting
account, set `SWISSCOM_API_URL` to its complete compatible chat-completions URL and supply its
model ID. [Apertus lists its hosting providers here](https://apertus-ai.org/pages/get-started/).
These cloud evaluations send ticket content to the selected provider.

Provider-qualified model IDs let both providers run in the same Core process without changing
`LLM_PROVIDER`: `openai/gpt-6-luna`, `swisscom/swiss-ai/Apertus-v1.5-70B`, or
`ollama/qwen2.5:7b`. The UI constructs these IDs from the selectors. They are preserved in results
and exports, while adapters receive only the provider's model ID. Bare model names keep using
the server's `LLM_PROVIDER` default. Remote cache entries are separated by provider and endpoint.

For the Apertus live test, use `E2E_LIVE_PROVIDER=swisscom` and
`E2E_LIVE_MODEL=swiss-ai/Apertus-v1.5-70B`. For Ollama, use `E2E_LIVE_PROVIDER=ollama` with an
installed model name. The default browser suite mocks provider results and makes no paid API calls.
