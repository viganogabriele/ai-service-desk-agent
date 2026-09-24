import { describe, expect, it } from "vitest";
import { CoreApiError } from "../clients/core/core-client";
import { JiraApiError } from "../clients/jira/jira-client";
import {
	createFakeJiraClient,
	fakeIssue,
} from "../clients/jira/jira-client.fake";
import { CORE_EVENT_CURSOR, getCursor, loadTickets } from "../db/store";
import { testBackend } from "../db/test-db";
import { consumeCoreEvents } from "./core-sync";
import { writeToJira } from "./jira-sync";
import { toTicketRecord } from "./tickets";

async function setup() {
	const backend = await testBackend({
		jira: createFakeJiraClient([fakeIssue("SUP-1"), fakeIssue("SUP-2")]),
	});
	await backend.syncer.syncNow();
	const core = backend.core;
	if (!core) throw new Error("Core missing");
	core.setEffectiveState("t-1", { Summary: "Core decision" });
	return { ...backend, core };
}

function override(core: Awaited<ReturnType<typeof setup>>["core"]) {
	return core.emit({
		type: "decision.overridden",
		ticket_id: "t-1",
		payload: {},
	});
}

describe("writeback recovery", () => {
	it("retries a transient Jira failure without consuming the event", async () => {
		const { core, jira, sql } = await setup();
		const seq = override(core);
		const update = jira.updateIssue;
		jira.updateIssue = async () => {
			throw new JiraApiError(503, "PUT", "/issue", "temporary");
		};
		await expect(consumeCoreEvents(core, jira, sql)).rejects.toThrow();
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBeNull();
		jira.updateIssue = update;
		await consumeCoreEvents(core, jira, sql);
		expect((await jira.getIssue("SUP-1", [])).fields.summary).toBe(
			"Core decision",
		);
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBe(String(seq));
		const rows =
			await sql`SELECT ok FROM writebacks WHERE core_event_seq = ${seq}`;
		expect([...rows]).toEqual([{ ok: true }]);
	});

	it.each([408, 429, 503])("retries Core HTTP %i", async (status) => {
		const { core, jira, sql } = await setup();
		override(core);
		const exportTicket = core.exportTicket;
		core.exportTicket = async () => {
			throw new CoreApiError(status, "GET", "/export", "temporary");
		};
		await expect(consumeCoreEvents(core, jira, sql)).rejects.toThrow();
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBeNull();
		core.exportTicket = exportTicket;
		await consumeCoreEvents(core, jira, sql);
		expect((await jira.getIssue("SUP-1", [])).fields.summary).toBe(
			"Core decision",
		);
	});

	it("keeps a permanent Jira failure from blocking later events", async () => {
		const { core, jira, sql } = await setup();
		override(core);
		jira.updateIssue = async () => {
			throw new JiraApiError(400, "PUT", "/issue", "invalid");
		};
		await consumeCoreEvents(core, jira, sql);
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBe("1");
		expect([...(await sql`SELECT ok FROM writebacks`)]).toEqual([
			{ ok: false },
		]);
	});

	it("retries refresh failures without duplicating an already written comment", async () => {
		const { core, jira, sql } = await setup();
		core.setEffectiveState("t-1", {
			"All Comments": ["written before refresh failed"],
		});
		override(core);
		const get = jira.getIssue;
		let reads = 0;
		jira.getIssue = async (key, fields) => {
			if (++reads === 2)
				throw new JiraApiError(503, "GET", "/issue", "refresh unavailable");
			return get(key, fields);
		};
		await expect(consumeCoreEvents(core, jira, sql)).rejects.toThrow();
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBeNull();
		await consumeCoreEvents(core, jira, sql);
		expect(
			(await loadTickets(sql, "SUP-1"))[0]?.record["All Comments"],
		).toEqual(["written before refresh failed"]);
		expect([...(await sql`SELECT ok FROM writebacks`)]).toEqual([{ ok: true }]);
	});

	it("does not swallow transient work-type failures as warnings", async () => {
		const { core, jira, sql } = await setup();
		core.setEffectiveState("t-1", { "Work type": "Service Request" });
		override(core);
		jira.updateIssue = async () => {
			throw new JiraApiError(503, "PUT", "/issue", "temporary");
		};
		await expect(consumeCoreEvents(core, jira, sql)).rejects.toThrow();
		expect(await getCursor(sql, CORE_EVENT_CURSOR)).toBeNull();
	});

	it("keeps the requested patch and applied changes when the refresh permanently fails", async () => {
		const { core, jira, sql } = await setup();
		override(core);
		const get = jira.getIssue;
		let reads = 0;
		jira.getIssue = async (key, fields) => {
			if (++reads === 2)
				throw new JiraApiError(404, "GET", "/issue", "no longer accessible");
			return get(key, fields);
		};
		await consumeCoreEvents(core, jira, sql);
		const rows = await sql`SELECT ok, requested, changed FROM writebacks`;
		expect([...rows]).toEqual([
			{
				ok: false,
				requested: { Key: "SUP-1", Summary: "Core decision" },
				changed: ["Summary"],
			},
		]);
	});

	it("logs successful tickets even if another batch item throws a network error", async () => {
		const { jira, sql } = await setup();
		const written = Promise.withResolvers<void>();
		const update = jira.updateIssue;
		const get = jira.getIssue;
		jira.updateIssue = async (key, input) => {
			await update(key, input);
			written.resolve();
		};
		jira.getIssue = async (key, fields) => {
			if (key === "SUP-2") {
				await written.promise;
				throw new TypeError("network failed");
			}
			return get(key, fields);
		};
		await expect(
			writeToJira(
				jira,
				sql,
				[
					{ Key: "SUP-1", Summary: "Successful batch item" },
					{ Key: "SUP-2", Summary: "Failed item" },
				],
				"api",
			),
		).rejects.toThrow("network failed");
		const rows =
			await sql`SELECT external_key, ok FROM writebacks ORDER BY external_key`;
		expect([...rows]).toEqual([
			{ external_key: "SUP-1", ok: true },
			{ external_key: "SUP-2", ok: false },
		]);
		expect((await loadTickets(sql, "SUP-1"))[0]?.record.Summary).toBe(
			"Successful batch item",
		);
	});
});

describe("effective-state writes", () => {
	it.each(["Highest", "Medium"])(
		"preserves Core priority %s when urgency and impact change",
		async (priority) => {
			const { core, jira, sql } = await setup();
			core.setEffectiveState("t-1", {
				Urgency: "Low",
				Impact: "Low",
				Priority: priority,
			});
			override(core);
			await consumeCoreEvents(core, jira, sql);
			expect(toTicketRecord(await jira.getIssue("SUP-1", [])).Priority).toBe(
				priority,
			);
		},
	);

	it.each([
		{ entities: ["Unknown entity"] },
		{ entities: ["France", "Unknown entity"] },
	])(
		"preserves the whole entity field if any value is unknown: $entities",
		async ({ entities }) => {
			const { jira, sql } = await setup();
			const [result] = await writeToJira(
				jira,
				sql,
				[{ Key: "SUP-1", "Business Entity": entities }],
				"api",
			);
			expect(result?.warnings.length).toBeGreaterThan(0);
			expect(
				toTicketRecord(await jira.getIssue("SUP-1", []))["Business Entity"],
			).toEqual(["Germany"]);
		},
	);

	it("still clears entities when explicitly given an empty array", async () => {
		const { jira, sql } = await setup();
		await writeToJira(
			jira,
			sql,
			[{ Key: "SUP-1", "Business Entity": [] }],
			"api",
		);
		expect(
			toTicketRecord(await jira.getIssue("SUP-1", []))["Business Entity"],
		).toEqual([]);
	});

	it("deduplicates a comment shared by concurrent API and Core writes", async () => {
		const { jira, sql, core, app } = await setup();
		const patch = { Key: "SUP-1", "All Comments": ["one comment"] };
		core.setEffectiveState("t-1", patch);
		override(core);
		await Promise.all([
			app.request("/tickets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			}),
			consumeCoreEvents(core, jira, sql),
		]);
		expect(
			toTicketRecord(await jira.getIssue("SUP-1", []))["All Comments"],
		).toEqual(["one comment"]);
	});

	it("deduplicates concurrent API requests and repeated text in one patch", async () => {
		const { jira, sql } = await setup();
		const patch = {
			Key: "SUP-1",
			"All Comments": ["one comment", " one comment "],
		};
		await Promise.all([
			writeToJira(jira, sql, [patch], "api"),
			writeToJira(jira, sql, [patch], "api"),
		]);
		expect(
			toTicketRecord(await jira.getIssue("SUP-1", []))["All Comments"],
		).toEqual(["one comment"]);
	});

	it("serializes identical single-comment writes", async () => {
		const { jira, sql } = await setup();
		const patch = { Key: "SUP-1", "All Comments": ["one comment"] };
		await Promise.all([
			writeToJira(jira, sql, [patch], "api"),
			writeToJira(jira, sql, [patch], "api"),
		]);
		expect(
			toTicketRecord(await jira.getIssue("SUP-1", []))["All Comments"],
		).toEqual(["one comment"]);
	});

	it("releases the ticket queue after a failed write", async () => {
		const { jira, sql } = await setup();
		const get = jira.getIssue;
		let fail = true;
		jira.getIssue = async (key, fields) => {
			if (fail) {
				fail = false;
				throw new TypeError("network failed");
			}
			return get(key, fields);
		};
		const outcomes = await Promise.allSettled([
			writeToJira(jira, sql, [{ Key: "SUP-1", Summary: "Failed" }], "api"),
			writeToJira(jira, sql, [{ Key: "SUP-1", Summary: "Recovered" }], "api"),
		]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			"rejected",
			"fulfilled",
		]);
		expect((await loadTickets(sql, "SUP-1"))[0]?.record.Summary).toBe(
			"Recovered",
		);
		expect([...(await sql`SELECT ok FROM writebacks ORDER BY id`)]).toEqual([
			{ ok: false },
			{ ok: true },
		]);
	});
});

describe("superseded Core events", () => {
	it.each(["needs_review", "human_only"])(
		"does not apply a newer %s run through an old auto event",
		async (lane) => {
			const { core, jira, sql } = await setup();
			core.emit({
				type: "run.completed",
				ticket_id: "t-1",
				run_id: "old",
				payload: { lane: "auto_applied" },
			});
			core.emit({
				type: "run.completed",
				ticket_id: "t-1",
				run_id: "new",
				payload: { lane },
			});
			await consumeCoreEvents(core, jira, sql);
			expect((await jira.getIssue("SUP-1", [])).fields.summary).not.toBe(
				"Core decision",
			);
			expect([...(await sql`SELECT * FROM writebacks`)]).toEqual([]);
		},
	);

	it("checks later event pages before applying an exported state", async () => {
		const { core, jira, sql } = await setup();
		core.emit({
			type: "run.completed",
			ticket_id: "t-1",
			payload: { lane: "auto_applied" },
		});
		core.emit({
			type: "run.completed",
			ticket_id: "t-2",
			payload: { lane: "needs_review" },
		});
		core.emit({
			type: "run.completed",
			ticket_id: "t-1",
			payload: { lane: "needs_review" },
		});
		const list = core.listEvents;
		core.listEvents = async (after) => (await list(after)).slice(0, 1);
		await consumeCoreEvents(core, jira, sql);
		expect((await jira.getIssue("SUP-1", [])).fields.summary).not.toBe(
			"Core decision",
		);
	});

	it("detects a new run published while the export was being read", async () => {
		const { core, jira, sql } = await setup();
		core.emit({
			type: "run.completed",
			ticket_id: "t-1",
			payload: { lane: "auto_applied" },
		});
		const exportTicket = core.exportTicket;
		core.exportTicket = async (id) => {
			core.emit({
				type: "run.completed",
				ticket_id: id,
				payload: { lane: "needs_review" },
			});
			return exportTicket(id);
		};
		await consumeCoreEvents(core, jira, sql);
		expect((await jira.getIssue("SUP-1", [])).fields.summary).not.toBe(
			"Core decision",
		);
	});

	it("still writes the latest auto-applied event after skipping an older one", async () => {
		const { core, jira, sql } = await setup();
		core.emit({
			type: "run.completed",
			ticket_id: "t-1",
			payload: { lane: "auto_applied" },
		});
		core.emit({
			type: "run.completed",
			ticket_id: "t-1",
			payload: { lane: "auto_applied" },
		});
		await consumeCoreEvents(core, jira, sql);
		expect((await jira.getIssue("SUP-1", [])).fields.summary).toBe(
			"Core decision",
		);
		const rows = await sql`SELECT core_event_seq::int AS seq FROM writebacks`;
		expect([...rows]).toEqual([{ seq: 2 }]);
	});
});
