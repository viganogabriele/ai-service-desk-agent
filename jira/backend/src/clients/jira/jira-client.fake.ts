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

const RESOLVE_TRANSITION = {
	id: "31",
	name: "Resolve",
	to: { name: "Resolved" },
};

const WORK_TYPES = [
	{ id: "10010", name: "[System] Service request" },
	{ id: "10011", name: "[System] Service request with approvals" },
	{ id: "10012", name: "[System] Incident" },
];

export function fakeIssue(
	key: string,
	fields: Record<string, unknown> = {},
): JiraIssue {
	return {
		key,
		fields: {
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
					issue.fields.issuetype = WORK_TYPES.find(
						(t) =>
							typeof value === "object" &&
							value !== null &&
							"id" in value &&
							t.id === value.id,
					);
					continue;
				}
				issue.fields[fieldId] = resolve(fieldId, value);
			}
		},

		async addComment(key, text, internal = false) {
			const issue = get(key, `/rest/api/3/issue/${key}/comment`);
			const thread = issue.fields.comment as { comments?: unknown[] } | null;
			const existing = thread?.comments ?? [];
			issue.fields.comment = {
				comments: [...existing, { body: adf(text), jsdPublic: !internal }],
			};
		},

		async getTransitions(key) {
			const issue = get(key, `/rest/api/3/issue/${key}/transitions`);
			return issue.fields.resolution ? [] : [RESOLVE_TRANSITION];
		},

		async transitionIssue(key, _transitionId, fields) {
			const issue = get(key, `/rest/api/3/issue/${key}/transitions`);
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
		},

		async getWorkTypes() {
			return WORK_TYPES;
		},
	};
}
