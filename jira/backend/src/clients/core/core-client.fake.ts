import {
	CoreApiError,
	type CoreClient,
	type CoreEvent,
	type CoreImport,
} from "./core-client";

export type FakeCore = CoreClient & {
	imports: CoreImport[];
	/** Sets the effective state the Core would export for a ticket. */
	setEffectiveState(ticketId: string, record: Record<string, unknown>): void;
	/** Appends an event to the Core's log and returns its seq. */
	emit(event: Omit<CoreEvent, "seq" | "event_id" | "occurred_at">): number;
};

/** In-memory Core for tests and local dev, following CORE_API.md. */
export function createFakeCoreClient(): FakeCore {
	const imports: CoreImport[] = [];
	const ticketIds = new Map<string, string>();
	const seenHashes = new Set<string>();
	const effective = new Map<string, Record<string, unknown>>();
	const events: CoreEvent[] = [];

	return {
		imports,

		setEffectiveState(ticketId, record) {
			effective.set(ticketId, record);
		},

		emit(event) {
			const seq = events.length + 1;
			events.push({
				...event,
				seq,
				event_id: `evt-${seq}`,
				occurred_at: new Date().toISOString(),
			});
			return seq;
		},

		async importTicket(input) {
			const ticketId =
				ticketIds.get(input.externalKey) ?? `t-${ticketIds.size + 1}`;
			ticketIds.set(input.externalKey, ticketId);
			const idempotencyKey = `${input.externalKey}:${input.contentHash}`;
			if (!seenHashes.has(idempotencyKey)) {
				seenHashes.add(idempotencyKey);
				imports.push(structuredClone(input));
			}
			return { ticketId };
		},

		async listEvents(afterSeq) {
			return events.filter((e) => e.seq > afterSeq);
		},

		async exportTicket(ticketId) {
			const record = effective.get(ticketId);
			if (!record)
				throw new CoreApiError(404, "GET", `/tickets/${ticketId}/export`, "");
			return structuredClone(record);
		},
	};
}
