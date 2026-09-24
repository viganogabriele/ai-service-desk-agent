import type { SQL } from "bun";
import type { JiraClient } from "../clients/jira/jira-client";
import {
	getCursor,
	JIRA_SYNC_CURSOR,
	keepCoreContent,
	markCoreContent,
	recordWriteback,
	setCursor,
	upsertSnapshot,
	type WritebackTrigger,
} from "../db/store";
import {
	applyTicketPatch,
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

const writes = new WeakMap<JiraClient, Map<string, Promise<void>>>();

// API requests and the sync loop share the same client and per-ticket queue.
async function serialWrite<T>(
	jira: JiraClient,
	key: string,
	write: () => Promise<T>,
): Promise<T> {
	let pending = writes.get(jira);
	if (!pending) {
		pending = new Map();
		writes.set(jira, pending);
	}
	const run = (pending.get(key) ?? Promise.resolve()).then(write);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	pending.set(key, settled);
	try {
		return await run;
	} finally {
		if (pending.get(key) === settled) pending.delete(key);
	}
}

/** Each ticket is written, refreshed and logged independently of the other batch items. */
export async function writeToJira(
	jira: JiraClient,
	sql: SQL,
	patches: readonly TicketPatch[],
	trigger: WritebackTrigger,
	coreEventSeq: number | null = null,
	coreTicketId: string | null = null,
): Promise<TicketPatchResult[]> {
	const results: TicketPatchResult[] = new Array(patches.length);
	const errors: unknown[] = [];
	let next = 0;

	async function write(patch: TicketPatch): Promise<TicketPatchResult> {
		const entry = {
			externalKey: patch.Key,
			trigger,
			coreEventSeq,
			requested: patch,
		};
		let result: TicketPatchResult | undefined;
		try {
			result = await applyTicketPatch(jira, patch, {
				derivePriority: trigger === "api",
			});
			if (result.ok) {
				const snapshot = await refreshTicket(jira, sql, result.key);
				if (coreTicketId)
					await markCoreContent(
						sql,
						result.key,
						coreTicketId,
						snapshot.contentHash,
					);
				else if (trigger === "api")
					await keepCoreContent(sql, result.key, snapshot.contentHash);
			}
		} catch (error) {
			await recordWriteback(sql, {
				...entry,
				changed: result?.ok ? result.changed : [],
				warnings: result?.warnings ?? [],
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		await recordWriteback(sql, {
			...entry,
			changed: result.ok ? result.changed : [],
			warnings: result.warnings,
			ok: result.ok,
			error: result.ok ? null : result.error,
		});
		return result;
	}

	async function worker() {
		while (next < patches.length) {
			const index = next++;
			const patch = patches[index];
			if (!patch) continue;
			try {
				results[index] = await serialWrite(jira, patch.Key, () => write(patch));
			} catch (error) {
				errors.push(error);
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(5, patches.length) }, worker),
	);
	if (errors.length > 0) throw errors[0];
	return results;
}
