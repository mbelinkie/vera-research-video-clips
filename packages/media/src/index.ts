import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type AcquiredMedia = {
  scratchPath: string;
  videoId: string;
  byteSize: number;
  format: "flac";
  provider: string;
  contentSha256: string;
};

export interface MediaAcquisitionProvider {
  acquireAuthorizedSource(
    videoId: string,
    scratchDirectory: string,
    signal?: AbortSignal,
  ): Promise<AcquiredMedia>;
}

export class MediaAcquisitionError extends Error {
  readonly code = "media_acquisition_failed";
  readonly retryable = true;
}

export type MediaCommandResult = { stdout: string; stderr: string };

export interface MediaCommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<MediaCommandResult>;
}

export class SpawnMediaCommandRunner implements MediaCommandRunner {
  async run(
    executable: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<MediaCommandResult> {
    validateExecutable(executable);
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let stdout = "";
      let stderr = "";
      const append = (current: string, chunk: Buffer) =>
        (current + chunk.toString("utf8")).slice(-(4 * 1024 * 1024));
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(
        () => child.kill("SIGTERM"),
        options.timeoutMs ?? 6 * 60 * 60 * 1_000,
      );
      timeout.unref?.();
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(
          new MediaAcquisitionError(
            `Could not run the configured media provider: ${error.message}`,
          ),
        );
      });
      child.once("close", (code, childSignal) => {
        clearTimeout(timeout);
        if (code === 0) resolve({ stdout, stderr });
        else {
          const detail = sanitizedDetail(stderr);
          reject(
            new MediaAcquisitionError(
              `Media provider exited ${childSignal ? `after ${childSignal}` : `with code ${code ?? "unknown"}`}${detail ? `: ${detail}` : "."}`,
            ),
          );
        }
      });
    });
  }
}

export type YtDlpAudioAcquisitionOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

export class YtDlpAudioAcquisitionProvider implements MediaAcquisitionProvider {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: YtDlpAudioAcquisitionOptions = {}) {
    this.#executable = options.executable ?? "yt-dlp";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1_000;
  }

  async acquireAuthorizedSource(
    videoId: string,
    scratchDirectory: string,
    signal?: AbortSignal,
  ): Promise<AcquiredMedia> {
    validateVideoId(videoId);
    validateScratchDirectory(scratchDirectory);
    await mkdir(scratchDirectory, { recursive: true, mode: 0o700 });
    const basename = `audio-${videoId}`;
    const existing = await findAudio(scratchDirectory, basename);
    if (existing) return acquiredAudio(videoId, existing);

    await this.#runner.run(
      this.#executable,
      [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extract-audio",
        "--audio-format",
        "flac",
        "--output",
        join(scratchDirectory, `${basename}.%(ext)s`),
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeoutMs: this.#timeoutMs, ...(signal ? { signal } : {}) },
    );
    const path = await findAudio(scratchDirectory, basename);
    if (!path) {
      throw new MediaAcquisitionError(
        "Media provider completed without producing the expected FLAC audio.",
      );
    }
    return acquiredAudio(videoId, path);
  }
}

export function createMediaAcquisitionProvider(
  configuration: { mode: "disabled" | "yt-dlp-audio"; ytDlpPath: string },
  runner?: MediaCommandRunner,
): MediaAcquisitionProvider | undefined {
  return configuration.mode === "yt-dlp-audio"
    ? new YtDlpAudioAcquisitionProvider({
        executable: configuration.ytDlpPath,
        ...(runner ? { runner } : {}),
      })
    : undefined;
}

export interface MediaInspector {
  inspect(path: string): Promise<{
    durationMs: number;
    videoCodec?: string;
    audioCodec?: string;
  }>;
}

async function findAudio(directory: string, basename: string) {
  const matches = (await readdir(directory))
    .filter((name) => name === `${basename}.flac`)
    .sort();
  return matches[0] ? join(directory, matches[0]) : undefined;
}

async function acquiredAudio(
  videoId: string,
  scratchPath: string,
): Promise<AcquiredMedia> {
  const info = await stat(scratchPath);
  if (!info.isFile() || info.size <= 0) {
    throw new MediaAcquisitionError("Acquired audio is empty or not a file.");
  }
  return {
    scratchPath,
    videoId,
    byteSize: info.size,
    format: "flac",
    provider: "yt-dlp",
    contentSha256: await sha256File(scratchPath),
  };
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function validateVideoId(videoId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new MediaAcquisitionError("Invalid YouTube video ID.");
  }
}

function validateScratchDirectory(directory: string) {
  if (!directory || directory.includes("\0")) {
    throw new MediaAcquisitionError("Media scratch directory is invalid.");
  }
}

function validateExecutable(executable: string) {
  if (!executable.trim() || executable.includes("\0")) {
    throw new MediaAcquisitionError("Media provider executable is invalid.");
  }
}

function sanitizedDetail(stderr: string) {
  return stderr
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(-500);
}
