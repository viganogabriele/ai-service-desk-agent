import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { adf } from "../clients/jira/adf";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import {
	createFakeJiraClient,
	fakeIssue,
} from "../clients/jira/jira-client.fake";
import { testBackend } from "../db/test-db";
import type { ErrorBody } from "../lib/errors";

/** A backend whose Postgres copy is in sync with the fake Jira. */
async function setup(
	jira: JiraClient = createFakeJiraClient([
		fakeIssue("SUP-1"),
		fakeIssue("SUP-2"),
	]),
) {
	const backend = await testBackend({ jira, withCore: false });
	await backend.syncer.syncNow();
	return { ...backend, client: testClient(backend.app) };
}

async function recordsByKey(
	client: Awaited<ReturnType<typeof setup>>["client"],
) {
	const body = await (await client.tickets.$get()).json();
	return new Map(body.records.map((r) => [r.Key, r]));
}

describe("GET /tickets", () => {
	it("returns the stored tickets in the challenge file envelope", async () => {
		const res = await (await setup()).client.tickets.$get();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.actualIssueCount).toBe(2);
		expect(body.jql).toContain("project = SUP");
		expect(body.records.map((r) => r.Key)).toEqual(["SUP-1", "SUP-2"]);
	});
});

describe("POST /sync", () => {
	it("maps a Jira failure to a 502 without leaking the Jira response", async () => {
		const failing: JiraClient = {
			...createFakeJiraClient(),
			searchIssues: () =>
				Promise.reject(new JiraApiError(401, "GET", "/search", "secret body")),
		};
		const { app } = await testBackend({ jira: failing, withCore: false });
		const res = await app.request("/sync", { method: "POST" });
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: {
				message: "Sync failed: Jira returned 401",
				code: "upstream_error",
			},
		});
	});
});

describe("POST /tickets", () => {
	it("logs every write to Jira", async () => {
		const { client, sql } = await setup();
		await client.tickets.$post({
			json: [
				{ Key: "SUP-1", Summary: "Changed" },
				{ Key: "SUP-99", Summary: "Unknown" },
			],
		});
		const rows = await sql`
			SELECT external_key, trigger, ok, changed FROM writebacks ORDER BY external_key`;
		expect([...rows]).toEqual([
			{ external_key: "SUP-1", trigger: "api", ok: true, changed: ["Summary"] },
			{ external_key: "SUP-99", trigger: "api", ok: false, changed: [] },
		]);
	});

	it("applies a single-ticket patch", async () => {
		const { client } = await setup();
		const res = await client.tickets.$post({
			json: {
				Key: "SUP-1",
				Summary: "New summary",
				Assignee: "oliver.varga@intcom.com",
				"Service Team(s)": ["Valuation & Pricing"],
				"Business Entity": ["France", "Nordics"],
			},
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			results: [
				{
					key: "SUP-1",
					ok: true,
					changed: [
						"Summary",
						"Business Entity",
						"Service Team(s)",
						"Assignee",
					],
					warnings: [],
				},
			],
		});

		expect((await recordsByKey(client)).get("SUP-1")).toMatchObject({
			Summary: "New summary",
			Assignee: "oliver.varga@intcom.com",
			"Service Team(s)": ["Valuation & Pricing"],
			"Business Entity": ["France", "Nordics"],
		});
	});

	it("keeps footer data when the description is edited", async () => {
		const { client } = await setup(
			createFakeJiraClient([
				fakeIssue("SUP-7", {
					description: adf(
						"Old text.\n\n---\nOriginal request type: New License\nOriginal created date: 2026-01-02 03:04\nOriginal status: open\nLinked issues: REP-20247",
					),
				}),
			]),
		);
		await client.tickets.$post({
			json: { Key: "SUP-7", Description: "Rewritten by the AI." },
		});
		expect((await recordsByKey(client)).get("SUP-7")).toMatchObject({
			Description: "Rewritten by the AI.",
			"Request type": "New License",
			"Created date": "2026-01-02 03:04",
			"Linked issues": ["REP-20247"],
		});
	});

	it("derives priority from urgency and impact via the README matrix", async () => {
		const { client } = await setup();
		// Lowest x High -> Low
		await client.tickets.$post({
			json: { Key: "SUP-1", Urgency: "Lowest", Impact: "High" },
		});
		expect((await recordsByKey(client)).get("SUP-1")).toMatchObject({
			Urgency: "Lowest",
			Impact: "High",
			Priority: "Low",
		});
	});

	it("accepts a full record back and writes only what changed", async () => {
		const { client } = await setup();
		await client.tickets.$post({
			json: { Key: "SUP-1", "All Comments": ["first comment"] },
		});
		const record = (await recordsByKey(client)).get("SUP-1");
		if (!record) throw new Error("SUP-1 missing");

		// The dashboard edits urgency and sends the whole record back, stale Priority included.
		const res = await client.tickets.$post({
			json: { ...record, Urgency: "Critical", Severity: "Sev-1" },
		});
		const { results } = await res.json();
		expect(results[0]).toMatchObject({
			ok: true,
			changed: ["Urgency", "Severity"],
		});

		expect((await recordsByKey(client)).get("SUP-1")).toMatchObject({
			Urgency: "Highest",
			Impact: "Medium",
			Priority: "High",
			Severity: "Sev-1",
			"All Comments": ["first comment"],
		});
	});

	it("appends comments and resolves the ticket", async () => {
		const { client } = await setup();
		await client.tickets.$post({
			json: {
				Key: "SUP-2",
				Resolution: "clarification",
				"All Comments": ["Please confirm which entity needs the licence."],
			},
		});
		expect((await recordsByKey(client)).get("SUP-2")).toMatchObject({
			Status: "done",
			Resolution: "clarification",
			"All Comments": ["Please confirm which entity needs the licence."],
		});
	});

	it("applies a bulk patch and reports per-ticket outcomes", async () => {
		const { client } = await setup();
		const res = await client.tickets.$post({
			json: [
				{ Key: "SUP-1", Priority: "High" },
				{ Key: "SUP-2", "Affected Business or IT Services": ["Not A Service"] },
				{ Key: "SUP-99", Priority: "High" },
			],
		});
		expect(res.status).toBe(200);
		const { results } = await res.json();
		expect(results[0]).toMatchObject({ key: "SUP-1", ok: true, warnings: [] });
		expect(results[1]).toMatchObject({ key: "SUP-2", ok: true });
		expect(results[1]?.warnings[0]).toContain("Not A Service");
		expect(results[2]).toMatchObject({ key: "SUP-99", ok: false });

		expect((await recordsByKey(client)).get("SUP-1")?.Priority).toBe("High");
	});

	it("rejects invalid bodies with the shared error shape", async () => {
		const { app } = await setup();
		const invalid = [
			{ Summary: "no key" },
			{ Key: "SUP-1", Urgency: 3 },
			[{ Key: "SUP-1" }, { Key: "SUP-1" }],
			[],
		];
		for (const body of invalid) {
			const res = await app.request("/tickets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			expect(res.status).toBe(400);
			const json = (await res.json()) as ErrorBody;
			expect(json.error.code).toBe("http_error");
		}
	});
});
