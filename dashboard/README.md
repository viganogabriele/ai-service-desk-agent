# AI Ticket Triage Dashboard

Phase 1 of the [dashboard PRD](../PRD.md), built with Vite+ / React / TypeScript, TanStack Router and Query, and Tailwind CSS v4. The existing Python prototype remains at the repository root.

```sh
pnpm install --dir dashboard
pnpm dev
pnpm build
pnpm lint
```

The app is **TicketBuddy**; its visual design follows the [TicketBuddy Figma file](https://www.figma.com/design/P6yzcAFDS0q93hAAk9iagw/TicketBuddy): a top bar with the logo and three view pills (Priority, List, Kanban), blue for navigation and section titles, a yellow flag for priority and the primary action on a ticket card, Poppins for headings and Inter for body text. When the backend at `VITE_BACKEND_URL` is unreachable the app falls back to `public/dashboard-data.json` and keeps status changes in the browser, so the UI can be run and demoed without Jira.

Run the last three commands from the repository root. The matching commands also work inside `dashboard/`. Python 3 is required for `scripts/prepare_data.py`; `dev` and `build` run it automatically. It reads the historical and challenge JSON files at the repository root and writes a compact bundle to `public/dashboard-data.json`. That bundle is generated and is not committed.

## Data sources

`scripts/prepare_data.py` builds `public/dashboard-data.json` from files only; nothing is generated or simulated.

- **Historical tickets** (`jira_first_20000_requested_fields_synthetic.json`): every Overview figure, the weekly intake and its linear projection, and the similar-resolution index.
- **Incoming tickets** (`jira_hackathon_blind_eval_challenge_*.json`): the ticket queue. Declared urgency and impact are validated at preparation time.
- **AI suggestions**: `dashboard/data/proposals.json` in the PRD §3.1 contract if present, otherwise the triage PoC output `output/triaged.json`. Without either, tickets start from the reporter-declared values and no AI element is shown. The dashboard does not classify tickets itself.
- **Per-field reasons**: a proposal in `proposals.json` may carry `explanations` (one `{ reason, confidence, evidence[] }` per triage field and for `resolution_comment`). Without it, the ticket page assembles each hover note from the proposal itself: the model's reason, what the reporter declared, the content clues the solver found and the assignee's historical support. Nothing is generated.
- **Similar resolved tickets**: TF-IDF similarity between the incoming ticket and historical tickets resolved as done that carry a documented `Resolution:` comment. They appear in the resolve step only for the ticket's current service and above a 10% similarity threshold.

Triage decisions and the operator action log persist in browser local storage. **Export triaged tickets** and **Clear all review data** are in the Tickets page menu.

## Styling

Design tokens are Tailwind v4 theme variables; component styles are plain CSS classes in `src/index.css` that read them. `primary` is the blue accent and `accent` the yellow priority mark; headings use `--font-display` (Poppins). `src/index.css` holds the design tokens in `@theme`, so each one is a CSS variable (`var(--color-primary)`) and a utility (`bg-primary`, `text-muted`, `border-ring`, `rounded-card`, `shadow-float`). Colors: `primary` (accent) with `primary-foreground`, `primary-subtle`, `primary-hover` and `ring`; surfaces `background`, `shell`, `surface`, `elevated`; text `foreground`, `secondary`, `muted`, `nav`; lines `border`, `border-hover`, `divider`; fills `hover`, `active`; status `success`, `warning`, `danger`, `info`; charts `chart-1` to `chart-5`. The default Tailwind palette, type scale, radii and breakpoints are reset, so only these tokens exist. `text-base` is the 13px body size, and sizes inherit the surrounding line-height. Re-theme by changing `--color-primary`.

Shared pieces live in `src/components/ui/`: `Button` / `buttonVariants` (also for router links), `Card`, `Pill`, `Dot`, `MockBadge`, `Tag`, `Field`, `Select`, `Textarea`, `InputGroup`, `Segmented`, `Chip`, `Table`, `Meter`, `Kbd`, page headings and the 12-column `Grid` with `SPAN`. They follow shadcn/ui conventions (`cn`, `class-variance-authority`) without depending on shadcn. Use `cn()` from `src/lib/utils.ts` to merge classes. It knows the custom scales and `@utility` classes, so overrides passed through `className` replace the defaults instead of stacking with them.

## Lint and formatting

`pnpm lint` runs Oxlint with the vendored generic rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` and `@shadcn/lint`'s `no-arbitrary-values` rule. The anti-slop repository's `.oxlintrc.json` contains only `oxc/no-accumulating-spread`; its README documents the full vendored plugin rule set. Both are merged in `oxlint.config.ts`. Effect-specific rules were omitted because this project does not use Effect. No ESLint or Prettier is installed.

`pnpm --dir dashboard format` runs Oxfmt and then Oxlint's spacing autofix. Generated TanStack route code is excluded from Oxfmt because it is regenerated by the router plugin.

## Pages

**Overview** (`/overview`) shows historical figures (daily volume, open backlog, share of closed tickets actually resolved, generic-service share), weekly intake with an 8-week linear projection, how tickets ended, tickets by service and team, and the incoming queue by priority and status. The AI triage card appears only when suggestions exist; operator agreement and corrections appear only after operators assign, resolve or question tickets that had an AI suggestion.

**Tickets** (`/tickets`, also the home page) opens in the **Priority View**: a row of cards for the tickets that need action now (high priority, or medium priority on a critical service, not yet routed), each with its priority, status, service, reporter and one note, then the whole queue as a table ordered by priority with open tickets first. `?view=table` is the list with search, filters and bulk assignment; `?view=board` is the Kanban board with columns Awaiting review, In progress, Assigned, Waiting for reporter and Resolved. Cards can be dragged between columns; moving to Resolved or Waiting for reporter asks for the comment first. A ticket page keeps the reading load down: the request text (folded past a few lines), comments and Jira details behind disclosures, then two numbered steps. Step 1 is the **Classification** sidebar on the right; step 2 chooses the next step (resolve with a note, ask the reporter, or assign to the service team) from three option cards. Every triage field is a tag whose style says who owns the value: AI suggestion (accent sparkle), confirmed by you (check), changed by you (person), declared by the reporter when there is no suggestion, and derived (dashed: team and priority). Hover a tag for the model's reason and evidence; click it to change the value, confirm the suggestion or restore it. One button confirms the remaining suggestions. The resolution note starts as the AI draft, tinted amber until you approve or edit it. Priority is always calculated from urgency and impact. Every action can be undone from the confirmation notice. `J`/`K` move between tickets.

**Ask a stronger model** appears only when `VITE_PREMIUM_SOLVER_URL` points to a second triage PoC instance (`python -m triage_poc --model <larger model> serve --port 8766`). The operator hint is appended to the ticket comments. Failures show a plain message and change nothing.
