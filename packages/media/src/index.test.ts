import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  YtDlpAudioAcquisitionProvider,
  YtDlpFullVideoAcquirer,
  FfprobeMediaInspector,
  FfmpegRangeRenderer,
  SpawnMediaCommandRunner,
  createMediaAcquisitionProvider,
  createFullVideoAcquirer,
  type MediaCommandRunner,
} from "./index.ts";

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

describe("opt-in full video acquisition", () => {
  it("requires confirmed rights and an empty private source directory", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "video-provider-"));
    const runner = vi.fn<MediaCommandRunner["run"]>(async (_bin, args) => {
      const output = args[args.indexOf("--output") + 1]!;
      await writeFile(output.replace("%(ext)s", "mp4"), "authorized fixture");
      return { stdout: "", stderr: "" };
    });
    const provider = createFullVideoAcquirer(
      { mode: "yt-dlp", ytDlpPath: "yt-dlp" },
      { run: runner },
    )!;
    try {
      expect(
        createFullVideoAcquirer({ mode: "disabled", ytDlpPath: "yt-dlp" }),
      ).toBeUndefined();
      await expect(
        provider.acquireAuthorizedVideo({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: false,
        }),
      ).rejects.toThrow(/rights/u);
      expect(runner).not.toHaveBeenCalled();
      const acquired = await provider.acquireAuthorizedVideo({
        videoId: "M7lc1UVf-VE",
        scratchDirectory: scratch,
        authorizationConfirmed: true,
      });
      expect(acquired).toMatchObject({
        videoId: "M7lc1UVf-VE",
        format: "mp4",
        byteSize: 18,
      });
      expect(acquired.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
      const args = runner.mock.calls[0]![1];
      expect(args).toContain("--no-config");
      expect(args).toContain("--no-playlist");
      expect(args).toContain("--remux-video");
      expect(args.slice(-2)).toEqual([
        "--",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      ]);
      await expect(
        provider.acquireAuthorizedVideo({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toThrow(/empty/u);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects forged IDs, extra output and symbolic-link downloads", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "video-bad-"));
    const outside = join(scratch, "outside");
    const runner = vi.fn<MediaCommandRunner["run"]>(async (_bin, args) => {
      const output = args[args.indexOf("--output") + 1]!.replace(
        "%(ext)s",
        "mp4",
      );
      await symlink(outside, output);
      return { stdout: "", stderr: "" };
    });
    const provider = new YtDlpFullVideoAcquirer({ runner: { run: runner } });
    try {
      await expect(
        provider.acquireAuthorizedVideo({
          videoId: "../../passwd",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toThrow(/ID/u);
      expect(runner).not.toHaveBeenCalled();
      await expect(
        provider.acquireAuthorizedVideo({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toThrow(/unsafe|missing/u);
      await rm(join(scratch, "video-M7lc1UVf-VE.mp4"));
      const extra = new YtDlpFullVideoAcquirer({
        runner: {
          run: async (_bin, args) => {
            const path = args[args.indexOf("--output") + 1]!.replace(
              "%(ext)s",
              "mp4",
            );
            await writeFile(path, "file");
            await writeFile(join(scratch, "extra.txt"), "unsafe");
            return { stdout: "", stderr: "" };
          },
        },
      });
      await expect(
        extra.acquireAuthorizedVideo({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: scratch,
          authorizationConfirmed: true,
        }),
      ).rejects.toThrow(/exactly one/u);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses symlink scratch parents before invoking yt-dlp", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "video-link-"));
    const link = join(scratch, "link");
    await mkdir(join(scratch, "safe"));
    await symlink(join(scratch, "safe"), link);
    const runner = vi.fn<MediaCommandRunner["run"]>();
    try {
      await expect(
        new YtDlpFullVideoAcquirer({
          runner: { run: runner },
        }).acquireAuthorizedVideo({
          videoId: "M7lc1UVf-VE",
          scratchDirectory: link,
          authorizationConfirmed: true,
        }),
      ).rejects.toThrow(/real directory/u);
      expect(runner).not.toHaveBeenCalled();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("FFprobe/FFmpeg guarded cut adapters", () => {
  it("parses required streams, rejects malformed metadata", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffprobe-"));
    const media = join(scratch, "fixture.mp4");
    await writeFile(media, "fake");
    const run = vi.fn<MediaCommandRunner["run"]>(async () => ({
      stdout: JSON.stringify({
        format: { duration: "3.420" },
        streams: [
          { codec_type: "video", codec_name: "h264" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
      stderr: "",
    }));
    try {
      await expect(
        new FfprobeMediaInspector({ runner: { run } }).inspect(media),
      ).resolves.toEqual({
        durationMs: 3420,
        videoCodec: "h264",
        audioCodec: "aac",
      });
      expect(run.mock.calls[0]![1]).toEqual([
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        media,
      ]);
      await expect(
        new FfprobeMediaInspector({
          runner: {
            run: async () => ({ stdout: '{"streams":[]}', stderr: "" }),
          },
        }).inspect(media),
      ).rejects.toThrow(/duration/u);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("does precise reencode, refuses invalid bounds and existing output", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "ffmpeg-"));
    const source = join(scratch, "source.mp4");
    const output = join(scratch, "cut.mp4");
    await writeFile(source, "source");
    const runner = vi.fn<MediaCommandRunner["run"]>(async (_bin, args) => {
      await writeFile(args.at(-1)!, "rendered");
      return { stdout: "", stderr: "" };
    });
    const renderer = new FfmpegRangeRenderer({ runner: { run: runner } });
    try {
      await expect(
        renderer.render({
          sourcePath: source,
          outputPath: output,
          startMs: 1_000,
          endMs: 1_000,
        }),
      ).rejects.toThrow(/bounds/u);
      expect(runner).not.toHaveBeenCalled();
      await renderer.render({
        sourcePath: source,
        outputPath: output,
        startMs: 1_125,
        endMs: 3_475,
      });
      const args = runner.mock.calls[0]![1];
      expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
        "-ss",
        "1.125",
        "-t",
        "2.350",
      ]);
      expect(args).toContain("libx264");
      expect(args).toContain("aac");
      expect(args).toContain("-n");
      await expect(
        renderer.render({
          sourcePath: source,
          outputPath: output,
          startMs: 0,
          endMs: 1_000,
        }),
      ).rejects.toThrow(/already exists/u);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("terminates hanging commands on timeout and abort", async () => {
    const runner = new SpawnMediaCommandRunner();
    await expect(
      runner.run(process.execPath, ["-e", "setInterval(() => {}, 100)"], {
        timeoutMs: 75,
      }),
    ).rejects.toThrow(/timed out/u);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.run(process.execPath, ["-e", "process.exit(0)"], {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/canceled/u);
  });
});
