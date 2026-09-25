import type { SQL } from "bun";
import type { CoreClient } from "../clients/core/core-client";
import type { JiraClient } from "../clients/jira/jira-client";
import { log } from "../lib/log";
import { consumeCoreEvents, pushToCore, sendClosures } from "./core-sync";
import { syncFromJira } from "./jira-sync";
import { reconcileWithJira } from "./reconcile";

// Checking every stored ticket against Jira lists the whole project, so not on every pass.
const RECONCILE_MS = 5 * 60_000;

export type SyncSummary = {
	jira: { upserted: number };
	/** Tickets removed because Jira no longer has them; null when this pass did not check. */
	removed: { postgres: number; core: number } | null;
	core:
		| { configured: false }
		| {
				configured: true;
				pushed: number;
				closed: number;
				processed: number;
				writebacks: number;
		  };
};

export type Syncer = {
	/**
	 * One pass: Jira -> Postgres -> Core (deletions, snapshots, closures), then Core events ->
	 * Jira. `full` re-reads every ticket and checks for deletions now, not every few minutes.
	 */
	syncNow(options?: { full?: boolean }): Promise<SyncSummary>;
	/** Runs syncNow on an interval until the returned function is called. */
	start(everySeconds: number): () => void;
};

/** Serialises every sync pass, so a scheduled pass and POST /sync never overlap. */
export function createSyncer(
	jira: JiraClient,
	core: CoreClient | null,
	sql: SQL,
): Syncer {
	let queue: Promise<unknown> = Promise.resolve();
	// The first pass after startup checks for deletions.
	let reconciledAt = Number.NEGATIVE_INFINITY;

	async function pass(full: boolean): Promise<SyncSummary> {
		const fromJira = await syncFromJira(jira, sql, { full });
		let removed: SyncSummary["removed"] = null;
		if (full || Date.now() - reconciledAt >= RECONCILE_MS) {
			removed = await reconcileWithJira(jira, core, sql);
			reconciledAt = Date.now();
		}
		if (!core) return { jira: fromJira, removed, core: { configured: false } };
		const { pushed } = await pushToCore(core, sql);
		const { closed } = await sendClosures(core, sql);
		const events = await consumeCoreEvents(core, jira, sql);
		return {
			jira: fromJira,
			removed,
			core: { configured: true, pushed, closed, ...events },
		};
	}

	function syncNow({ full = false } = {}): Promise<SyncSummary> {
		const run = queue.then(() => pass(full));
		queue = run.catch(() => undefined);
		return run;
	}

	return {
		syncNow,
		start(everySeconds) {
			let busy = false;
			const tick = async () => {
				if (busy) return;
				busy = true;
				try {
					await syncNow();
				} catch (error) {
					log.error("Sync pass failed, retrying on the next tick", error);
				} finally {
					busy = false;
				}
			};
			void tick();
			const timer = setInterval(tick, everySeconds * 1000);
			return () => clearInterval(timer);
		},
	};
}
