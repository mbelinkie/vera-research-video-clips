import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SqlDatabase } from "./database.ts";
export type { SqlDatabase } from "./database.ts";
export {
  ConnectionAffineDatabase,
  createPostgresDatabase,
} from "./pg-database.ts";
export { pilotBackupGateIsActive, pilotBackupGatePath } from "./maintenance.ts";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export async function runCloudMigrations(
  database: SqlDatabase,
  migrationDirectory = defaultMigrationDirectory,
): Promise<string[]> {
  // A pool cannot safely BEGIN on one connection and run migrations on another.
  // Hold the advisory lock, schema inspection, and all applied markers on one
  // checked-out client. Creating the table is also protected by the lock.
  if (database.withTransaction) {
    return database.withTransaction(async () => {
      await database.query("SELECT pg_advisory_xact_lock(7245850, 50)");
      return applyMigrations(database, migrationDirectory, false);
    });
  }
  return applyMigrations(database, migrationDirectory, true);
}

async function applyMigrations(
  database: SqlDatabase,
  migrationDirectory: string,
  perFileTransaction: boolean,
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
    if (perFileTransaction) await database.exec("BEGIN;");
    try {
      await database.exec(sql);
      await database.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
      if (perFileTransaction) await database.exec("COMMIT;");
      newlyApplied.push(version);
    } catch (error) {
      if (perFileTransaction) await database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}
