import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("GET /health", () => {
	it("returns ok status and uptime", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			uptimeSeconds: number;
		};
		expect(body).toMatchObject({ status: "ok" });
		expect(typeof body.uptimeSeconds).toBe("number");
	});
});

describe("unknown route", () => {
	it("returns the consistent error shape", async () => {
		const res = await app.request("/does-not-exist");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({
			error: { message: "Not found", code: "not_found" },
		});
	});
});
