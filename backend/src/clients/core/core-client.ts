import { createHash } from "node:crypto";
import { z } from "zod";

// Shapes from CORE_API.md §6.A (import), §8 (events) and §7 (export).

/** Python's json.dumps(value, sort_keys=True, ensure_ascii=False), for JSON-safe values. */
function pythonJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(pythonJson).join(", ")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pythonJson(v)}`).join(", ")}}`;
	}
	return JSON.stringify(value ?? null);
}

/** The Core's content_hash of a snapshot's fields (core/api/core.py `content_hash`). */
export function coreContentHash(fields: Record<string, unknown>): string {
	return createHash("sha256").update(pythonJson(fields)).digest("hex");
}

/** The Core expects external_key immediately followed by its own content hash. */
export function coreIdempotencyKey(
	externalKey: string,
	fields: Record<string, unknown>,
): string {
	return `${externalKey}${coreContentHash(fields)}`;
}

export type CoreEvent = {
	seq: number;
	event_id: string;
	type: string;
	occurred_at: string;
	ticket_id?: string | undefined;
	run_id?: string | undefined;
	payload: Record<string, unknown>;
};

export type CoreImport = {
	externalKey: string;
	contentHash: string;
	/** Normalised fields, same names as the challenge file. */
	fields: Record<string, unknown>;
};

/** POST /tickets/{id}/closure body (CORE_API §6C.2, §12). */
export type CoreClosure = {
	/** The final record, same names as the challenge file. */
	fields: Record<string, unknown>;
	resolutionNote: string | null;
	resolver: string | null;
	actor: string;
};

export class CoreApiError extends Error {
	readonly status: number;

	constructor(status: number, method: string, path: string, body: string) {
		super(`Core ${method} ${path} -> ${status}: ${body.slice(0, 500)}`);
		this.name = "CoreApiError";
		this.status = status;
	}
}

export interface CoreClient {
	/** POST /tickets. Idempotent on external_key + content_hash. */
	importTicket(input: CoreImport): Promise<{ ticketId: string }>;
	/** GET /events?after_seq=, oldest first. */
	listEvents(afterSeq: number): Promise<CoreEvent[]>;
	/** GET /tickets/{id}/export: effective state as one challenge record. */
	exportTicket(ticketId: string): Promise<Record<string, unknown>>;
	/** POST /tickets/{id}/closure. Not idempotent: every call is stored. */
	closeTicket(
		ticketId: string,
		closure: CoreClosure,
	): Promise<{ outcome: string }>;
	/** POST /demo/tickets: a new challenge-format ticket written by the Core, not stored. */
	demoTicket(): Promise<Record<string, unknown>>;
	/** GET /tickets: every ticket the Core holds. */
	listTickets(): Promise<CoreTicketRef[]>;
	/** DELETE /tickets/{id}: the ticket is gone from Jira. 404 when the Core has no such ticket. */
	deleteTicket(ticketId: string): Promise<void>;
}

export type CoreTicketRef = { ticketId: string; externalKey: string };

const importResponse = z.object({ ticket_id: z.string() });

const closureResponse = z.object({ outcome: z.string() });

const demoResponse = z.object({ fields: z.record(z.string(), z.unknown()) });

const ticketsResponse = z
	.object({
		tickets: z.array(
			z.object({ ticket_id: z.string(), external_key: z.string() }),
		),
	})
	.transform((r) =>
		r.tickets.map((t) => ({
			ticketId: t.ticket_id,
			externalKey: t.external_key,
		})),
	);

const eventSchema = z.object({
	seq: z.number().int(),
	event_id: z.string(),
	type: z.string(),
	occurred_at: z.string(),
	ticket_id: z
		.string()
		.nullish()
		.transform((v) => v ?? undefined),
	run_id: z
		.string()
		.nullish()
		.transform((v) => v ?? undefined),
	payload: z.record(z.string(), z.unknown()).default({}),
});

const eventsResponse = z.union([
	z.array(eventSchema),
	z.object({ events: z.array(eventSchema) }).transform((r) => r.events),
]);

const exportResponse = z.union([
	z
		.object({ records: z.array(z.record(z.string(), z.unknown())).length(1) })
		.transform((r) => r.records[0] ?? {}),
	z.record(z.string(), z.unknown()),
]);

export function createRealCoreClient(baseUrl: string): CoreClient {
	const base = baseUrl.replace(/\/+$/, "");

	async function call(
		method: string,
		path: string,
		init: { body?: unknown; headers?: Record<string, string> } = {},
	): Promise<unknown> {
		const request: RequestInit = {
			method,
			headers: { Accept: "application/json", ...init.headers },
		};
		if (init.body !== undefined) {
			request.body = JSON.stringify(init.body);
			request.headers = {
				...request.headers,
				"Content-Type": "application/json",
			};
		}
		const res = await fetch(base + path, request);
		const text = await res.text();
		if (!res.ok) throw new CoreApiError(res.status, method, path, text);
		return text ? JSON.parse(text) : null;
	}

	return {
		async importTicket({ externalKey, contentHash, fields }) {
			const data = await call("POST", "/tickets", {
				headers: { "Idempotency-Key": coreIdempotencyKey(externalKey, fields) },
				body: { external_key: externalKey, content_hash: contentHash, fields },
			});
			return { ticketId: importResponse.parse(data).ticket_id };
		},

		async listEvents(afterSeq) {
			const data = await call("GET", `/events?after_seq=${afterSeq}`);
			return eventsResponse.parse(data).sort((a, b) => a.seq - b.seq);
		},

		async exportTicket(ticketId) {
			const data = await call(
				"GET",
				`/tickets/${encodeURIComponent(ticketId)}/export`,
			);
			return exportResponse.parse(data);
		},

		async closeTicket(ticketId, { fields, resolutionNote, resolver, actor }) {
			const data = await call(
				"POST",
				`/tickets/${encodeURIComponent(ticketId)}/closure`,
				{ body: { fields, resolution_note: resolutionNote, resolver, actor } },
			);
			return { outcome: closureResponse.parse(data).outcome };
		},

		async demoTicket() {
			const data = await call("POST", "/demo/tickets");
			return demoResponse.parse(data).fields;
		},

		async listTickets() {
			return ticketsResponse.parse(await call("GET", "/tickets"));
		},

		async deleteTicket(ticketId) {
			await call("DELETE", `/tickets/${encodeURIComponent(ticketId)}`);
		},
	};
}
