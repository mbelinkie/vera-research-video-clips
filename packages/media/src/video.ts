import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse } from "node:path";

import {
  MediaAcquisitionError,
  SpawnMediaCommandRunner,
  type MediaCommandRunner,
  type MediaInspector,
} from "./index.ts";

/** Follow no symlink at any component of an owned local media path. */
export async function assertSafeDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory) || directory.includes("\0")) {
    throw new MediaAcquisitionError(
      "Media directory must be an absolute local path.",
    );
  }
  let current = directory;
  for (;;) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new MediaAcquisitionError(
        "Media directory is not a real directory.",
      );
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function assertRegularMediaFile(path: string): Promise<number> {
  await assertSafeDirectory(dirname(path));
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size < 1
  ) {
    throw new MediaAcquisitionError("Media file is missing, empty or unsafe.");
  }
  const resolved = await realpath(path);
  if (resolved !== path) {
    throw new MediaAcquisitionError(
      "Media file resolved outside its expected path.",
    );
  }
  return info.size;
}

export async function hashMediaFile(path: string): Promise<string> {
  await assertRegularMediaFile(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export type AcquiredVideo = {
  scratchPath: string;
  videoId: string;
  byteSize: number;
  contentSha256: string;
  format: "mp4";
};

export interface FullSourceAcquirer {
  acquireAuthorizedVideo(input: {
    videoId: string;
    scratchDirectory: string;
    authorizationConfirmed: boolean;
    signal?: AbortSignal;
  }): Promise<AcquiredVideo>;
}

export type VideoAdapterOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

function validExecutable(executable: string): string {
  if (
    !executable.trim() ||
    executable.includes("\0") ||
    /[\r\n]/u.test(executable)
  ) {
    throw new MediaAcquisitionError("Invalid configured media executable.");
  }
  return executable;
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MediaAcquisitionError("Invalid media command timeout.");
  }
  return value;
}

function validVideoId(videoId: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
    throw new MediaAcquisitionError("Invalid YouTube source video ID.");
  }
  return videoId;
}

export class YtDlpFullVideoAcquirer implements FullSourceAcquirer {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: VideoAdapterOptions = {}) {
    this.#executable = validExecutable(options.executable ?? "yt-dlp");
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = validTimeout(options.timeoutMs ?? 30 * 60_000);
  }

  async acquireAuthorizedVideo(input: {
    videoId: string;
    scratchDirectory: string;
    authorizationConfirmed: boolean;
    signal?: AbortSignal;
  }): Promise<AcquiredVideo> {
    if (input.authorizationConfirmed !== true) {
      throw new MediaAcquisitionError(
        "Confirm source rights before downloading.",
      );
    }
    const videoId = validVideoId(input.videoId);
    await assertSafeDirectory(input.scratchDirectory);
    if ((await readdir(input.scratchDirectory)).length) {
      throw new MediaAcquisitionError(
        "Source scratch directory must be empty and private.",
      );
    }
    const filename = `video-${videoId}.mp4`;
    await this.#runner.run(
      this.#executable,
      [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--no-cache-dir",
        "--no-write-info-json",
        "--no-write-thumbnail",
        "--no-part",
        "--format",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--output",
        join(input.scratchDirectory, `video-${videoId}.%(ext)s`),
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      {
        timeoutMs: this.#timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const files = await readdir(input.scratchDirectory);
    if (files.length !== 1 || files[0] !== filename) {
      throw new MediaAcquisitionError(
        "Video download did not yield exactly one MP4 source.",
      );
    }
    const scratchPath = join(input.scratchDirectory, filename);
    const byteSize = await assertRegularMediaFile(scratchPath);
    return {
      scratchPath,
      videoId,
      byteSize,
      contentSha256: await hashMediaFile(scratchPath),
      format: "mp4",
    };
  }
}

/** Full-video fetching is always disabled unless explicitly selected. */
export function createFullVideoAcquirer(
  configuration: { mode: "disabled" | "yt-dlp"; ytDlpPath: string },
  runner?: MediaCommandRunner,
): FullSourceAcquirer | undefined {
  return configuration.mode === "yt-dlp"
    ? new YtDlpFullVideoAcquirer({
        executable: configuration.ytDlpPath,
        ...(runner ? { runner } : {}),
      })
    : undefined;
}

export class FfprobeMediaInspector implements MediaInspector {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: VideoAdapterOptions = {}) {
    this.#executable = validExecutable(options.executable ?? "ffprobe");
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = validTimeout(options.timeoutMs ?? 30_000);
  }

  async inspect(path: string): Promise<{
    durationMs: number;
    videoCodec?: string;
    audioCodec?: string;
  }> {
    await assertRegularMediaFile(path);
    const { stdout } = await this.#runner.run(
      this.#executable,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        path,
      ],
      { timeoutMs: this.#timeoutMs },
    );
    let result: { format?: { duration?: unknown }; streams?: unknown };
    try {
      result = JSON.parse(stdout) as typeof result;
    } catch {
      throw new MediaAcquisitionError(
        "FFprobe returned invalid media metadata.",
      );
    }
    const seconds = Number(result.format?.duration);
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 1e9 ||
      !Array.isArray(result.streams)
    ) {
      throw new MediaAcquisitionError(
        "FFprobe did not report a valid media duration.",
      );
    }
    const streams = result.streams as Array<{
      codec_type?: unknown;
      codec_name?: unknown;
    }>;
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (
      !video ||
      !audio ||
      typeof video.codec_name !== "string" ||
      typeof audio.codec_name !== "string"
    ) {
      throw new MediaAcquisitionError(
        "Media requires a video and an audio stream.",
      );
    }
    return {
      durationMs: Math.round(seconds * 1_000),
      videoCodec: video.codec_name,
      audioCodec: audio.codec_name,
    };
  }
}

export type VideoRenderRange = {
  sourcePath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  signal?: AbortSignal;
};

export interface RangeRenderer {
  render(input: VideoRenderRange): Promise<void>;
}

export class FfmpegRangeRenderer implements RangeRenderer {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: VideoAdapterOptions = {}) {
    this.#executable = validExecutable(options.executable ?? "ffmpeg");
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = validTimeout(options.timeoutMs ?? 10 * 60_000);
  }

  async render(input: VideoRenderRange): Promise<void> {
    if (
      !Number.isSafeInteger(input.startMs) ||
      input.startMs < 0 ||
      !Number.isSafeInteger(input.endMs) ||
      input.endMs <= input.startMs
    ) {
      throw new MediaAcquisitionError("Video cut bounds are invalid.");
    }
    await assertRegularMediaFile(input.sourcePath);
    await assertSafeDirectory(dirname(input.outputPath));
    if (
      basename(input.outputPath) === "." ||
      !input.outputPath.endsWith(".mp4") ||
      !isAbsolute(input.outputPath) ||
      parse(input.outputPath).base.includes("\0")
    ) {
      throw new MediaAcquisitionError(
        "Video output path must be a private MP4 file.",
      );
    }
    try {
      await lstat(input.outputPath);
      throw new MediaAcquisitionError(
        "Video output already exists; refusing overwrite.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.#runner.run(
      this.#executable,
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        input.sourcePath,
        "-ss",
        (input.startMs / 1_000).toFixed(3),
        "-t",
        ((input.endMs - input.startMs) / 1_000).toFixed(3),
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
        "-n",
        input.outputPath,
      ],
      {
        timeoutMs: this.#timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    await assertRegularMediaFile(input.outputPath);
  }
}
