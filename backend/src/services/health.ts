import type { SQL } from "bun";

export type HealthStatus = {
	status: "ok" | "degraded";
	uptimeSeconds: number;
	database: "ok" | "unreachable";
	core: "configured" | "not_configured";
};

const startedAt = Date.now();

export async function getHealthStatus(
	sql: SQL,
	coreConfigured: boolean,
): Promise<HealthStatus> {
	const database = await sql`SELECT 1`.then(
		() => "ok" as const,
		() => "unreachable" as const,
	);
	return {
		status: database === "ok" ? "ok" : "degraded",
		uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
		database,
		core: coreConfigured ? "configured" : "not_configured",
	};
}
