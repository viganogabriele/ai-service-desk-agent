import { createHash } from "node:crypto";
import type { SQL } from "bun";
import { adfToText } from "../clients/jira/adf";
import {
	type ChallengeResolution,
	JIRA_FIELDS,
	JIRA_PROJECT_KEY,
	toChallengeResolution,
} from "../clients/jira/field-config";
import type { JiraIssue, JiraOption } from "../clients/jira/jira-client";
import { optionLabel, toChallengeLevel } from "../clients/jira/matching";
import { getCursor, JIRA_SYNC_CURSOR, loadTickets } from "../db/store";

export type WorkType = "Incident" | "Service Request";
export type TicketStatus = "open" | "in progress" | "done";

/** Same keys as the records in jira/data/challenge_blind.json, plus the Jira `Key`. */
export type TicketRecord = {
	Key: string;
	"Work type": WorkType;
	"Request type": string | null;
	Summary: string;
	Description: string;
	"Affected Business or IT Services": string[];
	"Business Entity": string[];
	"Business Critical for Entity": string[];
	"Service Team(s)": string[];
	Reporter: string | null;
	Assignee: string | null;
	Priority: string | null;
	Urgency: string | null;
	Impact: string | null;
	Severity: string | null;
	"Created date": string | null;
	Status: TicketStatus;
	"Linked issues": string[];
	Resolution: ChallengeResolution | null;
	"Due date": string | null;
	"Resolution date": string | null;
	"All Comments": string[];
};

export const TICKET_FIELDS = [
	"summary",
	"description",
	"issuetype",
	"priority",
	"status",
	"resolution",
	"created",
	"updated",
	"resolutiondate",
	"duedate",
	"comment",
	...Object.values(JIRA_FIELDS),
] as const;

// upload.py appends "\n\n---\n" plus "Key: value" lines for data Jira has no field for.
const FOOTER_MARKER = "\n\n---\n";

/** The footer block of a plain-text description, including its marker, or "". */
export function descriptionFooter(raw: string): string {
	const idx = raw.lastIndexOf(FOOTER_MARKER);
	return idx === -1 ? "" : raw.slice(idx).trimEnd();
}

function splitDescription(raw: string) {
	const idx = raw.lastIndexOf(FOOTER_MARKER);
	const footer = new Map<string, string>();
	if (idx === -1) return { description: raw.trim(), footer };
	for (const line of raw.slice(idx + FOOTER_MARKER.length).split("\n")) {
		const match = /^([^:]+):[ \t]*(.*)$/.exec(line);
		const value = match?.[2]?.trim();
		if (match?.[1] && value && value !== "-")
			footer.set(match[1].trim(), value);
	}
	return { description: raw.slice(0, idx).trim(), footer };
}

function isOption(value: unknown): value is JiraOption {
	return typeof value === "object" && value !== null && "id" in value;
}

function labelOf(value: unknown): string | null {
	return isOption(value) ? optionLabel(value) || null : null;
}

function labelsOf(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [value];
	return values.map(labelOf).filter((label): label is string => label !== null);
}

function textOf(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Jira's "2026-09-18T23:36:00.000+0200" -> the dataset's "2026-09-18 23:36" (site-local time). */
function dateOf(value: unknown): string | null {
	const text = textOf(value);
	return text ? text.replace("T", " ").slice(0, 16) : null;
}

function issueTypeName(issue: JiraIssue): string {
	const issuetype = issue.fields.issuetype;
	return typeof issuetype === "object" &&
		issuetype !== null &&
		"name" in issuetype
		? String(issuetype.name)
		: "";
}

export function isTicket(issue: JiraIssue): boolean {
	const name = issueTypeName(issue).toLowerCase();
	return (
		(name.includes("incident") || name.includes("service request")) &&
		!name.includes("approval")
	);
}

function statusOf(fields: Record<string, unknown>): TicketStatus {
	if (fields.resolution) return "done";
	const status = fields.status as
		| { statusCategory?: { key?: string } }
		| undefined;
	const category = status?.statusCategory?.key;
	if (category === "done") return "done";
	if (category === "indeterminate") return "in progress";
	return "open";
}

export type TicketComment = {
	id: string;
	author: string | null;
	body: string;
	isPublic: boolean;
	createdAt: string;
	updatedAt: string;
};

type RawComment = {
	id?: string;
	author?: { displayName?: string };
	body?: unknown;
	jsdPublic?: boolean;
	created?: string;
	updated?: string;
};

export function ticketComments(value: unknown): TicketComment[] {
	const comments = (value as { comments?: RawComment[] } | null | undefined)
		?.comments;
	return (comments ?? []).flatMap((c) => {
		const body = adfToText(c.body).trim();
		if (!c.id || !c.created || body.length === 0) return [];
		return [
			{
				id: c.id,
				author: c.author?.displayName ?? null,
				body,
				isPublic: c.jsdPublic !== false,
				createdAt: c.created,
				updatedAt: c.updated ?? c.created,
			},
		];
	});
}

export function toTicketRecord(issue: JiraIssue): TicketRecord {
	const f = issue.fields;
	const { description, footer } = splitDescription(
		adfToText(f.description).trim(),
	);
	const linkedIssues = (footer.get("Linked issues") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return {
		Key: issue.key,
		"Work type": issueTypeName(issue).toLowerCase().includes("service request")
			? "Service Request"
			: "Incident",
		"Request type": footer.get("Original request type") ?? null,
		Summary: textOf(f.summary) ?? "",
		Description: description,
		"Affected Business or IT Services": labelsOf(
			f[JIRA_FIELDS.affectedService],
		),
		"Business Entity": labelsOf(f[JIRA_FIELDS.businessEntity]),
		"Business Critical for Entity": labelsOf(f[JIRA_FIELDS.businessCritical]),
		"Service Team(s)": labelsOf(f[JIRA_FIELDS.serviceTeam]),
		Reporter: textOf(f[JIRA_FIELDS.originalReporter]),
		Assignee: textOf(f[JIRA_FIELDS.proposedAssignee]),
		Priority: toChallengeLevel(labelOf(f.priority)),
		Urgency: toChallengeLevel(labelOf(f[JIRA_FIELDS.urgency])),
		Impact: toChallengeLevel(labelOf(f[JIRA_FIELDS.impact])),
		Severity: labelOf(f[JIRA_FIELDS.severity]),
		// Imported tickets keep their original date; Jira's is the upload time.
		"Created date": footer.get("Original created date") ?? dateOf(f.created),
		Status: statusOf(f),
		"Linked issues": linkedIssues,
		Resolution: toChallengeResolution(labelOf(f.resolution)),
		"Due date": dateOf(f.duedate),
		"Resolution date": dateOf(f.resolutiondate),
		"All Comments": ticketComments(f.comment)
			.filter((c) => c.isPublic)
			.map((c) => c.body),
	};
}

/** Same envelope as jira/data/challenge_blind.json. */
export type TicketExport = {
	fetchedAtUtc: string;
	jql: string;
	actualIssueCount: number;
	records: TicketRecord[];
};

export const TICKETS_JQL = `project = ${JIRA_PROJECT_KEY}`;

/** The stored copy of Jira, as of the last sync. */
export async function storedTicketExport(sql: SQL): Promise<TicketExport> {
	const records = (await loadTickets(sql)).map((t) => t.record);
	const syncedAt = await getCursor(sql, JIRA_SYNC_CURSOR);
	return {
		fetchedAtUtc: `${(syncedAt ?? new Date().toISOString()).slice(0, 19)}Z`,
		jql: TICKETS_JQL,
		actualIssueCount: records.length,
		records,
	};
}

/** Everything the backend keeps about one Jira ticket. */
export type TicketSnapshot = {
	record: TicketRecord;
	comments: TicketComment[];
	jiraId: string;
	jiraStatus: string;
	jiraUpdatedAt: string;
	contentHash: string;
	raw: JiraIssue;
};

/** Hash of the record fields, used as the Core's snapshot content_hash. */
export function contentHash(record: TicketRecord): string {
	const { Key: _key, ...fields } = record;
	return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function toSnapshot(issue: JiraIssue): TicketSnapshot {
	const record = toTicketRecord(issue);
	const status = issue.fields.status as { name?: string } | undefined;
	return {
		record,
		comments: ticketComments(issue.fields.comment),
		jiraId: issue.id,
		jiraStatus: status?.name ?? "",
		jiraUpdatedAt: textOf(issue.fields.updated) ?? new Date().toISOString(),
		contentHash: contentHash(record),
		raw: issue,
	};
}
