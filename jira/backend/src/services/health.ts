export type HealthStatus = {
	status: "ok";
	uptimeSeconds: number;
};

const startedAt = Date.now();

export function getHealthStatus(): HealthStatus {
	return {
		status: "ok",
		uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
	};
}
