# Agent instructions — backend

This backend is the **ingestion/sync layer and gateway** of `CORE_API.md` §2.
Everything goes through it: the UI calls only this backend, the Core (the AI,
built by another team) never calls Jira, and only this backend talks to Jira.
Follow `CORE_API.md` for every interaction with the Core; it is binding.

- **Jira → Postgres:** every sync pass copies changed tickets, mapped to the
  challenge-record format (`src/services/tickets.ts`, `src/db/store.ts`).
- **Postgres → Core:** open tickets whose `content_hash` the Core doesn't have
  go to the Core's `POST /tickets` with `Idempotency-Key: <key>:<hash>`.
- **Core → Jira:** Core events are polled from `GET /events?after_seq=`.
  `run.completed` with lane `auto_applied`, `decision.overridden` and
  `comment.updated` write the Core's exported effective state to Jira. Every
  write is logged in `writebacks`, once per event.
- **UI → Core:** `/core/*` proxies the Core API unchanged, except the
  ingestion endpoints (`POST /tickets`, `POST /batches`, `POST
  /tickets/{id}/closure`), which belong to this backend.

Follow these rules when working in this directory.

## Architecture and layering

- `src/index.ts` — starts the Bun server. Nothing else lives here.
- `src/app.ts` — builds the Hono app, registers global middleware and routes,
  exports `type AppType` for the dashboard's `hc` RPC client.
- `src/env.ts` — the single source of truth for configuration. Parses and
  validates `process.env` with Zod at startup; the process must fail fast
  with a clear message on invalid config.
- `src/routes/` — thin route modules only. A route validates input with
  `zValidator`, calls a service, and returns a response. **No business logic
  and no direct external API calls in routes.**
- `src/services/` — business logic. Services must not import `Context` from
  Hono or otherwise depend on the HTTP layer — they take and return plain
  data so they can be tested and reused without an HTTP request.
- `src/clients/` — external integrations (Jira, the Core). Each client is
  an interface, a real implementation, and an in-memory fake for tests and
  local dev. See `src/clients/README.md`.
- `src/db/` — Postgres access with Bun's built-in `SQL`: the migration runner
  and plain query functions. Schema changes go in a new numbered file in
  `db/migrations/`; never edit a migration that has run anywhere.
- `src/lib/errors.ts` — the shared error shape. `src/lib/log.ts` — the only
  place allowed to use `console`.

Routes must be chained (`app.get(...).post(...)`, `app.route(...)`) so RPC
type inference works for `AppType`. Do not break the chain.

## Database: integration state only

- Postgres holds the **integration state**: the mapped copy of Jira, the
  field mapping (`jira_field_map`, rewritten at startup from
  `field-config.ts`), comments, the write-back log and the sync cursors.
- Jira stays the source of truth for ticket data. After writing to Jira,
  re-read the ticket instead of updating the copy by hand.
- Runs, decisions, overrides, acceptances, KB, policy and events belong to
  the Core's own store. Do not copy them into Postgres; read them through the
  Core API.
- Tests reset a database whose name must end in `_test` (`TEST_DATABASE_URL`,
  default: the `backend_test` database of `docker compose`).

## No auth, local only

- There is **no authentication**. The server must only ever bind to
  `127.0.0.1`, never `0.0.0.0` or a public interface, and must never be
  deployed anywhere reachable from outside the developer's own machine
  without adding real authentication and hardening first. Do not "fix" this
  by binding wider — ask before changing it.

## Secrets

- Secrets (`JIRA_API_TOKEN`, etc.) live only in `.env`, validated via
  `src/env.ts`. Never log them, never echo them in a response body or error
  message, never commit `.env`.

## Hono

- Verify Hono APIs against the Hono skill (if available) or the docs at
  https://hono.dev (fetch a page with `Accept: text/markdown`) before using
  them. Do not rely on memory for Hono APIs — they change across versions.
- Use `npx hono routes` / `npx hono request` to inspect and exercise the app
  without starting a server.

## Dependencies

- New dependencies require explicit approval from the user before adding
  them. Do not add a package to solve something the existing stack
  (Hono, Zod, Bun) already solves.

## No speculative abstractions

- No generic base classes, no DI containers, no repository layers, no
  "for later" utility files. Keep files small and explicit. Prefer plain
  functions over classes.

## Before considering any task done

Start the database (`bun run db:up`), then run and make sure all pass:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Commits

Agents never commit, push or open pull requests here; the user does. Suggest
a Conventional Commits message instead.
