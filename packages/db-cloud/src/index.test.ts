import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { runCloudMigrations } from "./index.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

describe("cloud migrations", () => {
  it("migrates an empty PostgreSQL-compatible database idempotently", async () => {
    const database = new PGlite();
    databases.add(database);

    expect(await runCloudMigrations(database)).toEqual([
      "0001_foundation",
      "0002_shared_transcript_store",
      "0003_transcription_batches",
      "0004_worker_resolution_leases",
      "0005_batch_controls",
      "0006_clip_candidates",
      "0007_logged_export_requests",
    ]);
    expect(await runCloudMigrations(database)).toEqual([]);
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'transcription_batch_items'",
    );
    expect(result.rows).toHaveLength(1);
    const clipResult = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'clip_candidates'",
    );
    expect(clipResult.rows).toHaveLength(1);
  });
});
