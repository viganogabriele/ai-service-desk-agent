import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { JiraClient } from "./clients/jira/jira-client";
import { env } from "./env";
import { errorBody } from "./lib/errors";
import { healthRoute } from "./routes/health";
import { createTicketsRoute } from "./routes/tickets";

export function createApp(jira: JiraClient) {
	const app = new Hono();

	app.use(logger());
	app.use(secureHeaders());
	app.use("*", cors({ origin: env.DASHBOARD_ORIGIN }));

	const route = app
		.route("/health", healthRoute)
		.route("/tickets", createTicketsRoute(jira));

	app.notFound((c) => c.json(errorBody("Not found", "not_found"), 404));

	app.onError((err, c) => {
		if (err instanceof HTTPException && err.status < 500) {
			return c.json(errorBody(err.message, "http_error"), err.status);
		}
		// biome-ignore lint/suspicious/noConsole: this is the server-side error log
		console.error(err);
		if (err instanceof HTTPException) {
			return c.json(errorBody(err.message, "upstream_error"), err.status);
		}
		return c.json(errorBody("Internal server error", "internal_error"), 500);
	});

	return route;
}

export type AppType = ReturnType<typeof createApp>;
