import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SQL } from "bun";

// Resolved from the working directory: scripts always run from backend/.
const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

/** Applies every db/migrations/*.sql not applied yet, each in its own transaction. */
export async function migrate(
	sql: SQL,
	dir = MIGRATIONS_DIR,
): Promise<string[]> {
	await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
		name       text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`;
	const applied = new Set(
		(await sql`SELECT name FROM schema_migrations`).map(
			(row: { name: string }) => row.name,
		),
	);
	const pending = (await readdir(dir))
		.filter((file) => file.endsWith(".sql") && !applied.has(file))
		.sort();

	for (const file of pending) {
		const text = await Bun.file(join(dir, file)).text();
		await sql.begin(async (tx) => {
			await tx.unsafe(text);
			await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
		});
	}
	return pending;
}
