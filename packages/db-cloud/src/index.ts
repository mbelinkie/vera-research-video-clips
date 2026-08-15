import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export async function runCloudMigrations(
  database: Pick<PGlite, "exec" | "query">,
  migrationDirectory = defaultMigrationDirectory,
): Promise<string[]> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const result = await database.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const applied = new Set(result.rows.map((row) => row.version));
  const files = readdirSync(resolve(migrationDirectory))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();
  const newlyApplied: string[] = [];

  for (const filename of files) {
    const version = basename(filename, ".sql");
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(migrationDirectory, filename), "utf8");
    await database.exec("BEGIN;");
    try {
      await database.exec(sql);
      await database.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
      await database.exec("COMMIT;");
      newlyApplied.push(version);
    } catch (error) {
      await database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}
