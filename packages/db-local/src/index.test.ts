import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { sha256Fingerprint } from "@research-video/export-settings";

import {
  LocalExportQueue,
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
