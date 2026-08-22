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

import { LoggedExportSuccessResultSchema } from "../../contracts/src/index.ts";

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
      "0012_registered_export_workers",
      "0013_logged_export_deliveries",
      "0014_logged_export_success_results",
      "0015_logged_export_failure_results",
      "0016_logged_export_retry_lineage",
      "0017_logged_export_safe_cancellation",
      "0018_logged_export_execution_progress",
      "0019_logged_export_batches",
      "0020_export_request_origin",
    ]);
    expect(await runCloudMigrations(database)).toEqual([]);
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'export_requests' AND column_name = 'request_origin'`,
        )
      ).rows,
    ).toEqual([{ column_name: "request_origin" }]);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name IN ('artifact_versions', 'export_artifact_versions')`,
        )
      ).rows,
    ).toEqual([]);
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
    const deliveryConstraints = await database.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'logged_export_deliveries'::regclass
         AND contype = 'c'`,
    );
    expect(
      deliveryConstraints.rows.map((row) => row.definition).join(" "),
    ).toContain(
      "accepted_at >= reserved_at) AND (accepted_at < reservation_expires_at)",
    );
    const resultTable = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'logged_export_success_results'`,
    );
    expect(resultTable.rows).toHaveLength(1);
    const failureResultTable = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'logged_export_failure_results'`,
    );
    expect(failureResultTable.rows).toHaveLength(1);
    const retryColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'export_requests'
         AND column_name IN (
           'retry_of_request_id', 'retry_ordinal', 'retry_idempotency_key'
         )`,
    );
    expect(retryColumns.rows).toHaveLength(3);
    const cancellationTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'logged_export_cancel_intents', 'logged_export_executions',
         'logged_export_canceled_results'
       )`,
    );
    expect(cancellationTables.rows).toHaveLength(3);
    const clipStatusConstraints = await database.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'clip_candidates'::regclass
         AND conname = 'clip_candidates_export_status_check'`,
    );
    expect(clipStatusConstraints.rows[0]!.definition).toContain("'canceled'");
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

  it("adds delivery and result tables to a populated worker catalog without changing registrations", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0012-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0013") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database, migrations);
    const userId = randomUUID();
    const workerId = randomUUID();
    const at = "2026-08-20T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, display_name, preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:populated-worker', 'Populated worker', 'en', $2, $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO registered_export_workers
         (id, owner_user_id, epoch, capability_json,
          installed_capabilities_json, advertisement_fingerprint,
          heartbeat_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, 7, '{}'::jsonb, '{}'::jsonb, $3, $4, $5, $4, $4)`,
      [workerId, userId, "a".repeat(64), at, "2026-08-20T12:01:00.000Z"],
    );
    const before = (
      await database.query(
        "SELECT * FROM registered_export_workers WHERE id = $1",
        [workerId],
      )
    ).rows[0];
    copyFileSync(
      resolve(cloudMigrationDirectory, "0013_logged_export_deliveries.sql"),
      join(migrations, "0013_logged_export_deliveries.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0013_logged_export_deliveries",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_deliveries'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0014_logged_export_success_results.sql",
      ),
      join(migrations, "0014_logged_export_success_results.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0014_logged_export_success_results",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_success_results'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0015_logged_export_failure_results.sql",
      ),
      join(migrations, "0015_logged_export_failure_results.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0015_logged_export_failure_results",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_failure_results'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(cloudMigrationDirectory, "0016_logged_export_retry_lineage.sql"),
      join(migrations, "0016_logged_export_retry_lineage.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0016_logged_export_retry_lineage",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0017_logged_export_safe_cancellation.sql",
      ),
      join(migrations, "0017_logged_export_safe_cancellation.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0017_logged_export_safe_cancellation",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM information_schema.tables
           WHERE table_name IN (
             'logged_export_cancel_intents', 'logged_export_executions',
             'logged_export_canceled_results'
           )`,
        )
      ).rows[0]!.count,
    ).toBe("3");
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0018_logged_export_execution_progress.sql",
      ),
      join(migrations, "0018_logged_export_execution_progress.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0018_logged_export_execution_progress",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_execution_progress'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(cloudMigrationDirectory, "0019_logged_export_batches.sql"),
      join(migrations, "0019_logged_export_batches.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0019_logged_export_batches",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM information_schema.tables
           WHERE table_name IN (
             'logged_export_batches', 'logged_export_batch_items'
           )`,
        )
      ).rows[0]!.count,
    ).toBe("2");
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'export_requests'
             AND column_name = 'batch_item_id'`,
        )
      ).rows,
    ).toHaveLength(1);
    const projectId = randomUUID();
    const videoId = randomUUID();
    const clipId = randomUUID();
    const jobId = randomUUID();
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const successId = randomUUID();
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Legacy history', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos (id, youtube_video_id, title, created_at)
       VALUES ($1, 'LegacyM6History', 'Legacy history', $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO clip_candidates
         (id, project_id, video_id, youtube_video_id, canonical_url,
          video_title, idempotency_key, transcript_track_id,
          transcript_version, first_segment_id, last_segment_id,
          transcript_start_ms, transcript_end_ms, export_start_ms,
          export_end_ms, timing_precision, english_text, export_status,
          created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'LegacyM6History',
               'https://www.youtube.com/watch?v=LegacyM6History',
               'Legacy history', 'legacy-history-clip', $4, 1, $5, $6,
               0, 1000, 0, 1000, 'cue', 'Legacy selection', 'complete',
               $7, $8, $8)`,
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
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'export', 'complete', 'legacy-history-job', 0,
               '{}'::jsonb, $3, $3)`,
      [jobId, projectId, at],
    );
    await database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, preset_snapshot,
          resolved_settings_snapshot, requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'logged', '{}'::jsonb, '{}'::jsonb,
               'confirmed_english', '{}'::jsonb, '{}'::jsonb, $5, $6, $6)`,
      [requestId, jobId, clipId, projectId, userId, at],
    );
    await database.query(
      `INSERT INTO logged_export_deliveries
         (id, export_request_id, generation, reservation_token, worker_id,
          worker_epoch, reserved_at, reservation_expires_at, accepted_at,
          created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, 7, $5, $6, $5, $5, $5)`,
      [
        deliveryId,
        requestId,
        randomUUID(),
        workerId,
        at,
        "2026-08-20T12:00:30.000Z",
      ],
    );
    await database.query(
      `INSERT INTO logged_export_success_results
         (id, export_request_id, delivery_id, delivery_generation, worker_id,
          worker_epoch, result_schema_version, result_json,
          result_fingerprint, reconciled_at)
       VALUES ($1, $2, $3, 1, $4, 7, 1, $5::jsonb, $6, $7)`,
      [
        successId,
        requestId,
        deliveryId,
        workerId,
        JSON.stringify(
          legacyLoggedExportSuccessResult({
            requestId,
            jobId,
            projectId,
            clipId,
            trackId: randomUUID(),
            validatedAt: at,
          }),
        ),
        "b".repeat(64),
        at,
      ],
    );
    const legacySuccess = (
      await database.query<Record<string, unknown>>(
        "SELECT * FROM logged_export_success_results WHERE id = $1",
        [successId],
      )
    ).rows[0];
    copyFileSync(
      resolve(cloudMigrationDirectory, "0020_export_request_origin.sql"),
      join(migrations, "0020_export_request_origin.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0020_export_request_origin",
    ]);
    expect(
      (
        await database.query<{ request_origin: string | null }>(
          "SELECT request_origin FROM export_requests WHERE id = $1",
          [requestId],
        )
      ).rows[0],
    ).toEqual({ request_origin: null });
    expect(
      LoggedExportSuccessResultSchema.parse(legacySuccess!.result_json),
    ).toMatchObject({
      requestId,
      jobId,
      projectId,
      clipId,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ role: "manifest_json" }),
      ]),
    });
    expect(
      (
        await database.query(
          "SELECT * FROM logged_export_success_results WHERE id = $1",
          [successId],
        )
      ).rows[0],
    ).toEqual(legacySuccess);
    await expect(
      database.query(
        "UPDATE export_requests SET request_origin = 'selection_action' WHERE id = $1",
        [requestId],
      ),
    ).rejects.toThrow(/immutable/u);
    await expect(
      database.query(
        "DELETE FROM logged_export_success_results WHERE id = $1",
        [successId],
      ),
    ).rejects.toThrow(/immutable history/u);
    await expect(
      database.query("DELETE FROM export_requests WHERE id = $1", [requestId]),
    ).rejects.toThrow(/immutable history/u);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results WHERE id = $1",
          [successId],
        )
      ).rows[0]!.count,
    ).toBe("1");
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

function legacyLoggedExportSuccessResult(input: {
  requestId: string;
  jobId: string;
  projectId: string;
  clipId: string;
  trackId: string;
  validatedAt: string;
}) {
  const packageIdentity = `clip-${input.requestId}`;
  const artifact = (role: string, digit: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt: 1,
    validatedAt: input.validatedAt,
  });
  return LoggedExportSuccessResultSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    jobId: input.jobId,
    projectId: input.projectId,
    clipId: input.clipId,
    sourceLanguageClass: "confirmed_english",
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: input.validatedAt,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: "a".repeat(64),
      observedProperties: {
        schemaVersion: 1,
        container: { formatNames: ["mp4"] },
        streamCounts: {
          total: 2,
          video: 1,
          audio: 1,
          subtitle: 0,
          data: 0,
          other: 0,
        },
        video: {
          codec: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1_920,
          height: 1_080,
          sampleAspectRatio: { numerator: 1, denominator: 1 },
          displayAspectRatio: { numerator: 16, denominator: 9 },
          averageFrameRate: { numerator: 30, denominator: 1 },
        },
        audio: {
          codec: "aac",
          sampleRate: 48_000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationMs: 1_000,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    englishSubtitleProvenance: {
      trackId: input.trackId,
      trackVersion: 1,
      cueCount: 1,
      byteSize: 64,
      contentSha256: "e".repeat(64),
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("english_srt", "2"),
      artifact("manifest_json", "3"),
      artifact("thumbnail_jpg", "4"),
      artifact("video_mp4", "5"),
    ],
  });
}
