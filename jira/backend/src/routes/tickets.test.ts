import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { adf } from "../clients/jira/adf";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";
import {
	createFakeJiraClient,
	fakeIssue,
} from "../clients/jira/jira-client.fake";
import type { ErrorBody } from "../lib/errors";

function setup(
	jira: JiraClient = createFakeJiraClient([
		fakeIssue("SUP-1"),
		fakeIssue("SUP-2"),
	]),
) {
	const app = createApp(jira);
	return { app, client: testClient(app) };
}

async function recordsByKey(client: ReturnType<typeof setup>["client"]) {
	const body = await (await client.tickets.$get()).json();
	return new Map(body.records.map((r) => [r.Key, r]));
}

describe("GET /tickets", () => {
	it("returns every ticket in the challenge file envelope", async () => {
		const res = await setup().client.tickets.$get();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.actualIssueCount).toBe(2);
		expect(body.jql).toContain("project = SUP");
		expect(body.records.map((r) => r.Key)).toEqual(["SUP-1", "SUP-2"]);
	});

	it("maps a Jira failure to a 502 without leaking the Jira response", async () => {
		const failing: JiraClient = {
			...createFakeJiraClient(),
			searchIssues: () =>
				Promise.reject(new JiraApiError(401, "GET", "/search", "secret body")),
		};
		const res = await setup(failing).app.request("/tickets");
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: {
				message: "Reading tickets from Jira failed",
				code: "upstream_error",
			},
		});
	});
});

describe("POST /tickets", () => {
	it("applies a single-ticket patch", async () => {
		const { client } = setup();
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
			results: [{ key: "SUP-1", ok: true, warnings: [] }],
		});

		expect((await recordsByKey(client)).get("SUP-1")).toMatchObject({
			Summary: "New summary",
			Assignee: "oliver.varga@intcom.com",
			"Service Team(s)": ["Valuation & Pricing"],
			"Business Entity": ["France", "Nordics"],
		});
	});

	it("keeps footer data when the description is edited", async () => {
		const { client } = setup(
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

	it("derives priority from the urgency and impact Jira accepted", async () => {
		const { client } = setup();
		// Jira has no "Lowest" urgency, so it lands on "Low": Low x High -> Medium
		await client.tickets.$post({
			json: { Key: "SUP-1", Urgency: "Lowest", Impact: "High" },
		});
		expect((await recordsByKey(client)).get("SUP-1")).toMatchObject({
			Urgency: "Low",
			Impact: "High",
			Priority: "Medium",
		});
	});

	it("appends comments and resolves the ticket", async () => {
		const { client } = setup();
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
		const { client } = setup();
		const res = await client.tickets.$post({
			json: [
				{ Key: "SUP-1", Priority: "High" },
				{ Key: "SUP-2", "Affected Business or IT Services": ["Not A Service"] },
				{ Key: "SUP-99", Priority: "High" },
			],
		});
		expect(res.status).toBe(200);
		const { results } = await res.json();
		expect(results[0]).toEqual({ key: "SUP-1", ok: true, warnings: [] });
		expect(results[1]).toMatchObject({ key: "SUP-2", ok: true });
		expect(results[1]?.warnings[0]).toContain("Not A Service");
		expect(results[2]).toMatchObject({ key: "SUP-99", ok: false });

		expect((await recordsByKey(client)).get("SUP-1")?.Priority).toBe("High");
	});

	it("rejects invalid bodies with the shared error shape", async () => {
		const { app } = setup();
		const invalid = [
			{ Summary: "no key" },
			{ Key: "SUP-1", Status: "done" },
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
