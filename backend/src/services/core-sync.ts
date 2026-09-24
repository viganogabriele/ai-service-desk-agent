import type { SQL } from "bun";
import {
	CoreApiError,
	type CoreClient,
	type CoreEvent,
} from "../clients/core/core-client";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import {
	CORE_EVENT_CURSOR,
	getCursor,
	hasWriteback,
	keyForCoreTicket,
	loadTickets,
	markCoreContent,
	recordWriteback,
	setCursor,
	type WritebackTrigger,
} from "../db/store";
import { log } from "../lib/log";
import { writeToJira } from "./jira-sync";
import { ticketPatchSchema } from "./ticket-patch";

const EVENT_CURSOR = CORE_EVENT_CURSOR;

/**
 * Sends open tickets whose content the Core doesn't have yet (CORE_API §6.A).
 * Resolved tickets are left for closure harvesting (API step 2).
 */
export async function pushToCore(
	core: CoreClient,
	sql: SQL,
): Promise<{ pushed: number }> {
	const pending = (await loadTickets(sql)).filter(
		(t) => t.record.Status !== "done" && t.coreContentHash !== t.contentHash,
	);
	for (const ticket of pending) {
		const { Key, ...fields } = ticket.record;
		const { ticketId } = await core.importTicket({
			externalKey: Key,
			contentHash: ticket.contentHash,
			fields,
		});
		await markCoreContent(sql, Key, ticketId, ticket.contentHash);
	}
	return { pushed: pending.length };
}

/** The events the sync layer acts on (CORE_API §6.A step 4 and §8). */
function writebackTrigger(event: CoreEvent): WritebackTrigger | null {
	switch (event.type) {
		case "run.completed":
			return event.payload.lane === "auto_applied" ? "core_auto_applied" : null;
		case "decision.overridden":
			return "core_override";
		case "comment.updated":
			return "core_comment";
		default:
			return null;
	}
}

function isPermanent(error: unknown): error is CoreApiError | JiraApiError {
	return (
		(error instanceof CoreApiError || error instanceof JiraApiError) &&
		error.status < 500
	);
}

async function writeBack(
	core: CoreClient,
	jira: JiraClient,
	sql: SQL,
	event: CoreEvent,
	coreTicketId: string,
	trigger: WritebackTrigger,
): Promise<boolean> {
	const key = await keyForCoreTicket(sql, coreTicketId);
	if (!key) {
		log.warn(
			`Core event ${event.seq}: unknown Core ticket ${coreTicketId}, skipped`,
		);
		return false;
	}
	if (await hasWriteback(sql, event.seq, key)) return false;

	const fail = (error: string) =>
		recordWriteback(sql, {
			externalKey: key,
			trigger,
			coreEventSeq: event.seq,
			requested: {},
			changed: [],
			warnings: [],
			ok: false,
			error,
		});

	try {
		const exported = await core.exportTicket(coreTicketId);
		const patch = ticketPatchSchema.safeParse({ ...exported, Key: key });
		if (!patch.success) {
			await fail(
				`Core export is not a valid ticket record: ${patch.error.message}`,
			);
			return true;
		}
		const [result] = await writeToJira(
			jira,
			sql,
			[patch.data],
			trigger,
			event.seq,
		);
		if (result?.ok) {
			// Jira now holds the Core's own effective state: not a new snapshot for it.
			const [stored] = await loadTickets(sql, key);
			if (stored)
				await markCoreContent(sql, key, coreTicketId, stored.contentHash);
		}
		return true;
	} catch (error) {
		// 4xx can't succeed on retry: log it and move on. Anything else is retried.
		if (!isPermanent(error)) throw error;
		await fail(error.message);
		return true;
	}
}

/** Reads new Core events and writes effective state back to Jira where the contract says so. */
export async function consumeCoreEvents(
	core: CoreClient,
	jira: JiraClient,
	sql: SQL,
): Promise<{ processed: number; writebacks: number }> {
	const after = Number((await getCursor(sql, EVENT_CURSOR)) ?? 0);
	const events = await core.listEvents(after);
	let writebacks = 0;
	for (const event of events) {
		const trigger = writebackTrigger(event);
		if (trigger && event.ticket_id) {
			if (await writeBack(core, jira, sql, event, event.ticket_id, trigger))
				writebacks++;
		}
		await setCursor(sql, EVENT_CURSOR, String(event.seq));
	}
	return { processed: events.length, writebacks };
}
