import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import { normalizeTranscriptFixture } from "@research-video/transcript";

import {
  LocalExportQueue,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "./index.ts";

const temporaryDirectories = new Set<string>();

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
    const exportInput = {
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
    const exportRequest = exportQueue.createExportOnly(exportInput);
    const retry = exportQueue.createExportOnly({
      ...exportInput,
      preset: { ...exportInput.preset, name: "Changed retry" },
    });
    expect(exportRequest).toMatchObject({
      mode: "export_only",
      state: "queued",
      preset: { name: "Editing MP4" },
    });
    expect(retry).toEqual(exportRequest);
    expect(exportQueue.list()).toEqual([exportRequest]);
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
    });
    expect(exportQueue.get(exportRequest.id)).toMatchObject({
      renderedMediaProvenance: {
        durationMs: 3_200,
        videoCodec: "h264",
        audioCodec: "aac",
        sourceAttempt: 1,
      },
    });
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
});
