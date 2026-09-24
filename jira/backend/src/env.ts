import { z } from "zod";
import { log } from "./lib/log";

// "" from an unset .env placeholder counts as absent.
const optional = <T extends z.ZodType>(inner: T) =>
	z.preprocess((value) => (value === "" ? undefined : value), inner.optional());

const schema = z.object({
	PORT: z.coerce.number().int().positive().default(8787),
	DASHBOARD_ORIGIN: z.url(),
	DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
	JIRA_BASE_URL: z.url(),
	JIRA_EMAIL: z.email(),
	JIRA_API_TOKEN: z.string().min(1),
	// Without it the backend still syncs Jira into Postgres; /core returns 503.
	CORE_BASE_URL: optional(z.url()),
	SYNC_SECONDS: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
	const result = schema.safeParse(process.env);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		log.error(`Invalid environment configuration:\n${issues}`);
		process.exit(1);
	}
	return result.data;
}

export const env: Env = loadEnv();
