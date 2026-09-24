import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env";
import { errorBody } from "./lib/errors";
import { healthRoute } from "./routes/health";

const app = new Hono();

app.use(logger());
app.use(secureHeaders());
app.use(
	"*",
	cors({
		origin: env.DASHBOARD_ORIGIN,
	}),
);

const route = app.route("/health", healthRoute);

app.notFound((c) => {
	return c.json(errorBody("Not found", "not_found"), 404);
});

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return c.json(errorBody(err.message, "http_error"), err.status);
	}
	// biome-ignore lint/suspicious/noConsole: this is the server-side error log
	console.error(err);
	return c.json(errorBody("Internal server error", "internal_error"), 500);
});

export { app };
export type AppType = typeof route;
