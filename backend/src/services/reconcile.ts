import type { SQL } from "bun";
import { CoreApiError, type CoreClient } from "../clients/core/core-client";
import { JIRA_PROJECT_KEY } from "../clients/jira/field-config";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import {
	deleteTicket,
	type StoredTicketRef,
	storedTicketRefs,
} from "../db/store";
import { forEachConcurrent } from "../lib/concurrency";
import { log } from "../lib/log";
import { isTicket, TICKETS_JQL } from "./tickets";

// Lookups of different tickets are independent; Jira throttles well above this.
const LOOKUP_CONCURRENCY = 5;

/**
 * Whether Jira still has this stored ticket as a ticket of the project. A ticket missing
 * from the search can still exist, since Jira's search index lags behind its writes, so
 * each one is looked up by its id; a move to another project changes its key. Only a 404
 * counts as deleted: other errors are rethrown.
 */
async function stillInJira(
	jira: JiraClient,
	ticket: StoredTicketRef,
): Promise<boolean> {
	try {
		const issue = await jira.getIssue(ticket.jiraId, ["issuetype"]);
		return isTicket(issue) && issue.key.startsWith(`${JIRA_PROJECT_KEY}-`);
	} catch (error) {
		if (error instanceof JiraApiError && error.status === 404) return false;
		throw error;
	}
}

async function deleteFromCore(core: CoreClient, ticketId: string) {
	try {
		await core.deleteTicket(ticketId);
	} catch (error) {
		if (!(error instanceof CoreApiError && error.status === 404)) throw error;
	}
}

/**
 * Removes every stored ticket that Jira no longer has (deleted, moved to another project or
 * retyped), from the Core first and then from Postgres, so a failure never loses the Core
 * id. Then removes the Core tickets that Postgres doesn't have. Incremental syncs only see
 * issues that still exist, so this is the only way a deletion in Jira reaches either store.
 */
export async function reconcileWithJira(
	jira: JiraClient,
	core: CoreClient | null,
	sql: SQL,
): Promise<{ postgres: number; core: number }> {
	const inJira = new Set(
		(await jira.searchIssues(TICKETS_JQL, ["issuetype"]))
			.filter(isTicket)
			.map((issue) => issue.key),
	);
	const stored = await storedTicketRefs(sql);
	// An empty project more likely means a token that lost access than a wiped project.
	if (inJira.size === 0 && stored.length > 0) {
		log.warn(
			`Jira returned no ${JIRA_PROJECT_KEY} tickets; keeping the ${stored.length} stored ones`,
		);
		return { postgres: 0, core: 0 };
	}

	const gone: StoredTicketRef[] = [];
	await forEachConcurrent(
		stored.filter((ticket) => !inJira.has(ticket.key)),
		LOOKUP_CONCURRENCY,
		async (ticket) => {
			if (!(await stillInJira(jira, ticket))) gone.push(ticket);
		},
	);
	for (const ticket of gone) {
		if (core && ticket.coreTicketId)
			await deleteFromCore(core, ticket.coreTicketId);
		await deleteTicket(sql, ticket.key);
	}

	if (!core) return { postgres: gone.length, core: 0 };

	// Listed before reading Postgres: the Core only gets tickets Postgres already has.
	const inCore = await core.listTickets();
	const kept = new Set((await storedTicketRefs(sql)).map((t) => t.key));
	const orphans = inCore.filter((t) => !kept.has(t.externalKey));
	for (const orphan of orphans) await deleteFromCore(core, orphan.ticketId);

	const coreRemoved =
		gone.filter((t) => t.coreTicketId).length + orphans.length;
	if (gone.length > 0 || coreRemoved > 0)
		log.info(
			`Removed ${gone.length} tickets deleted from Jira, ${coreRemoved} from the Core`,
		);
	return { postgres: gone.length, core: coreRemoved };
}
