import { SQL } from "bun";
import { createApp } from "../app";
import {
	createFakeCoreClient,
	type FakeCore,
} from "../clients/core/core-client.fake";
import type { JiraClient, JiraIssue } from "../clients/jira/jira-client";
import { createFakeJiraClient } from "../clients/jira/jira-client.fake";
import { createSyncer } from "../services/sync";
import { migrate } from "./migrate";

let shared: SQL | null = null;

/** An empty, migrated test database. Refuses anything not named *_test. */
export async function freshDatabase(): Promise<SQL> {
	const url = process.env.DATABASE_URL ?? "";
	if (!new URL(url).pathname.endsWith("_test")) {
		throw new Error(
			`Refusing to reset ${url}: test databases must end in _test`,
		);
	}
	shared ??= new SQL(url);
	await shared.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
	await migrate(shared);
	return shared;
}

/** The app wired to a fresh database, a fake Jira and (unless disabled) a fake Core. */
export async function testBackend(
	options: { issues?: JiraIssue[]; jira?: JiraClient; withCore?: boolean } = {},
) {
	const sql = await freshDatabase();
	const jira = options.jira ?? createFakeJiraClient(options.issues);
	const core: FakeCore | null =
		options.withCore === false ? null : createFakeCoreClient();
	const syncer = createSyncer(jira, core, sql);
	const app = createApp({ jira, sql, syncer, core: { baseUrl: undefined } });
	return { sql, jira, core, syncer, app };
}
