import { testClient } from "hono/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { testBackend } from "./db/test-db";

let backend: Awaited<ReturnType<typeof testBackend>>;
beforeEach(async () => {
	backend = await testBackend();
});

describe("GET /health", () => {
	it("reports uptime, database and Core status", async () => {
		const res = await testClient(backend.app).health.$get();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			status: "ok",
			database: "ok",
			core: "not_configured",
		});
		expect(typeof body.uptimeSeconds).toBe("number");
	});
});

describe("unknown route", () => {
	it("returns the consistent error shape", async () => {
		const res = await backend.app.request("/does-not-exist");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { message: "Not found", code: "not_found" },
		});
	});
});
