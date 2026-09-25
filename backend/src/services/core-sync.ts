import { createHash } from "node:crypto";
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
	markCoreClosure,
	markCoreContent,
	recordWriteback,
	setCursor,
	type WritebackTrigger,
} from "../db/store";
import { isRetryableStatus } from "../lib/errors";
import { log } from "../lib/log";
import { writeToJira } from "./jira-sync";
import { ticketPatchSchema } from "./ticket-patch";
import type { TicketRecord } from "./tickets";

const EVENT_CURSOR = CORE_EVENT_CURSOR;

/**
 * Sends open tickets whose content the Core doesn't have yet (CORE_API §6.A).
 * Resolved tickets reach the Core as closures instead (sendClosures).
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

/** The Core actor the backend's own writes are recorded as. */
const SYNC_ACTOR = "jira-sync";

// "<resolver>: Resolution: …", as in the dataset, the Core's comments and the dashboard's.
const RESOLUTION_COMMENT = /^(?:(\S+@\S+): )?(Resolution: [\s\S]+)$/;

/** The latest resolution note on a ticket and who wrote it (else the assignee). */
export function closureOf(record: TicketRecord) {
	for (const comment of [...record["All Comments"]].reverse()) {
		const match = RESOLUTION_COMMENT.exec(comment.trim());
		if (match?.[2])
			return {
				resolutionNote: match[2],
				resolver: match[1] ?? record.Assignee,
			};
	}
	return { resolutionNote: null, resolver: record.Assignee };
}

/**
 * Sends the outcome of tickets resolved as done to the Core for harvesting (CORE_API
 * §6C.2), once per note and resolver. Other resolutions carry no fix to learn from.
 */
export async function sendClosures(
	core: CoreClient,
	sql: SQL,
): Promise<{ closed: number }> {
	let closed = 0;
	for (const ticket of await loadTickets(sql)) {
		const { Key, ...fields } = ticket.record;
		if (!ticket.coreTicketId || fields.Status !== "done") continue;
		if (fields.Resolution !== "done") continue;
		const closure = closureOf(ticket.record);
		const closureKey = createHash("sha256")
			.update(JSON.stringify([closure.resolutionNote, closure.resolver]))
			.digest("hex");
		if (closureKey === ticket.coreClosureKey) continue;
		try {
			await core.closeTicket(ticket.coreTicketId, {
				fields,
				...closure,
				actor: SYNC_ACTOR,
			});
			closed++;
		} catch (error) {
			if (!isPermanent(error)) throw error;
			log.warn(`Closure of ${Key} refused, not retried: ${error.message}`);
		}
		await markCoreClosure(sql, Key, closureKey);
	}
	return { closed };
}

/**
 * The Core actor the dashboard records its decisions as, after writing them to
 * Jira itself: "dashboard", or "dashboard:<email>" for a signed-in user.
 */
export const DASHBOARD_ACTOR = "dashboard";

function isDashboard(actor: unknown): boolean {
	return (
		typeof actor === "string" &&
		(actor === DASHBOARD_ACTOR || actor.startsWith(`${DASHBOARD_ACTOR}:`))
	);
}

/** The events the sync layer acts on (CORE_API §6.A step 4 and §8). */
function writebackTrigger(event: CoreEvent): WritebackTrigger | null {
	switch (event.type) {
		case "run.completed":
			return event.payload.lane === "auto_applied" ? "core_auto_applied" : null;
		case "decision.overridden":
			// Already in Jira: exporting would also push the AI's other fields, e.g. Resolution.
			return isDashboard(event.payload.actor) ? null : "core_override";
		case "comment.updated":
			// Without an origin the comment only went stale; there is no new text to write.
			return event.payload.origin ? "core_comment" : null;
		default:
			return null;
	}
}

function isPermanent(error: unknown): error is CoreApiError | JiraApiError {
	return (
		(error instanceof CoreApiError || error instanceof JiraApiError) &&
		!isRetryableStatus(error.status)
	);
}

const STATE_EVENTS = new Set([
	"ticket.imported",
	"run.started",
	"run.completed",
	"decision.overridden",
	"comment.updated",
]);

/** Check after exporting: even events published during the export invalidate an older write. */
async function isSuperseded(
	core: CoreClient,
	event: CoreEvent,
): Promise<boolean> {
	let after = event.seq;
	for (;;) {
		const page = await core.listEvents(after);
		if (
			page.some(
				(next) =>
					next.ticket_id === event.ticket_id && STATE_EVENTS.has(next.type),
			)
		)
			return true;
		const last = page.at(-1);
		if (!last) return false;
		if (last.seq <= after)
			throw new Error("Core event pagination did not advance");
		after = last.seq;
	}
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
		if (await isSuperseded(core, event)) return false;
		// The status is Jira's workflow; the Core's snapshot of it may be stale.
		const { Status: _status, ...record } = exported;
		const patch = ticketPatchSchema.safeParse({ ...record, Key: key });
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
			coreTicketId,
		);
		if (result && !result.ok && result.retryable) throw new Error(result.error);
		return true;
	} catch (error) {
		// Validation and missing-resource errors are terminal; throttling and outages retry.
		if (!isPermanent(error)) throw error;
		// writeToJira already recorded Jira failures, including any changes before a failed refresh.
		if (error instanceof CoreApiError) await fail(error.message);
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
