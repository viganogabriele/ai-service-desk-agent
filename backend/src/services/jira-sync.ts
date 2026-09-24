import type { SQL } from "bun";
import type { JiraClient } from "../clients/jira/jira-client";
import {
	getCursor,
	JIRA_SYNC_CURSOR,
	recordWriteback,
	setCursor,
	upsertSnapshot,
	type WritebackTrigger,
} from "../db/store";
import {
	applyTicketPatches,
	type TicketPatch,
	type TicketPatchResult,
} from "./ticket-patch";
import {
	isTicket,
	TICKET_FIELDS,
	TICKETS_JQL,
	type TicketSnapshot,
	toSnapshot,
} from "./tickets";

const CURSOR = JIRA_SYNC_CURSOR;
// Re-read a few minutes before the last sync, so clock skew never loses a change.
const OVERLAP_MINUTES = 5;

/** Copies tickets changed since the last sync (all of them the first time) into Postgres. */
export async function syncFromJira(
	jira: JiraClient,
	sql: SQL,
	now = new Date(),
): Promise<{ upserted: number }> {
	const last = await getCursor(sql, CURSOR);
	let jql = TICKETS_JQL;
	if (last) {
		// Relative dates avoid depending on the Jira user's time zone.
		const minutes =
			Math.ceil((now.getTime() - Date.parse(last)) / 60_000) + OVERLAP_MINUTES;
		jql += ` AND updated >= "-${minutes}m"`;
	}
	const issues = (
		await jira.searchIssues(`${jql} ORDER BY updated ASC`, TICKET_FIELDS)
	).filter(isTicket);
	for (const issue of issues) await upsertSnapshot(sql, toSnapshot(issue));
	await setCursor(sql, CURSOR, now.toISOString());
	return { upserted: issues.length };
}

/** Re-reads one ticket from Jira, e.g. right after writing to it. */
export async function refreshTicket(
	jira: JiraClient,
	sql: SQL,
	key: string,
): Promise<TicketSnapshot> {
	const snapshot = toSnapshot(await jira.getIssue(key, TICKET_FIELDS));
	await upsertSnapshot(sql, snapshot);
	return snapshot;
}

/** Writes patches to Jira, logs each write and refreshes the stored copies. */
export async function writeToJira(
	jira: JiraClient,
	sql: SQL,
	patches: readonly TicketPatch[],
	trigger: WritebackTrigger,
	coreEventSeq: number | null = null,
): Promise<TicketPatchResult[]> {
	const results = await applyTicketPatches(jira, patches);
	for (const [i, result] of results.entries()) {
		await recordWriteback(sql, {
			externalKey: result.key,
			trigger,
			coreEventSeq,
			requested: patches[i],
			changed: result.ok ? result.changed : [],
			warnings: result.warnings,
			ok: result.ok,
			error: result.ok ? null : result.error,
		});
		if (result.ok) await refreshTicket(jira, sql, result.key);
	}
	return results;
}
