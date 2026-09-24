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
import { descriptionFooter } from "./tickets";

const resolutionSchema = z.enum(
	Object.keys(JIRA_RESOLUTIONS) as [
		keyof typeof JIRA_RESOLUTIONS,
		...(keyof typeof JIRA_RESOLUTIONS)[],
	],
);

/**
 * A partial ticket: only the fields present are written. "All Comments" holds
 * comments to append, not the full history. "Request type", "Status", dates and
 * the other read-only fields of the record are not accepted.
 */
export const ticketPatchSchema = z.strictObject({
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
	Priority: z.string().optional(),
	Urgency: z.string().optional(),
	Impact: z.string().optional(),
	Resolution: resolutionSchema.optional(),
	"All Comments": z.array(z.string().min(1)).optional(),
});

export const ticketPatchBodySchema = z
	.union([ticketPatchSchema, z.array(ticketPatchSchema).min(1).max(500)])
	.transform((body) => (Array.isArray(body) ? body : [body]))
	.refine(
		(patches) => new Set(patches.map((p) => p.Key)).size === patches.length,
		{
			message: "each Key may appear only once per request",
		},
	);

export type TicketPatch = z.infer<typeof ticketPatchSchema>;

export type TicketPatchResult =
	| { key: string; ok: true; warnings: string[] }
	| { key: string; ok: false; warnings: string[]; error: string };

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

type FieldBuilder = {
	fields: Record<string, unknown>;
	warnings: string[];
	select(
		fieldId: string,
		label: string,
		value: string | undefined,
	): JiraOption | null;
};

function fieldBuilder(meta: Record<string, JiraFieldMeta>): FieldBuilder {
	const builder: FieldBuilder = {
		fields: {},
		warnings: [],
		select(fieldId, label, value) {
			if (value === undefined) return null;
			const option = matchOption(value, meta[fieldId]?.allowedValues);
			if (!option) {
				builder.warnings.push(
					`${label}: '${value}' is not an allowed Jira option, not changed`,
				);
				return null;
			}
			builder.fields[fieldId] = { id: option.id };
			return option;
		},
	};
	return builder;
}

function buildFields(
	patch: TicketPatch,
	meta: Record<string, JiraFieldMeta>,
	currentFooter: string,
) {
	const b = fieldBuilder(meta);

	if (patch.Summary !== undefined) b.fields.summary = patch.Summary;
	if (patch.Description !== undefined)
		b.fields.description = adf(patch.Description.trim() + currentFooter);
	if (patch.Reporter !== undefined)
		b.fields[JIRA_FIELDS.originalReporter] = patch.Reporter;
	if (patch.Assignee !== undefined)
		b.fields[JIRA_FIELDS.proposedAssignee] = patch.Assignee;

	const service = patch["Affected Business or IT Services"];
	if (service?.length === 0) b.fields[JIRA_FIELDS.affectedService] = null;
	else
		b.select(
			JIRA_FIELDS.affectedService,
			"Affected Business or IT Services",
			service?.[0],
		);

	const team = patch["Service Team(s)"];
	if (team?.length === 0) b.fields[JIRA_FIELDS.serviceTeam] = null;
	else b.select(JIRA_FIELDS.serviceTeam, "Service Team(s)", team?.[0]);

	const entities = patch["Business Entity"];
	if (entities !== undefined) {
		const allowed = meta[JIRA_FIELDS.businessEntity]?.allowedValues;
		const matched = entities.map((e) => ({
			e,
			option: matchOption(e, allowed),
		}));
		const unknown = matched.filter((m) => !m.option).map((m) => m.e);
		if (unknown.length > 0) {
			b.warnings.push(
				`Business Entity: ${unknown.join(", ")} not allowed, skipped`,
			);
		}
		b.fields[JIRA_FIELDS.businessEntity] = matched.flatMap((m) =>
			m.option ? [{ id: m.option.id }] : [],
		);
	}

	// Jira's Urgency/Impact scales are coarser than the dataset's, so derive the
	// priority from the options actually written, keeping the three consistent.
	const urgency = b.select(JIRA_FIELDS.urgency, "Urgency", patch.Urgency);
	const impact = b.select(JIRA_FIELDS.impact, "Impact", patch.Impact);
	const priority =
		patch.Priority ??
		(urgency && impact
			? priorityFrom(optionLabel(urgency), optionLabel(impact))
			: null);
	if (priority) b.select("priority", "Priority", priority);

	return b;
}

async function changeWorkType(
	client: JiraClient,
	patch: TicketPatch,
	warnings: string[],
) {
	const wanted = patch["Work type"];
	if (!wanted) return;
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
		await client.updateIssue(patch.Key, {
			fields: { issuetype: { id: target.id } },
		});
	} catch (error) {
		// Jira refuses the change when the two work types use different workflows.
		if (!(error instanceof JiraApiError)) throw error;
		warnings.push(
			`Work type: Jira refused the change to ${wanted} (${error.status})`,
		);
	}
}

async function resolve(
	client: JiraClient,
	patch: TicketPatch,
	meta: Record<string, JiraFieldMeta>,
	warnings: string[],
) {
	if (!patch.Resolution) return;
	const resolution = { name: JIRA_RESOLUTIONS[patch.Resolution] };
	const transition = (await client.getTransitions(patch.Key)).find(
		(t) =>
			t.name.toLowerCase().includes("resolve") ||
			t.to.name.toLowerCase().includes("resolved"),
	);
	if (transition) {
		await client.transitionIssue(patch.Key, transition.id, { resolution });
	} else if (meta.resolution) {
		// Already resolved: the resolution can still be edited in place.
		await client.updateIssue(patch.Key, { fields: { resolution } });
	} else {
		warnings.push(
			"Resolution: no Resolve transition from the current status, not changed",
		);
	}
}

export async function applyTicketPatch(
	client: JiraClient,
	patch: TicketPatch,
): Promise<TicketPatchResult> {
	const warnings: string[] = [];
	try {
		const meta = await client.getEditMeta(patch.Key);
		await changeWorkType(client, patch, warnings);

		// The footer holds data Jira has no field for; keep it when the text changes.
		const footer =
			patch.Description === undefined
				? ""
				: descriptionFooter(
						adfToText(
							(await client.getIssue(patch.Key, ["description"])).fields
								.description,
						),
					);
		const built = buildFields(patch, meta, footer);
		warnings.push(...built.warnings);
		if (Object.keys(built.fields).length > 0) {
			await client.updateIssue(patch.Key, { fields: built.fields });
		}

		for (const text of patch["All Comments"] ?? []) {
			await client.addComment(patch.Key, text);
		}

		await resolve(client, patch, meta, warnings);
		return { key: patch.Key, ok: true, warnings };
	} catch (error) {
		if (!(error instanceof JiraApiError)) throw error;
		return { key: patch.Key, ok: false, warnings, error: error.message };
	}
}

const CONCURRENCY = 5;

/** Applies patches with bounded concurrency so a large bulk edit doesn't trip Jira's rate limit. */
export async function applyTicketPatches(
	client: JiraClient,
	patches: readonly TicketPatch[],
): Promise<TicketPatchResult[]> {
	const results: TicketPatchResult[] = new Array(patches.length);
	let next = 0;
	async function worker() {
		while (next < patches.length) {
			const index = next++;
			const patch = patches[index];
			if (patch) results[index] = await applyTicketPatch(client, patch);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, patches.length) }, worker),
	);
	return results;
}
