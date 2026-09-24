# Agent instructions — jira/backend

This backend sits between Jira (the system of record), a custom dashboard, and
an AI model that analyzes and modifies Jira data. Follow these rules when
working in this directory.

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
- `src/clients/` — external integrations (Jira, the AI model). Each client is
  an interface, a real implementation, and an in-memory fake for tests and
  local dev. See `src/clients/README.md`.
- `src/lib/errors.ts` — the shared error shape.

Routes must be chained (`app.get(...).post(...)`, `app.route(...)`) so RPC
type inference works for `AppType`. Do not break the chain.

## No database, no auth, local only

- This backend owns **no persistent state**. Anything held in memory is a
  cache or a derived view of Jira, never the source of truth. Jira is the
  only source of truth.
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

Run, and make sure all pass:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Commits

Use Conventional Commits for every commit in this project.
