import { PGlite } from "@electric-sql/pglite";

import { runCloudMigrations } from "./index.ts";

if (!process.argv.includes("--test")) {
  throw new Error(
    "Only the embedded --test migration target exists in Milestone 0",
  );
}

const database = new PGlite();
try {
  const applied = await runCloudMigrations(database);
  const result = await database.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects'",
  );
  if (result.rows.length !== 1)
    throw new Error("Cloud migration validation did not create projects");
  process.stdout.write(
    `Cloud migrations valid (${applied.length} newly applied)\n`,
  );
} finally {
  await database.close();
}
