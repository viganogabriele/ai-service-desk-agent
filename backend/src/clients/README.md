# Clients

External integrations live here:

- `jira/` — the Jira Cloud REST API (tickets, edit metadata, transitions).
- `core/` — the Core API from `CORE_API.md`: ticket import, the event log and
  the effective-state export. The fake follows the same contract.

Convention for each client:

- An interface describing the operations a service needs (e.g. `JiraClient`).
- A real implementation that calls the external API (e.g. `jira-client.ts`).
- An in-memory fake implementing the same interface, for tests and local dev
  without hitting the real API (e.g. `jira-client.fake.ts`).

Services depend on the interface, not the concrete implementation, so the fake
can be swapped in for tests without touching business logic.
