import { randomUUID } from "node:crypto";

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
      "0008_export_subtitle_track_snapshots",
      "0009_preferred_language_translations_clip_evidence",
      "0010_export_preset_catalogs",
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
    const presetTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'export_presets', 'export_preset_versions',
         'personal_export_preset_defaults', 'project_export_preset_defaults',
         'export_preset_command_receipts'
       )`,
    );
    expect(presetTables.rows).toHaveLength(5);
  });

  it("enforces preset ownership, scope names, fixed defaults, and immutable revisions", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const ownerId = randomUUID();
    const otherId = randomUUID();
    const presetId = randomUUID();
    for (const [id, subject] of [
      [ownerId, "fixture:preset-owner"],
      [otherId, "fixture:preset-other"],
    ]) {
      await database.query(
        `INSERT INTO users
           (id, external_subject, display_name, preferred_language, created_at, updated_at)
         VALUES ($1, $2, $3, 'en', now(), now())`,
        [id, subject, subject],
      );
    }
    await expect(
      database.query(
        `INSERT INTO export_presets
           (id, scope, owner_user_id, project_id, normalized_name,
            current_version, entity_version, created_by)
         VALUES ($1, 'personal', NULL, NULL, 'invalid', 1, 1, $2)`,
        [randomUUID(), ownerId],
      ),
    ).rejects.toThrow();
    await database.query(
      `INSERT INTO export_presets
         (id, scope, owner_user_id, project_id, normalized_name,
          current_version, entity_version, created_by)
       VALUES ($1, 'personal', $2, NULL, 'editing', 1, 1, $2)`,
      [presetId, ownerId],
    );
    await database.query(
      `INSERT INTO export_preset_versions
         (preset_id, version, name, description, settings_snapshot, created_by)
       VALUES ($1, 1, 'Editing', '', '{}'::jsonb, $2)`,
      [presetId, ownerId],
    );
    await expect(
      database.query(
        `INSERT INTO export_presets
           (id, scope, owner_user_id, project_id, normalized_name,
            current_version, entity_version, created_by)
         VALUES ($1, 'personal', $2, NULL, 'editing', 1, 1, $2)`,
        [randomUUID(), ownerId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO personal_export_preset_defaults
           (user_id, preset_id, preset_version, entity_version, updated_by)
         VALUES ($1, $2, 1, 1, $1)`,
        [otherId, presetId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE export_preset_versions SET description = 'mutated'
         WHERE preset_id = $1 AND version = 1`,
        [presetId],
      ),
    ).rejects.toThrow(/immutable/u);
  });
});
