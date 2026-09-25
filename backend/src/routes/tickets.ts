import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { JiraClient } from "../clients/jira/jira-client";
import type { Auth } from "../services/auth";
import { writeToJira } from "../services/jira-sync";
import { ticketPatchBodySchema } from "../services/ticket-patch";
import { storedTicketExport } from "../services/tickets";
import { SESSION_COOKIE } from "./auth";

/** With sign-in configured, writes act as the signed-in user; otherwise as JIRA_API_TOKEN. */
export function createTicketsRoute(
	jira: JiraClient,
	sql: SQL,
	auth: Auth | null = null,
) {
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
				const writer = auth ? auth.jira(getCookie(c, SESSION_COOKIE)) : jira;
				if (!writer)
					throw new HTTPException(401, {
						message: "Sign in with Atlassian to change tickets",
					});
				const results = await writeToJira(
					writer,
					sql,
					c.req.valid("json"),
					"api",
				);
				return c.json({ results });
			},
		);
}
