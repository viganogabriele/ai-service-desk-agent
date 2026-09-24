# Clients

External integrations (Jira, the AI model) live here. None are implemented yet.

Convention for each client, once added:

- An interface describing the operations a service needs (e.g. `JiraClient`).
- A real implementation that calls the external API (e.g. `jira-client.ts`).
- An in-memory fake implementing the same interface, for tests and local dev
  without hitting the real API (e.g. `jira-client.fake.ts`).

Services depend on the interface, not the concrete implementation, so the fake
can be swapped in for tests without touching business logic.
