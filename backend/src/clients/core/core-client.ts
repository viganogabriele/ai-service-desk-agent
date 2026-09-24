import { z } from "zod";

// Shapes from CORE_API.md §6.A (import), §8 (events) and §7 (export).

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
}

const importResponse = z.object({ ticket_id: z.string() });

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
				headers: { "Idempotency-Key": `${externalKey}:${contentHash}` },
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
	};
}
