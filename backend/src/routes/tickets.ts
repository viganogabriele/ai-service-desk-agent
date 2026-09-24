import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { JiraClient } from "../clients/jira/jira-client";
import { writeToJira } from "../services/jira-sync";
import { ticketPatchBodySchema } from "../services/ticket-patch";
import { storedTicketExport } from "../services/tickets";

export function createTicketsRoute(jira: JiraClient, sql: SQL) {
	return new Hono()
		.get("/", async (c) => c.json(await storedTicketExport(sql)))
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
				const results = await writeToJira(
					jira,
					sql,
					c.req.valid("json"),
					"api",
				);
				return c.json({ results });
			},
		);
}
