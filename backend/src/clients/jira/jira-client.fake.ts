import { adf } from "./adf";
import { JIRA_FIELDS } from "./field-config";
import {
	JiraApiError,
	type JiraClient,
	type JiraFieldMeta,
	type JiraIssue,
	type JiraOption,
} from "./jira-client";

function options(
	labels: readonly string[],
	key: "value" | "name" = "value",
): JiraOption[] {
	return labels.map((label, i) => ({ id: String(i + 1), [key]: label }));
}

// Same labels as the real SUP site, so matching logic is exercised realistically.
const OPTION_LISTS: Record<string, JiraOption[]> = {
	priority: options(["Highest", "High", "Medium", "Low", "Lowest"], "name"),
	[JIRA_FIELDS.urgency]: options([
		"Critical",
		"High",
		"Medium",
		"Low",
		"Lowest",
	]),
	[JIRA_FIELDS.impact]: options([
		"Extensive / Widespread",
		"Significant / Large",
		"Moderate / Limited",
		"Minor / Localized",
		"No direct impact",
	]),
	[JIRA_FIELDS.severity]: options(["Sev-0", "Sev-1", "Sev-2", "Sev-3"]),
	[JIRA_FIELDS.affectedService]: options([
		"Trading Platform",
		"Tax Reporting",
		"Fund Pricing",
	]),
	[JIRA_FIELDS.serviceTeam]: options([
		"Service Desk",
		"Tax & Reporting",
		"Valuation & Pricing",
	]),
	[JIRA_FIELDS.businessEntity]: options([
		"Switzerland",
		"France",
		"Luxembourg",
		"Germany",
		"Nordics",
	]),
};

// The service desk workflow of the real project, as GET /transitions returns it.
const RESOLVE_TRANSITION = {
	id: "111",
	name: "Resolve",
	to: { name: "Resolved", statusCategory: { key: "done" } },
};
const OPEN_TRANSITIONS = [
	{
		id: "51",
		name: "Pending",
		to: { name: "Pending", statusCategory: { key: "indeterminate" } },
	},
	{
		id: "31",
		name: "Investigate",
		to: { name: "Work in progress", statusCategory: { key: "indeterminate" } },
	},
	RESOLVE_TRANSITION,
];
const IN_PROGRESS_TRANSITIONS = [
	{
		id: "61",
		name: "Back to open",
		to: { name: "Open", statusCategory: { key: "new" } },
	},
	RESOLVE_TRANSITION,
];

const WORK_TYPES = [
	{ id: "10010", name: "[System] Service request" },
	{ id: "10011", name: "[System] Service request with approvals" },
	{ id: "10012", name: "[System] Incident" },
];

let commentSeq = 0;

export function fakeComment(text: string, isPublic = true) {
	commentSeq += 1;
	const at = `2026-09-19T0${commentSeq % 10}:00:00.000+0200`;
	return {
		id: String(10000 + commentSeq),
		author: { displayName: "Bianca Ianosel" },
		body: adf(text),
		jsdPublic: isPublic,
		created: at,
		updated: at,
	};
}

export function fakeIssue(
	key: string,
	fields: Record<string, unknown> = {},
): JiraIssue {
	return {
		id: String(10000 + Number(key.split("-")[1] ?? 0)),
		key,
		fields: {
			updated: "2026-09-18T23:36:00.000+0200",
			summary: "Tax Reporting portal unreachable",
			description: adf(
				"Users in Germany cannot open the Tax Reporting portal.",
			),
			issuetype: { id: "10012", name: "[System] Incident" },
			priority: { id: "3", name: "Medium" },
			status: { name: "Open", statusCategory: { key: "new" } },
			resolution: null,
			created: "2026-09-18T23:36:00.000+0200",
			resolutiondate: null,
			duedate: null,
			comment: { comments: [] },
			[JIRA_FIELDS.affectedService]: { id: "2", value: "Tax Reporting" },
			[JIRA_FIELDS.serviceTeam]: { id: "2", value: "Tax & Reporting" },
			[JIRA_FIELDS.businessEntity]: [{ id: "4", value: "Germany" }],
			[JIRA_FIELDS.proposedAssignee]: null,
			[JIRA_FIELDS.originalReporter]: "amelia.marcus@intcom.com",
			[JIRA_FIELDS.urgency]: { id: "3", value: "Medium" },
			[JIRA_FIELDS.impact]: { id: "3", value: "Moderate / Limited" },
			...fields,
		},
	};
}

/** In-memory Jira for tests and local dev. Resolves option ids like Jira does. */
export function createFakeJiraClient(
	seed: JiraIssue[] = [fakeIssue("SUP-1")],
): JiraClient {
	const issues = new Map(
		seed.map((issue) => [issue.key, structuredClone(issue)]),
	);

	function get(key: string, path: string): JiraIssue {
		const issue = issues.get(key);
		if (!issue)
			throw new JiraApiError(404, "GET", path, "Issue does not exist");
		return issue;
	}

	function touch(issue: JiraIssue) {
		issue.fields.updated = new Date().toISOString().replace("Z", "+0000");
	}

	function workType(value: unknown) {
		return WORK_TYPES.find(
			(t) =>
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				t.id === value.id,
		);
	}

	function resolve(fieldId: string, value: unknown): unknown {
		const list = OPTION_LISTS[fieldId];
		if (!list) return value;
		const lookup = (ref: unknown) =>
			list.find(
				(o) =>
					typeof ref === "object" &&
					ref !== null &&
					"id" in ref &&
					o.id === ref.id,
			) ?? ref;
		return Array.isArray(value) ? value.map(lookup) : lookup(value);
	}

	return {
		async searchIssues() {
			return [...issues.values()].map((issue) => structuredClone(issue));
		},

		async getIssue(key) {
			return structuredClone(get(key, `/rest/api/3/issue/${key}`));
		},

		async createIssue(fields) {
			const numbers = [...issues.keys()].map((k) => Number(k.split("-")[1]));
			const key = `SUP-${Math.max(0, ...numbers) + 1}`;
			const now = new Date().toISOString().replace("Z", "+0000");
			// A new issue has only what it was created with.
			const issue = fakeIssue(key, {
				created: now,
				updated: now,
				[JIRA_FIELDS.affectedService]: null,
				[JIRA_FIELDS.serviceTeam]: null,
				[JIRA_FIELDS.businessEntity]: [],
				[JIRA_FIELDS.originalReporter]: null,
				[JIRA_FIELDS.urgency]: null,
				[JIRA_FIELDS.impact]: null,
			});
			for (const [fieldId, value] of Object.entries(fields)) {
				if (fieldId === "project") continue;
				issue.fields[fieldId] =
					fieldId === "issuetype" ? workType(value) : resolve(fieldId, value);
			}
			issues.set(key, issue);
			return { key };
		},

		async getEditMeta(key) {
			get(key, `/rest/api/3/issue/${key}/editmeta`);
			const meta: Record<string, JiraFieldMeta> = {};
			for (const [fieldId, allowedValues] of Object.entries(OPTION_LISTS)) {
				meta[fieldId] = { allowedValues };
			}
			return meta;
		},

		async updateIssue(key, input) {
			const issue = get(key, `/rest/api/3/issue/${key}`);
			for (const [fieldId, value] of Object.entries(input.fields ?? {})) {
				if (fieldId === "issuetype") {
					issue.fields.issuetype = workType(value);
					continue;
				}
				issue.fields[fieldId] = resolve(fieldId, value);
			}
			touch(issue);
		},

		async addComment(key, text, internal = false) {
			const issue = get(key, `/rest/api/3/issue/${key}/comment`);
			const thread = issue.fields.comment as { comments?: unknown[] } | null;
			const existing = thread?.comments ?? [];
			issue.fields.comment = {
				comments: [...existing, fakeComment(text, !internal)],
			};
			touch(issue);
		},

		async getTransitions(key) {
			const issue = get(key, `/rest/api/3/issue/${key}/transitions`);
			if (issue.fields.resolution) return [];
			const status = issue.fields.status as
				| { statusCategory?: { key?: string } }
				| undefined;
			return status?.statusCategory?.key === "indeterminate"
				? IN_PROGRESS_TRANSITIONS
				: OPEN_TRANSITIONS;
		},

		async transitionIssue(key, transitionId, fields) {
			const issue = get(key, `/rest/api/3/issue/${key}/transitions`);
			const target = [...OPEN_TRANSITIONS, ...IN_PROGRESS_TRANSITIONS].find(
				(t) => t.id === transitionId,
			);
			if (target && target !== RESOLVE_TRANSITION) {
				issue.fields.status = { ...target.to };
				touch(issue);
				return;
			}
			const requested = fields?.resolution as { name?: string } | undefined;
			issue.fields.status = {
				name: "Resolved",
				statusCategory: { key: "done" },
			};
			issue.fields.resolution = {
				id: "10000",
				name: requested?.name ?? "Done",
			};
			issue.fields.resolutiondate = "2026-09-24T10:00:00.000+0200";
			touch(issue);
		},

		async getWorkTypes() {
			return WORK_TYPES;
		},
	};
}
