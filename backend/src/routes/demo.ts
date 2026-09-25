import type { SQL } from "bun";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CoreApiError, type CoreClient } from "../clients/core/core-client";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import { createDemoTicket, DemoTicketError } from "../services/demo";
import type { Syncer } from "../services/sync";

export function createDemoRoute(
	jira: JiraClient,
	sql: SQL,
	syncer: Syncer,
	core: CoreClient | null,
) {
	return new Hono().post("/tickets", async (c) => {
		if (!core) {
			throw new HTTPException(503, {
				message: "The Core is not configured (CORE_BASE_URL)",
			});
		}
		try {
			return c.json(await createDemoTicket(core, jira, sql, syncer), 201);
		} catch (error) {
			if (error instanceof JiraApiError || error instanceof CoreApiError) {
				const upstream = error instanceof JiraApiError ? "Jira" : "the Core";
				throw new HTTPException(502, {
					message: `Demo ticket failed: ${upstream} returned ${error.status}`,
					cause: error,
				});
			}
			if (error instanceof DemoTicketError) {
				throw new HTTPException(502, { message: error.message, cause: error });
			}
			throw error;
		}
	});
}
