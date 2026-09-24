import type { SQL } from "bun";
import type { CoreClient } from "../clients/core/core-client";
import type { JiraClient } from "../clients/jira/jira-client";
import { log } from "../lib/log";
import { consumeCoreEvents, pushToCore } from "./core-sync";
import { syncFromJira } from "./jira-sync";

export type SyncSummary = {
	jira: { upserted: number };
	core:
		| { configured: false }
		| {
				configured: true;
				pushed: number;
				processed: number;
				writebacks: number;
		  };
};

export type Syncer = {
	/** One full pass: Jira -> Postgres -> Core, then Core events -> Jira. */
	syncNow(): Promise<SyncSummary>;
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

	async function pass(): Promise<SyncSummary> {
		const fromJira = await syncFromJira(jira, sql);
		if (!core) return { jira: fromJira, core: { configured: false } };
		const { pushed } = await pushToCore(core, sql);
		const events = await consumeCoreEvents(core, jira, sql);
		return { jira: fromJira, core: { configured: true, pushed, ...events } };
	}

	function syncNow(): Promise<SyncSummary> {
		const run = queue.then(pass);
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
