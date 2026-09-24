import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { proxy } from "hono/proxy";
import { isIngestion } from "../services/core-proxy";

export type CoreProxyConfig = {
	baseUrl: string | undefined;
	/** Replaces fetch, so tests can answer as the Core without a server. */
	fetch?: (request: Request) => Promise<Response>;
};

/** Passes UI calls through to the Core API (CORE_API.md §7), unchanged. */
export function createCoreRoute(config: CoreProxyConfig) {
	return new Hono().all("/*", async (c) => {
		if (!config.baseUrl) {
			throw new HTTPException(503, {
				message: "The Core is not configured (CORE_BASE_URL)",
			});
		}
		const path = c.req.path.replace(/^\/core/, "") || "/";
		if (isIngestion(c.req.method, path)) {
			throw new HTTPException(403, {
				message:
					"Tickets reach the Core through the backend's Jira sync, not the UI",
			});
		}
		const target = `${config.baseUrl.replace(/\/+$/, "")}${path}${new URL(c.req.url).search}`;
		return proxy(target, {
			...c.req,
			headers: { ...c.req.header(), host: undefined },
			...(config.fetch ? { customFetch: config.fetch } : {}),
		});
	});
}
