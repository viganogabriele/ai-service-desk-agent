import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Test files share one Postgres database, reset per test.
		fileParallelism: false,
		env: {
			DASHBOARD_ORIGIN: "http://localhost:5173",
			DATABASE_URL:
				process.env.TEST_DATABASE_URL ??
				"postgres://backend:backend@127.0.0.1:5433/backend_test",
			// Tests use the in-memory fakes; these only satisfy env validation.
			JIRA_BASE_URL: "https://jira.invalid",
			JIRA_EMAIL: "test@example.com",
			JIRA_API_TOKEN: "test-token",
		},
	},
});
