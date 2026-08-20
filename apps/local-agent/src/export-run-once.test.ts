import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
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
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "@research-video/config";
import {
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  type CreateExportOnlyRequest,
  type ExportSettings,
  type LoggedExportDelivery,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  FfmpegCapabilityDiscoveryProvider,
  FfmpegCapabilityRangeRenderer,
  FfprobeJpegThumbnailInspector,
  FfprobeMediaInspector,
  RenderDurationToleranceMs,
} from "@research-video/media";
import {
  availableRendererCapabilityIds,
  rendererCapabilityIdForSettings,
  resolveExportSettings,
} from "@research-video/export-settings";
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
const execFile = promisify(execFileCallback);

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
    const renderer = new FfmpegCapabilityRangeRenderer({
      executable: ffmpegPath,
    });
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
      "thumbnail_jpg",
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
      `${packageIdentity}.jpg`,
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
    const thumbnail = await new FfprobeJpegThumbnailInspector({
      executable: ffprobePath,
    }).inspect(join(packageDirectory, `${packageIdentity}.jpg`));
    expect(thumbnail).toEqual({ codecName: "mjpeg", width: 640, height: 360 });
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
      schemaVersion: 2,
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
      schemaVersion: 2,
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
    const thumbnailArtifact = manifest.artifacts.find(
      (artifact) => artifact.role === "thumbnail_jpg",
    );
    expect(thumbnailArtifact).toMatchObject({
      filename: `${packageIdentity}.jpg`,
      thumbnail: {
        extractionTimeMs: Math.floor(manifest.renderedDurationMs / 2),
        width: 640,
        height: 360,
        jpegQuality: 3,
      },
    });
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
      expect(request?.finalArtifacts).toHaveLength(6);
      expect(request?.thumbnailProvenance).toMatchObject({
        extractionTimeMs: Math.floor(manifest.renderedDurationMs / 2),
        width: 640,
        height: 360,
        sourceAttempt: 1,
      });
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
                : artifact.role === "thumbnail_jpg"
                  ? `${packageIdentity}.jpg`
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

  it("executes one accepted logged delivery through the same processor and projects a replay-stable safe result", async () => {
    const root = await createFixtureWorkspace();
    const request = createFixtureRequest(
      root,
      "logged-success",
      editingSettings,
      true,
    );
    let acquisitionCalls = 0;
    const options = {
      config: fixtureConfig(root),
      sourceProvider: fixtureSourceProvider(() => {
        acquisitionCalls += 1;
      }),
      inspector: new FfprobeMediaInspector({ executable: ffprobePath }),
      renderer: new FfmpegCapabilityRangeRenderer({ executable: ffmpegPath }),
    };
    expect(
      await runConfiguredLocalExportOnce(
        { requestId: request.requestId, authorizationConfirmed: true },
        options,
      ),
    ).toMatchObject({ status: "complete", state: "complete" });
    const database = openLocalDatabase(join(root, "local.sqlite"));
    let firstResult;
    try {
      const queue = new LocalExportQueue(database);
      expect(queue.getAcceptedLoggedDelivery(request.requestId)).toMatchObject({
        status: "accepted",
        request: { id: request.requestId, state: "complete" },
      });
      firstResult = queue.buildLoggedExportSuccessResult(request.requestId);
      expect(firstResult).toMatchObject({
        requestId: request.requestId,
        sourceLanguageClass: "foreign",
        artifacts: [
          { role: "clip_metadata_json" },
          { role: "english_srt" },
          { role: "manifest_json" },
          { role: "original_srt" },
          { role: "thumbnail_jpg" },
          { role: "video_mp4" },
        ],
      });
      expect(JSON.stringify(firstResult)).not.toMatch(
        /repository-synthetic-4s|reservationToken|sourceIdentity|\/private\//i,
      );
    } finally {
      database.close();
    }
    expect(
      await runConfiguredLocalExportOnce(
        { requestId: request.requestId, authorizationConfirmed: true },
        options,
      ),
    ).toMatchObject({ status: "already_complete", state: "complete" });
    const replayDatabase = openLocalDatabase(join(root, "local.sqlite"));
    try {
      expect(
        new LocalExportQueue(replayDatabase).buildLoggedExportSuccessResult(
          request.requestId,
        ),
      ).toEqual(firstResult);
    } finally {
      replayDatabase.close();
    }
    expect(acquisitionCalls).toBe(1);
  });

  it("projects processor-persisted accepted logged failures only after safe cleanup", async () => {
    const root = await createFixtureWorkspace();
    const notStarted = createFixtureRequest(
      root,
      "logged-not-started-failure",
      editingSettings,
      true,
    );
    expect(
      await runConfiguredLocalExportOnce(
        {
          requestId: notStarted.requestId,
          authorizationConfirmed: false,
        },
        {
          config: fixtureConfig(root),
          sourceProvider: fixtureSourceProvider(),
        },
      ),
    ).toMatchObject({
      status: "failed",
      state: "needs_user_action",
      error: { code: "source_authorization_required" },
    });
    const notStartedDatabase = openLocalDatabase(join(root, "local.sqlite"));
    try {
      expect(
        new LocalExportQueue(notStartedDatabase).buildLoggedExportFailureResult(
          notStarted.requestId,
        ),
      ).toMatchObject({
        attempt: 0,
        sourceCleanup: { lifecycle: "not_started" },
        error: { code: "source_authorization_required" },
      });
    } finally {
      notStartedDatabase.close();
    }

    const attempted = createFixtureRequest(
      root,
      "logged-cleaned-failure",
      editingSettings,
      true,
    );
    expect(
      await runConfiguredLocalExportOnce(
        { requestId: attempted.requestId, authorizationConfirmed: true },
        {
          config: fixtureConfig(root),
          sourceProvider: {
            acquireAuthorizedFullSource: async () => {
              throw Object.assign(
                new Error(
                  "acquisition failed at C:\\Users\\name\\source.mp4 Bearer private.jwt-token",
                ),
                { code: "fixture_acquisition_failed" },
              );
            },
          },
        },
      ),
    ).toMatchObject({
      status: "failed",
      state: "needs_user_action",
      error: { code: "fixture_acquisition_failed" },
    });
    const attemptedDatabase = openLocalDatabase(join(root, "local.sqlite"));
    try {
      const queue = new LocalExportQueue(attemptedDatabase);
      const result = queue.buildLoggedExportFailureResult(attempted.requestId);
      expect(result).toMatchObject({
        attempt: 1,
        sourceCleanup: {
          lifecycle: "deleted",
          deletedAt: expect.any(String),
        },
        error: {
          code: "fixture_acquisition_failed",
          message: "acquisition failed at <path> Bearer <redacted>",
        },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /C:\\Users|private\.jwt|reservationToken|sourceIdentity/i,
      );
      expect(
        queue.getSourceAttempt(queue.get(attempted.requestId)!.jobId, 1),
      ).toMatchObject({ lifecycleState: "deleted" });
    } finally {
      attemptedDatabase.close();
    }
  });

  it.each([
    {
      label: "H.264/MP4 with English soft subtitles",
      settings: {
        ...editingSettings,
        embedEnglishSubtitleTrack: true,
      } satisfies ExportSettings,
      extension: "mp4",
      role: "video_mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      embedded: true,
    },
    {
      label: "HEVC/MKV",
      settings: {
        container: "mkv",
        videoCodec: "hevc",
        videoRateControl: { mode: "crf", value: 28 },
        maxWidth: 640,
        frameRate: "24",
        audioCodec: "aac",
        audioKilobitsPerSecond: 192,
        audioSampleRate: "48000",
        audioChannels: "2",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: true,
      } satisfies ExportSettings,
      extension: "mkv",
      embedded: true,
      subtitleCodec: "subrip",
      role: "video_mkv",
      videoCodec: "hevc",
      audioCodec: "aac",
    },
    {
      label: "ProRes/MOV",
      settings: {
        container: "mov",
        videoCodec: "prores",
        videoRateControl: { mode: "codec_default" },
        frameRate: "25",
        audioCodec: "pcm_s16le",
        audioSampleRate: "48000",
        audioChannels: "2",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: true,
      } satisfies ExportSettings,
      extension: "mov",
      embedded: true,
      subtitleCodec: "mov_text",
      role: "video_mov",
      videoCodec: "prores",
      audioCodec: "pcm_s16le",
    },
  ])(
    "renders and verifies installed $label conformance",
    async (fixture, context) => {
      const capabilityProvider = new FfmpegCapabilityDiscoveryProvider({
        executable: ffmpegPath,
      });
      const discovered = await capabilityProvider.discover();
      const rendererId = rendererCapabilityIdForSettings(fixture.settings)!;
      if (!availableRendererCapabilityIds(discovered).includes(rendererId)) {
        (context as unknown as { skip: () => void }).skip();
        return;
      }
      const root = await createFixtureWorkspace();
      const request = createFixtureRequest(
        root,
        fixture.extension,
        fixture.settings,
      );
      const result = await runConfiguredLocalExportOnce(
        { requestId: request.requestId, authorizationConfirmed: true },
        {
          config: fixtureConfig(root),
          sourceProvider: fixtureSourceProvider(),
          inspector: new FfprobeMediaInspector({ executable: ffprobePath }),
          renderer: new FfmpegCapabilityRangeRenderer({
            executable: ffmpegPath,
          }),
          capabilityProvider,
        },
      );
      expect(result.status, JSON.stringify(result)).toBe("complete");
      expect(result.state).toBe("complete");
      expect(result.artifacts?.map((artifact) => artifact.role)).toContain(
        fixture.role,
      );
      const packageIdentity = `clip-${request.requestId}`;
      const packageDirectory = join(root, "exports", packageIdentity);
      const videoPath = join(
        packageDirectory,
        `${packageIdentity}.${fixture.extension}`,
      );
      const observed = await new FfprobeMediaInspector({
        executable: ffprobePath,
      }).inspect(videoPath);
      expect(observed).toMatchObject({
        videoCodec: fixture.videoCodec,
        audioCodec: fixture.audioCodec,
        observedProperties: {
          streamCounts: {
            total: fixture.embedded ? 3 : 2,
            video: 1,
            audio: 1,
            subtitle: fixture.embedded ? 1 : 0,
            data: 0,
            other: 0,
          },
        },
      });
      if (fixture.embedded)
        expect(observed.observedProperties?.subtitle).toMatchObject({
          codec: fixture.subtitleCodec ?? "mov_text",
          language: "eng",
          default: false,
          forced: false,
        });
      if (fixture.embedded && fixture.extension === "mp4") {
        const [embedded, sidecar] = await Promise.all([
          extractEmbeddedEnglishSrt(videoPath),
          readFile(join(packageDirectory, `${packageIdentity}.en.srt`), "utf8"),
        ]);
        expect(parseSrt(embedded)).toEqual(parseSrt(sidecar));
      }
      const manifest = ExportClipManifestSchema.parse(
        JSON.parse(
          await readFile(join(packageDirectory, "manifest.json"), "utf8"),
        ),
      );
      expect(manifest).toMatchObject({
        schemaVersion: 2,
        rendererCapabilityId: rendererId,
        videoArtifact: {
          role: fixture.role,
          filename: `${packageIdentity}.${fixture.extension}`,
        },
        observedMedia: observed.observedProperties,
      });
    },
  );
});

async function extractEmbeddedEnglishSrt(videoPath: string): Promise<string> {
  const result = await execFile(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      videoPath,
      "-map",
      "0:s:0",
      "-c:s",
      "srt",
      "-f",
      "srt",
      "-",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return result.stdout;
}

async function createFixtureWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "local-export-runtime-"));
  temporaryRoots.add(root);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  database.close();
  return root;
}

const editingSettings: ExportSettings = {
  container: "mp4",
  videoCodec: "h264",
  videoRateControl: { mode: "crf", value: 20 },
  frameRate: "source",
  audioCodec: "aac",
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};

function createFixtureRequest(
  root: string,
  suffix = "success",
  settings: ExportSettings = editingSettings,
  logged = false,
) {
  const database = openLocalDatabase(join(root, "local.sqlite"));
  try {
    const queue = new LocalExportQueue(database);
    const originalTrackId = randomUUID();
    const englishTrackId = randomUUID();
    const originalSegmentId = randomUUID();
    const englishSegmentId = randomUUID();
    const videoId = `fixture-runtime-${suffix}`;
    const index = new LocalTranscriptIndex(database);
    index.replace({
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e101",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e102",
      transcriptVersionId: randomUUID(),
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
            endMs: 1_500,
            text: "Texto de fixture autorizado.",
          },
        ],
      }),
    });
    index.replace({
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e101",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e102",
      transcriptVersionId: randomUUID(),
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
            endMs: 1_500,
            text: "Authorized fixture text.",
          },
        ],
      }),
    });
    const input: CreateExportOnlyRequest = {
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
        settings,
      },
    };
    if (logged) {
      const preset = input.preset;
      if (!preset) {
        throw new Error("Logged export fixture requires an explicit preset");
      }
      const at = "2026-08-20T12:00:00.000Z";
      const resolved = resolveExportSettings({
        context: "logged",
        sourceLanguageClass: "foreign",
        resolvedAt: at,
      }).snapshot;
      const delivery: LoggedExportDelivery = {
        deliveryId: randomUUID(),
        generation: 1,
        reservationToken: randomUUID(),
        workerId: randomUUID(),
        workerEpoch: 1,
        status: "reserved",
        reservedAt: at,
        reservationExpiresAt: "2026-08-20T12:00:30.000Z",
        request: {
          id: randomUUID(),
          jobId: randomUUID(),
          mode: "logged",
          projectId: "019fbb95-cd76-7920-93fa-e23ba755e101",
          clipId: randomUUID(),
          video: input.video,
          selection: input.selection,
          sourceLanguageClass: input.sourceLanguageClass,
          subtitleTracks: input.subtitleTracks,
          preset: {
            presetId: preset.presetId,
            presetVersion: preset.presetVersion ?? 1,
            name: preset.name ?? "Editing MP4",
            settings: resolved.settings,
          },
          resolvedSettingsSnapshot: resolved,
          state: "queued",
          createdAt: at,
          updatedAt: at,
        },
      };
      queue.importLoggedDeliveryPending(delivery);
      const accepted: LoggedExportDelivery = {
        ...delivery,
        status: "accepted",
        acceptedAt: "2026-08-20T12:00:05.000Z",
      };
      const request = queue.activateLoggedDelivery(accepted);
      return { requestId: request.id };
    }
    const request = queue.createExportOnly(input);
    return { requestId: request.id };
  } finally {
    database.close();
  }
}

function fixtureConfig(root: string) {
  return loadConfig({ NODE_ENV: "test", DATA_DIR: root });
}

function fixtureSourceProvider(onAcquisition: () => void = () => undefined) {
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
