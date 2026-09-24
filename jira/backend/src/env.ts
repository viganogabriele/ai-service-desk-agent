import { z } from "zod";

const schema = z.object({
	PORT: z.coerce.number().int().positive().default(8787),
	DASHBOARD_ORIGIN: z.url(),
	JIRA_BASE_URL: z.url(),
	JIRA_EMAIL: z.email(),
	JIRA_API_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
	const result = schema.safeParse(process.env);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		// biome-ignore lint/suspicious/noConsole: startup fails before any logger exists
		console.error(`Invalid environment configuration:\n${issues}`);
		process.exit(1);
	}
	return result.data;
}

export const env: Env = loadEnv();
