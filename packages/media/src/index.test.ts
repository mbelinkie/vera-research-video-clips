import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertEditingFriendlyH264AacMp4Settings,
  buildFfmpegRenderArguments,
  ExportSourceAcquisitionError,
  FfmpegCapabilityDiscoveryProvider,
  FfmpegH264AacRangeRenderer,
  FfmpegJpegThumbnailExtractor,
  FfmpegRenderError,
  FfprobeJpegThumbnailInspector,
  FfprobeMediaInspector,
  YtDlpAudioAcquisitionProvider,
  YtDlpFullSourceAcquisitionProvider,
  createMediaAcquisitionProvider,
  createExportSourceAcquisitionProvider,
  inspectVerifiedExportSource,
  inspectAndValidateJpegThumbnail,
  resolveExportBounds,
  type MediaCommandRunner,
  withExportSourceScratch,
} from "./index.ts";

describe("FfprobeMediaInspector", () => {
  it("uses bounded argument arrays and parses only safe media provenance", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffprobe-source-"));
    const source = join(scratch, "source.mp4");
    await writeFile(source, "fixture source");
    const runner = vi.fn<MediaCommandRunner["run"]>(
      async (_executable, args) =>
        args.includes("-version")
          ? { stdout: "ffprobe version 7.1 Copyright", stderr: "" }
          : {
              stdout: JSON.stringify({
                format: {
                  duration: "12.3456",
                  format_name: "mov,mp4,m4a,3gp,3g2,mj2",
                  nb_streams: 2,
                  tags: { major_brand: "isom" },
                },
                streams: [
                  {
                    index: 0,
                    codec_type: "video",
                    codec_name: "h264",
                    profile: "High",
                    pix_fmt: "yuv420p",
                    width: 640,
                    height: 360,
                    sample_aspect_ratio: "1:1",
                    display_aspect_ratio: "16:9",
                    avg_frame_rate: "30/1",
                  },
                  {
                    index: 1,
                    codec_type: "audio",
                    codec_name: "aac",
                    sample_rate: "48000",
                    channels: 1,
                    channel_layout: "mono",
                    bit_rate: "128000",
                  },
                ],
              }),
              stderr: "",
            },
    );
    try {
      const inspector = new FfprobeMediaInspector({
        executable: "/opt/tools/ffprobe",
        runner: { run: runner },
      });
      await expect(
        inspectVerifiedExportSource({
          sourcePath: source,
          scratchDirectory: scratch,
          inspector,
        }),
      ).resolves.toMatchObject({
        durationMs: 12_346,
        containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        ffprobeVersion: "7.1",
        observedProperties: {
          streamCounts: { total: 2, video: 1, audio: 1 },
          video: { profile: "High", pixelFormat: "yuv420p" },
          audio: { sampleRate: 48_000, channels: 1 },
        },
      });
      expect(runner.mock.calls[0]?.[0]).toBe("/opt/tools/ffprobe");
      expect(runner.mock.calls[0]?.[1]).toEqual([
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name,nb_streams:format_tags=major_brand:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,sample_aspect_ratio,display_aspect_ratio,avg_frame_rate,sample_rate,channels,channel_layout,bit_rate,disposition:stream_tags=language,title",
        "-of",
        "json",
        "--",
        source,
      ]);
      expect(runner.mock.calls[1]?.[1]).toEqual(["-version"]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects malformed output and sources outside their attempt scratch", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffprobe-source-"));
    const elsewhere = await mkdtemp(join(tmpdir(), "ffprobe-outside-"));
    const source = join(scratch, "source.mp4");
    const outsideSource = join(elsewhere, "source.mp4");
    await writeFile(source, "fixture source");
    await writeFile(outsideSource, "fixture source");
    const inspector = new FfprobeMediaInspector({
      runner: { run: async () => ({ stdout: "not json", stderr: "" }) },
    });
    try {
      await expect(inspector.inspect(source)).rejects.toMatchObject({
        code: "ffprobe_output_malformed",
      });
      await expect(
        inspectVerifiedExportSource({
          sourcePath: outsideSource,
          scratchDirectory: scratch,
          inspector,
        }),
      ).rejects.toMatchObject({ code: "source_path_outside_scratch" });
    } finally {
      await rm(scratch, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("clamps requested padded bounds and rejects empty resolved ranges", () => {
    expect(
      resolveExportBounds({
        requestedStartMs: -500,
        requestedEndMs: 4_000,
        durationMs: 2_000,
      }),
    ).toEqual({ startMs: 0, endMs: 2_000 });
    expect(() =>
      resolveExportBounds({
        requestedStartMs: 2_000,
        requestedEndMs: 4_000,
        durationMs: 2_000,
      }),
    ).toThrow(/does not overlap/u);
  });
});

describe("FfmpegH264AacRangeRenderer", () => {
  it("discovers the fixed installed encoder, muxer, and filter vocabulary", async () => {
    const runner = vi.fn<MediaCommandRunner["run"]>(
      async (_executable, args) => {
        if (args.includes("-encoders"))
          return {
            stdout:
              " V..... libx264 fixture\n V..... libx265 fixture\n V..... prores_ks fixture\n",
            stderr: "",
          };
        if (args.includes("-muxers"))
          return {
            stdout: " E mp4 fixture\n E matroska fixture\n E mov fixture\n",
            stderr: "",
          };
        if (args.includes("-filters"))
          return { stdout: " .. scale fixture\n .. fps fixture\n", stderr: "" };
        return { stdout: "ffmpeg version 8.1.2 Copyright", stderr: "" };
      },
    );
    const provider = new FfmpegCapabilityDiscoveryProvider({
      executable: "/opt/tools/ffmpeg",
      runner: { run: runner },
    });

    await expect(provider.discover()).resolves.toEqual({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks"],
      muxers: ["matroska", "mov", "mp4"],
      filters: ["fps", "scale"],
    });
    expect(runner).toHaveBeenCalledTimes(4);
  });

  it("maps alternative stable IDs to fixed HEVC and ProRes arguments", () => {
    const base = {
      sourcePath: "/private/tmp/source.mp4",
      stagingDirectory: "/private/tmp",
      startMs: 1_000,
      endMs: 2_000,
    };
    const hevc = buildFfmpegRenderArguments({
      ...base,
      outputPath: "/private/tmp/output.mkv",
      settings: {
        container: "mkv",
        videoCodec: "hevc",
        videoRateControl: { mode: "bitrate", kilobitsPerSecond: 8_000 },
        maxWidth: 1_280,
        frameRate: "23.976",
        audioCodec: "aac",
        audioKilobitsPerSecond: 192,
        audioSampleRate: "48000",
        audioChannels: "2",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    });
    expect(hevc).toEqual(
      expect.arrayContaining([
        "libx265",
        "main",
        "yuv420p",
        "scale=w='min(iw,1280)':h=-2:flags=lanczos,fps=fps=24000/1001:round=near",
        "8000k",
        "192k",
        "matroska",
      ]),
    );
    const prores = buildFfmpegRenderArguments({
      ...base,
      outputPath: "/private/tmp/output.mov",
      settings: {
        container: "mov",
        videoCodec: "prores",
        videoRateControl: { mode: "codec_default" },
        frameRate: "source",
        audioCodec: "pcm_s16le",
        audioSampleRate: "44100",
        audioChannels: "1",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    });
    expect(prores).toEqual(
      expect.arrayContaining([
        "prores_ks",
        "2",
        "yuv422p10le",
        "pcm_s16le",
        "44100",
        "mov",
      ]),
    );
    expect(prores).not.toContain("-crf");
    expect(prores).not.toContain("-b:v");
    expect(prores).not.toContain("-b:a");
  });

  it("maps one processor-owned English SRT to the fixed MP4 soft-subtitle stream", () => {
    const args = buildFfmpegRenderArguments({
      sourcePath: "/private/tmp/source.mp4",
      stagingDirectory: "/private/tmp",
      outputPath: "/private/tmp/output.mp4",
      englishSubtitlePath: "/private/tmp/english.srt",
      startMs: 1_000,
      endMs: 2_000,
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: true,
      },
    });
    expect(args).toEqual(
      expect.arrayContaining([
        "-map",
        "1:s:0",
        "-c:s",
        "mov_text",
        "language=eng",
        "title=English",
        "-disposition:s:0",
        "0",
      ]),
    );
    expect(args).toContain("/private/tmp/english.srt");
  });

  it("builds a precise, bounded H.264/AAC MP4 argument array", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffmpeg-render-"));
    const source = join(scratch, "source.mp4");
    const output = join(scratch, "rendered-range.mp4");
    await writeFile(source, "fixture source");
    const runner = vi.fn<MediaCommandRunner["run"]>(async () => ({
      stdout: "",
      stderr: "",
    }));
    try {
      const renderer = new FfmpegH264AacRangeRenderer({
        executable: "/opt/tools/ffmpeg",
        runner: { run: runner },
      });
      await renderer.render({
        sourcePath: source,
        stagingDirectory: scratch,
        outputPath: output,
        startMs: 1_250,
        endMs: 4_750,
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      });
      expect(runner).toHaveBeenCalledWith(
        "/opt/tools/ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          source,
          "-ss",
          "1.250",
          "-t",
          "3.500",
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-sn",
          "-dn",
          "-map_metadata",
          "-1",
          "-map_chapters",
          "-1",
          "-c:v",
          "libx264",
          "-profile:v",
          "high",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "20",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          "-n",
          output,
        ],
        expect.objectContaining({ timeoutMs: 6 * 60 * 60 * 1_000 }),
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects settings beyond the initial editing-friendly snapshot", () => {
    expect(() =>
      assertEditingFriendlyH264AacMp4Settings({
        container: "mov",
        videoCodec: "hevc",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      }),
    ).toThrow(FfmpegRenderError);
  });

  it("reads a bounded encoder version without ever failing a render", async () => {
    const runner = vi.fn<MediaCommandRunner["run"]>(async () => ({
      stdout: "ffmpeg version 8.1.2 Copyright (c) 2000-2026\nbuilt with clang",
      stderr: "",
    }));
    const renderer = new FfmpegH264AacRangeRenderer({
      executable: "/opt/tools/ffmpeg",
      runner: { run: runner },
    });

    await expect(renderer.readVersion()).resolves.toBe("8.1.2");
    expect(runner).toHaveBeenCalledWith(
      "/opt/tools/ffmpeg",
      ["-version"],
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
    await expect(
      new FfmpegH264AacRangeRenderer({
        runner: {
          run: async () => {
            throw new Error("ffmpeg is unavailable");
          },
        },
      }).readVersion(),
    ).resolves.toBeUndefined();
    await expect(
      new FfmpegH264AacRangeRenderer({
        runner: { run: async () => ({ stdout: "unexpected", stderr: "" }) },
      }).readVersion(),
    ).resolves.toBeUndefined();
  });
});

describe("FfmpegJpegThumbnailExtractor", () => {
  it("uses one bounded argument-array extraction from the rendered MP4", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffmpeg-thumbnail-"));
    const rendered = join(scratch, "rendered-range.mp4");
    const output = join(scratch, "thumbnail.jpg");
    await writeFile(rendered, "fixture render");
    const runner = vi.fn<MediaCommandRunner["run"]>(async () => ({
      stdout: "",
      stderr: "",
    }));
    try {
      const extractor = new FfmpegJpegThumbnailExtractor({
        executable: "/opt/tools/ffmpeg",
        runner: { run: runner },
      });
      await extractor.extract({
        renderedVideoPath: rendered,
        stagingDirectory: scratch,
        outputPath: output,
        extractionTimeMs: 1_500,
      });
      expect(runner).toHaveBeenCalledWith(
        "/opt/tools/ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          rendered,
          "-ss",
          "1.500",
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v",
          "mjpeg",
          "-q:v",
          "3",
          "-pix_fmt",
          "yuvj420p",
          "-f",
          "image2",
          "-n",
          output,
        ],
        expect.objectContaining({ timeoutMs: 30_000 }),
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("independently validates one in-policy MJPEG thumbnail", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffprobe-thumbnail-"));
    const output = join(scratch, "thumbnail.jpg");
    await writeFile(output, "fixture thumbnail");
    try {
      await expect(
        inspectAndValidateJpegThumbnail({
          outputPath: output,
          stagingDirectory: scratch,
          inspector: {
            inspect: async () => ({
              codecName: "mjpeg",
              width: 640,
              height: 360,
            }),
          },
        }),
      ).resolves.toEqual({ codecName: "mjpeg", width: 640, height: 360 });
      await expect(
        inspectAndValidateJpegThumbnail({
          outputPath: output,
          stagingDirectory: scratch,
          inspector: {
            inspect: async () => ({
              codecName: "png",
              width: 641,
              height: 360,
            }),
          },
        }),
      ).rejects.toMatchObject({ code: "thumbnail_output_policy_mismatch" });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("bounds image probe output and accepts only one safe image stream", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffprobe-thumbnail-"));
    const output = join(scratch, "thumbnail.jpg");
    await writeFile(output, "fixture thumbnail");
    const runner = vi.fn<MediaCommandRunner["run"]>(async () => ({
      stdout: JSON.stringify({
        streams: [{ codec_name: "mjpeg", width: 640, height: 360 }],
      }),
      stderr: "",
    }));
    try {
      await expect(
        new FfprobeJpegThumbnailInspector({
          executable: "/opt/tools/ffprobe",
          runner: { run: runner },
        }).inspect(output),
      ).resolves.toEqual({ codecName: "mjpeg", width: 640, height: 360 });
      expect(runner).toHaveBeenCalledWith(
        "/opt/tools/ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,width,height",
          "-of",
          "json",
          "--",
          output,
        ],
        expect.objectContaining({ timeoutMs: 30_000 }),
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("YtDlpAudioAcquisitionProvider", () => {
  it("is opt-in and acquires only audio into isolated scratch storage", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "audio-provider-"));
    const runner = vi.fn<MediaCommandRunner["run"]>(
      async (_executable, args) => {
        const output = args[args.indexOf("--output") + 1]!;
        await writeFile(output.replace("%(ext)s", "flac"), "fixture audio");
        return { stdout: "", stderr: "" };
      },
    );
    const provider = createMediaAcquisitionProvider(
      { mode: "yt-dlp-audio", ytDlpPath: "/opt/tools/yt-dlp" },
      { run: runner },
    );

    try {
      expect(
        createMediaAcquisitionProvider({
          mode: "disabled",
          ytDlpPath: "yt-dlp",
        }),
      ).toBeUndefined();
      const acquired = await provider!.acquireAuthorizedSource(
        "M7lc1UVf-VE",
        scratch,
      );
      expect(acquired).toMatchObject({
        videoId: "M7lc1UVf-VE",
        format: "flac",
        provider: "yt-dlp",
        byteSize: 13,
      });
      expect(acquired.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(runner.mock.calls[0]?.[1]).toEqual([
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extract-audio",
        "--audio-format",
        "flac",
        "--output",
        join(scratch, "audio-M7lc1UVf-VE.%(ext)s"),
        "--",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      ]);

      await expect(
        provider!.acquireAuthorizedSource("M7lc1UVf-VE", scratch),
      ).resolves.toEqual(acquired);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects invalid video IDs before invoking the tool", async () => {
    const runner = vi.fn<MediaCommandRunner["run"]>();
    const provider = new YtDlpAudioAcquisitionProvider({
      runner: { run: runner },
    });
    await expect(
      provider.acquireAuthorizedSource("invalid", "/tmp/job"),
    ).rejects.toMatchObject({ code: "media_acquisition_failed" });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("YtDlpFullSourceAcquisitionProvider", () => {
  it("requires authorization and builds a bounded no-config full-source command", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "export-source-provider-"));
    const runner = vi.fn<MediaCommandRunner["run"]>(
      async (_executable, args) => {
        const output = args[args.indexOf("--output") + 1]!;
        await writeFile(output.replace("%(ext)s", "mp4"), "fixture source");
        return { stdout: "", stderr: "" };
      },
    );
    const provider = createExportSourceAcquisitionProvider(
      { mode: "yt-dlp", ytDlpPath: "/opt/tools/yt-dlp" },
      { run: runner },
    );

    try {
      expect(
        createExportSourceAcquisitionProvider({
          mode: "disabled",
          ytDlpPath: "yt-dlp",
        }),
      ).toBeUndefined();
      await expect(
        provider!.acquireAuthorizedFullSource({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: false,
        }),
      ).rejects.toMatchObject({ code: "source_authorization_required" });
      expect(runner).not.toHaveBeenCalled();

      const source = await provider!.acquireAuthorizedFullSource({
        videoId: "M7lc1UVf-VE",
        scratchDirectory: scratch,
        authorizationConfirmed: true,
      });
      expect(source).toMatchObject({
        sourceIdentity: "M7lc1UVf-VE",
        provider: "yt-dlp",
        byteSize: 14,
      });
      expect(source.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(runner.mock.calls[0]?.[1]).toEqual([
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--format",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--output",
        join(scratch, "source-M7lc1UVf-VE.%(ext)s"),
        "--",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects absent, empty, and non-regular provider output", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "export-source-provider-"));
    const provider = new YtDlpFullSourceAcquisitionProvider({
      runner: { run: async () => ({ stdout: "", stderr: "" }) },
    });
    try {
      await expect(
        provider.acquireAuthorizedFullSource({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "source_output_missing" });
      await writeFile(join(scratch, "source-M7lc1UVf-VE.mp4"), "");
      await expect(
        provider.acquireAuthorizedFullSource({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "source_output_invalid" });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("withExportSourceScratch", () => {
  const sourceProvider = (action?: (directory: string) => Promise<void>) => ({
    acquireAuthorizedFullSource: async ({
      videoId,
      scratchDirectory,
      signal,
    }: {
      videoId: string;
      scratchDirectory: string;
      signal?: AbortSignal;
    }) => {
      await action?.(scratchDirectory);
      if (signal?.aborted) throw signal.reason;
      const path = join(scratchDirectory, `source-${videoId}.mp4`);
      await writeFile(path, "fixture source");
      return {
        scratchPath: path,
        sourceIdentity: videoId,
        byteSize: 14,
        provider: "fixture",
        contentSha256: "a".repeat(64),
      };
    },
  });

  it("deletes the private attempt directory after a successful handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "export-source-lifecycle-"));
    const events: string[] = [];
    try {
      const result = await withExportSourceScratch({
        scratchRoot: root,
        attemptId: "job-a1",
        provider: sourceProvider(),
        videoId: "M7lc1UVf-VE",
        authorizationConfirmed: true,
        handoff: async (source) => {
          events.push(`handoff:${source.contentSha256}`);
          return "handed-off";
        },
        hooks: {
          sourceReady: async () => void events.push("ready"),
          cleanupStarted: async () => void events.push("deleting"),
          cleanupSucceeded: async () => void events.push("deleted"),
        },
      });
      expect(result).toBe("handed-off");
      expect(events).toEqual([
        "ready",
        `handoff:${"a".repeat(64)}`,
        "deleting",
        "deleted",
      ]);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans attempt scratch after acquisition failure and cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "export-source-lifecycle-"));
    const cleanupEvents: string[] = [];
    const cancellation = new AbortController();
    cancellation.abort(new Error("canceled by researcher"));
    try {
      await expect(
        withExportSourceScratch({
          scratchRoot: root,
          attemptId: "job-a2",
          provider: {
            acquireAuthorizedFullSource: async ({ scratchDirectory }) => {
              await writeFile(join(scratchDirectory, "partial.mp4"), "partial");
              throw new ExportSourceAcquisitionError("provider unavailable");
            },
          },
          videoId: "M7lc1UVf-VE",
          authorizationConfirmed: true,
          handoff: async () => undefined,
          hooks: {
            cleanupSucceeded: async () => void cleanupEvents.push("failure"),
          },
        }),
      ).rejects.toThrow("provider unavailable");
      await expect(
        withExportSourceScratch({
          scratchRoot: root,
          attemptId: "job-a3",
          provider: sourceProvider(),
          videoId: "M7lc1UVf-VE",
          authorizationConfirmed: true,
          signal: cancellation.signal,
          handoff: async () => undefined,
          hooks: {
            cleanupSucceeded: async () => void cleanupEvents.push("canceled"),
          },
        }),
      ).rejects.toThrow("canceled by researcher");
      expect(cleanupEvents).toEqual(["failure", "canceled"]);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports cleanup failure instead of reporting a successful handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "export-source-lifecycle-"));
    let cleanupFailure: string | undefined;
    try {
      await expect(
        withExportSourceScratch({
          scratchRoot: root,
          attemptId: "job-a4",
          provider: sourceProvider(),
          videoId: "M7lc1UVf-VE",
          authorizationConfirmed: true,
          handoff: async () => {
            await chmod(root, 0o500);
          },
          hooks: {
            cleanupFailed: async (message) => {
              cleanupFailure = message;
            },
          },
        }),
      ).rejects.toMatchObject({ code: "source_cleanup_failed" });
      expect(cleanupFailure).toBeTruthy();
    } finally {
      await chmod(root, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });
});
