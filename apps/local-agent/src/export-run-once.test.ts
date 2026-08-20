import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "@research-video/config";
import {
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  FfmpegH264AacRangeRenderer,
  FfprobeMediaInspector,
  RenderDurationToleranceMs,
} from "@research-video/media";
import {
  normalizeTranscriptFixture,
  parseSrt,
  validateClipRelativeSrtCues,
} from "@research-video/transcript";

import { runConfiguredLocalExportOnce } from "./export-run-once.ts";

const fixtureMediaPath = fileURLToPath(
  new URL("../../../tests/fixtures/media/synthetic-4s.mp4", import.meta.url),
);
const ffmpegPath = "/usr/local/bin/ffmpeg";
const ffprobePath = "/usr/local/bin/ffprobe";
const temporaryRoots = new Set<string>();

beforeAll(async () => {
  await Promise.all([
    access(fixtureMediaPath),
    access(ffmpegPath),
    access(ffprobePath),
  ]);
});

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

describe("one-shot local export runtime", () => {
  it("processes one persisted export-only request with real FFmpeg and FFprobe", async () => {
    const root = await createFixtureWorkspace();
    const firstAttempt = createFixtureRequest(root);
    const inspection = new FfprobeMediaInspector({ executable: ffprobePath });
    const renderer = new FfmpegH264AacRangeRenderer({ executable: ffmpegPath });
    let acquisitionCalls = 0;
    let inspectionCalls = 0;
    let renderCalls = 0;
    const sourceProvider = fixtureSourceProvider(() => {
      acquisitionCalls += 1;
    });

    const missingConfirmation = await runConfiguredLocalExportOnce(
      { requestId: firstAttempt.requestId, authorizationConfirmed: false },
      {
        config: fixtureConfig(root),
        sourceProvider,
        inspector: {
          inspect: async (...args) => {
            inspectionCalls += 1;
            return inspection.inspect(...args);
          },
        },
        renderer: {
          render: async (...args) => {
            renderCalls += 1;
            return renderer.render(...args);
          },
          readVersion: (signal) => renderer.readVersion(signal),
        },
      },
    );

    expect(missingConfirmation).toMatchObject({
      status: "failed",
      state: "needs_user_action",
      error: { code: "source_authorization_required" },
    });
    expect({ acquisitionCalls, inspectionCalls, renderCalls }).toEqual({
      acquisitionCalls: 0,
      inspectionCalls: 0,
      renderCalls: 0,
    });

    const result = await runConfiguredLocalExportOnce(
      { requestId: firstAttempt.requestId, authorizationConfirmed: true },
      {
        config: fixtureConfig(root),
        sourceProvider,
        inspector: {
          inspect: async (...args) => {
            inspectionCalls += 1;
            return inspection.inspect(...args);
          },
        },
        renderer: {
          render: async (...args) => {
            renderCalls += 1;
            return renderer.render(...args);
          },
          readVersion: (signal) => renderer.readVersion(signal),
        },
      },
    );

    expect(result).toMatchObject({
      requestId: firstAttempt.requestId,
      status: "complete",
      state: "complete",
      packageIdentity: `clip-${firstAttempt.requestId}`,
    });
    expect(result.artifacts?.map((artifact) => artifact.role).sort()).toEqual([
      "clip_metadata_json",
      "english_srt",
      "manifest_json",
      "original_srt",
      "video_mp4",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/\/|youtube\.com|Authorized/u);
    expect(acquisitionCalls).toBe(1);
    expect(inspectionCalls).toBeGreaterThanOrEqual(2);
    expect(renderCalls).toBe(1);

    const packageIdentity = `clip-${firstAttempt.requestId}`;
    const packageDirectory = join(root, "exports", packageIdentity);
    const packageEntries = await readdir(packageDirectory);
    expect(packageEntries.sort()).toEqual([
      `${packageIdentity}.en.srt`,
      `${packageIdentity}.json`,
      `${packageIdentity}.mp4`,
      `${packageIdentity}.original.srt`,
      "manifest.json",
    ]);
    expect(
      (await readdir(join(root, "exports"))).filter((entry) =>
        entry.startsWith("."),
      ),
    ).toEqual([]);

    const videoPath = join(packageDirectory, `${packageIdentity}.mp4`);
    const output = await inspection.inspect(videoPath);
    expect(output).toMatchObject({ videoCodec: "h264", audioCodec: "aac" });
    expect(Math.abs(output.durationMs - 3_000)).toBeLessThanOrEqual(
      RenderDurationToleranceMs,
    );
    for (const suffix of ["original", "en"]) {
      const cues = parseSrt(
        await readFile(
          join(packageDirectory, `${packageIdentity}.${suffix}.srt`),
        ),
      );
      validateClipRelativeSrtCues(cues, output.durationMs);
      expect(cues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            startMs: expect.any(Number),
            endMs: expect.any(Number),
          }),
        ]),
      );
      expect(cues[0]?.startMs).toBeGreaterThanOrEqual(0);
    }

    const manifest = ExportClipManifestSchema.parse(
      JSON.parse(
        await readFile(join(packageDirectory, "manifest.json"), "utf8"),
      ),
    );
    const metadata = ExportClipMetadataSchema.parse(
      JSON.parse(
        await readFile(
          join(packageDirectory, `${packageIdentity}.json`),
          "utf8",
        ),
      ),
    );
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      exportRequestId: firstAttempt.requestId,
      packageIdentity,
      sourceLanguageClass: "foreign",
      video: {
        canonicalUrl: "https://www.youtube.com/watch?v=fixture-runtime-success",
      },
    });
    expect(JSON.stringify(metadata)).not.toContain(root);
    expect(JSON.stringify(metadata)).not.toMatch(/file:/u);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      exportRequestId: firstAttempt.requestId,
      packageIdentity,
      sourceLanguageClass: "foreign",
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
    });
    expect(Math.abs(manifest.renderedDurationMs - 3_000)).toBeLessThanOrEqual(
      RenderDurationToleranceMs,
    );
    expect(manifest.toolVersions.ffprobeVersion).toMatch(/^[0-9]/u);
    expect(manifest.toolVersions.ffmpegVersion).toMatch(/^[0-9]/u);
    for (const artifact of manifest.artifacts) {
      const bytes = await readFile(join(packageDirectory, artifact.filename));
      expect(artifact.byteSize).toBe(bytes.byteLength);
      expect(artifact.contentSha256).toBe(sha256(bytes));
    }

    const persisted = openLocalDatabase(join(root, "local.sqlite"));
    try {
      const queue = new LocalExportQueue(persisted);
      const request = queue.get(firstAttempt.requestId);
      expect(request?.state).toBe("complete");
      expect(request?.finalArtifacts).toHaveLength(5);
      expect(request?.renderedMediaProvenance?.ffmpegVersion).toBe(
        manifest.toolVersions.ffmpegVersion,
      );
      for (const artifact of request?.finalArtifacts ?? []) {
        const filename =
          artifact.role === "video_mp4"
            ? `${packageIdentity}.mp4`
            : artifact.role === "english_srt"
              ? `${packageIdentity}.en.srt`
              : artifact.role === "clip_metadata_json"
                ? `${packageIdentity}.json`
                : artifact.role === "manifest_json"
                  ? "manifest.json"
                  : `${packageIdentity}.original.srt`;
        const bytes = await readFile(join(packageDirectory, filename));
        expect(artifact.byteSize).toBe(bytes.byteLength);
        expect(artifact.contentSha256).toBe(sha256(bytes));
      }
      expect(queue.getSourceAttempt(request!.jobId, 1)?.lifecycleState).toBe(
        "deleted",
      );
    } finally {
      persisted.close();
    }
    expect(await readdir(join(root, "jobs", "export-source-scratch"))).toEqual(
      [],
    );

    const replay = await runConfiguredLocalExportOnce(
      { requestId: firstAttempt.requestId, authorizationConfirmed: true },
      {
        config: fixtureConfig(root),
        sourceProvider,
        inspector: inspection,
        renderer,
      },
    );
    expect(replay.status).toBe("already_complete");
    expect(acquisitionCalls).toBe(1);
    expect(renderCalls).toBe(1);

    const failedAttempt = createFixtureRequest(root, "failure");
    const failure = await runConfiguredLocalExportOnce(
      { requestId: failedAttempt.requestId, authorizationConfirmed: true },
      {
        config: fixtureConfig(root),
        sourceProvider: {
          acquireAuthorizedFullSource: async () => {
            throw Object.assign(
              new Error("authorized fixture acquisition failed"),
              {
                code: "fixture_acquisition_failed",
              },
            );
          },
        },
        inspector: inspection,
        renderer,
      },
    );
    expect(failure).toMatchObject({
      status: "failed",
      state: "needs_user_action",
      error: { code: "fixture_acquisition_failed" },
    });
    expect(await readdir(join(root, "exports"))).toEqual([packageIdentity]);
  });
});

async function createFixtureWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "local-export-runtime-"));
  temporaryRoots.add(root);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  database.close();
  return root;
}

function createFixtureRequest(root: string, suffix = "success") {
  const database = openLocalDatabase(join(root, "local.sqlite"));
  try {
    const queue = new LocalExportQueue(database);
    const originalTrackId =
      suffix === "success"
        ? "019fbb95-cd76-7920-93fa-e23ba755e201"
        : "019fbb95-cd76-7920-93fa-e23ba755e221";
    const englishTrackId =
      suffix === "success"
        ? "019fbb95-cd76-7920-93fa-e23ba755e202"
        : "019fbb95-cd76-7920-93fa-e23ba755e222";
    const originalSegmentId =
      suffix === "success"
        ? "019fbb95-cd76-7920-93fa-e23ba755e211"
        : "019fbb95-cd76-7920-93fa-e23ba755e231";
    const englishSegmentId =
      suffix === "success"
        ? "019fbb95-cd76-7920-93fa-e23ba755e212"
        : "019fbb95-cd76-7920-93fa-e23ba755e232";
    const videoId = `fixture-runtime-${suffix}`;
    const index = new LocalTranscriptIndex(database);
    index.replace({
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e101",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e102",
      transcriptVersionId:
        suffix === "success"
          ? "019fbb95-cd76-7920-93fa-e23ba755e103"
          : "019fbb95-cd76-7920-93fa-e23ba755e105",
      transcript: normalizeTranscriptFixture({
        track: {
          id: originalTrackId,
          videoId,
          language: "es",
          kind: "original",
          source: "fixture",
          provider: "fixture",
          timingPrecision: "cue",
          schemaVersion: 1,
          contentSha256: "a".repeat(64),
          version: 1,
        },
        segments: [
          {
            id: originalSegmentId,
            ordinal: 0,
            startMs: 500,
            endMs: 3_500,
            text: "Texto de fixture autorizado.",
          },
        ],
      }),
    });
    index.replace({
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e101",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e102",
      transcriptVersionId:
        suffix === "success"
          ? "019fbb95-cd76-7920-93fa-e23ba755e104"
          : "019fbb95-cd76-7920-93fa-e23ba755e106",
      transcript: normalizeTranscriptFixture({
        track: {
          id: englishTrackId,
          videoId,
          language: "en",
          kind: "english",
          source: "translated",
          provider: "fixture",
          sourceTrackId: originalTrackId,
          timingPrecision: "cue",
          schemaVersion: 1,
          contentSha256: "b".repeat(64),
          version: 1,
        },
        segments: [
          {
            id: englishSegmentId,
            ordinal: 0,
            startMs: 500,
            endMs: 3_500,
            text: "Authorized fixture text.",
          },
        ],
      }),
    });
    const request = queue.createExportOnly({
      idempotencyKey: `runtime-${suffix}`,
      video: {
        youtubeVideoId: videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: "Authorized local fixture",
      },
      selection: {
        trackId: englishTrackId,
        transcriptVersion: 1,
        firstSegmentId: englishSegmentId,
        lastSegmentId: englishSegmentId,
        transcriptStartMs: 500,
        transcriptEndMs: 3_500,
        exportStartMs: 500,
        exportEndMs: 3_500,
        text: "Fixture selection",
        timingPrecision: "cue",
      },
      sourceLanguageClass: "foreign",
      subtitleTracks: {
        original: { trackId: originalTrackId, trackVersion: 1 },
        english: { trackId: englishTrackId, trackVersion: 1 },
      },
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
    });
    return { requestId: request.id };
  } finally {
    database.close();
  }
}

function fixtureConfig(root: string) {
  return loadConfig({ NODE_ENV: "test", DATA_DIR: root });
}

function fixtureSourceProvider(onAcquisition: () => void) {
  return {
    acquireAuthorizedFullSource: async (input: {
      videoId: string;
      scratchDirectory: string;
      authorizationConfirmed: boolean;
    }) => {
      expect(input.authorizationConfirmed).toBe(true);
      onAcquisition();
      const scratchPath = join(
        input.scratchDirectory,
        `source-${input.videoId}.mp4`,
      );
      await copyFile(fixtureMediaPath, scratchPath);
      const info = await lstat(scratchPath);
      return {
        scratchPath,
        sourceIdentity: "repository-synthetic-4s",
        byteSize: info.size,
        provider: "repository-fixture",
        contentSha256: sha256(await readFile(scratchPath)),
      };
    },
  };
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
