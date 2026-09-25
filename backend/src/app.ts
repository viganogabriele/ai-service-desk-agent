import type { SQL } from "bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { CoreClient } from "./clients/core/core-client";
import type { JiraClient } from "./clients/jira/jira-client";
import { env } from "./env";
import { errorBody } from "./lib/errors";
import { log } from "./lib/log";
import { createAuthRoute } from "./routes/auth";
import { type CoreProxyConfig, createCoreRoute } from "./routes/core";
import { createDemoRoute } from "./routes/demo";
import { createHealthRoute } from "./routes/health";
import { createSyncRoute } from "./routes/sync";
import { createTicketsRoute } from "./routes/tickets";
import type { Auth } from "./services/auth";
import type { Syncer } from "./services/sync";

export type AppDeps = {
	jira: JiraClient;
	sql: SQL;
	syncer: Syncer;
	core: CoreProxyConfig;
	/** Sign in with Atlassian; null keeps every write on JIRA_API_TOKEN. */
	auth?: Auth | null;
	/** The Core the backend itself calls; null when CORE_BASE_URL is unset. */
	coreClient: CoreClient | null;
};

export function createApp({
	jira,
	sql,
	syncer,
	core,
	coreClient,
	auth = null,
}: AppDeps) {
	const app = new Hono();

	app.use(async (c, next) => {
		// Query strings can contain OAuth authorization codes and state.
		const request = `${c.req.method} ${c.req.path}`;
		const started = Date.now();
		log.info(`<-- ${request}`);
		await next();
		log.info(`--> ${request} ${c.res.status} ${Date.now() - started}ms`);
	});
	app.use(secureHeaders());
	app.use("*", cors({ origin: env.DASHBOARD_ORIGIN, credentials: true }));

	const route = app
		.route("/health", createHealthRoute(sql, Boolean(core.baseUrl)))
		.route("/auth", createAuthRoute(auth, `${env.DASHBOARD_ORIGIN}/`))
		.route("/tickets", createTicketsRoute(jira, sql, auth))
		.route("/sync", createSyncRoute(syncer))
		.route("/demo", createDemoRoute(jira, sql, syncer, coreClient))
		.route("/core", createCoreRoute(core));

	app.notFound((c) => c.json(errorBody("Not found", "not_found"), 404));

	app.onError((err, c) => {
		if (err instanceof HTTPException && err.status < 500) {
			return c.json(errorBody(err.message, "http_error"), err.status);
		}
		if (err instanceof HTTPException) {
			// Expected upstream trouble: one line, plus the upstream error if any.
			log.error(`${c.req.method} ${c.req.path}: ${err.message}`, err.cause);
			return c.json(errorBody(err.message, "upstream_error"), err.status);
		}
		log.error(`${c.req.method} ${c.req.path} failed`, err);
		return c.json(errorBody("Internal server error", "internal_error"), 500);
	});

	return route;
}

export type AppType = ReturnType<typeof createApp>;
