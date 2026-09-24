import { adf } from "./adf";
import { JIRA_PROJECT_KEY } from "./field-config";

export type JiraOption = { id: string; value?: string; name?: string };
export type JiraIssue = { key: string; fields: Record<string, unknown> };
export type JiraFieldMeta = { allowedValues?: JiraOption[] };
export type JiraTransition = { id: string; name: string; to: { name: string } };
export type JiraWorkType = { id: string; name: string };
export type JiraIssueUpdate = {
	fields?: Record<string, unknown>;
	update?: Record<string, unknown>;
};

export class JiraApiError extends Error {
	readonly status: number;

	constructor(status: number, method: string, path: string, body: string) {
		super(`${method} ${path} -> ${status}: ${body.slice(0, 500)}`);
		this.name = "JiraApiError";
		this.status = status;
	}
}

export interface JiraClient {
	searchIssues(jql: string, fields: readonly string[]): Promise<JiraIssue[]>;
	getIssue(key: string, fields: readonly string[]): Promise<JiraIssue>;
	getEditMeta(key: string): Promise<Record<string, JiraFieldMeta>>;
	updateIssue(key: string, input: JiraIssueUpdate): Promise<void>;
	addComment(key: string, text: string, internal?: boolean): Promise<void>;
	getTransitions(key: string): Promise<JiraTransition[]>;
	transitionIssue(
		key: string,
		transitionId: string,
		fields?: Record<string, unknown>,
	): Promise<void>;
	getWorkTypes(): Promise<JiraWorkType[]>;
}

export type JiraClientConfig = {
	baseUrl: string;
	email: string;
	apiToken: string;
};

const MAX_ATTEMPTS = 6;

export function createRealJiraClient(config: JiraClientConfig): JiraClient {
	const base = config.baseUrl.replace(/\/+$/, "");
	const authorization = `Basic ${btoa(`${config.email}:${config.apiToken}`)}`;

	async function call(
		method: string,
		path: string,
		options: { body?: unknown; params?: Record<string, string> } = {},
	): Promise<unknown> {
		const url = new URL(base + path);
		for (const [k, v] of Object.entries(options.params ?? {})) {
			url.searchParams.set(k, v);
		}
		const init: RequestInit = {
			method,
			headers: {
				Authorization: authorization,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
		};
		if (options.body !== undefined) init.body = JSON.stringify(options.body);

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const res = await fetch(url, init);
			if (res.status === 429 || res.status >= 500) {
				const retryAfter =
					Number(res.headers.get("Retry-After")) || 2 ** attempt;
				await Bun.sleep(retryAfter * 1000);
				continue;
			}
			const text = await res.text();
			if (!res.ok) throw new JiraApiError(res.status, method, path, text);
			return text ? JSON.parse(text) : null;
		}
		throw new JiraApiError(503, method, path, "retries exhausted");
	}

	return {
		async searchIssues(jql, fields) {
			const issues: JiraIssue[] = [];
			let nextPageToken: string | undefined;
			do {
				const params: Record<string, string> = {
					jql,
					fields: fields.join(","),
					maxResults: "50",
				};
				if (nextPageToken) params.nextPageToken = nextPageToken;
				const data = (await call("GET", "/rest/api/3/search/jql", {
					params,
				})) as {
					issues?: JiraIssue[];
					nextPageToken?: string;
				};
				issues.push(...(data.issues ?? []));
				nextPageToken = data.nextPageToken;
			} while (nextPageToken);
			return issues;
		},

		async getIssue(key, fields) {
			return (await call(
				"GET",
				`/rest/api/3/issue/${encodeURIComponent(key)}`,
				{
					params: { fields: fields.join(",") },
				},
			)) as JiraIssue;
		},

		async getEditMeta(key) {
			const data = (await call(
				"GET",
				`/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
			)) as {
				fields: Record<string, JiraFieldMeta>;
			};
			return data.fields;
		},

		async updateIssue(key, input) {
			await call("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
				body: input,
			});
		},

		async addComment(key, text, internal = false) {
			const body: Record<string, unknown> = { body: adf(text) };
			if (internal) {
				// Jira Service Management reads this property to keep the comment agent-only
				body.properties = [
					{ key: "sd.public.comment", value: { internal: true } },
				];
			}
			await call(
				"POST",
				`/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
				{ body },
			);
		},

		async getTransitions(key) {
			const data = (await call(
				"GET",
				`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
			)) as { transitions: JiraTransition[] };
			return data.transitions;
		},

		async transitionIssue(key, transitionId, fields) {
			const body: Record<string, unknown> = {
				transition: { id: transitionId },
			};
			if (fields) body.fields = fields;
			await call(
				"POST",
				`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
				{ body },
			);
		},

		async getWorkTypes() {
			const data = (await call(
				"GET",
				`/rest/api/3/issue/createmeta/${JIRA_PROJECT_KEY}/issuetypes`,
			)) as { issueTypes?: JiraWorkType[]; values?: JiraWorkType[] };
			return data.issueTypes ?? data.values ?? [];
		},
	};
}
