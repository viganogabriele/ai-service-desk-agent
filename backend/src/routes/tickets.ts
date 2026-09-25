import { zValidator } from "@hono/zod-validator";
import type { SQL } from "bun";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { JiraClient } from "../clients/jira/jira-client";
import { type Auth, writerFor } from "../services/auth";
import { writeToJira } from "../services/jira-sync";
import { ticketPatchBodySchema } from "../services/ticket-patch";
import { storedTicketExport } from "../services/tickets";
import { SESSION_COOKIE } from "./auth";

/** Writes act as the signed-in Atlassian user, else as the shared JIRA_API_TOKEN account. */
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
				const writer = writerFor(
					auth,
					jira,
					getCookie(c, SESSION_COOKIE),
					c.req.header("X-Atlassian-Account-Id"),
				);
				if (!writer.ok)
					throw writer.reason === "session_expired"
						? new HTTPException(401, {
								message:
									"Your session expired. Sign in again or review the change before using the shared account.",
							})
						: new HTTPException(409, {
								message:
									"The signed-in account changed. Review the change and try again.",
							});
				const results = await writeToJira(
					writer.jira,
					sql,
					c.req.valid("json"),
					"api",
				);
				return c.json({ results });
			},
		);
}
