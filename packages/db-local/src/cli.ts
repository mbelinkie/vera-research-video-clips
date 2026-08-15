import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { loadConfig } from "@research-video/config";

import { openLocalDatabase, runLocalMigrations } from "./index.ts";

const testMode = process.argv.includes("--test");
const temporaryDirectory = testMode
  ? mkdtempSync(join(tmpdir(), "research-video-local-db-"))
  : undefined;
const databasePath = temporaryDirectory
  ? join(temporaryDirectory, "local.sqlite")
  : resolve(loadConfig().dataDir, "db", "local.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });
const database = openLocalDatabase(databasePath);

try {
  const applied = runLocalMigrations(database);
  const projectTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    )
    .get();
  if (!projectTable)
    throw new Error("Local migration validation did not create projects");
  process.stdout.write(
    `Local migrations valid (${applied.length} newly applied)\n`,
  );
} finally {
  database.close();
  if (temporaryDirectory)
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
