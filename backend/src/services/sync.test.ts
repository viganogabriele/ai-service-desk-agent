import { describe, expect, it } from "vitest";
import {
	createFakeJiraClient,
	fakeIssue,
} from "../clients/jira/jira-client.fake";
import { loadTickets } from "../db/store";
import { testBackend } from "../db/test-db";
import { DASHBOARD_ACTOR } from "./core-sync";

function resolvedIssue(key: string) {
	return fakeIssue(key, {
		status: { name: "Completed", statusCategory: { key: "done" } },
		resolution: { id: "1", name: "Done" },
	});
}

async function setup() {
	const jira = createFakeJiraClient([
		fakeIssue("SUP-1"),
		fakeIssue("SUP-2"),
		resolvedIssue("SUP-3"),
	]);
	const backend = await testBackend({ jira });
	const core = backend.core;
	if (!core) throw new Error("fake Core missing");
	return { ...backend, core };
}

async function stored(
	sql: Awaited<ReturnType<typeof setup>>["sql"],
	key: string,
) {
	const [ticket] = await loadTickets(sql, key);
	if (!ticket) throw new Error(`${key} not stored`);
	return ticket;
}

describe("Jira -> Postgres -> Core", () => {
	it("stores every ticket and sends only open ones to the Core, once", async () => {
		const { syncer, core, sql } = await setup();

		const first = await syncer.syncNow();
		expect(first.jira.upserted).toBe(3);
		expect(first.core).toMatchObject({ configured: true, pushed: 2 });
		expect(core.imports.map((i) => i.externalKey)).toEqual(["SUP-1", "SUP-2"]);

		const sent = core.imports[0];
		expect(sent?.fields).not.toHaveProperty("Key");
		expect(sent?.fields).toMatchObject({
			Summary: "Tax Reporting portal unreachable",
		});
		expect(sent?.contentHash).toBe((await stored(sql, "SUP-1")).contentHash);

		const second = await syncer.syncNow();
		expect(second.core).toMatchObject({ pushed: 0 });
		expect(core.imports).toHaveLength(2);
	});

	it("sends a new snapshot when someone changes the ticket in Jira", async () => {
		const { syncer, core, jira } = await setup();
		await syncer.syncNow();

		await jira.updateIssue("SUP-1", {
			fields: { summary: "Edited by an agent in Jira" },
		});
		await syncer.syncNow();

		expect(core.imports.map((i) => i.externalKey)).toEqual([
			"SUP-1",
			"SUP-2",
			"SUP-1",
		]);
		expect(core.imports[2]?.fields).toMatchObject({
			Summary: "Edited by an agent in Jira",
		});
	});

	it("does not re-triage a ticket after an operator edits it through the API", async () => {
		const { syncer, core, app } = await setup();
		await syncer.syncNow();

		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ Key: "SUP-1", Assignee: "jane.doe@intcom.com" }),
		});
		expect(res.status).toBe(200);
		await syncer.syncNow();

		expect(core.imports.map((i) => i.externalKey)).toEqual(["SUP-1", "SUP-2"]);
	});
});

describe("closures -> Core", () => {
	async function resolve(
		app: Awaited<ReturnType<typeof setup>>["app"],
		key: string,
		patch: Record<string, unknown>,
	) {
		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ Key: key, ...patch }),
		});
		expect(res.status).toBe(200);
	}

	it("sends the outcome of a ticket resolved as done to the Core, once", async () => {
		const { syncer, core, app, sql } = await setup();
		await syncer.syncNow();
		const { coreTicketId } = await stored(sql, "SUP-1");

		await resolve(app, "SUP-1", {
			Assignee: "jane.doe@intcom.com",
			Resolution: "done",
			"All Comments": [
				"oliver.varga@intcom.com: Resolution: Renewed the expired portal certificate and verified the login works.",
			],
		});
		const first = await syncer.syncNow();
		expect(first.core).toMatchObject({ closed: 1 });
		expect(core.closures).toEqual([
			expect.objectContaining({
				ticketId: coreTicketId,
				resolutionNote:
					"Resolution: Renewed the expired portal certificate and verified the login works.",
				resolver: "oliver.varga@intcom.com",
				actor: "jira-sync",
				fields: expect.objectContaining({ Status: "done", Resolution: "done" }),
			}),
		]);
		expect(core.closures[0]?.fields).not.toHaveProperty("Key");

		const second = await syncer.syncNow();
		expect(second.core).toMatchObject({ closed: 0 });
		expect(core.closures).toHaveLength(1);
	});

	it("falls back to the assignee and sends a missing note as null", async () => {
		const { syncer, core, app } = await setup();
		await syncer.syncNow();

		await resolve(app, "SUP-1", {
			Assignee: "jane.doe@intcom.com",
			Resolution: "done",
		});
		await syncer.syncNow();

		expect(core.closures).toEqual([
			expect.objectContaining({
				resolutionNote: null,
				resolver: "jane.doe@intcom.com",
			}),
		]);
	});

	it("skips other resolutions and tickets the Core never saw", async () => {
		const { syncer, core, app } = await setup();
		await syncer.syncNow();

		await resolve(app, "SUP-2", {
			Resolution: "clarification",
			"All Comments": ["Please confirm which entity needs the licence."],
		});
		// SUP-3 was resolved before the first sync, so it never reached the Core.
		const summary = await syncer.syncNow();

		expect(summary.core).toMatchObject({ closed: 0 });
		expect(core.closures).toEqual([]);
	});
});

describe("Core events -> Jira", () => {
	async function triaged() {
		const backend = await setup();
		await backend.syncer.syncNow();
		const { coreTicketId, record } = await stored(backend.sql, "SUP-1");
		if (!coreTicketId) throw new Error("SUP-1 was not sent to the Core");
		const { Key: _key, ...fields } = record;
		// What GET /tickets/{id}/export returns: the effective state, challenge format.
		backend.core.setEffectiveState(coreTicketId, {
			...fields,
			"Affected Business or IT Services": ["Fund Pricing"],
			"Service Team(s)": ["Valuation & Pricing"],
			Assignee: "oliver.varga@intcom.com",
			Urgency: "High",
			Impact: "Medium",
			Priority: "High",
			"All Comments": [
				...fields["All Comments"],
				"oliver.varga@intcom.com: Resolution: feed restarted.",
			],
		});
		return { ...backend, coreTicketId };
	}

	it("writes the effective state of an auto_applied run and logs it", async () => {
		const { syncer, core, sql, coreTicketId } = await triaged();
		core.emit({
			type: "run.completed",
			ticket_id: coreTicketId,
			payload: { lane: "auto_applied", lane_reasons: [] },
		});

		const summary = await syncer.syncNow();
		expect(summary.core).toMatchObject({ processed: 1, writebacks: 1 });

		expect((await stored(sql, "SUP-1")).record).toMatchObject({
			"Affected Business or IT Services": ["Fund Pricing"],
			"Service Team(s)": ["Valuation & Pricing"],
			Assignee: "oliver.varga@intcom.com",
			Urgency: "High",
			Impact: "Medium",
			Priority: "High",
			"All Comments": ["oliver.varga@intcom.com: Resolution: feed restarted."],
		});
		const [writeback] =
			await sql`SELECT trigger, core_event_seq::int AS core_event_seq, ok FROM writebacks`;
		expect(writeback).toEqual({
			trigger: "core_auto_applied",
			core_event_seq: 1,
			ok: true,
		});
	});

	it("does not send the Core's own write back to it as a new snapshot", async () => {
		const { syncer, core, coreTicketId } = await triaged();
		core.emit({
			type: "run.completed",
			ticket_id: coreTicketId,
			payload: { lane: "auto_applied" },
		});
		await syncer.syncNow();
		const importsAfterWrite = core.imports.length;

		await syncer.syncNow();
		expect(core.imports).toHaveLength(importsAfterWrite);
	});

	it("leaves Jira alone for runs that need review", async () => {
		const { syncer, core, sql, coreTicketId } = await triaged();
		core.emit({
			type: "run.completed",
			ticket_id: coreTicketId,
			payload: { lane: "needs_review" },
		});
		core.emit({
			type: "run.completed",
			ticket_id: coreTicketId,
			payload: { lane: "human_only" },
		});

		const summary = await syncer.syncNow();
		expect(summary.core).toMatchObject({ processed: 2, writebacks: 0 });
		expect((await stored(sql, "SUP-1")).record.Urgency).toBe("Medium");
	});

	it("writes human overrides and never repeats an event", async () => {
		const { syncer, core, sql, coreTicketId } = await triaged();
		core.emit({
			type: "decision.overridden",
			ticket_id: coreTicketId,
			payload: {},
		});
		await syncer.syncNow();

		// Replay from the start, as after a lost cursor.
		await sql`DELETE FROM sync_state WHERE name = 'core.last_event_seq'`;
		const replay = await syncer.syncNow();
		expect(replay.core).toMatchObject({ processed: 1, writebacks: 0 });

		const rows = await sql`SELECT trigger FROM writebacks`;
		expect([...rows]).toEqual([{ trigger: "core_override" }]);
	});

	it("keeps Jira's status when the Core's snapshot of it is stale", async () => {
		const { syncer, core, sql, app, coreTicketId } = await triaged();
		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ Key: "SUP-1", Status: "in progress" }),
		});
		expect(res.status).toBe(200);

		// The export still carries the "open" status of the snapshot the Core triaged.
		core.emit({
			type: "run.completed",
			ticket_id: coreTicketId,
			payload: { lane: "auto_applied" },
		});
		await syncer.syncNow();

		expect((await stored(sql, "SUP-1")).record).toMatchObject({
			Status: "in progress",
			Assignee: "oliver.varga@intcom.com",
		});
	});

	it("leaves Jira alone for overrides the dashboard already wrote", async () => {
		const { syncer, core, sql, coreTicketId } = await triaged();
		core.emit({
			type: "decision.overridden",
			ticket_id: coreTicketId,
			payload: { actor: DASHBOARD_ACTOR, changes: [] },
		});
		core.emit({
			type: "comment.updated",
			ticket_id: coreTicketId,
			payload: { stale: true, origin: null },
		});

		const summary = await syncer.syncNow();
		expect(summary.core).toMatchObject({ processed: 2, writebacks: 0 });
		expect((await stored(sql, "SUP-1")).record.Urgency).toBe("Medium");
	});

	it("logs an export the Core refuses and moves on", async () => {
		const { syncer, core, sql } = await triaged();
		core.emit({
			type: "decision.overridden",
			ticket_id: "t-unknown-in-core",
			payload: {},
		});
		core.emit({
			type: "comment.updated",
			ticket_id: "t-1",
			payload: { stale: false, origin: "edited" },
		});

		// t-1 is SUP-1; an empty Summary is not a valid challenge record.
		core.setEffectiveState("t-1", { Summary: "" });
		const summary = await syncer.syncNow();
		expect(summary.core).toMatchObject({ processed: 2 });

		const rows = await sql`SELECT external_key, trigger, ok FROM writebacks`;
		expect([...rows]).toEqual([
			{ external_key: "SUP-1", trigger: "core_comment", ok: false },
		]);
	});
});
