import type { SQL } from "bun";
import type { FieldMapping } from "../clients/jira/field-config";
import type {
	TicketRecord,
	TicketSnapshot,
	TicketStatus,
	WorkType,
} from "../services/tickets";

// Plain queries over the tables in db/migrations. No business logic here.

type TicketRow = {
	external_key: string;
	work_type: WorkType;
	request_type: string | null;
	summary: string;
	description: string;
	affected_services: string[];
	business_entities: string[];
	business_critical_entities: string[];
	service_teams: string[];
	reporter: string | null;
	assignee: string | null;
	priority: string | null;
	urgency: string | null;
	impact: string | null;
	severity: string | null;
	created_date: Date | null;
	status: TicketStatus;
	linked_issues: string[];
	resolution: TicketRecord["Resolution"];
	due_date: Date | null;
	resolution_date: Date | null;
	comments: string[];
	content_hash: string;
	core_ticket_id: string | null;
	core_content_hash: string | null;
	core_closure_key: string | null;
};

export type StoredTicket = {
	record: TicketRecord;
	contentHash: string;
	coreTicketId: string | null;
	coreContentHash: string | null;
	coreClosureKey: string | null;
};

// timestamp without time zone comes back as a Date read as UTC.
function formatDate(value: Date | null): string | null {
	return value ? value.toISOString().slice(0, 16).replace("T", " ") : null;
}

function toStored(row: TicketRow): StoredTicket {
	return {
		record: {
			Key: row.external_key,
			"Work type": row.work_type,
			"Request type": row.request_type,
			Summary: row.summary,
			Description: row.description,
			"Affected Business or IT Services": row.affected_services,
			"Business Entity": row.business_entities,
			"Business Critical for Entity": row.business_critical_entities,
			"Service Team(s)": row.service_teams,
			Reporter: row.reporter,
			Assignee: row.assignee,
			Priority: row.priority,
			Urgency: row.urgency,
			Impact: row.impact,
			Severity: row.severity,
			"Created date": formatDate(row.created_date),
			Status: row.status,
			"Linked issues": row.linked_issues,
			Resolution: row.resolution,
			"Due date": formatDate(row.due_date),
			"Resolution date": formatDate(row.resolution_date),
			"All Comments": row.comments,
		},
		contentHash: row.content_hash,
		coreTicketId: row.core_ticket_id,
		coreContentHash: row.core_content_hash,
		coreClosureKey: row.core_closure_key,
	};
}

export async function loadTickets(
	sql: SQL,
	key?: string,
): Promise<StoredTicket[]> {
	const rows: TicketRow[] = await sql`
		SELECT t.external_key, t.work_type, t.request_type, t.summary, t.description,
		       t.affected_services, t.business_entities, t.business_critical_entities,
		       t.service_teams, t.reporter, t.assignee, t.priority, t.urgency, t.impact,
		       t.severity, t.created_date, t.status, t.linked_issues, t.resolution,
		       t.due_date, t.resolution_date, t.content_hash, t.core_ticket_id,
		       t.core_content_hash, t.core_closure_key,
		       COALESCE((SELECT array_agg(c.body ORDER BY c.created_at, c.jira_comment_id)
		                 FROM ticket_comments c
		                 WHERE c.external_key = t.external_key AND c.is_public), '{}') AS comments
		FROM tickets t
		WHERE ${key ?? null}::text IS NULL OR t.external_key = ${key ?? null}
		ORDER BY t.created_date NULLS LAST, t.jira_id::bigint`;
	return rows.map(toStored);
}

export async function upsertSnapshot(
	sql: SQL,
	s: TicketSnapshot,
): Promise<void> {
	const r = s.record;
	const text = (values: string[]) => sql.array(values, "text");
	await sql.begin(async (tx) => {
		await tx`
			INSERT INTO tickets (
				external_key, jira_id, work_type, request_type, summary, description,
				affected_services, business_entities, business_critical_entities, service_teams,
				reporter, assignee, priority, urgency, impact, severity, created_date, status,
				linked_issues, resolution, due_date, resolution_date,
				jira_status, raw, content_hash, jira_updated_at, synced_at
			) VALUES (
				${r.Key}, ${s.jiraId}, ${r["Work type"]}, ${r["Request type"]}, ${r.Summary},
				${r.Description}, ${text(r["Affected Business or IT Services"])},
				${text(r["Business Entity"])}, ${text(r["Business Critical for Entity"])},
				${text(r["Service Team(s)"])}, ${r.Reporter}, ${r.Assignee}, ${r.Priority},
				${r.Urgency}, ${r.Impact}, ${r.Severity}, ${r["Created date"]}, ${r.Status},
				${text(r["Linked issues"])}, ${r.Resolution}, ${r["Due date"]},
				${r["Resolution date"]}, ${s.jiraStatus}, ${s.raw}, ${s.contentHash},
				${s.jiraUpdatedAt}, now()
			)
			ON CONFLICT (external_key) DO UPDATE SET
				jira_id = EXCLUDED.jira_id,
				work_type = EXCLUDED.work_type,
				request_type = EXCLUDED.request_type,
				summary = EXCLUDED.summary,
				description = EXCLUDED.description,
				affected_services = EXCLUDED.affected_services,
				business_entities = EXCLUDED.business_entities,
				business_critical_entities = EXCLUDED.business_critical_entities,
				service_teams = EXCLUDED.service_teams,
				reporter = EXCLUDED.reporter,
				assignee = EXCLUDED.assignee,
				priority = EXCLUDED.priority,
				urgency = EXCLUDED.urgency,
				impact = EXCLUDED.impact,
				severity = EXCLUDED.severity,
				created_date = EXCLUDED.created_date,
				status = EXCLUDED.status,
				linked_issues = EXCLUDED.linked_issues,
				resolution = EXCLUDED.resolution,
				due_date = EXCLUDED.due_date,
				resolution_date = EXCLUDED.resolution_date,
				jira_status = EXCLUDED.jira_status,
				raw = EXCLUDED.raw,
				content_hash = EXCLUDED.content_hash,
				jira_updated_at = EXCLUDED.jira_updated_at,
				synced_at = now()`;

		const ids = s.comments.map((c) => c.id);
		await tx`
			DELETE FROM ticket_comments
			WHERE external_key = ${r.Key} AND NOT (jira_comment_id = ANY(${text(ids)}))`;
		for (const c of s.comments) {
			await tx`
				INSERT INTO ticket_comments
					(jira_comment_id, external_key, author, body, is_public, created_at, updated_at)
				VALUES (${c.id}, ${r.Key}, ${c.author}, ${c.body}, ${c.isPublic},
				        ${c.createdAt}, ${c.updatedAt})
				ON CONFLICT (jira_comment_id) DO UPDATE SET
					author = EXCLUDED.author, body = EXCLUDED.body,
					is_public = EXCLUDED.is_public, updated_at = EXCLUDED.updated_at`;
		}
	});
}

/** Records that the Core now holds this content (sent to it, or produced by it). */
export async function markCoreContent(
	sql: SQL,
	key: string,
	coreTicketId: string,
	hash: string,
): Promise<void> {
	await sql`
		UPDATE tickets SET core_ticket_id = ${coreTicketId}, core_content_hash = ${hash}
		WHERE external_key = ${key}`;
}

/** Records the closure (resolution note and resolver) last sent to the Core. */
export async function markCoreClosure(
	sql: SQL,
	key: string,
	closureKey: string,
): Promise<void> {
	await sql`
		UPDATE tickets SET core_closure_key = ${closureKey} WHERE external_key = ${key}`;
}

/**
 * After a human edit through the API: the Core gets the decision as overrides,
 * so the edited content must not be re-imported and re-triaged.
 */
export async function keepCoreContent(
	sql: SQL,
	key: string,
	hash: string,
): Promise<void> {
	await sql`
		UPDATE tickets SET core_content_hash = ${hash}
		WHERE external_key = ${key} AND core_ticket_id IS NOT NULL`;
}

export async function keyForCoreTicket(
	sql: SQL,
	coreTicketId: string,
): Promise<string | null> {
	const [row] = await sql`
		SELECT external_key FROM tickets WHERE core_ticket_id = ${coreTicketId}`;
	return (row as { external_key: string } | undefined)?.external_key ?? null;
}

export type WritebackTrigger =
	| "core_auto_applied"
	| "core_override"
	| "core_comment"
	| "api";

export type Writeback = {
	externalKey: string;
	trigger: WritebackTrigger;
	coreEventSeq: number | null;
	requested: unknown;
	changed: string[];
	warnings: string[];
	ok: boolean;
	error: string | null;
};

export async function recordWriteback(sql: SQL, w: Writeback): Promise<void> {
	await sql`
		INSERT INTO writebacks
			(external_key, trigger, core_event_seq, requested, changed, warnings, ok, error)
		VALUES (${w.externalKey}, ${w.trigger}, ${w.coreEventSeq}, ${w.requested},
		        ${sql.array(w.changed, "text")}, ${sql.array(w.warnings, "text")},
		        ${w.ok}, ${w.error})
		ON CONFLICT (core_event_seq, external_key) WHERE core_event_seq IS NOT NULL
		DO UPDATE SET requested = EXCLUDED.requested, changed = EXCLUDED.changed,
			warnings = EXCLUDED.warnings, ok = EXCLUDED.ok, error = EXCLUDED.error
		WHERE NOT writebacks.ok`;
}

export async function hasWriteback(
	sql: SQL,
	coreEventSeq: number,
	key: string,
): Promise<boolean> {
	const rows = await sql`
		SELECT 1 FROM writebacks
		WHERE core_event_seq = ${coreEventSeq} AND external_key = ${key} AND ok`;
	return rows.length > 0;
}

export const JIRA_SYNC_CURSOR = "jira.last_sync_started";
export const CORE_EVENT_CURSOR = "core.last_event_seq";

export async function getCursor(
	sql: SQL,
	name: string,
): Promise<string | null> {
	const [row] = await sql`SELECT value FROM sync_state WHERE name = ${name}`;
	return (row as { value: string } | undefined)?.value ?? null;
}

export async function setCursor(
	sql: SQL,
	name: string,
	value: string,
): Promise<void> {
	await sql`
		INSERT INTO sync_state (name, value, updated_at) VALUES (${name}, ${value}, now())
		ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function saveFieldMap(
	sql: SQL,
	map: readonly FieldMapping[],
): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`DELETE FROM jira_field_map`;
		for (const m of map) {
			await tx`
				INSERT INTO jira_field_map (record_field, jira_field_id, jira_type, writable)
				VALUES (${m.recordField}, ${m.jiraFieldId}, ${m.jiraType}, ${m.writable})`;
		}
	});
}
