# Clients

External integrations live here:

- `jira/` — the Jira Cloud REST API (tickets, edit metadata, transitions).
- `core/` — the Core API from `CORE_API.md`: ticket import, closures, the
  event log and the effective-state export. The fake follows the same contract.

Convention for each client:

- An interface describing the operations a service needs (e.g. `JiraClient`).
- A real implementation that calls the external API (e.g. `jira-client.ts`).
- An in-memory fake implementing the same interface, for tests and local dev
  without hitting the real API (e.g. `jira-client.fake.ts`).

Services depend on the interface, not the concrete implementation, so the fake
can be swapped in for tests without touching business logic.

Core writebacks preserve the exported priority, including forced human overrides.
After reading an export, the backend checks all later event pages for changes to
that ticket and skips superseded writes. This relies on the Core making a state
change and its event visible together; an export ahead of the event log cannot be
correlated safely through the current API.
