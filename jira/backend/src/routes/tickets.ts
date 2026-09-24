import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import {
	applyTicketPatches,
	ticketPatchBodySchema,
} from "../services/ticket-patch";
import { exportTickets } from "../services/tickets";

export function createTicketsRoute(jira: JiraClient) {
	return new Hono()
		.get("/", async (c) => {
			try {
				return c.json(await exportTickets(jira));
			} catch (error) {
				if (error instanceof JiraApiError) {
					throw new HTTPException(502, {
						message: "Reading tickets from Jira failed",
						cause: error,
					});
				}
				throw error;
			}
		})
		.post(
			"/",
			zValidator("json", ticketPatchBodySchema, (result) => {
				if (!result.success) {
					const issues = result.error.issues
						.map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
						.join("; ");
					throw new HTTPException(400, {
						message: `Invalid ticket patch: ${issues}`,
					});
				}
			}),
			async (c) => {
				const results = await applyTicketPatches(jira, c.req.valid("json"));
				return c.json({ results });
			},
		);
}
