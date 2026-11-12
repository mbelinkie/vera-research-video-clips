import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { normalizeWebVttCaption } from "@research-video/transcript";
import { readFileSync } from "node:fs";

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
      "0005_derived_caption_ends",
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
    database.close();
  });

  it("retains derived ends across SQLite index and export-only JSON snapshots", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-derived-sqlite-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    runLocalMigrations(database);
    try {
      const transcript = await normalizeWebVttCaption({
        contents: readFileSync(
          new URL(
            "../../../tests/fixtures/transcripts/auto-word-timed.vtt",
            import.meta.url,
          ),
        ),
        videoId: "M7lc1UVf-VE",
        language: "en",
        source: "youtube-auto",
        provider: "yt-dlp",
      });
      const index = new LocalTranscriptIndex(database);
      index.replace({
        projectId: "project-fixture",
        catalogVideoId: "video-fixture",
        transcriptVersionId: "v2",
        transcript,
      });
      expect(index.get("v2", "english")).toEqual(transcript);
      expect(
        database
          .prepare("SELECT end_timing FROM transcript_tokens WHERE id = ?")
          .get(transcript.tokens[1]!.id),
      ).toEqual({ end_timing: "derived" });
      expect(() =>
        database
          .prepare(
            "UPDATE transcript_tokens SET end_timing = 'exact' WHERE id = ?",
          )
          .run(transcript.tokens[1]!.id),
      ).toThrow();

      const selection = {
        trackId: transcript.track.id,
        transcriptVersion: transcript.track.version,
        firstSegmentId: transcript.segments[0]!.id,
        lastSegmentId: transcript.segments[0]!.id,
        firstTokenId: transcript.tokens[1]!.id,
        lastTokenId: transcript.tokens[3]!.id,
        transcriptStartMs: 11_840,
        transcriptEndMs: 13_100,
        exportStartMs: 11_500,
        exportEndMs: 13_500,
        text: "closely now please",
        timingPrecision: "estimated" as const,
        endTiming: "derived" as const,
      };
      const queue = new LocalExportQueue(database);
      const request = queue.createExportOnly({
        idempotencyKey: "timed-export",
        video: {
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://youtu.be/M7lc1UVf-VE",
          title: "Test",
        },
        selection,
        sourceLanguageClass: "confirmed_english",
        preset: {
          presetVersion: 1,
          name: "MP4",
          settings: {
            container: "mp4",
            videoCodec: "h264",
            videoRateControl: { mode: "crf", value: 20 },
            maxWidth: 1_920,
            frameRate: "source",
            audioCodec: "aac",
            audioKilobitsPerSecond: 192,
            omitSubtitleFilesForConfirmedEnglish: false,
            embedEnglishSubtitleTrack: false,
          },
        },
      });
      expect(request.selection).toEqual(selection);
      expect(queue.get(request.id)?.selection).toEqual(selection);
      expect(queue.list()[0]?.selection).toEqual(selection);
      expect(
        JSON.parse(
          String(
            database
              .prepare(
                "SELECT selection_snapshot_json FROM export_requests WHERE id = ?",
              )
              .get(request.id)?.selection_snapshot_json,
          ),
        ),
      ).toEqual(selection);
    } finally {
      database.close();
    }
  });
});
