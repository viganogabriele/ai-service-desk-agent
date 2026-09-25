import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { CoreApiError } from "../clients/core/core-client";
import { JiraApiError } from "../clients/jira/jira-client";
import type { Syncer } from "../services/sync";

/** `?full=true` re-reads every ticket and removes those deleted from Jira right away. */
const syncQuery = z.object({ full: z.enum(["true", "false"]).optional() });

export function createSyncRoute(syncer: Syncer) {
	return new Hono().post("/", zValidator("query", syncQuery), async (c) => {
		try {
			return c.json(
				await syncer.syncNow({ full: c.req.valid("query").full === "true" }),
			);
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
