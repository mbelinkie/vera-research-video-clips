import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };
import { normalizeTranscriptFixture } from "@research-video/transcript";
import type { LoggedExportDelivery } from "@research-video/contracts";
import {
  resolveExportSettings,
  sha256Fingerprint,
} from "@research-video/export-settings";

import {
  LocalExportQueue,
  LocalExportWorkerIdentityRepository,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "./index.ts";

const localMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const temporaryDirectories = new Set<string>();

const fixtureExportInput = {
  idempotencyKey: "fixture-export-only",
  video: {
    youtubeVideoId: "M7lc1UVf-VE",
    canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    title: "Fixture video",
  },
  selection: {
    trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
    transcriptVersion: 1,
    firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
    lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
    firstTokenId: "019fbb95-cd76-7920-93fa-e23ba755e322",
    lastTokenId: "019fbb95-cd76-7920-93fa-e23ba755e326",
    transcriptStartMs: 300,
    transcriptEndMs: 2_900,
    exportStartMs: 0,
    exportEndMs: 3_400,
    text: "fixture has accurate word timing. Click any word",
    timingPrecision: "word" as const,
  },
  sourceLanguageClass: "confirmed_english" as const,
  preset: {
    presetVersion: 1,
    name: "Editing MP4",
    settings: {
      container: "mp4" as const,
      videoCodec: "h264" as const,
      videoRateControl: { mode: "crf" as const, value: 20 },
      maxWidth: 1_920,
      frameRate: "source" as const,
      audioCodec: "aac" as const,
      audioKilobitsPerSecond: 192,
      omitSubtitleFilesForConfirmedEnglish: false,
      embedEnglishSubtitleTrack: false,
    },
  },
};

const fixtureObservedProperties = {
  schemaVersion: 1 as const,
  container: {
    formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
    majorBrand: "isom",
  },
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
    width: 640,
    height: 360,
    sampleAspectRatio: { numerator: 1, denominator: 1 },
    displayAspectRatio: { numerator: 16, denominator: 9 },
    averageFrameRate: { numerator: 30, denominator: 1 },
  },
  audio: {
    codec: "aac",
    sampleRate: 48_000,
    channels: 1,
    channelLayout: "mono",
    reportedBitRate: 128_000,
  },
  durationMs: 3_200,
  ffprobeVersion: "7.1",
};

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("local migrations", () => {
  it("migrates an empty database idempotently", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-sqlite-test-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "test.sqlite"));

    expect(runLocalMigrations(database)).toEqual([
      "0001_foundation",
      "0002_verified_transcript_cache",
      "0003_normalized_transcripts",
      "0004_export_only_requests",
      "0005_export_source_scratch_lifecycle",
      "0006_export_probe_resolution",
      "0007_export_render_validation",
      "0008_export_english_sidecar_validation",
      "0009_export_bilingual_sidecar_validation",
      "0010_export_confirmed_english_subtitle_omission",
      "0011_export_final_artifact_provenance",
      "0012_export_clip_package_manifest",
      "0013_preferred_translation_cache",
      "0014_export_clip_metadata_sidecar",
      "0015_export_clip_thumbnail_artifact",
      "0016_resolved_export_settings_snapshots",
      "0017_alternative_render_conformance",
      "0018_registered_export_worker_identity",
      "0019_logged_export_delivery_import",
      "0020_logged_export_delivery_acceptance_time",
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    expect(runLocalMigrations(database)).toEqual([]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'verified_transcript_cache'",
        )
        .get(),
    ).toBeDefined();

    const transcript = normalizeTranscriptFixture(fixture);
    const index = new LocalTranscriptIndex(database);
    index.replace({
      projectId: "project-fixture",
      catalogVideoId: "video-fixture",
      transcriptVersionId: "version-fixture",
      transcript,
    });
    expect(index.get("version-fixture", "original")).toEqual(transcript);

    const exportQueue = new LocalExportQueue(
      database,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );
    const exportRequest = exportQueue.createExportOnly(fixtureExportInput);
    const retry = exportQueue.createExportOnly({
      ...fixtureExportInput,
      preset: { ...fixtureExportInput.preset, name: "Changed retry" },
    });
    expect(exportRequest).toMatchObject({
      mode: "export_only",
      state: "queued",
      preset: { name: "Editing MP4" },
    });
    expect(retry).toEqual(exportRequest);
    expect(exportQueue.list()).toEqual([exportRequest]);
    expect(exportRequest.resolvedSettingsSnapshot).toMatchObject({
      resolutionKind: "legacy_inline",
      context: "export_only",
      settings: fixtureExportInput.preset.settings,
      capability: { validation: "legacy_unvalidated" },
    });
    const storedSnapshots = database
      .prepare(
        `SELECT er.resolved_settings_snapshot_json AS request_snapshot,
                json_extract(j.payload_json, '$.resolvedSettingsSnapshot') AS job_snapshot
         FROM export_requests er JOIN jobs j ON j.id = er.job_id
         WHERE er.id = ?`,
      )
      .get(exportRequest.id) as {
      request_snapshot: string;
      job_snapshot: string;
    };
    expect(storedSnapshots.job_snapshot).toBe(storedSnapshots.request_snapshot);
    expect(() =>
      database
        .prepare(
          "UPDATE export_requests SET resolved_settings_snapshot_json = '{}' WHERE id = ?",
        )
        .run(exportRequest.id),
    ).toThrow(/immutable/);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM jobs WHERE kind = 'export' AND project_id IS NULL",
        )
        .get(),
    ).toEqual({ count: 1 });

    const sourceAttempt = exportQueue.beginSourceAcquisition(exportRequest.id);
    expect(sourceAttempt).toMatchObject({
      request: { id: exportRequest.id, jobId: exportRequest.jobId },
      attempt: 1,
    });
    expect(exportQueue.getSourceAttempt(exportRequest.jobId, 1)).toMatchObject({
      lifecycleState: "acquiring",
    });
    exportQueue.recordSourceReady(exportRequest.jobId, 1, {
      provider: "fixture",
      sourceIdentity: "M7lc1UVf-VE",
      byteSize: 123,
      contentSha256: "a".repeat(64),
    });
    exportQueue.recordSourceInspection(
      exportRequest.jobId,
      1,
      {
        durationMs: 3_200,
        containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        ffprobeVersion: "7.1",
      },
      { startMs: 0, endMs: 3_200 },
    );
    expect(exportQueue.get(exportRequest.id)).toMatchObject({
      selection: {
        exportStartMs: 0,
        exportEndMs: 3_400,
      },
      mediaProvenance: { durationMs: 3_200, videoCodec: "h264" },
      resolvedExportBounds: { startMs: 0, endMs: 3_200, sourceAttempt: 1 },
    });
    exportQueue.recordRenderedOutputValidation(exportRequest.jobId, 1, {
      durationMs: 3_200,
      containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "7.1",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(
        exportRequest.resolvedSettingsSnapshot!.settings,
      ),
      observedProperties: fixtureObservedProperties,
    });
    expect(exportQueue.get(exportRequest.id)).toMatchObject({
      renderedMediaProvenance: {
        durationMs: 3_200,
        videoCodec: "h264",
        audioCodec: "aac",
        ffprobeVersion: "7.1",
        ffmpegVersion: "8.1.2",
        sourceAttempt: 1,
      },
    });
    expect(
      exportQueue.get(exportRequest.id)?.mediaProvenance,
    ).not.toHaveProperty("ffmpegVersion");
    exportQueue.recordSourceCleanupStarted(exportRequest.jobId, 1);
    exportQueue.recordSourceCleanupSucceeded(exportRequest.jobId, 1);
    expect(exportQueue.get(exportRequest.id)).toMatchObject({
      state: "queued",
    });
    expect(exportQueue.getSourceAttempt(exportRequest.jobId, 1)).toEqual({
      jobId: exportRequest.jobId,
      attempt: 1,
      provider: "fixture",
      sourceIdentity: "M7lc1UVf-VE",
      byteSize: 123,
      contentSha256: "a".repeat(64),
      durationMs: 3_200,
      containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "7.1",
      lifecycleState: "deleted",
      scratchLayoutVersion: 2,
      deletedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-02T12:00:00.000Z",
    });

    exportQueue.beginSourceAcquisition(exportRequest.id);
    exportQueue.recordSourceCleanupFailed(
      exportRequest.jobId,
      2,
      "source directory remains",
    );
    expect(exportQueue.get(exportRequest.id)).toMatchObject({
      state: "needs_user_action",
    });
    expect(exportQueue.getSourceAttempt(exportRequest.jobId, 2)).toMatchObject({
      lifecycleState: "cleanup_failed",
      cleanupErrorCode: "source_cleanup_failed",
    });
    database.close();
  });

  it("upgrades a populated legacy scratch row to manual cleanup instead of inferring a new path", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-legacy-scratch-migration-"),
    );
    temporaryDirectories.add(directory);
    const through0020 = join(directory, "through-0020");
    mkdirSync(through0020);
    for (const filename of readdirSync(localMigrationDirectory)) {
      if (filename < "0021") {
        copyFileSync(
          resolve(localMigrationDirectory, filename),
          join(through0020, filename),
        );
      }
    }
    const database = openLocalDatabase(join(directory, "legacy.sqlite"));
    runLocalMigrations(database, through0020);
    database.exec(`
      INSERT INTO jobs
        (id, kind, state, idempotency_key, attempt, payload_json, created_at, updated_at)
      VALUES ('019fbb95-cd76-7920-93fa-e23ba755ef90', 'export', 'processing',
              'legacy-scratch-job', 1, '{}', '2026-08-20T12:00:00.000Z',
              '2026-08-20T12:00:00.000Z');
      INSERT INTO source_scratch_assets
        (id, job_id, attempt, lifecycle_state, created_at, expires_at, updated_at)
      VALUES ('019fbb95-cd76-7920-93fa-e23ba755ef91',
              '019fbb95-cd76-7920-93fa-e23ba755ef90', 1, 'ready',
              '2026-08-20T12:00:00.000Z', '2026-08-20T12:05:00.000Z',
              '2026-08-20T12:00:00.000Z');
    `);

    expect(runLocalMigrations(database, localMigrationDirectory)).toEqual([
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    expect(
      database
        .prepare(
          `SELECT lifecycle_state, scratch_layout_version, cleanup_error_code,
                  cleanup_error_message
           FROM source_scratch_assets`,
        )
        .get(),
    ).toEqual({
      lifecycle_state: "cleanup_failed",
      scratch_layout_version: null,
      cleanup_error_code: "source_scratch_legacy_layout_unrecoverable",
      cleanup_error_message: "Legacy source scratch requires manual cleanup.",
    });
    expect(
      database.prepare("SELECT state, payload_json FROM jobs").get(),
    ).toEqual({
      state: "needs_user_action",
      payload_json: JSON.stringify({
        lastError: {
          code: "source_scratch_legacy_layout_unrecoverable",
          message: "Legacy source scratch requires manual cleanup.",
        },
      }),
    });
    database.close();
  });

  it("promotes and reuses only an exact verified derived translation", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-derived-cache-test-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    runLocalMigrations(database);
    const index = new LocalTranscriptIndex(
      database,
      () => new Date("2026-08-20T12:00:00.000Z"),
    );
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const identity = {
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e601",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e602",
      baseTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e603",
      originalTrackId: original.track.id,
      originalContentSha256: original.track.contentSha256,
      targetLanguage: "es-MX",
      provider: spanish.track.provider,
      normalizationSchemaVersion: spanish.track.schemaVersion,
    };
    const encoded = JSON.stringify(spanish);
    index.promoteDerivedTranslation({
      identity,
      translationVersionId: "019fbb95-cd76-7920-93fa-e23ba755e604",
      manifestSha256: "a".repeat(64),
      normalizedSha256: createHash("sha256").update(encoded).digest("hex"),
      transcript: spanish,
    });
    expect(index.findDerivedTranslation(identity)).toEqual(spanish);
    expect(
      index.findDerivedTranslation({
        ...identity,
        baseTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e605",
      }),
    ).toBeUndefined();
    database
      .prepare(
        "UPDATE derived_translation_cache SET normalized_sha256 = ? WHERE translation_version_id = ?",
      )
      .run("b".repeat(64), "019fbb95-cd76-7920-93fa-e23ba755e604");
    expect(index.findDerivedTranslation(identity)).toBeUndefined();
    database.close();
  });

  it("widens the final-artifact role vocabulary in 0015 without rewriting existing rows", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-sqlite-0014-"),
    );
    temporaryDirectories.add(directory);
    const previousMigrations = join(directory, "migrations");
    mkdirSync(previousMigrations);
    for (const filename of readdirSync(localMigrationDirectory)) {
      if (filename < "0015") {
        copyFileSync(
          resolve(localMigrationDirectory, filename),
          join(previousMigrations, filename),
        );
      }
    }
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    expect(runLocalMigrations(database, previousMigrations)).toContain(
      "0013_preferred_translation_cache",
    );

    const legacyRequestId = "019fbb95-cd76-7920-93fa-e23ba755e401";
    const legacyJobId = "019fbb95-cd76-7920-93fa-e23ba755e402";
    const legacyTimestamp = "2026-08-01T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO jobs
           (id, kind, state, idempotency_key, attempt, payload_json,
            created_at, updated_at)
         VALUES (?, 'export', 'queued', 'export-only:legacy', 0, '{}', ?, ?)`,
      )
      .run(legacyJobId, legacyTimestamp, legacyTimestamp);
    database
      .prepare(
        `INSERT INTO export_requests
           (id, job_id, mode, video_snapshot_json, selection_snapshot_json,
            source_language_class, preset_snapshot_json, created_at, updated_at)
         VALUES (?, ?, 'export_only', '{}', '{}', 'confirmed_english', ?, ?, ?)`,
      )
      .run(
        legacyRequestId,
        legacyJobId,
        JSON.stringify(fixtureExportInput.preset),
        legacyTimestamp,
        legacyTimestamp,
      );
    const legacyArtifact = {
      export_request_id: legacyRequestId,
      role: "video_mp4",
      package_identity: `clip-${legacyRequestId}`,
      byte_size: 2_048,
      content_sha256: "d".repeat(64),
      source_attempt: 1,
      validated_at: legacyTimestamp,
    };
    const insertArtifact = (role: string) =>
      database
        .prepare(
          `INSERT INTO export_final_artifacts
             (export_request_id, role, package_identity, byte_size,
              content_sha256, source_attempt, validated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          legacyArtifact.export_request_id,
          role,
          legacyArtifact.package_identity,
          legacyArtifact.byte_size,
          legacyArtifact.content_sha256,
          legacyArtifact.source_attempt,
          legacyArtifact.validated_at,
        );
    insertArtifact("video_mp4");
    insertArtifact("manifest_json");
    insertArtifact("clip_metadata_json");
    expect(() => insertArtifact("thumbnail_jpg")).toThrow();

    database.exec("CREATE TABLE export_final_artifacts_0015 (blocker TEXT);");
    expect(() =>
      runLocalMigrations(database, localMigrationDirectory),
    ).toThrow();
    const legacyManifestArtifact = { ...legacyArtifact, role: "manifest_json" };
    const legacyMetadataArtifact = {
      ...legacyArtifact,
      role: "clip_metadata_json",
    };
    expect(
      database.prepare("SELECT * FROM export_final_artifacts").all(),
    ).toEqual([legacyArtifact, legacyManifestArtifact, legacyMetadataArtifact]);
    expect(() => insertArtifact("thumbnail_jpg")).toThrow();
    database.exec("DROP TABLE export_final_artifacts_0015;");

    expect(runLocalMigrations(database, localMigrationDirectory)).toEqual([
      "0015_export_clip_thumbnail_artifact",
      "0016_resolved_export_settings_snapshots",
      "0017_alternative_render_conformance",
      "0018_registered_export_worker_identity",
      "0019_logged_export_delivery_import",
      "0020_logged_export_delivery_acceptance_time",
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    expect(
      database.prepare("SELECT * FROM export_final_artifacts").all(),
    ).toEqual([legacyArtifact, legacyManifestArtifact, legacyMetadataArtifact]);
    const backfilled = database
      .prepare(
        `SELECT er.resolved_settings_snapshot_json AS request_snapshot,
                json_extract(j.payload_json, '$.resolvedSettingsSnapshot') AS job_snapshot
         FROM export_requests er JOIN jobs j ON j.id = er.job_id
         WHERE er.id = ?`,
      )
      .get(legacyRequestId) as {
      request_snapshot: string;
      job_snapshot: string;
    };
    expect(backfilled.job_snapshot).toBe(backfilled.request_snapshot);
    expect(JSON.parse(backfilled.request_snapshot)).toMatchObject({
      resolutionKind: "legacy_inline",
      context: "export_only",
      legacyPreset: fixtureExportInput.preset,
      settings: fixtureExportInput.preset.settings,
      capability: { validation: "legacy_unvalidated" },
      resolvedAt: legacyTimestamp,
      resolutionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_export_final_artifacts_request_attempt'`,
        )
        .get(),
    ).toBeDefined();
    insertArtifact("thumbnail_jpg");
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM export_final_artifacts WHERE export_request_id = ?",
        )
        .get(legacyRequestId),
    ).toEqual({ count: 4 });
    database.close();
  });

  it("upgrades 0016 through 0017 without rewriting any established artifact role", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-sqlite-0016-"),
    );
    temporaryDirectories.add(directory);
    const migrationsThrough0016 = join(directory, "migrations");
    mkdirSync(migrationsThrough0016);
    for (const filename of readdirSync(localMigrationDirectory)) {
      if (filename < "0017") {
        copyFileSync(
          resolve(localMigrationDirectory, filename),
          join(migrationsThrough0016, filename),
        );
      }
    }
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    runLocalMigrations(database, migrationsThrough0016);
    const requestId = "019fbb95-cd76-7920-93fa-e23ba755e501";
    const jobId = "019fbb95-cd76-7920-93fa-e23ba755e502";
    const timestamp = "2026-08-01T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO jobs
           (id, kind, state, idempotency_key, attempt, payload_json,
            created_at, updated_at)
         VALUES (?, 'export', 'queued', 'export-only:0017-role-preservation',
                 0, '{}', ?, ?)`,
      )
      .run(jobId, timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO export_requests
           (id, job_id, mode, video_snapshot_json, selection_snapshot_json,
            source_language_class, preset_snapshot_json,
            resolved_settings_snapshot_json, created_at, updated_at)
         VALUES (?, ?, 'export_only', '{}', '{}', 'confirmed_english', ?, '{}', ?, ?)`,
      )
      .run(
        requestId,
        jobId,
        JSON.stringify(fixtureExportInput.preset),
        timestamp,
        timestamp,
      );
    const packageIdentity = `clip-${requestId}`;
    const insertArtifact = (role: string) =>
      database
        .prepare(
          `INSERT INTO export_final_artifacts
             (export_request_id, role, package_identity, byte_size,
              content_sha256, source_attempt, validated_at)
           VALUES (?, ?, ?, 1024, ?, 1, ?)`,
        )
        .run(
          requestId,
          role,
          packageIdentity,
          "d".repeat(64),
          "2026-08-01T12:00:00.000Z",
        );
    for (const role of [
      "video_mp4",
      "english_srt",
      "original_srt",
      "clip_metadata_json",
      "thumbnail_jpg",
      "manifest_json",
    ]) {
      insertArtifact(role);
    }
    const establishedRows = database
      .prepare(
        "SELECT * FROM export_final_artifacts WHERE export_request_id = ? ORDER BY role",
      )
      .all(requestId);

    expect(runLocalMigrations(database, localMigrationDirectory)).toEqual([
      "0017_alternative_render_conformance",
      "0018_registered_export_worker_identity",
      "0019_logged_export_delivery_import",
      "0020_logged_export_delivery_acceptance_time",
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    expect(
      database
        .prepare(
          "SELECT * FROM export_final_artifacts WHERE export_request_id = ? ORDER BY role",
        )
        .all(requestId),
    ).toEqual(establishedRows);
    expect(() => insertArtifact("video_mkv")).not.toThrow();
    expect(() => insertArtifact("video_mov")).not.toThrow();
    expect(() => insertArtifact("arbitrary_video")).toThrow();
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_export_final_artifacts_request_attempt'`,
        )
        .get(),
    ).toBeDefined();
    database.close();
  });

  it("requires metadata, thumbnail, and manifest artifacts in every promoted package", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-sqlite-manifest-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    runLocalMigrations(database);
    const queue = new LocalExportQueue(
      database,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );
    const request = queue.createExportOnly(fixtureExportInput);
    queue.beginSourceAcquisition(request.id);
    queue.recordSourceReady(request.jobId, 1, {
      provider: "fixture",
      sourceIdentity: "M7lc1UVf-VE",
      byteSize: 123,
      contentSha256: "a".repeat(64),
    });
    queue.recordSourceInspection(
      request.jobId,
      1,
      { durationMs: 3_200 },
      { startMs: 0, endMs: 3_200 },
    );
    queue.recordRenderedOutputValidation(request.jobId, 1, {
      durationMs: 3_200,
      ffprobeVersion: "7.1",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(
        request.resolvedSettingsSnapshot!.settings,
      ),
      observedProperties: fixtureObservedProperties,
    });
    queue.recordThumbnailValidation(request.jobId, 1, {
      extractionTimeMs: 1_600,
      width: 640,
      height: 360,
    });
    const artifact = (
      role:
        "video_mp4" | "clip_metadata_json" | "thumbnail_jpg" | "manifest_json",
      byteSize: number,
    ) => ({
      role,
      packageIdentity: `clip-${request.id}`,
      byteSize,
      contentSha256: role === "video_mp4" ? "e".repeat(64) : "f".repeat(64),
      sourceAttempt: 1,
      validatedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(() =>
      queue.recordFinalArtifactPromotion(request.jobId, 1, [
        artifact("video_mp4", 2_048),
      ]),
    ).toThrow(/Final artifact provenance is invalid/u);
    queue.recordFinalArtifactPromotion(request.jobId, 1, [
      artifact("video_mp4", 2_048),
      artifact("clip_metadata_json", 384),
      artifact("thumbnail_jpg", 256),
      artifact("manifest_json", 512),
    ]);
    expect(queue.get(request.id)?.finalArtifacts).toEqual([
      expect.objectContaining({ role: "clip_metadata_json", byteSize: 384 }),
      expect.objectContaining({ role: "manifest_json", byteSize: 512 }),
      expect.objectContaining({ role: "thumbnail_jpg", byteSize: 256 }),
      expect.objectContaining({ role: "video_mp4", byteSize: 2_048 }),
    ]);
    database.close();
  });
});

describe("durable local export-worker identity", () => {
  it("keeps one worker ID and epoch across restart while advancing only for a changed advertisement", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-video-worker-id-"));
    temporaryDirectories.add(directory);
    const filename = join(directory, "worker.sqlite");
    const initial = "a".repeat(64);
    const changed = "b".repeat(64);
    const firstDatabase = openLocalDatabase(filename);
    runLocalMigrations(firstDatabase);
    const first = new LocalExportWorkerIdentityRepository(
      firstDatabase,
      () => new Date("2026-08-20T12:00:00.000Z"),
    ).prepareRegistration(initial);
    expect(first).toMatchObject({
      epoch: 1,
      advertisementFingerprint: initial,
    });
    firstDatabase.close();

    const restartedDatabase = openLocalDatabase(filename);
    runLocalMigrations(restartedDatabase);
    const restarted = new LocalExportWorkerIdentityRepository(
      restartedDatabase,
      () => new Date("2026-08-20T12:01:00.000Z"),
    );
    expect(restarted.prepareRegistration(initial)).toEqual(first);
    expect(restarted.prepareRegistration(changed)).toMatchObject({
      workerId: first.workerId,
      epoch: 2,
      advertisementFingerprint: changed,
    });
    expect(() => restarted.prepareRegistration("invalid")).toThrow(
      /fingerprint/i,
    );
    restartedDatabase.close();
  });
});

describe("logged export delivery import", () => {
  it("keeps pending work non-runnable, imports once, and activates only the exact accepted generation", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-video-delivery-"));
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "delivery.sqlite"));
    runLocalMigrations(database);
    const queue = new LocalExportQueue(
      database,
      () => new Date("2026-08-20T12:00:10.000Z"),
    );
    const delivery = fixtureLoggedDelivery();
    const partialJobId = "019fbb95-cd76-7920-93fa-e23ba755ef21";
    database
      .prepare(
        `INSERT INTO jobs
           (id, kind, state, idempotency_key, attempt, payload_json,
            created_at, updated_at)
         VALUES (?, 'export', 'claimed', 'partial-cloud-provenance', 0, '{}', ?, ?)`,
      )
      .run(partialJobId, delivery.reservedAt, delivery.reservedAt);
    expect(() =>
      database
        .prepare(
          `INSERT INTO export_requests
             (id, job_id, mode, video_snapshot_json, selection_snapshot_json,
              source_language_class, preset_snapshot_json,
              resolved_settings_snapshot_json, cloud_project_id,
              created_at, updated_at)
           VALUES ($id, $jobId, 'export_only', $video, $selection,
                   'confirmed_english', $preset, $resolved, $projectId,
                   $createdAt, $updatedAt)`,
        )
        .run({
          $id: "019fbb95-cd76-7920-93fa-e23ba755ef22",
          $jobId: partialJobId,
          $video: JSON.stringify(delivery.request.video),
          $selection: JSON.stringify(delivery.request.selection),
          $preset: JSON.stringify(delivery.request.preset),
          $resolved: JSON.stringify(delivery.request.resolvedSettingsSnapshot),
          $projectId: delivery.request.projectId!,
          $createdAt: delivery.request.createdAt,
          $updatedAt: delivery.request.updatedAt,
        }),
    ).toThrow(/provenance must be complete/u);
    database.prepare("DELETE FROM jobs WHERE id = ?").run(partialJobId);

    const pending = queue.importLoggedDeliveryPending(delivery);
    expect(pending).toMatchObject({
      mode: "logged",
      projectId: delivery.request.projectId,
      clipId: delivery.request.clipId,
      state: "claimed",
    });
    expect(queue.importLoggedDeliveryPending(delivery)).toEqual(pending);
    expect(queue.list()).toHaveLength(1);
    const payload = JSON.parse(
      String(
        (
          database
            .prepare("SELECT payload_json FROM jobs WHERE id = ?")
            .get(delivery.request.jobId) as { payload_json: string }
        ).payload_json,
      ),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("cloudDelivery");
    expect(JSON.stringify(payload)).not.toContain(delivery.reservationToken);
    expect(queue.getPendingLoggedDelivery()).toMatchObject({
      reservationToken: delivery.reservationToken,
    });
    expect(() => queue.beginSourceAcquisition(pending.id)).toThrowError(
      expect.objectContaining({ code: "logged_export_delivery_not_accepted" }),
    );
    expect(() =>
      queue.importLoggedDeliveryPending({
        ...delivery,
        request: {
          ...delivery.request,
          video: { ...delivery.request.video, title: "Mutated title" },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "logged_export_delivery_conflict" }),
    );
    const aliasedDelivery: LoggedExportDelivery = {
      ...delivery,
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ef23",
      request: {
        ...delivery.request,
        id: "019fbb95-cd76-7920-93fa-e23ba755ef24",
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ef25",
        video: { ...delivery.request.video, title: "Aliased request" },
      },
    };
    expect(() =>
      queue.importLoggedDeliveryPending(aliasedDelivery),
    ).toThrowError(
      expect.objectContaining({ code: "logged_export_delivery_conflict" }),
    );
    expect(queue.get(aliasedDelivery.request.id)).toBeUndefined();
    expect(queue.list()).toHaveLength(1);
    expect(
      database.prepare("SELECT count(*) AS count FROM jobs").get(),
    ).toEqual({ count: 1 });

    const accepted: LoggedExportDelivery = {
      ...delivery,
      status: "accepted",
      acceptedAt: "2026-08-20T12:00:05.000Z",
    };
    expect(queue.activateLoggedDelivery(accepted)).toMatchObject({
      mode: "logged",
      state: "queued",
      projectId: delivery.request.projectId,
      clipId: delivery.request.clipId,
    });
    expect(queue.getAcceptedLoggedDelivery(pending.id)).toMatchObject({
      status: "accepted",
      acceptedAt: accepted.acceptedAt,
      reservationToken: delivery.reservationToken,
      request: { id: pending.id, state: "queued" },
    });
    activateFixtureExecution(queue, accepted);
    const attempt = queue.beginSourceAcquisition(pending.id).attempt;
    expect(attempt).toBe(1);
    queue.recordSourceReady(pending.jobId, attempt, {
      provider: "fixture",
      sourceIdentity: "private-source-identity-not-for-cloud",
      byteSize: 123,
      contentSha256: "a".repeat(64),
    });
    queue.recordSourceInspection(
      pending.jobId,
      attempt,
      { durationMs: 3_200 },
      { startMs: 0, endMs: 3_200 },
    );
    queue.recordRenderedOutputValidation(pending.jobId, attempt, {
      durationMs: 3_200,
      ffprobeVersion: "7.1",
      ffmpegVersion: "7.1",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(
        pending.resolvedSettingsSnapshot!.settings,
      ),
      observedProperties: fixtureObservedProperties,
    });
    queue.recordThumbnailValidation(pending.jobId, attempt, {
      extractionTimeMs: 1_600,
      width: 640,
      height: 360,
    });
    queue.recordEnglishSubtitleValidation(pending.jobId, attempt, {
      trackId: pending.selection.trackId,
      trackVersion: pending.selection.transcriptVersion,
      cueCount: 1,
      byteSize: 64,
      contentSha256: "b".repeat(64),
      startMs: 300,
      endMs: 2_900,
    });
    const packageIdentity = `clip-${pending.id}`;
    const finalArtifact = (
      role:
        | "video_mp4"
        | "english_srt"
        | "clip_metadata_json"
        | "thumbnail_jpg"
        | "manifest_json",
      digit: string,
    ) => ({
      role,
      packageIdentity,
      byteSize: 128,
      contentSha256: digit.repeat(64),
      sourceAttempt: attempt,
      validatedAt: "2026-08-20T12:00:10.000Z",
    });
    queue.recordFinalArtifactPromotion(pending.jobId, attempt, [
      finalArtifact("video_mp4", "1"),
      finalArtifact("english_srt", "2"),
      finalArtifact("clip_metadata_json", "3"),
      finalArtifact("thumbnail_jpg", "4"),
      finalArtifact("manifest_json", "5"),
    ]);
    queue.recordSourceCleanupStarted(pending.jobId, attempt);
    queue.recordSourceCleanupSucceeded(pending.jobId, attempt);
    const result = queue.buildLoggedExportSuccessResult(pending.id);
    expect(result).toMatchObject({
      requestId: pending.id,
      jobId: pending.jobId,
      projectId: pending.projectId,
      clipId: pending.clipId,
      sourceLanguageClass: "confirmed_english",
      artifacts: [
        { role: "clip_metadata_json" },
        { role: "english_srt" },
        { role: "manifest_json" },
        { role: "thumbnail_jpg" },
        { role: "video_mp4" },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-source-identity|reservationToken|cloudAcceptedAt|path/i,
    );
    expect(() =>
      database
        .prepare(
          "UPDATE export_requests SET cloud_accepted_at = ? WHERE id = ?",
        )
        .run("2026-08-20T12:00:06.000Z", pending.id),
    ).toThrow(/acceptance time is immutable/u);
    database.close();
  });

  it("persists one exact cloud execution and projects cancellation only after verified cleanup", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-video-cancel-"));
    temporaryDirectories.add(directory);
    const filename = join(directory, "cancel.sqlite");
    const database = openLocalDatabase(filename);
    runLocalMigrations(database);
    const queue = new LocalExportQueue(
      database,
      () => new Date("2026-08-20T12:00:10.000Z"),
    );
    const delivery = fixtureLoggedDelivery();
    queue.importLoggedDeliveryPending(delivery);
    queue.activateLoggedDelivery({
      ...delivery,
      status: "accepted",
      acceptedAt: "2026-08-20T12:00:05.000Z",
    });
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ef31",
      requestId: delivery.request.id,
      attempt: 1,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ef32",
      startedAt: "2026-08-20T12:00:06.000Z",
      heartbeatAt: "2026-08-20T12:00:07.000Z",
      expiresAt: "2026-08-20T12:00:37.000Z",
    };
    expect(queue.activateLoggedExecution(execution)).toEqual(execution);
    expect(queue.activateLoggedExecution(execution)).toEqual(execution);
    const preparing = queue.recordLoggedExportProgress(
      delivery.request.id,
      "preparing",
      250,
    );
    expect(
      queue.recordLoggedExportProgress(delivery.request.id, "preparing", 250),
    ).toEqual(preparing);
    const rendering = queue.recordLoggedExportProgress(
      delivery.request.id,
      "rendering",
      3_500,
    );
    expect(rendering).toMatchObject({
      executionId: execution.executionId,
      requestId: delivery.request.id,
      attempt: execution.attempt,
      sequence: 2,
      stage: "rendering",
      basisPoints: 3_500,
    });
    const packaging = queue.reconcileLoggedExportProgress({
      ...rendering,
      sequence: 3,
      stage: "packaging",
      basisPoints: 8_000,
      updatedAt: "2026-08-20T12:00:11.000Z",
    });
    expect(queue.reconcileLoggedExportProgress(packaging)).toEqual(packaging);
    expect(() =>
      queue.reconcileLoggedExportProgress({
        ...packaging,
        executionId: "019fbb95-cd76-7920-93fa-e23ba755ef39",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "logged_export_progress_ownership_mismatch",
      }),
    );
    expect(() =>
      queue.recordLoggedExportProgress(
        delivery.request.id,
        "acquiring_source",
        3_600,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "logged_export_progress_regression" }),
    );
    expect(() =>
      database
        .prepare(
          `UPDATE export_requests
           SET local_progress_stage_rank = 10
           WHERE id = ?`,
        )
        .run(delivery.request.id),
    ).toThrow(/stage rank|exact and monotonic/u);
    expect(() =>
      queue.activateLoggedExecution({
        ...execution,
        leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ef33",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "logged_export_execution_conflict" }),
    );
    expect(() =>
      database
        .prepare(
          "UPDATE export_requests SET cloud_execution_lease_token = NULL WHERE id = ?",
        )
        .run(delivery.request.id),
    ).toThrow(/provenance must be complete|identity is immutable/u);

    const started = queue.beginSourceAcquisition(delivery.request.id, {
      requireLoggedExecution: true,
    });
    expect(started.attempt).toBe(execution.attempt);
    queue.recordSourceCleanupStarted(started.request.jobId, started.attempt);
    queue.recordSourceCleanupSucceeded(started.request.jobId, started.attempt);
    queue.recordSourceAttemptCanceled(
      started.request.jobId,
      started.attempt,
      "user_requested",
    );
    expect(queue.buildLoggedExportCanceledResult(delivery.request.id)).toEqual({
      schemaVersion: 1,
      requestId: delivery.request.id,
      jobId: delivery.request.jobId,
      projectId: delivery.request.projectId,
      clipId: delivery.request.clipId,
      reason: "user_requested",
      attempt: 1,
      sourceCleanup: {
        lifecycle: "deleted",
        deletedAt: "2026-08-20T12:00:10.000Z",
      },
      executionId: execution.executionId,
      executionAttempt: execution.attempt,
    });
    expect(() =>
      queue.recordSourceAttemptCanceled(
        started.request.jobId,
        started.attempt,
        "execution_lease_lost",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "logged_export_cancellation_state_conflict",
      }),
    );
    database.close();
    const reopened = openLocalDatabase(filename);
    runLocalMigrations(reopened);
    expect(
      new LocalExportQueue(reopened).getLoggedExportProgress(
        delivery.request.id,
      ),
    ).toEqual(packaging);
    reopened.close();
  });

  it("projects only sanitized not-started or verified-deleted logged failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-video-failure-"));
    temporaryDirectories.add(directory);
    const filename = join(directory, "failure.sqlite");
    const database = openLocalDatabase(filename);
    runLocalMigrations(database);
    const queue = new LocalExportQueue(database);
    const claimed = fixtureLoggedDelivery();
    queue.importLoggedDeliveryPending(claimed);
    const accepted: LoggedExportDelivery = {
      ...claimed,
      status: "accepted",
      acceptedAt: "2026-08-20T12:00:05.000Z",
    };
    queue.activateLoggedDelivery(accepted);
    queue.recordSourceNotStartedFailure(
      accepted.request.id,
      "Provider Failed!",
      `failed /private/source.mp4 C:\\Users\\name\\source.mov \\\\server\\share\\source.mov file:///private/source.mov token=${accepted.reservationToken} Bearer private.jwt-token https://private.invalid/source`,
    );
    const notStarted = queue.buildLoggedExportFailureResult(
      accepted.request.id,
    );
    expect(notStarted).toMatchObject({
      requestId: accepted.request.id,
      jobId: accepted.request.jobId,
      projectId: accepted.request.projectId,
      clipId: accepted.request.clipId,
      error: {
        code: "provider_failed",
        message:
          "failed <path> <path> <path> <path> token=<redacted> Bearer <redacted> <url>",
      },
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" },
    });
    expect(JSON.stringify(notStarted)).not.toContain(accepted.reservationToken);
    expect(JSON.stringify(notStarted)).not.toMatch(
      /private|source\.mp4|private\.invalid/iu,
    );

    database.close();
    const reopened = openLocalDatabase(filename);
    runLocalMigrations(reopened);
    expect(
      new LocalExportQueue(reopened).buildLoggedExportFailureResult(
        accepted.request.id,
      ),
    ).toEqual(notStarted);
    reopened.close();

    const cleanedDirectory = mkdtempSync(
      join(tmpdir(), "research-video-cleaned-failure-"),
    );
    temporaryDirectories.add(cleanedDirectory);
    const cleanedDatabase = openLocalDatabase(
      join(cleanedDirectory, "cleaned.sqlite"),
    );
    runLocalMigrations(cleanedDatabase);
    const cleanedQueue = new LocalExportQueue(cleanedDatabase);
    cleanedQueue.importLoggedDeliveryPending(claimed);
    cleanedQueue.activateLoggedDelivery(accepted);
    activateFixtureExecution(cleanedQueue, accepted);
    const started = cleanedQueue.beginSourceAcquisition(accepted.request.id);
    cleanedQueue.recordSourceCleanupStarted(
      started.request.jobId,
      started.attempt,
    );
    cleanedQueue.recordSourceCleanupSucceeded(
      started.request.jobId,
      started.attempt,
    );
    cleanedQueue.recordSourceAttemptFailure(
      started.request.jobId,
      started.attempt,
      "render_failed",
      "Renderer could not produce a valid package.",
    );
    expect(
      cleanedQueue.buildLoggedExportFailureResult(accepted.request.id),
    ).toMatchObject({
      attempt: 1,
      error: { code: "render_failed" },
      sourceCleanup: {
        lifecycle: "deleted",
        deletedAt: expect.any(String),
      },
    });
    cleanedQueue.recordLoggedExportPersistedFailureCancellation(
      accepted.request.id,
      "user_requested",
      "2026-08-20T12:00:09.000Z",
    );
    expect(
      cleanedQueue.buildLoggedExportCanceledResult(accepted.request.id),
    ).toMatchObject({
      reason: "user_requested",
      attempt: 1,
      sourceCleanup: { lifecycle: "deleted" },
    });
    const canceledRequest = cleanedQueue.get(accepted.request.id);
    expect(canceledRequest).toMatchObject({ state: "canceled" });
    expect(canceledRequest).not.toHaveProperty("lastError");
    cleanedDatabase.close();
  });

  it("rejects inconsistent or incomplete scratch cleanup as a terminal failure", () => {
    const setup = () => {
      const directory = mkdtempSync(
        join(tmpdir(), "research-video-unsafe-failure-"),
      );
      temporaryDirectories.add(directory);
      const database = openLocalDatabase(join(directory, "unsafe.sqlite"));
      runLocalMigrations(database);
      const queue = new LocalExportQueue(database);
      const claimed = fixtureLoggedDelivery();
      const accepted: LoggedExportDelivery = {
        ...claimed,
        status: "accepted",
        acceptedAt: "2026-08-20T12:00:05.000Z",
      };
      queue.importLoggedDeliveryPending(claimed);
      queue.activateLoggedDelivery(accepted);
      activateFixtureExecution(queue, accepted);
      return { database, queue, accepted };
    };

    const notStarted = setup();
    notStarted.queue.recordSourceNotStartedFailure(
      notStarted.accepted.request.id,
      "provider_missing",
      "Configure a provider.",
    );
    notStarted.database
      .prepare(
        `INSERT INTO source_scratch_assets
           (id, job_id, attempt, lifecycle_state, created_at, expires_at, updated_at)
         VALUES (?, ?, 1, 'deleted', ?, ?, ?)`,
      )
      .run(
        "019fbb95-cd76-7920-93fa-e23ba755ef90",
        notStarted.accepted.request.jobId,
        "2026-08-20T12:00:06.000Z",
        "2026-08-21T12:00:06.000Z",
        "2026-08-20T12:00:06.000Z",
      );
    expect(() =>
      notStarted.queue.buildLoggedExportFailureResult(
        notStarted.accepted.request.id,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "logged_export_failure_cleanup_inconsistent",
      }),
    );
    notStarted.database.close();

    const cleanupFailed = setup();
    const started = cleanupFailed.queue.beginSourceAcquisition(
      cleanupFailed.accepted.request.id,
    );
    cleanupFailed.queue.recordSourceCleanupStarted(
      started.request.jobId,
      started.attempt,
    );
    cleanupFailed.queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    expect(() =>
      cleanupFailed.queue.buildLoggedExportFailureResult(
        cleanupFailed.accepted.request.id,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "logged_export_failure_cleanup_incomplete",
      }),
    );
    const retained = cleanupFailed.queue.getSourceAttempt(
      started.request.jobId,
      1,
    );
    expect(retained).toMatchObject({
      lifecycleState: "cleanup_failed",
      cleanupErrorMessage: "Could not delete <path>",
    });
    expect(retained).not.toHaveProperty("deletedAt");
    cleanupFailed.database.close();
  });

  it("permits M5-18 failure projection only after a cleanup-recovery claim settles deleted", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-recovered-cleanup-failure-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "recovered.sqlite"));
    runLocalMigrations(database);
    const queue = new LocalExportQueue(
      database,
      () => new Date("2026-08-21T12:00:00.000Z"),
    );
    const claimed = fixtureLoggedDelivery();
    const accepted: LoggedExportDelivery = {
      ...claimed,
      status: "accepted",
      acceptedAt: "2026-08-20T12:00:05.000Z",
    };
    queue.importLoggedDeliveryPending(claimed);
    queue.activateLoggedDelivery(accepted);
    activateFixtureExecution(queue, accepted);
    const started = queue.beginSourceAcquisition(accepted.request.id);
    queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    expect(() =>
      queue.buildLoggedExportFailureResult(accepted.request.id),
    ).toThrow(
      expect.objectContaining({
        code: "logged_export_failure_cleanup_incomplete",
      }),
    );

    const [recovery] = queue.claimSourceScratchCleanup(1);
    expect(recovery).toMatchObject({
      jobId: started.request.jobId,
      attempt: started.attempt,
    });
    expect(queue.completeSourceScratchCleanupClaim(recovery!)).toEqual({
      restoredComplete: false,
      markedNeedsUserAction: true,
    });
    expect(
      queue.getSourceAttempt(started.request.jobId, started.attempt),
    ).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(
      queue.buildLoggedExportFailureResult(accepted.request.id),
    ).toMatchObject({
      error: { code: "source_scratch_cleanup_recovered" },
      attempt: started.attempt,
      sourceCleanup: { lifecycle: "deleted", deletedAt: expect.any(String) },
    });
    database.close();
  });

  it("replaces an expired pending generation and removes a definitively stale copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-video-redelivery-"));
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "redelivery.sqlite"));
    runLocalMigrations(database);
    const queue = new LocalExportQueue(database);
    const first = fixtureLoggedDelivery();
    queue.importLoggedDeliveryPending(first);
    const second: LoggedExportDelivery = {
      ...first,
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ef12",
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ef13",
      reservedAt: "2026-08-20T12:00:31.000Z",
      reservationExpiresAt: "2026-08-20T12:01:01.000Z",
    };
    database.exec(`
      CREATE TRIGGER fixture_fail_replacement_job_insert
      BEFORE INSERT ON jobs
      WHEN NEW.id = '${first.request.jobId}'
      BEGIN
        SELECT RAISE(ABORT, 'fixture replacement insert failure');
      END;
    `);
    expect(() => queue.importLoggedDeliveryPending(second)).toThrow(
      /fixture replacement insert failure/u,
    );
    expect(queue.getPendingLoggedDelivery()).toMatchObject({
      deliveryId: first.deliveryId,
      generation: first.generation,
      reservationToken: first.reservationToken,
      request: { id: first.request.id, jobId: first.request.jobId },
    });
    expect(
      database.prepare("SELECT count(*) AS count FROM jobs").get(),
    ).toEqual({ count: 1 });
    database.exec("DROP TRIGGER fixture_fail_replacement_job_insert;");
    expect(queue.importLoggedDeliveryPending(second)).toMatchObject({
      id: first.request.id,
      mode: "logged",
      state: "claimed",
    });
    expect(queue.getPendingLoggedDelivery()).toMatchObject({
      deliveryId: second.deliveryId,
      generation: second.generation,
      reservationToken: second.reservationToken,
      workerId: second.workerId,
      workerEpoch: second.workerEpoch,
      request: {
        id: second.request.id,
        mode: "logged",
        projectId: second.request.projectId,
        clipId: second.request.clipId,
        state: "claimed",
      },
    });
    expect(
      database.prepare("SELECT count(*) AS count FROM jobs").get(),
    ).toEqual({ count: 1 });
    queue.rejectPendingLoggedDelivery(second);
    expect(queue.get(first.request.id)).toBeUndefined();
    expect(queue.getPendingLoggedDelivery()).toBeUndefined();
    expect(
      database.prepare("SELECT count(*) AS count FROM jobs").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  it("upgrades a populated export-only queue without changing its logical mode or snapshots", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-populated-0018-"),
    );
    temporaryDirectories.add(directory);
    const through0018 = join(directory, "migrations");
    mkdirSync(through0018);
    for (const filename of readdirSync(localMigrationDirectory)) {
      if (filename < "0019") {
        copyFileSync(
          resolve(localMigrationDirectory, filename),
          join(through0018, filename),
        );
      }
    }
    const filename = join(directory, "populated.sqlite");
    const database = openLocalDatabase(filename);
    runLocalMigrations(database, through0018);
    const before = new LocalExportQueue(database).createExportOnly(
      fixtureExportInput,
    );
    const rawSnapshot = database
      .prepare(
        "SELECT resolved_settings_snapshot_json FROM export_requests WHERE id = ?",
      )
      .get(before.id);
    expect(runLocalMigrations(database, localMigrationDirectory)).toEqual([
      "0019_logged_export_delivery_import",
      "0020_logged_export_delivery_acceptance_time",
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    const after = new LocalExportQueue(database).get(before.id);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ mode: "export_only", state: "queued" });
    expect(() =>
      database
        .prepare(
          `UPDATE export_requests
           SET cloud_delivery_state = 'accepted'
           WHERE id = ?`,
        )
        .run(before.id),
    ).toThrow(/acceptance/u);
    expect(new LocalExportQueue(database).get(before.id)).toEqual(before);
    expect(
      database
        .prepare(
          "SELECT resolved_settings_snapshot_json FROM export_requests WHERE id = ?",
        )
        .get(before.id),
    ).toEqual(rawSnapshot);
    database.close();
  });

  it("backfills the exact accepted-at value for a populated M5-16 delivery", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-populated-0019-"),
    );
    temporaryDirectories.add(directory);
    const through0019 = join(directory, "migrations");
    mkdirSync(through0019);
    for (const filename of readdirSync(localMigrationDirectory)) {
      if (filename < "0020") {
        copyFileSync(
          resolve(localMigrationDirectory, filename),
          join(through0019, filename),
        );
      }
    }
    const database = openLocalDatabase(join(directory, "populated.sqlite"));
    runLocalMigrations(database, through0019);
    const delivery = fixtureLoggedDelivery();
    const queue = new LocalExportQueue(database);
    queue.importLoggedDeliveryPending(delivery);
    const acceptedAt = "2026-08-20T12:00:05.000Z";
    database
      .prepare(
        `UPDATE export_requests
         SET cloud_delivery_state = 'accepted', updated_at = ?
         WHERE id = ?`,
      )
      .run(acceptedAt, delivery.request.id);
    database
      .prepare("UPDATE jobs SET state = 'queued', updated_at = ? WHERE id = ?")
      .run(acceptedAt, delivery.request.jobId);
    expect(runLocalMigrations(database, localMigrationDirectory)).toEqual([
      "0020_logged_export_delivery_acceptance_time",
      "0021_source_scratch_recovery_claims",
      "0022_logged_export_execution_cancellation",
      "0023_logged_export_execution_progress",
    ]);
    expect(
      new LocalExportQueue(database).getAcceptedLoggedDelivery(
        delivery.request.id,
      ),
    ).toMatchObject({
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      acceptedAt,
      request: { id: delivery.request.id, state: "queued" },
    });
    database.close();
  });
});

function activateFixtureExecution(
  queue: LocalExportQueue,
  delivery: LoggedExportDelivery,
) {
  return queue.activateLoggedExecution({
    executionId: randomUUID(),
    requestId: delivery.request.id,
    attempt: 1,
    workerId: delivery.workerId,
    workerEpoch: delivery.workerEpoch,
    leaseToken: randomUUID(),
    startedAt: "2026-08-20T12:00:06.000Z",
    heartbeatAt: "2026-08-20T12:00:07.000Z",
    expiresAt: "2026-08-20T12:00:37.000Z",
  });
}

function fixtureLoggedDelivery(): LoggedExportDelivery {
  const resolved = resolveExportSettings({
    context: "logged",
    sourceLanguageClass: "confirmed_english",
    resolvedAt: "2026-08-20T11:59:00.000Z",
  }).snapshot;
  const request = {
    id: "019fbb95-cd76-7920-93fa-e23ba755ef01",
    jobId: "019fbb95-cd76-7920-93fa-e23ba755ef02",
    mode: "logged" as const,
    projectId: "019fbb95-cd76-7920-93fa-e23ba755ef03",
    clipId: "019fbb95-cd76-7920-93fa-e23ba755ef04",
    video: fixtureExportInput.video,
    selection: fixtureExportInput.selection,
    sourceLanguageClass: "confirmed_english" as const,
    preset: {
      presetVersion: 1,
      name: "Editing MP4",
      settings: resolved.settings,
    },
    resolvedSettingsSnapshot: resolved,
    state: "queued" as const,
    createdAt: "2026-08-20T11:59:00.000Z",
    updatedAt: "2026-08-20T11:59:00.000Z",
  };
  return {
    deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ef05",
    generation: 1,
    reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ef06",
    workerId: "019fbb95-cd76-7920-93fa-e23ba755ef07",
    workerEpoch: 1,
    status: "reserved",
    reservedAt: "2026-08-20T12:00:00.000Z",
    reservationExpiresAt: "2026-08-20T12:00:30.000Z",
    request,
  };
}
