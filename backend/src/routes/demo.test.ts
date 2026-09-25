import { describe, expect, it } from "vitest";
import { CoreApiError } from "../clients/core/core-client";
import { JIRA_FIELDS } from "../clients/jira/field-config";
import { createFakeJiraClient } from "../clients/jira/jira-client.fake";
import { loadTickets } from "../db/store";
import { testBackend } from "../db/test-db";

async function setup() {
	const backend = await testBackend({ jira: createFakeJiraClient([]) });
	const create = async () => {
		const res = await backend.app.request("/demo/tickets", { method: "POST" });
		// The Core push runs after the response; wait for it before the next test resets the database.
		await backend.syncer.syncNow();
		return res;
	};
	return { ...backend, create };
}

describe("POST /demo/tickets", () => {
	it("files the Core's ticket in Jira and sends it to the Core for triage", async () => {
		const { create, core, jira, sql } = await setup();
		const res = await create();
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ key: "SUP-1", warnings: [] });

		const [stored] = await loadTickets(sql);
		expect(stored?.record).toMatchObject({
			Key: "SUP-1",
			"Work type": "Incident",
			"Request type": "Machine Created Alert",
			Summary: "Overnight price load stopped for three funds",
			"Affected Business or IT Services": ["Tax Reporting"],
			"Business Entity": ["Luxembourg"],
			"Service Team(s)": [],
			Reporter: "sa_accounting@intcom.com",
			Assignee: null,
			Urgency: "High",
			Impact: "Medium",
			// The matrix value of the stored urgency and impact.
			Priority: "High",
			Status: "open",
			"All Comments": ["eva.keller@intcom.com: Still missing at 07:30."],
		});
		const issue = await jira.getIssue("SUP-1", ["labels"]);
		expect(issue.fields.labels).toEqual(["demo"]);
		expect(issue.fields[JIRA_FIELDS.serviceTeam]).toBeNull();
		expect(core?.imports.map((i) => i.externalKey)).toEqual(["SUP-1"]);
	});

	it("maps a Core failure to a 502 and creates nothing", async () => {
		const { create, core, jira } = await setup();
		if (core)
			core.demoTicket = () =>
				Promise.reject(
					new CoreApiError(503, "POST", "/demo/tickets", "llm_unavailable"),
				);
		const res = await create();
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: {
				message: "Demo ticket failed: the Core returned 503",
				code: "upstream_error",
			},
		});
		expect(await jira.searchIssues("", [])).toEqual([]);
	});

	it("refuses when the Core is not configured", async () => {
		const { app } = await testBackend({ withCore: false });
		const res = await app.request("/demo/tickets", { method: "POST" });
		expect(res.status).toBe(503);
	});
});
