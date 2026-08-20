import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { runCloudMigrations } from "./index.ts";

const databases = new Set<PGlite>();
const temporaryDirectories = new Set<string>();
const cloudMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
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
      "0011_resolved_export_settings_snapshots",
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

  it("backfills immutable legacy request/job snapshots from the 0010 schema", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0010-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0011")
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
    }
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database, migrations);
    const userId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const clipId = randomUUID();
    const jobId = randomUUID();
    const requestId = randomUUID();
    const at = "2026-08-20T12:00:00.000Z";
    const preset = {
      presetVersion: 1,
      name: "Legacy Editing",
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    };
    await database.query(
      `INSERT INTO users (id, external_subject, display_name, created_at)
       VALUES ($1, 'fixture:legacy', 'Legacy', $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Legacy', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, title, canonical_url, created_at)
       VALUES ($1, 'M7lc1UVf-VE', 'Legacy',
               'https://www.youtube.com/watch?v=M7lc1UVf-VE', $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO clip_candidates
         (id, project_id, video_id, youtube_video_id, canonical_url,
          video_title, idempotency_key, transcript_track_id,
          transcript_version, first_segment_id, last_segment_id,
          transcript_start_ms, transcript_end_ms, export_start_ms,
          export_end_ms, timing_precision, english_text, created_by,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'M7lc1UVf-VE',
               'https://www.youtube.com/watch?v=M7lc1UVf-VE', 'Legacy',
               'legacy', $4, 1, $5, $6, 100, 900, 0, 1000, 'cue',
               'Legacy clip', $7, $8, $8)`,
      [
        clipId,
        projectId,
        videoId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        userId,
        at,
      ],
    );
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'export', 'queued', 'legacy-export', '{}'::jsonb, $3, $3)`,
      [jobId, projectId, at],
    );
    await database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, preset_snapshot,
          requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'logged', '{}'::jsonb, '{}'::jsonb,
               'confirmed_english', $5, $6, $7, $7)`,
      [requestId, jobId, clipId, projectId, preset, userId, at],
    );
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0011_resolved_export_settings_snapshots.sql",
      ),
      join(migrations, "0011_resolved_export_settings_snapshots.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0011_resolved_export_settings_snapshots",
    ]);
    const result = await database.query<{
      request_snapshot: Record<string, unknown>;
      job_snapshot: Record<string, unknown>;
    }>(
      `SELECT er.resolved_settings_snapshot AS request_snapshot,
              j.payload->'resolvedSettingsSnapshot' AS job_snapshot
       FROM export_requests er JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [requestId],
    );
    expect(result.rows[0]!.job_snapshot).toEqual(
      result.rows[0]!.request_snapshot,
    );
    expect(result.rows[0]!.request_snapshot).toMatchObject({
      resolutionKind: "legacy_inline",
      context: "logged",
      legacyPreset: preset,
      settings: preset.settings,
      capability: { validation: "legacy_unvalidated" },
      resolvedAt: at,
      resolutionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(
      database.query(
        "UPDATE export_requests SET resolved_settings_snapshot = '{}'::jsonb WHERE id = $1",
        [requestId],
      ),
    ).rejects.toThrow(/immutable/);
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
