import { SQL } from "bun";
import { createApp } from "./app";
import { createRealOAuthClient } from "./clients/atlassian/oauth-client";
import { createRealCoreClient } from "./clients/core/core-client";
import { RECORD_FIELD_MAP } from "./clients/jira/field-config";
import { createRealJiraClient } from "./clients/jira/jira-client";
import { migrate } from "./db/migrate";
import { saveFieldMap } from "./db/store";
import { env } from "./env";
import { log } from "./lib/log";
import { createAuth } from "./services/auth";
import { createSyncer } from "./services/sync";

const sql = new SQL(env.DATABASE_URL);
const applied = await migrate(sql);
if (applied.length > 0) log.info(`Applied migrations: ${applied.join(", ")}`);
await saveFieldMap(sql, RECORD_FIELD_MAP);

const jira = createRealJiraClient({
	baseUrl: env.JIRA_BASE_URL,
	email: env.JIRA_EMAIL,
	apiToken: env.JIRA_API_TOKEN,
});
const core = env.CORE_BASE_URL ? createRealCoreClient(env.CORE_BASE_URL) : null;
const syncer = createSyncer(jira, core, sql);
const auth =
	env.ATLASSIAN_CLIENT_ID && env.ATLASSIAN_CLIENT_SECRET
		? createAuth(
				createRealOAuthClient({
					clientId: env.ATLASSIAN_CLIENT_ID,
					clientSecret: env.ATLASSIAN_CLIENT_SECRET,
					redirectUri: env.OAUTH_REDIRECT_URI,
				}),
				env.JIRA_BASE_URL,
				(baseUrl, accessToken) =>
					createRealJiraClient({ baseUrl, accessToken }),
			)
		: null;

const app = createApp({
	jira,
	sql,
	syncer,
	core: { baseUrl: env.CORE_BASE_URL },
	coreClient: core,
	auth,
});

Bun.serve({
	fetch: app.fetch,
	hostname: "127.0.0.1",
	port: env.PORT,
	// SSE from the Core's /events/stream must not be cut after the default 10 s.
	idleTimeout: 0,
});

syncer.start(env.SYNC_SECONDS);
log.info(
	`Listening on http://127.0.0.1:${env.PORT}, syncing every ${env.SYNC_SECONDS}s` +
		(core ? "" : " (Core not configured)") +
		(auth ? ", sign-in with Atlassian on" : ""),
);
