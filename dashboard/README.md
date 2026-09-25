# AI Ticket Triage Dashboard

Built with Vite+ / React / TypeScript, TanStack Router and Query, and Tailwind CSS v4.

```sh
pnpm install --dir dashboard
pnpm dev
pnpm build
pnpm lint
```

The app is **TicketBuddy**; its visual design follows the [TicketBuddy Figma file](https://www.figma.com/design/P6yzcAFDS0q93hAAk9iagw/TicketBuddy): a top bar with the logo and a toggle bar for the three views (Priority, List, Kanban), blue for navigation and section titles, red, yellow and green priority marks, yellow for the primary action, Poppins for headings and Inter for body text. When the backend at `VITE_BACKEND_URL` is unreachable the app falls back to `public/dashboard-data.json` and keeps status changes in the browser, so the UI can be run and demoed without Jira.

Run the last three commands from the repository root. The matching commands also work inside `dashboard/`. Python 3 is required for `scripts/prepare_data.py`; `dev` and `build` run it automatically. It reads the historical and challenge JSON files at the repository root and writes a compact bundle to `public/dashboard-data.json`. That bundle is generated and is not committed.

## Atlassian sign-in

Sign-in is optional: visitors use the shared Jira account, while signed-in operators write as themselves. Set `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET` in the backend environment. Register `OAUTH_REDIRECT_URI` as the exact callback URL in the Atlassian app and enable the `read:jira-work`, `write:jira-work` and `read:me` scopes.

By default, open `http://localhost:5173`: the dashboard calls `/api`, and Vite proxies it to `http://127.0.0.1:8787`. Use `DASHBOARD_ORIGIN=http://localhost:5173` and `OAUTH_REDIRECT_URI=http://localhost:5173/api/auth/callback` on the backend.
If the backend is not running, the dev server returns `backend_unreachable` without proxy errors and the dashboard shows its bundled ticket data. Start the backend on port 8787 and refresh the dashboard to use live Jira data. If neither the backend nor the bundle answers, the page shows which connection failed and the command that starts the backend, and retries every 10 seconds. While tickets load, each page shows a placeholder of its own layout.

For direct access on another port, set `VITE_BACKEND_URL=http://localhost:8787`, keep `DASHBOARD_ORIGIN=http://localhost:5173`, and set `OAUTH_REDIRECT_URI=http://localhost:8787/auth/callback`. Fetch includes credentials and the backend allows credentialed CORS only for `DASHBOARD_ORIGIN`. Use the same hostname and scheme for the dashboard, backend URL and callback: HTTP cookies use `SameSite=Lax`, so mixing `localhost` and `127.0.0.1` will not work. The default proxy avoids this restriction because the browser only sees the dashboard origin.

Sessions expire with the Atlassian access token and are lost on backend restart. A write checks the account shown in the dashboard; if it expired or changed, the write stops, refreshes sign-in status and keeps the draft. Sign in again, or review the shared-account identity before retrying. Comments retain the `email: text` format used by the dashboard and Core, with the signed-in operator's email when available.

Run `pnpm --dir dashboard test` for client and comment-format regression tests (Node.js 22.18+).

## Data sources

`scripts/prepare_data.py` builds `public/dashboard-data.json` from files only. The 20,000 synthetic historical tickets are the challenge artifact; in the intended product they represent older Jira tickets.

- **Historical tickets** (`backend/jira_scripts/data/jira_first_20000_requested_fields_synthetic.json`): every Overview figure, the weekly intake and its linear projection, and the similar-resolution index.
- **Incoming tickets** (`backend/jira_scripts/data/challenge_blind.json`): the ticket queue. Declared urgency and impact are validated at preparation time.
- **AI suggestions**: `dashboard/data/proposals.json` if present (`{"proposals": [...]}`, each item shaped like `Proposal` in `src/domain.ts` and checked by `validate()` in `scripts/prepare_data.py`), otherwise the saved triage PoC output `dashboard/fixtures/triaged.json`. Without either, tickets start from the reporter-declared values and no AI element is shown. The dashboard does not classify tickets itself.
- **Live AI suggestions from the Core**: when the backend has `CORE_BASE_URL`, the dashboard reads the Core's effective state for every ticket through the backend's `/core` proxy, including each decision's source, confidence, signals, ticket quotes, historical patterns, flags, lane, risk and resolution draft provenance. Approving a suggested triage field records an acceptance in the Core immediately; the UI restores acceptances from Core history after reload. Assigning, resolving or requesting clarification writes to Jira first, then records changed fields as Core overrides and remaining fields as acceptances. The backend does not write those overrides back to Jira again. Without the Core the dashboard runs on Jira data alone. Moving an open ticket between Awaiting review and In progress runs the matching Jira transition through the backend.
- **Per-field reasons**: a proposal in `proposals.json` may carry `explanations` (one `{ reason, confidence, evidence[] }` per triage field and for `resolution_comment`). Without it, the ticket page assembles each hover note from the proposal itself: the model's reason, what the reporter declared, the content clues the solver found and the assignee's historical support. Nothing is generated.
- **Similar resolved tickets**: TF-IDF similarity between the incoming ticket and historical tickets resolved as done that carry a documented `Resolution:` comment. They appear in the resolve step only for the ticket's current service and above a 10% similarity threshold.

Triage decisions and the operator action log persist in browser local storage. **Export triaged tickets** and **Clear all review data** are in the Tickets page menu. Ctrl+Enter (⌘+Enter on a Mac) submits a resolution note or question from its editor.

## Styling

Everything is styled with Tailwind v4 utilities; there are no component CSS classes. `src/index.css` holds only the design tokens in `@theme`, the light-theme overrides, a minimal base layer and a few `@utility` classes that no built-in utility covers (the card-strip edge fade, checkbox marks, the `details` height animation, the `skeleton` loading placeholder). Each token is both a CSS variable (`var(--color-primary)`) and a utility (`bg-primary`, `text-muted`, `border-ring`, `rounded-card`, `shadow-float`, `px-page`).

- **Colours:** `primary` is the blue accent (`primary-text`, `primary-hover`, `primary-subtle`, `ring`) and `accent` the yellow priority mark (`action` for the primary button). Surfaces are `background`, `shell`, `surface`, `elevated`, `field` and `popover` (floating lists, menus and the toast; `tooltip` is the small dark bubble in both themes). Text is `foreground`, `strong`, `secondary`, `muted` and `nav`. Lines are `border`, `border-hover` and `divider`, fills are `hover`, `active` and `row`, and status colours are `success`, `warning`, `danger` and `info`. Charts use `chart-1` to `chart-5`. The light theme overrides the same variables on `html[data-theme="light"]`.
- **Scales:** the default palette, type scale, radii and breakpoints are reset, so only these tokens exist. `--spacing` is 4px, so `p-4` is 16px even though `text-base`, the body size, is 13px. Font sizes carry no line-height. `page`, `section`, `card-gap` and `card-pad` are named spacings that tighten on smaller screens. Layout-specific values such as grid templates (`grid-cols-workspace`) and viewport-relative heights (`max-h-rail`) are tokens as well.
- **Shadows:** Tailwind inlines shadow values into utilities, so the themed ones (`shadow-card`, `shadow-popover`, `shadow-float`) point at `--elevation-*` variables, which switch with the theme.

Shared pieces live in `src/components/ui/`: `Button` / `buttonVariants` (also for router links), `Badge`, `Dot`, `Pill`, `Card` and its parts, `Empty`, the `Section*` headings, `Tile*`, `Field`, `Textarea`, `Checkbox`, `Kbd`. They follow shadcn/ui conventions (`cn`, `class-variance-authority`) without depending on shadcn. `Dialog` and `Menu` in `src/components/ui.tsx` wrap Radix Dialog and DropdownMenu, so focus trapping, focus return, Escape, outside clicks, scroll locking and keyboard navigation come from Radix; the reason tooltips and value pickers use Radix Tooltip and Popover the same way. Use `cn()` from `src/lib/utils.ts` to merge classes. It knows the custom scales and `@utility` classes, so overrides passed through `className` replace the defaults instead of stacking with them. Add a new token name there when you add one to `@theme`.

## Lint and formatting

`pnpm lint` runs Oxlint with the vendored generic rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` and `@shadcn/lint`'s `no-arbitrary-values` rule. The anti-slop repository's `.oxlintrc.json` contains only `oxc/no-accumulating-spread`; its README documents the full vendored plugin rule set. Both are merged in `oxlint.config.ts`. Effect-specific rules were omitted because this project does not use Effect. No ESLint or Prettier is installed.

`pnpm --dir dashboard format` runs Oxfmt and then Oxlint's spacing autofix. Generated TanStack route code is excluded from Oxfmt because it is regenerated by the router plugin.

## Pages

**Overview** (`/overview`) shows historical figures (daily volume, open backlog, share of closed tickets actually resolved, generic-service share), weekly intake with an 8-week linear projection, how tickets ended, tickets by service and team, and the incoming queue by priority and status. The AI triage card appears only when suggestions exist; operator agreement and corrections appear only after operators assign, resolve or question tickets that had an AI suggestion.

**Tickets** (`/tickets`, also the home page) opens in the **Priority View**: three rows of cards, then the whole queue as a table ordered by priority with open tickets first. **Upcoming** (only with the Core connected) holds open tickets the AI has not classified yet, as thin, non-interactive cards that show whether they are queued or being classified; each moves on once the Core has a suggestion, which the dashboard checks every 5 seconds while any is pending. **Attention needed** holds every reporter reply to a question, every ticket whose triage has started, every ticket the AI could not classify or left to a human, and untouched tickets that are high priority or medium on a critical service. Priority orders them first; within one priority a reply comes before a started triage, which comes before an untouched ticket, then critical services, then the oldest. **Most recent** shows the 12 newest tickets by when the AI finished them (or when they were opened), and marks those classified in the last 15 minutes. A card's top-left chip names its stage (reporter replied, triage started, AI classified, AI couldn't classify, assigned, closed as clarification, resolved) and its button names the next step; the priority colours the border only while it is the operator's turn, and a card without an AI suggestion is dashed. `?view=table` is the list with search, filters and bulk assignment; `?view=board` is the Kanban board with columns Awaiting review, In progress, Assigned, Closed · clarification and Resolved. Dropping into Closed · clarification asks for a question and **closes the Jira ticket with Resolution = Clarification**; it does not hold an open ticket waiting for a reply. Closed cards must be reopened from their ticket page before they can be moved again. A ticket page shows the request text, comments and Jira details, then Classification and the next step. The Core evidence panel shows exact ticket quotes, decision sources, historical patterns, confidence signals, lane reasons, risk and draft provenance; matching description quotes are highlighted. Approving a Core triage suggestion records a Core acceptance. Without Core, approval is local to this browser. Marking a resolution draft reviewed is always local; posting the note happens only on Resolve. Priority is calculated from urgency and impact. `J`/`K` move between tickets.

**Notifications** (the bell in the top bar) keep what the queue order can bury: every reporter reply to a question, whatever the ticket's priority, and every ticket the AI finished classifying after the page opened. A reply that arrives while the page is open also shows a notice, unless another notice (such as an Undo) is up, and the tab title counts what is unread. Opening a ticket marks its notifications read; read marks and the last 30 classifications are kept in browser local storage.

**Simulate incoming ticket** (Tickets toolbar, only when the backend has a Core) is for demos. The Core writes a new ticket in the style of the challenge set, using a random scenario from its knowledge base and never the challenge file. The backend files it in Jira with the label `demo` and hands it to the Core. The ticket appears in Upcoming, and at the top of the table, disabled, with placeholders, until the Core's classification arrives. It then lights up and stays at the top of the table until someone works on it; it joins Most recent, and Attention needed if the AI finds it urgent. If no classification arrives within five minutes, it becomes an ordinary ticket that can be triaged by hand.

**Usage** (`/usage`, the coins icon in the top bar) reads the Core's LLM usage ledger (`GET /usage`, CORE_API §9) through the backend's `/core` proxy and refreshes every 30 seconds. It shows the estimated cost, tokens or calls (switch at the top) for the past 24 hours, 7, 30 or 90 days: a headline figure split by provider, an hourly or daily chart, totals (processed, cached and uncached input, output and reasoning tokens, cache savings, cost per classification), call outcomes (answers from the Core's disk cache, retries after invalid output, failures, mean response time) and a breakdown by model, pipeline step, purpose or day. Costs are list-price estimates from the Core's `LLM_PRICES`, fixed when each call is made; the page lists the prices it used. Without the Core the page says so and retries.

**Ask a stronger model** appears only when `VITE_PREMIUM_SOLVER_URL` points to a solver that answers `GET /health` and `POST /triage` with a list holding one challenge record. The repository no longer ships one: the triage PoC that served this contract has been removed, so the button stays hidden unless you run your own. The operator hint is appended to the ticket comments. Failures show a plain message and change nothing.

## Model playground and end-to-end tests

Open **Model playground** (the flask in the header), or go to `/playground` after `pnpm dev`.
The page works independently of the ticket queue and starts with the checked-in Qwen 4B development
run. `scripts/prepare_playground.py` reads `dashboard/fixtures/dev_predictions.json`, `dev_input.json`
and `dev_reference.json` to generate its data. Those six cases have labels for **service
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
