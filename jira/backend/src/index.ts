import { createApp } from "./app";
import { createRealJiraClient } from "./clients/jira/jira-client";
import { env } from "./env";

const app = createApp(
	createRealJiraClient({
		baseUrl: env.JIRA_BASE_URL,
		email: env.JIRA_EMAIL,
		apiToken: env.JIRA_API_TOKEN,
	}),
);

Bun.serve({
	fetch: app.fetch,
	hostname: "127.0.0.1",
	port: env.PORT,
});

// biome-ignore lint/suspicious/noConsole: startup announcement, not app logging
console.log(`Listening on http://127.0.0.1:${env.PORT}`);
