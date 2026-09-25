import { z } from "zod";
import { adf, adfToText } from "../clients/jira/adf";
import { JIRA_FIELDS, JIRA_RESOLUTIONS } from "../clients/jira/field-config";
import {
	JiraApiError,
	type JiraClient,
	type JiraFieldMeta,
	type JiraOption,
} from "../clients/jira/jira-client";
import { matchOption, optionLabel, rank } from "../clients/jira/matching";
import { isRetryableStatus } from "../lib/errors";
import {
	descriptionFooter,
	TICKET_FIELDS,
	type TicketRecord,
	toTicketRecord,
} from "./tickets";

const resolutionSchema = z.enum(
	Object.keys(JIRA_RESOLUTIONS) as [
		keyof typeof JIRA_RESOLUTIONS,
		...(keyof typeof JIRA_RESOLUTIONS)[],
	],
);

/**
 * A partial or full ticket record. Fields equal to what Jira already has are
 * skipped, null clears a field, and fields Jira can't take (dates, Request
 * type, Linked issues, ...) are dropped. Status moves between open and in
 * progress through a Jira transition; "done" needs a Resolution. "All
 * Comments" may be the full history: only comments not already on the ticket
 * are added.
 */
export const ticketPatchSchema = z.object({
	Key: z
		.string()
		.regex(/^[A-Z][A-Z0-9]*-\d+$/, "must be a Jira key like SUP-12"),
	"Work type": z.enum(["Incident", "Service Request"]).optional(),
	Summary: z.string().min(1).max(254).optional(),
	Description: z.string().optional(),
	"Affected Business or IT Services": z.array(z.string()).max(1).optional(),
	"Business Entity": z.array(z.string()).optional(),
	"Service Team(s)": z.array(z.string()).max(1).optional(),
	Reporter: z.string().nullable().optional(),
	Assignee: z.string().nullable().optional(),
	// Null is ignored: Jira always keeps a priority.
	Priority: z.string().nullable().optional(),
	Urgency: z.string().nullable().optional(),
	Impact: z.string().nullable().optional(),
	Severity: z.string().nullable().optional(),
	// Null is ignored: Jira can't un-resolve through an edit.
	Resolution: resolutionSchema.nullable().optional(),
	// "done" is only reached through Resolution.
	Status: z.enum(["open", "in progress", "done"]).optional(),
	"All Comments": z.array(z.string().min(1)).optional(),
});

export const ticketPatchBodySchema = z
	.union([ticketPatchSchema, z.array(ticketPatchSchema).min(1).max(500)])
	.transform((body) => (Array.isArray(body) ? body : [body]))
	.refine(
		(patches) => new Set(patches.map((p) => p.Key)).size === patches.length,
		{ message: "each Key may appear only once per request" },
	);

export type TicketPatch = z.infer<typeof ticketPatchSchema>;

export type TicketPatchResult =
	| { key: string; ok: true; changed: string[]; warnings: string[] }
	| {
			key: string;
			ok: false;
			warnings: string[];
			error: string;
			retryable: boolean;
	  };

// README matrix. Rows: urgency rank 0..4, columns: impact rank 0..4.
const PRIORITY_MATRIX = [
	["Highest", "Highest", "High", "Medium", "Medium"],
	["Highest", "High", "High", "Medium", "Low"],
	["High", "High", "Medium", "Low", "Low"],
	["Medium", "Medium", "Low", "Low", "Lowest"],
	["Medium", "Low", "Low", "Lowest", "Lowest"],
] as const;

export function priorityFrom(urgency: string, impact: string): string | null {
	const u = rank(urgency);
	const i = rank(impact);
	if (u === null || i === null) return null;
	return PRIORITY_MATRIX[u]?.[i] ?? null;
}

/** The patch without the fields whose value already matches Jira. */
function changesAgainst(patch: TicketPatch, current: TicketRecord) {
	const changes: Partial<TicketPatch> = {};
	for (const [field, value] of Object.entries(patch)) {
		if (field === "Key" || value === undefined) continue;
		const now = current[field as keyof TicketRecord];
		if (JSON.stringify(value) !== JSON.stringify(now)) {
			Object.assign(changes, { [field]: value });
		}
	}
	return changes;
}

function fieldWriter(meta: Record<string, JiraFieldMeta>) {
	const fields: Record<string, unknown> = {};
	const warnings: string[] = [];

	function select(
		fieldId: string,
		label: string,
		value: string | null | undefined,
	): JiraOption | null {
		if (value === undefined) return null;
		if (value === null) {
			fields[fieldId] = null;
			return null;
		}
		const option = matchOption(value, meta[fieldId]?.allowedValues);
		if (!option) {
			warnings.push(
				`${label}: '${value}' is not an allowed Jira option, not changed`,
			);
			return null;
		}
		fields[fieldId] = { id: option.id };
		return option;
	}

	return { fields, warnings, select };
}

function buildFields(
	changes: Partial<TicketPatch>,
	current: TicketRecord,
	meta: Record<string, JiraFieldMeta>,
	footer: string,
	derivePriority: boolean,
) {
	const w = fieldWriter(meta);

	if (changes.Summary !== undefined) w.fields.summary = changes.Summary;
	if (changes.Description !== undefined)
		w.fields.description = adf(changes.Description.trim() + footer);
	if (changes.Reporter !== undefined)
		w.fields[JIRA_FIELDS.originalReporter] = changes.Reporter;
	if (changes.Assignee !== undefined)
		w.fields[JIRA_FIELDS.proposedAssignee] = changes.Assignee;

	const service = changes["Affected Business or IT Services"];
	if (service !== undefined)
		w.select(
			JIRA_FIELDS.affectedService,
			"Affected Business or IT Services",
			service[0] ?? null,
		);
	const team = changes["Service Team(s)"];
	if (team !== undefined)
		w.select(JIRA_FIELDS.serviceTeam, "Service Team(s)", team[0] ?? null);
	w.select(JIRA_FIELDS.severity, "Severity", changes.Severity);

	const entities = changes["Business Entity"];
	if (entities !== undefined) {
		const allowed = meta[JIRA_FIELDS.businessEntity]?.allowedValues;
		const options: { id: string }[] = [];
		for (const entity of entities) {
			const option = matchOption(entity, allowed);
			if (option) options.push({ id: option.id });
			else
				w.warnings.push(
					`Business Entity: '${entity}' not allowed, field not changed`,
				);
		}
		if (options.length === entities.length)
			w.fields[JIRA_FIELDS.businessEntity] = options;
	}

	// Priority follows the README matrix whenever urgency or impact changes,
	// computed from the options Jira actually stored.
	const urgency = w.select(JIRA_FIELDS.urgency, "Urgency", changes.Urgency);
	const impact = w.select(JIRA_FIELDS.impact, "Impact", changes.Impact);
	let priority = changes.Priority ?? null;
	if (
		derivePriority &&
		(changes.Urgency !== undefined || changes.Impact !== undefined)
	) {
		const u = urgency ? optionLabel(urgency) : current.Urgency;
		const i = impact ? optionLabel(impact) : current.Impact;
		priority = (u && i && priorityFrom(u, i)) || priority;
	}
	if (priority && priority !== current.Priority)
		w.select("priority", "Priority", priority);

	return w;
}

async function changeWorkType(
	client: JiraClient,
	key: string,
	wanted: TicketRecord["Work type"],
	warnings: string[],
) {
	const needle = wanted.toLowerCase();
	const target = (await client.getWorkTypes()).find((t) => {
		const name = t.name.toLowerCase();
		return name.includes(needle) && !name.includes("approval");
	});
	if (!target) {
		warnings.push(`Work type: no Jira work type matches '${wanted}'`);
		return;
	}
	try {
		await client.updateIssue(key, { fields: { issuetype: { id: target.id } } });
	} catch (error) {
		// Refused when the two work types use different workflows.
		if (
			!(error instanceof JiraApiError) ||
			isRetryableStatus(error.status) ||
			error.status === 401 ||
			error.status === 403
		)
			throw error;
		warnings.push(
			`Work type: Jira refused the change to ${wanted} (${error.status})`,
		);
	}
}

async function resolve(
	client: JiraClient,
	key: string,
	resolution: keyof typeof JIRA_RESOLUTIONS,
	meta: Record<string, JiraFieldMeta>,
	warnings: string[],
) {
	const value = { name: JIRA_RESOLUTIONS[resolution] };
	const transition = (await client.getTransitions(key)).find(
		(t) =>
			t.name.toLowerCase().includes("resolve") ||
			t.to.name.toLowerCase().includes("resolved"),
	);
	if (transition) {
		await client.transitionIssue(key, transition.id, { resolution: value });
	} else if (meta.resolution) {
		await client.updateIssue(key, { fields: { resolution: value } });
	} else {
		warnings.push(
			"Resolution: no Resolve transition from the current status, not changed",
		);
	}
}

// The Jira status category each record status lives in.
const STATUS_CATEGORY = {
	open: "new",
	"in progress": "indeterminate",
} as const;

async function moveTo(
	client: JiraClient,
	key: string,
	status: keyof typeof STATUS_CATEGORY,
	warnings: string[],
) {
	const options = (await client.getTransitions(key)).filter(
		(t) => t.to.statusCategory?.key === STATUS_CATEGORY[status],
	);
	// "Investigate" -> "Work in progress" rather than "Pending", when both exist.
	const transition =
		options.find((t) => /progress/i.test(t.to.name)) ?? options[0];
	if (transition) await client.transitionIssue(key, transition.id);
	else
		warnings.push(
			`Status: no Jira transition to ${status} from the current status, not changed`,
		);
}

export async function applyTicketPatch(
	client: JiraClient,
	patch: TicketPatch,
	options: { derivePriority?: boolean } = {},
): Promise<TicketPatchResult> {
	const warnings: string[] = [];
	try {
		const issue = await client.getIssue(patch.Key, TICKET_FIELDS);
		const current = toTicketRecord(issue);
		const changes = changesAgainst(patch, current);
		const changed = Object.keys(changes);
		if (changed.length === 0)
			return { key: patch.Key, ok: true, changed, warnings };

		const meta = await client.getEditMeta(patch.Key);
		if (changes["Work type"])
			await changeWorkType(client, patch.Key, changes["Work type"], warnings);

		// The footer holds data Jira has no field for; keep it when the text changes.
		const footer = descriptionFooter(adfToText(issue.fields.description));
		const built = buildFields(
			changes,
			current,
			meta,
			footer,
			options.derivePriority ?? true,
		);
		warnings.push(...built.warnings);
		if (Object.keys(built.fields).length > 0) {
			await client.updateIssue(patch.Key, { fields: built.fields });
		}

		const existing = new Set(current["All Comments"]);
		for (const text of changes["All Comments"] ?? []) {
			const trimmed = text.trim();
			if (!existing.has(trimmed)) {
				await client.addComment(patch.Key, trimmed);
				existing.add(trimmed);
			}
		}

		if (changes.Resolution)
			await resolve(client, patch.Key, changes.Resolution, meta, warnings);
		else if (changes.Status === "done")
			warnings.push("Status: set a Resolution to resolve the ticket");
		else if (changes.Status)
			await moveTo(client, patch.Key, changes.Status, warnings);

		return { key: patch.Key, ok: true, changed, warnings };
	} catch (error) {
		if (!(error instanceof JiraApiError)) throw error;
		return {
			key: patch.Key,
			ok: false,
			warnings,
			error: error.message,
			retryable: isRetryableStatus(error.status),
		};
	}
}
