import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createFakeJiraClient } from "./clients/jira/jira-client.fake";

const app = createApp(createFakeJiraClient());

describe("GET /health", () => {
	it("returns ok status and uptime", async () => {
		const res = await testClient(app).health.$get();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(typeof body.uptimeSeconds).toBe("number");
	});
});

describe("unknown route", () => {
	it("returns the consistent error shape", async () => {
		const res = await app.request("/does-not-exist");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { message: "Not found", code: "not_found" },
		});
	});
});
