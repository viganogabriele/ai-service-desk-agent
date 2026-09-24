import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CoreApiError } from "../clients/core/core-client";
import { JiraApiError } from "../clients/jira/jira-client";
import type { Syncer } from "../services/sync";

export function createSyncRoute(syncer: Syncer) {
	return new Hono().post("/", async (c) => {
		try {
			return c.json(await syncer.syncNow());
		} catch (error) {
			if (error instanceof JiraApiError || error instanceof CoreApiError) {
				const upstream = error instanceof JiraApiError ? "Jira" : "the Core";
				throw new HTTPException(502, {
					message: `Sync failed: ${upstream} returned ${error.status}`,
					cause: error,
				});
			}
			throw error;
		}
	});
}
