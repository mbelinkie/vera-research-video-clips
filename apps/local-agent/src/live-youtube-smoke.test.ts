import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "@research-video/config";
import { LocalExportQueue, openLocalDatabase } from "@research-video/db-local";
import {
  FfmpegCapabilityRangeRenderer,
  FfprobeMediaInspector,
} from "@research-video/media";

import {
  LiveYouTubeSmokeDescriptorSchema,
  parseLiveYouTubeSmokeCommandLine,
  pathIsWithinRoot,
  runLiveYouTubeSmoke,
  runLiveYouTubeSmokeCommand,
  runLiveYouTubeSmokeFromConfig,
  type LiveYouTubeSmokeEvidence,
} from "./live-youtube-smoke.ts";
import { runConfiguredLocalExportOnce } from "./export-run-once.ts";

const temporaryRoots = new Set<string>();
const authorization = {
  authorizationConfirmed: true,
  liveSmokeAuthorized: true,
} as const;
const fixtureMediaPath = fileURLToPath(
  new URL("../../../tests/fixtures/media/synthetic-4s.mp4", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

describe("opt-in live YouTube smoke", () => {
  it("requires both authorization flags and exactly one external descriptor", () => {
    expect(parseLiveYouTubeSmokeCommandLine([])).toEqual({
      error: "live_smoke_authorization_required",
    });
    expect(
      parseLiveYouTubeSmokeCommandLine([
        "--authorization-confirmed",
        "--smoke-config",
        "/private/tmp/smoke.json",
      ]),
    ).toEqual({ error: "live_smoke_authorization_required" });
    expect(
      parseLiveYouTubeSmokeCommandLine([
        "--authorization-confirmed",
        "--live-smoke-authorized",
      ]),
    ).toEqual({ error: "live_smoke_config_required" });
    expect(
      parseLiveYouTubeSmokeCommandLine([
        "--authorization-confirmed",
        "--live-smoke-authorized",
        "--smoke-config",
        "/private/tmp/smoke.json",
        "--unexpected",
      ]),
    ).toEqual({ error: "live_smoke_arguments_invalid" });
    expect(
      parseLiveYouTubeSmokeCommandLine([
        "--authorization-confirmed",
        "--live-smoke-authorized",
        "--smoke-config",
        "/private/tmp/smoke.json",
      ]),
    ).toEqual({ descriptorPath: "/private/tmp/smoke.json" });
  });

  it("strictly validates rights, range, video linkage, roles, lineage, and cue coverage", () => {
    expect(LiveYouTubeSmokeDescriptorSchema.parse(descriptor())).toBeDefined();
    const invalid = [
      { ...descriptor(), authorization: { rightsCleared: false } },
      {
        ...descriptor(),
        selection: { exportStartMs: 0, exportEndMs: 30_001 },
      },
      { ...descriptor(), youtubeVideoId: "not-a-video" },
      {
        ...descriptor(),
        englishTranscript: {
          ...descriptor().englishTranscript,
          track: {
            ...descriptor().englishTranscript.track,
            sourceTrackId: randomUUID(),
          },
        },
      },
      {
        ...descriptor(),
        originalTranscript: {
          ...descriptor().originalTranscript,
          segments: [
            {
              ...descriptor().originalTranscript.segments[0],
              startMs: 6_000,
              endMs: 7_000,
            },
          ],
        },
      },
      { ...descriptor(), token: "must-be-rejected" },
      {
        ...descriptor(),
        originalTranscript: {
          ...descriptor().originalTranscript,
          track: {
            ...descriptor().originalTranscript.track,
            cookie: "must-also-be-rejected",
          },
        },
      },
      {
        ...descriptor(),
        originalTranscript: {
          ...descriptor().originalTranscript,
          segments: [
            {
              ...descriptor().originalTranscript.segments[0],
              trackId: randomUUID(),
            },
          ],
        },
      },
    ];
    for (const candidate of invalid) {
      expect(
        LiveYouTubeSmokeDescriptorSchema.safeParse(candidate).success,
      ).toBe(false);
    }
  });

  it("refuses disabled or unavailable prerequisites before setup or executor invocation", async () => {
    const preflight = vi.fn(async () => undefined);
    const createTemporaryRoot = vi.fn(async () => "/never-created");
    const executeExport = vi.fn();
    expect(
      await runLiveYouTubeSmoke(
        descriptor(),
        {} as typeof authorization,
        config("yt-dlp"),
        { preflightTools: preflight, createTemporaryRoot, executeExport },
      ),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_authorization_required",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(preflight).not.toHaveBeenCalled();
    expect(
      await runLiveYouTubeSmoke(
        descriptor(),
        authorization,
        config("disabled"),
        {
          preflightTools: preflight,
          createTemporaryRoot,
          executeExport,
        },
      ),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_provider_disabled",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(preflight).not.toHaveBeenCalled();
    expect(createTemporaryRoot).not.toHaveBeenCalled();
    expect(executeExport).not.toHaveBeenCalled();

    expect(
      await runLiveYouTubeSmoke(descriptor(), authorization, config("yt-dlp"), {
        preflightTools: async () => {
          throw new Error("missing /private/tool Bearer secret");
        },
        createTemporaryRoot,
        executeExport,
      }),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_prerequisite_unavailable",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(createTemporaryRoot).not.toHaveBeenCalled();
    expect(executeExport).not.toHaveBeenCalled();
  });

  it("seeds one private request, delegates once to the established executor, and removes the workspace", async () => {
    let root = "";
    const preflight = vi.fn(async () => undefined);
    const executeExport = vi.fn(async (input, options) => {
      expect(input.authorizationConfirmed).toBe(true);
      root = options.config!.dataDir;
      temporaryRoots.add(root);
      const database = openLocalDatabase(join(root, "local.sqlite"));
      try {
        expect(
          new LocalExportQueue(database).get(input.requestId),
        ).toMatchObject({
          id: input.requestId,
          mode: "export_only",
          sourceLanguageClass: "foreign",
          subtitleTracks: {
            original: {
              trackId: descriptor().originalTranscript.track.id,
              trackVersion: 3,
            },
            english: {
              trackId: descriptor().englishTranscript.track.id,
              trackVersion: 5,
            },
          },
        });
      } finally {
        database.close();
      }
      return {
        requestId: input.requestId,
        status: "complete" as const,
        state: "complete",
        packageIdentity: `clip-${input.requestId}`,
        artifacts: evidence().artifacts,
      };
    });
    const verifyExport = vi.fn(async () => evidence());
    const result = await runLiveYouTubeSmoke(
      descriptor(),
      authorization,
      config("yt-dlp"),
      {
        preflightTools: preflight,
        executeExport,
        verifyExport,
        createTemporaryRoot: async () => {
          const created = await mkdtemp(join(tmpdir(), "live-smoke-test-"));
          temporaryRoots.add(created);
          return created;
        },
      },
    );
    expect(result).toEqual({
      status: "passed",
      evidence: evidence(),
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(preflight).toHaveBeenCalledOnce();
    expect(executeExport).toHaveBeenCalledOnce();
    expect(verifyExport).toHaveBeenCalledOnce();
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    temporaryRoots.delete(root);
  });

  it("redacts adversarial executor failure evidence and makes cleanup failure terminal", async () => {
    let root = "";
    const result = await runLiveYouTubeSmoke(
      descriptor(),
      authorization,
      config("yt-dlp"),
      {
        preflightTools: async () => undefined,
        createTemporaryRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "live-smoke-redaction-"));
          temporaryRoots.add(root);
          return root;
        },
        executeExport: async ({ requestId }) => ({
          requestId,
          status: "failed",
          state: "needs_user_action",
          error: {
            code: "../../private/path?token=secret",
            message:
              "https://youtube.com/watch?v=fixture-smk /private/source Bearer private-token",
          },
        }),
      },
    );
    expect(result).toEqual({
      status: "failed",
      code: "live_smoke_export_failed",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /youtube|private|token|fixture-smk|source/u,
    );
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    temporaryRoots.delete(root);

    const cleanupFailure = await runLiveYouTubeSmoke(
      descriptor(),
      authorization,
      config("yt-dlp"),
      {
        preflightTools: async () => undefined,
        createTemporaryRoot: async () => {
          const created = await mkdtemp(join(tmpdir(), "live-smoke-leak-"));
          temporaryRoots.add(created);
          return created;
        },
        executeExport: async ({ requestId }) => ({
          requestId,
          status: "complete",
          state: "complete",
          packageIdentity: `clip-${requestId}`,
          artifacts: evidence().artifacts,
        }),
        verifyExport: async () => evidence(),
        removeTemporaryRoot: async () => {
          throw new Error("cleanup failed at /private/smoke");
        },
      },
    );
    expect(cleanupFailure).toEqual({
      status: "failed",
      code: "live_smoke_workspace_cleanup_failed",
      cleanup: { temporaryWorkspaceRemoved: false },
    });
  });

  it("propagates interruption to the executor and removes the private workspace", async () => {
    const controller = new AbortController();
    let root = "";
    let executionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    const running = runLiveYouTubeSmoke(
      descriptor(),
      authorization,
      config("yt-dlp"),
      {
        preflightTools: async () => undefined,
        createTemporaryRoot: async () => {
          root = await mkdtemp(join(tmpdir(), "live-smoke-interrupt-"));
          temporaryRoots.add(root);
          return root;
        },
        executeExport: async (input) => {
          expect(input.signal).toBe(controller.signal);
          executionStarted();
          return new Promise((resolve) => {
            input.signal?.addEventListener(
              "abort",
              () =>
                resolve({
                  requestId: input.requestId,
                  status: "canceled",
                  state: "canceled",
                }),
              { once: true },
            );
          });
        },
      },
      controller.signal,
    );
    await started;
    controller.abort();
    expect(await running).toEqual({
      status: "failed",
      code: "live_smoke_interrupted",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    temporaryRoots.delete(root);
  });

  it("runs the real verifier offline through the existing processor and emits no source identity", async () => {
    const liveDescriptor = {
      ...descriptor(),
      selection: { exportStartMs: 500, exportEndMs: 3_500 },
    };
    const result = await runLiveYouTubeSmoke(
      liveDescriptor,
      authorization,
      config("yt-dlp"),
      {
        preflightTools: async () => undefined,
        executeExport: async (input, options) =>
          runConfiguredLocalExportOnce(input, {
            ...options,
            sourceProvider: offlineFixtureSourceProvider(),
            inspector: new FfprobeMediaInspector({
              executable: "/usr/local/bin/ffprobe",
            }),
            renderer: new FfmpegCapabilityRangeRenderer({
              executable: "/usr/local/bin/ffmpeg",
            }),
          }),
      },
    );
    expect(result).toMatchObject({
      status: "passed",
      evidence: {
        artifacts: expect.arrayContaining([
          expect.objectContaining({ role: "manifest_json" }),
          expect.objectContaining({ role: "original_srt" }),
          expect.objectContaining({ role: "english_srt" }),
          expect.objectContaining({ role: "video_mp4" }),
        ]),
        media: {
          durationMs: 3_000,
          videoCodec: "h264",
          audioCodec: "aac",
          width: 640,
          height: 360,
        },
        sourceScratchAbsent: true,
      },
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-smk|repository-synthetic|authorized text|texto autorizado|youtube/u,
    );
  });

  it("fails closed when the real verifier sees sidecar bytes diverge from the descriptor", async () => {
    const liveDescriptor = {
      ...descriptor(),
      selection: { exportStartMs: 500, exportEndMs: 3_500 },
    };
    const result = await runLiveYouTubeSmoke(
      liveDescriptor,
      authorization,
      config("yt-dlp"),
      {
        preflightTools: async () => undefined,
        executeExport: async (input, options) => {
          const execution = await runConfiguredLocalExportOnce(input, {
            ...options,
            sourceProvider: offlineFixtureSourceProvider(),
            inspector: new FfprobeMediaInspector({
              executable: "/usr/local/bin/ffprobe",
            }),
            renderer: new FfmpegCapabilityRangeRenderer({
              executable: "/usr/local/bin/ffmpeg",
            }),
          });
          if (execution.packageIdentity) {
            const dataRoot = options?.config?.dataDir;
            expect(dataRoot).toBeDefined();
            await writeFile(
              join(
                dataRoot!,
                "exports",
                execution.packageIdentity,
                `${execution.packageIdentity}.en.srt`,
              ),
              "1\n00:00:00,000 --> 00:00:02,000\nTampered text.\n",
              "utf8",
            );
          }
          return execution;
        },
      },
    );
    expect(result).toEqual({
      status: "failed",
      code: "live_smoke_subtitle_provenance_invalid",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /tampered|fixture-smk|youtube/iu,
    );
  });

  it("requires an absolute descriptor outside the repository and never writes sensitive CLI output", async () => {
    const preflight = vi.fn(async () => undefined);
    expect(
      await runLiveYouTubeSmokeFromConfig(
        "relative.json",
        authorization,
        process.env,
        {
          preflightTools: preflight,
        },
      ),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_config_must_be_external",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(
      await runLiveYouTubeSmokeFromConfig(
        join(process.cwd(), "package.json"),
        authorization,
        process.env,
        { preflightTools: preflight },
      ),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_config_must_be_external",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(preflight).not.toHaveBeenCalled();
    expect(
      pathIsWithinRoot(
        process.cwd(),
        join(process.cwd(), "..live-smoke", "descriptor.json"),
      ),
    ).toBe(true);
    expect(
      pathIsWithinRoot(
        process.cwd(),
        join(process.cwd(), "..", "external-smoke", "descriptor.json"),
      ),
    ).toBe(false);

    const externalRoot = await mkdtemp(join(tmpdir(), "live-smoke-config-"));
    temporaryRoots.add(externalRoot);
    const configPath = join(externalRoot, "descriptor.json");
    await writeFile(configPath, JSON.stringify({ invalid: true }), "utf8");
    expect(
      await runLiveYouTubeSmokeFromConfig(
        configPath,
        authorization,
        { NODE_ENV: "test", EXPORT_SOURCE_PROVIDER: "yt-dlp" },
        { preflightTools: preflight },
      ),
    ).toEqual({
      status: "blocked",
      code: "live_smoke_descriptor_invalid",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(preflight).not.toHaveBeenCalled();

    let output = "";
    const exit = await runLiveYouTubeSmokeCommand(
      ["--authorization-confirmed"],
      {
        execute: vi.fn(),
        write: (value) => {
          output += value;
        },
      },
    );
    expect(exit).toBe(2);
    expect(JSON.parse(output)).toEqual({
      status: "blocked",
      code: "live_smoke_authorization_required",
      cleanup: { temporaryWorkspaceRemoved: true },
    });
    expect(output).not.toMatch(/path|url|video|token|transcript|text/iu);
    expect(await readFile(configPath, "utf8")).toContain("invalid");
  });
});

function config(provider: "disabled" | "yt-dlp") {
  return loadConfig({
    NODE_ENV: "test",
    DATA_DIR: join(tmpdir(), "unused-live-smoke-data"),
    EXPORT_SOURCE_PROVIDER: provider,
    YT_DLP_PATH: "yt-dlp",
  });
}

function descriptor() {
  const originalTrackId = "019fbb95-cd76-7920-93fa-e23ba755f101";
  return {
    schemaVersion: 1 as const,
    authorization: { rightsCleared: true as const },
    youtubeVideoId: "fixture-smk",
    selection: { exportStartMs: 1_000, exportEndMs: 5_000 },
    originalTranscript: {
      track: {
        id: originalTrackId,
        videoId: "fixture-smk",
        language: "es",
        kind: "original" as const,
        source: "fixture" as const,
        provider: "external-authorized-smoke",
        timingPrecision: "cue" as const,
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 3,
      },
      segments: [
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755f111",
          trackId: originalTrackId,
          ordinal: 0,
          startMs: 500,
          endMs: 2_500,
          text: "Texto autorizado.",
        },
      ],
      tokens: [],
    },
    englishTranscript: {
      track: {
        id: "019fbb95-cd76-7920-93fa-e23ba755f102",
        videoId: "fixture-smk",
        language: "en",
        kind: "english" as const,
        source: "translated" as const,
        provider: "external-authorized-smoke",
        sourceTrackId: originalTrackId,
        timingPrecision: "cue" as const,
        schemaVersion: 1,
        contentSha256: "b".repeat(64),
        version: 5,
      },
      segments: [
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755f112",
          trackId: "019fbb95-cd76-7920-93fa-e23ba755f102",
          ordinal: 0,
          startMs: 500,
          endMs: 2_500,
          text: "Authorized text.",
        },
      ],
      tokens: [],
    },
  };
}

function evidence(): LiveYouTubeSmokeEvidence {
  const hash = "c".repeat(64);
  return {
    artifacts: [
      "clip_metadata_json",
      "english_srt",
      "manifest_json",
      "original_srt",
      "thumbnail_jpg",
      "video_mp4",
    ].map((role) => ({ role, byteSize: 100, contentSha256: hash })),
    media: {
      durationMs: 4_000,
      videoCodec: "h264",
      audioCodec: "aac",
      width: 640,
      height: 360,
    },
    subtitles: {
      policy: "original_and_english",
      original: { cueCount: 1, startMs: 0, endMs: 1_500 },
      english: { cueCount: 1, startMs: 0, endMs: 1_500 },
    },
    sourceScratchAbsent: true,
  };
}

function offlineFixtureSourceProvider() {
  return {
    acquireAuthorizedFullSource: async (sourceInput: {
      videoId: string;
      scratchDirectory: string;
      authorizationConfirmed: boolean;
    }) => {
      expect(sourceInput.authorizationConfirmed).toBe(true);
      const scratchPath = join(
        sourceInput.scratchDirectory,
        `source-${sourceInput.videoId}.mp4`,
      );
      await copyFile(fixtureMediaPath, scratchPath);
      const bytes = await readFile(scratchPath);
      return {
        scratchPath,
        sourceIdentity: "repository-synthetic-4s",
        byteSize: bytes.byteLength,
        provider: "repository-fixture",
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
}
