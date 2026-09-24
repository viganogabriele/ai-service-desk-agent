import type { SQL } from "bun";
import { Hono } from "hono";
import { getHealthStatus } from "../services/health";

export function createHealthRoute(sql: SQL, coreConfigured: boolean) {
	return new Hono().get("/", async (c) =>
		c.json(await getHealthStatus(sql, coreConfigured)),
	);
}
