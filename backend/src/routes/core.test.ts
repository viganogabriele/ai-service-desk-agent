import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createFakeJiraClient } from "../clients/jira/jira-client.fake";
import { freshDatabase } from "../db/test-db";
import { createSyncer } from "../services/sync";

// Stands in for the Core API server: echoes what it received.
const fakeCoreServer = new Hono()
	.get("/queue", (c) =>
		c.json({ path: c.req.path, lane: c.req.query("lane"), items: [] }),
	)
	.post("/tickets/:id/overrides", async (c) =>
		c.json({ id: c.req.param("id"), body: await c.req.json() }, 201),
	)
	.post("/tickets/:id/accept", (c) =>
		c.json(
			{ error: "conflict", message: "stale base_run_id", details: {} },
			409,
		),
	);

async function setup(
	{ baseUrl }: { baseUrl: string | undefined } = {
		baseUrl: "http://core.local",
	},
) {
	const sql = await freshDatabase();
	const jira = createFakeJiraClient();
	const requests: string[] = [];
	const app = createApp({
		jira,
		sql,
		syncer: createSyncer(jira, null, sql),
		core: {
			baseUrl,
			fetch: (request) => {
				requests.push(`${request.method} ${request.url}`);
				return Promise.resolve(fakeCoreServer.fetch(request));
			},
		},
	});
	return { app, requests };
}

describe("/core proxy", () => {
	it("forwards reads with their query string", async () => {
		const { app, requests } = await setup();
		const res = await app.request("/core/queue?lane=needs_review&sort=risk");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			path: "/queue",
			lane: "needs_review",
			items: [],
		});
		expect(requests).toEqual([
			"GET http://core.local/queue?lane=needs_review&sort=risk",
		]);
	});

	it("forwards review actions with their body and the Core's own status", async () => {
		const { app } = await setup();
		const override = {
			base_run_id: "r-1",
			actor: "bia",
			changes: [
				{
					field: "service",
					value: "Tax Reporting",
					reason_code: "wrong_service",
				},
			],
			force: false,
		};
		const res = await app.request("/core/tickets/t-1/overrides", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(override),
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: "t-1", body: override });
	});

	it("passes Core errors through unchanged", async () => {
		const { app } = await setup();
		const res = await app.request("/core/tickets/t-1/accept", {
			method: "POST",
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ error: "conflict" });
	});

	it("keeps ingestion endpoints for the backend's own sync", async () => {
		const { app, requests } = await setup();
		for (const path of [
			"/core/tickets",
			"/core/batches",
			"/core/tickets/t-1/closure",
		]) {
			const res = await app.request(path, { method: "POST", body: "{}" });
			expect(res.status).toBe(403);
		}
		expect(requests).toEqual([]);
	});

	it("answers 503 while the Core is not configured", async () => {
		const { app } = await setup({ baseUrl: undefined });
		const res = await app.request("/core/queue");
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			error: {
				message: "The Core is not configured (CORE_BASE_URL)",
				code: "upstream_error",
			},
		});
	});
});
