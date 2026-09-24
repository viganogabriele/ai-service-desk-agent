import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		env: {
			DASHBOARD_ORIGIN: "http://localhost:5173",
			// Tests use the in-memory fake; these only satisfy env validation.
			JIRA_BASE_URL: "https://jira.invalid",
			JIRA_EMAIL: "test@example.com",
			JIRA_API_TOKEN: "test-token",
		},
	},
});
