import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";

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

/**
 * Full-source acquisition is intentionally separate from the audio-only
 * transcription adapter above. Callers must explicitly attest that they are
 * authorized to process the source for the request at hand.
 */
export type AcquiredExportSource = {
  scratchPath: string;
  sourceIdentity: string;
  byteSize: number;
  provider: string;
  contentSha256: string;
};

export type ExportSourceAcquisitionInput = {
  videoId: string;
  scratchDirectory: string;
  authorizationConfirmed: boolean;
  signal?: AbortSignal;
};

export interface ExportSourceAcquisitionProvider {
  acquireAuthorizedFullSource(
    input: ExportSourceAcquisitionInput,
  ): Promise<AcquiredExportSource>;
}

export class ExportSourceAcquisitionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ExportSourceAcquisitionError";
    this.code = options.code ?? "export_source_acquisition_failed";
    this.retryable = options.retryable ?? true;
  }
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

export type YtDlpFullSourceAcquisitionOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

/** An opt-in yt-dlp adapter for an authorized, full export source. */
export class YtDlpFullSourceAcquisitionProvider implements ExportSourceAcquisitionProvider {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: YtDlpFullSourceAcquisitionOptions = {}) {
    this.#executable = options.executable ?? "yt-dlp";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1_000;
  }

  async acquireAuthorizedFullSource(
    input: ExportSourceAcquisitionInput,
  ): Promise<AcquiredExportSource> {
    validateVideoId(input.videoId);
    validateScratchDirectory(input.scratchDirectory);
    if (!input.authorizationConfirmed) {
      throw new ExportSourceAcquisitionError(
        "Confirm authorization to process this source before acquisition.",
        { code: "source_authorization_required", retryable: true },
      );
    }

    await mkdir(input.scratchDirectory, { recursive: true, mode: 0o700 });
    await chmod(input.scratchDirectory, 0o700);
    const basename = `source-${input.videoId}`;
    const existing = await findFullSource(input.scratchDirectory, basename);
    if (existing) return acquiredFullSource(input.videoId, existing);

    try {
      await this.#runner.run(
        this.#executable,
        [
          "--no-config",
          "--no-playlist",
          "--no-progress",
          "--format",
          "bv*+ba/b",
          "--merge-output-format",
          "mp4",
          "--output",
          join(input.scratchDirectory, `${basename}.%(ext)s`),
          "--",
          `https://www.youtube.com/watch?v=${input.videoId}`,
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    } catch {
      throw new ExportSourceAcquisitionError(
        input.signal?.aborted
          ? "Full-source acquisition was canceled."
          : "The configured provider could not acquire the full source.",
        {
          code: input.signal?.aborted
            ? "source_acquisition_canceled"
            : "source_provider_failed",
        },
      );
    }
    const path = await findFullSource(input.scratchDirectory, basename);
    if (!path) {
      throw new ExportSourceAcquisitionError(
        "Media provider completed without producing one full source file.",
        { code: "source_output_missing" },
      );
    }
    return acquiredFullSource(input.videoId, path);
  }
}

export function createExportSourceAcquisitionProvider(
  configuration: { mode: "disabled" | "yt-dlp"; ytDlpPath: string },
  runner?: MediaCommandRunner,
): ExportSourceAcquisitionProvider | undefined {
  return configuration.mode === "yt-dlp"
    ? new YtDlpFullSourceAcquisitionProvider({
        executable: configuration.ytDlpPath,
        ...(runner ? { runner } : {}),
      })
    : undefined;
}

export type ExportSourceLifecycleHooks = {
  sourceReady?(
    source: Omit<AcquiredExportSource, "scratchPath">,
  ): Promise<void>;
  cleanupStarted?(): Promise<void>;
  cleanupSucceeded?(): Promise<void>;
  cleanupFailed?(message: string): Promise<void>;
};

export type ExportSourceLifecycleInput<T> = {
  scratchRoot: string;
  attemptId: string;
  provider: ExportSourceAcquisitionProvider;
  videoId: string;
  authorizationConfirmed: boolean;
  signal?: AbortSignal;
  handoff(source: AcquiredExportSource, scratchDirectory: string): Promise<T>;
  hooks?: ExportSourceLifecycleHooks;
};

/**
 * Gives the next export stage a verified ephemeral source and removes it on
 * every path. The source path never leaves this process boundary; persistence
 * hooks receive only safe provenance.
 */
export async function withExportSourceScratch<T>(
  input: ExportSourceLifecycleInput<T>,
): Promise<T> {
  validateScratchDirectory(input.scratchRoot);
  validateAttemptId(input.attemptId);
  await mkdir(input.scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(input.scratchRoot, 0o700);
  const scratchDirectory = await createAttemptDirectory(
    input.scratchRoot,
    input.attemptId,
  );
  let primaryError: unknown;
  try {
    const source = await input.provider.acquireAuthorizedFullSource({
      videoId: input.videoId,
      scratchDirectory,
      authorizationConfirmed: input.authorizationConfirmed,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await input.hooks?.sourceReady?.({
      sourceIdentity: source.sourceIdentity,
      byteSize: source.byteSize,
      provider: source.provider,
      contentSha256: source.contentSha256,
    });
    return await input.handoff(source, scratchDirectory);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await input.hooks?.cleanupStarted?.();
      await cleanupAttemptDirectory(scratchDirectory);
      await input.hooks?.cleanupSucceeded?.();
    } catch (cleanupError) {
      const message = safeErrorMessage(cleanupError);
      try {
        await input.hooks?.cleanupFailed?.(message);
      } catch {
        // The cleanup error remains the actionable result even if recording it fails.
      }
      if (primaryError) {
        throw new ExportSourceAcquisitionError(
          `Source processing failed and scratch cleanup also failed: ${message}`,
          { code: "source_cleanup_failed" },
        );
      }
      throw new ExportSourceAcquisitionError(
        `Source scratch cleanup failed: ${message}`,
        { code: "source_cleanup_failed" },
      );
    }
  }
}

export type ExportSourceInspection = {
  durationMs: number;
  containerFormat?: string;
  videoCodec?: string;
  audioCodec?: string;
  ffprobeVersion?: string;
};

export interface ExportSourceInspector {
  inspect(path: string, signal?: AbortSignal): Promise<ExportSourceInspection>;
}

export type EditingMp4RenderSettings = {
  container: string;
  videoCodec: string;
  videoRateControl: { mode: string; value?: number };
  maxWidth?: number | undefined;
  frameRate: string;
  audioCodec: string;
  audioKilobitsPerSecond?: number | undefined;
  embedEnglishSubtitleTrack: boolean;
};

export type FfmpegRangeRenderInput = {
  sourcePath: string;
  stagingDirectory: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  settings: EditingMp4RenderSettings;
  signal?: AbortSignal;
};

/** A replaceable, deterministic-test-friendly boundary for one precise render. */
export interface FfmpegRangeRenderer {
  render(input: FfmpegRangeRenderInput): Promise<void>;
  /**
   * Optional best-effort encoder provenance. A renderer that cannot report a
   * version still produces verified media, so callers must treat a missing
   * value as legal.
   */
  readVersion?(signal?: AbortSignal): Promise<string | undefined>;
}

export class FfmpegRenderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "FfmpegRenderError";
    this.code = options.code ?? "ffmpeg_render_failed";
    this.retryable = options.retryable ?? true;
  }
}

export type FfmpegH264AacRangeRendererOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

/**
 * The first render adapter deliberately supports only the immutable
 * editing-friendly H.264/AAC MP4 snapshot. New presets belong in a later
 * capability-aware slice, not as raw FFmpeg arguments here.
 */
export class FfmpegH264AacRangeRenderer implements FfmpegRangeRenderer {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: FfmpegH264AacRangeRendererOptions = {}) {
    this.#executable = options.executable ?? "ffmpeg";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1_000;
  }

  async render(input: FfmpegRangeRenderInput): Promise<void> {
    assertEditingFriendlyH264AacMp4Settings(input.settings);
    await validateRenderInput(input);
    if (input.signal?.aborted) throw renderCanceled();
    try {
      await this.#runner.run(
        this.#executable,
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          resolve(input.sourcePath),
          "-ss",
          formatFfmpegTime(input.startMs),
          "-t",
          formatFfmpegTime(input.endMs - input.startMs),
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "libx264",
          "-crf",
          String(input.settings.videoRateControl.value),
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          "-n",
          resolve(input.outputPath),
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    } catch {
      if (input.signal?.aborted) throw renderCanceled();
      throw new FfmpegRenderError(
        "FFmpeg could not render the requested range. Retry this export after checking the local media tools.",
        { code: "ffmpeg_render_failed" },
      );
    }
    if (input.signal?.aborted) throw renderCanceled();
  }

  async readVersion(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const result = await this.#runner.run(this.#executable, ["-version"], {
        timeoutMs: Math.min(this.#timeoutMs, 5_000),
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) throw renderCanceled();
      return parseFfmpegVersion(result.stdout);
    } catch (error) {
      if (error instanceof FfmpegRenderError) throw error;
      if (signal?.aborted) throw renderCanceled();
      return undefined;
    }
  }
}

export const RenderDurationToleranceMs = 250;

export function assertEditingFriendlyH264AacMp4Settings(
  settings: EditingMp4RenderSettings,
): void {
  if (
    settings.container !== "mp4" ||
    settings.videoCodec !== "h264" ||
    settings.videoRateControl.mode !== "crf" ||
    !Number.isSafeInteger(settings.videoRateControl.value) ||
    settings.videoRateControl.value! < 0 ||
    settings.videoRateControl.value! > 51 ||
    settings.maxWidth !== undefined ||
    settings.frameRate !== "source" ||
    settings.audioCodec !== "aac" ||
    settings.audioKilobitsPerSecond !== undefined ||
    settings.embedEnglishSubtitleTrack
  ) {
    throw new FfmpegRenderError(
      "This worker currently supports only the editing-friendly H.264/AAC MP4 snapshot. Choose that preset without advanced overrides and retry.",
      { code: "export_settings_unsupported", retryable: true },
    );
  }
}

export function assertEditingFriendlySourceCompatibility(
  inspection: ExportSourceInspection,
): void {
  if (!inspection.videoCodec) {
    throw new FfmpegRenderError(
      "The inspected source has no usable video stream for this export. Choose another source or retry after reacquiring it.",
      { code: "source_video_stream_missing", retryable: true },
    );
  }
  if (!inspection.audioCodec) {
    throw new FfmpegRenderError(
      "The inspected source has no usable audio stream for this export. Choose another source or retry after reacquiring it.",
      { code: "source_audio_stream_missing", retryable: true },
    );
  }
}

export async function inspectAndValidateRenderedExportOutput(input: {
  outputPath: string;
  stagingDirectory: string;
  inspector: ExportSourceInspector;
  startMs: number;
  endMs: number;
  settings: EditingMp4RenderSettings;
  signal?: AbortSignal;
}): Promise<ExportSourceInspection> {
  assertEditingFriendlyH264AacMp4Settings(input.settings);
  validateScratchDirectory(input.stagingDirectory);
  if (!isInsideScratchDirectory(input.stagingDirectory, input.outputPath)) {
    throw new FfmpegRenderError(
      "Rendered output is outside its private staging directory.",
      { code: "render_output_outside_staging", retryable: false },
    );
  }
  await validateRenderedOutput(input.outputPath);
  if (input.signal?.aborted) throw renderCanceled();
  const inspection = await input.inspector.inspect(
    input.outputPath,
    input.signal,
  );
  if (input.signal?.aborted) throw renderCanceled();
  const expectedDurationMs = input.endMs - input.startMs;
  if (
    !Number.isSafeInteger(input.startMs) ||
    !Number.isSafeInteger(input.endMs) ||
    expectedDurationMs <= 0
  ) {
    throw new FfmpegRenderError("Resolved export bounds are invalid.", {
      code: "export_bounds_invalid",
      retryable: false,
    });
  }
  if (
    Math.abs(inspection.durationMs - expectedDurationMs) >
    RenderDurationToleranceMs
  ) {
    throw new FfmpegRenderError(
      "Rendered output duration does not match the resolved export range. Retry this export.",
      { code: "render_output_duration_mismatch" },
    );
  }
  if (!inspection.containerFormat?.split(",").includes("mp4")) {
    throw new FfmpegRenderError(
      "Rendered output is not an MP4 container. Retry this export.",
      { code: "render_output_container_mismatch" },
    );
  }
  if (inspection.videoCodec !== "h264") {
    throw new FfmpegRenderError(
      "Rendered output video codec does not match the requested H.264 setting. Retry this export.",
      { code: "render_output_video_codec_mismatch" },
    );
  }
  if (inspection.audioCodec !== "aac") {
    throw new FfmpegRenderError(
      "Rendered output audio codec does not match the requested AAC setting. Retry this export.",
      { code: "render_output_audio_codec_mismatch" },
    );
  }
  return inspection;
}

export class ExportSourceInspectionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ExportSourceInspectionError";
    this.code = options.code ?? "source_inspection_failed";
    this.retryable = options.retryable ?? true;
  }
}

export type FfprobeMediaInspectorOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

/** A provider-neutral FFprobe adapter for safe, bounded source provenance. */
export class FfprobeMediaInspector implements ExportSourceInspector {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: FfprobeMediaInspectorOptions = {}) {
    this.#executable = options.executable ?? "ffprobe";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async inspect(
    path: string,
    signal?: AbortSignal,
  ): Promise<ExportSourceInspection> {
    await validateRegularNonemptySource(path);
    if (signal?.aborted) throw inspectionCanceled();
    let result: MediaCommandResult;
    try {
      result = await this.#runner.run(
        this.#executable,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration,format_name:stream=codec_type,codec_name",
          "-of",
          "json",
          "--",
          resolve(path),
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
    } catch {
      if (signal?.aborted) throw inspectionCanceled();
      throw new ExportSourceInspectionError(
        "FFprobe could not inspect the acquired source. Retry this export after checking the local media tools.",
        { code: "ffprobe_failed" },
      );
    }
    if (signal?.aborted) throw inspectionCanceled();
    const inspection = parseFfprobeOutput(result.stdout);
    const ffprobeVersion = await this.#readVersion(signal);
    return { ...inspection, ...(ffprobeVersion ? { ffprobeVersion } : {}) };
  }

  async #readVersion(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const result = await this.#runner.run(this.#executable, ["-version"], {
        timeoutMs: Math.min(this.#timeoutMs, 5_000),
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) throw inspectionCanceled();
      return parseFfprobeVersion(result.stdout);
    } catch (error) {
      if (error instanceof ExportSourceInspectionError) throw error;
      if (signal?.aborted) throw inspectionCanceled();
      return undefined;
    }
  }
}

/**
 * Checks M5-01's handoff asset before any inspector sees it. This keeps
 * deterministic fakes honest and ensures a provider cannot redirect FFprobe
 * outside the private attempt directory.
 */
export async function inspectVerifiedExportSource(input: {
  sourcePath: string;
  scratchDirectory: string;
  inspector: ExportSourceInspector;
  signal?: AbortSignal;
}): Promise<ExportSourceInspection> {
  validateScratchDirectory(input.scratchDirectory);
  if (!isInsideScratchDirectory(input.scratchDirectory, input.sourcePath)) {
    throw new ExportSourceInspectionError(
      "Acquired source is outside its private scratch directory.",
      { code: "source_path_outside_scratch", retryable: false },
    );
  }
  await validateRegularNonemptySource(input.sourcePath);
  if (input.signal?.aborted) throw inspectionCanceled();
  return input.inspector.inspect(input.sourcePath, input.signal);
}

export function resolveExportBounds(input: {
  requestedStartMs: number;
  requestedEndMs: number;
  durationMs: number;
}): { startMs: number; endMs: number } {
  const { requestedStartMs, requestedEndMs, durationMs } = input;
  if (
    !Number.isSafeInteger(requestedStartMs) ||
    !Number.isSafeInteger(requestedEndMs) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new ExportSourceInspectionError(
      "The requested export bounds or media duration is invalid. Adjust the range and retry.",
      { code: "export_bounds_invalid", retryable: true },
    );
  }
  const startMs = Math.min(Math.max(requestedStartMs, 0), durationMs);
  const endMs = Math.min(Math.max(requestedEndMs, 0), durationMs);
  if (endMs <= startMs) {
    throw new ExportSourceInspectionError(
      "The requested export range does not overlap the inspected media. Adjust the clip bounds and retry.",
      { code: "export_bounds_empty", retryable: true },
    );
  }
  return { startMs, endMs };
}

async function findAudio(directory: string, basename: string) {
  const matches = (await readdir(directory))
    .filter((name) => name === `${basename}.flac`)
    .sort();
  return matches[0] ? join(directory, matches[0]) : undefined;
}

async function findFullSource(directory: string, basename: string) {
  const matches = (await readdir(directory))
    .filter((name) =>
      new RegExp(`^${escapeRegExp(basename)}\\.[A-Za-z0-9]{1,12}$`, "u").test(
        name,
      ),
    )
    .sort();
  if (matches.length !== 1) return undefined;
  const path = join(directory, matches[0]!);
  return isInsideScratchDirectory(directory, path) ? path : undefined;
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

async function acquiredFullSource(
  videoId: string,
  scratchPath: string,
): Promise<AcquiredExportSource> {
  const info = await lstat(scratchPath);
  if (!info.isFile() || info.size <= 0) {
    throw new ExportSourceAcquisitionError(
      "Acquired source is empty, not a regular file, or is unsafe.",
      { code: "source_output_invalid" },
    );
  }
  return {
    scratchPath,
    sourceIdentity: videoId,
    byteSize: info.size,
    provider: "yt-dlp",
    contentSha256: await sha256File(scratchPath),
  };
}

async function validateRegularNonemptySource(path: string): Promise<void> {
  if (!path || path.includes("\0") || resolve(path) === sep) {
    throw new ExportSourceInspectionError("Acquired source path is invalid.", {
      code: "source_path_invalid",
      retryable: false,
    });
  }
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new ExportSourceInspectionError(
      "The acquired source is missing before media inspection.",
      { code: "source_missing", retryable: true },
    );
  }
  if (!info.isFile() || info.size <= 0) {
    throw new ExportSourceInspectionError(
      "The acquired source must be a regular nonempty file before media inspection.",
      { code: "source_invalid", retryable: false },
    );
  }
}

async function validateRenderInput(
  input: FfmpegRangeRenderInput,
): Promise<void> {
  validateScratchDirectory(input.stagingDirectory);
  if (
    !Number.isSafeInteger(input.startMs) ||
    !Number.isSafeInteger(input.endMs) ||
    input.startMs < 0 ||
    input.endMs <= input.startMs
  ) {
    throw new FfmpegRenderError("Resolved export bounds are invalid.", {
      code: "export_bounds_invalid",
      retryable: false,
    });
  }
  if (!isInsideScratchDirectory(input.stagingDirectory, input.sourcePath)) {
    throw new FfmpegRenderError(
      "Acquired source is outside its private staging directory.",
      { code: "source_path_outside_scratch", retryable: false },
    );
  }
  if (!isInsideScratchDirectory(input.stagingDirectory, input.outputPath)) {
    throw new FfmpegRenderError(
      "Rendered output is outside its private staging directory.",
      { code: "render_output_outside_staging", retryable: false },
    );
  }
  if (resolve(input.sourcePath) === resolve(input.outputPath)) {
    throw new FfmpegRenderError(
      "Rendered output path must differ from the acquired source.",
      { code: "render_output_path_invalid", retryable: false },
    );
  }
  if (!resolve(input.outputPath).endsWith(".mp4")) {
    throw new FfmpegRenderError(
      "The editing-friendly render output must use an MP4 filename.",
      { code: "render_output_path_invalid", retryable: false },
    );
  }
  await validateRegularNonemptySource(input.sourcePath);
  const exists = await access(input.outputPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new FfmpegRenderError(
      "A temporary render output already exists for this attempt. Retry the export.",
      { code: "render_output_already_exists", retryable: true },
    );
  }
}

async function validateRenderedOutput(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new FfmpegRenderError(
      "FFmpeg completed without producing a rendered output file.",
      { code: "render_output_missing" },
    );
  }
  if (!info.isFile() || info.size <= 0) {
    throw new FfmpegRenderError(
      "Rendered output must be a regular nonempty file.",
      { code: "render_output_invalid", retryable: false },
    );
  }
}

function formatFfmpegTime(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3);
}

function parseFfprobeOutput(output: string): ExportSourceInspection {
  if (Buffer.byteLength(output, "utf8") > 512 * 1024) {
    throw new ExportSourceInspectionError(
      "FFprobe returned too much inspection data for this source.",
      { code: "ffprobe_output_too_large", retryable: true },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new ExportSourceInspectionError(
      "FFprobe returned malformed inspection data. Retry this export after checking the local media tools.",
      { code: "ffprobe_output_malformed" },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw malformedFfprobeOutput();
  }
  const format = (value as { format?: unknown }).format;
  const streams = (value as { streams?: unknown }).streams;
  if (!format || typeof format !== "object" || Array.isArray(format)) {
    throw malformedFfprobeOutput();
  }
  const duration = Number((format as { duration?: unknown }).duration);
  const durationMs = Math.round(duration * 1_000);
  if (
    !Number.isFinite(duration) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new ExportSourceInspectionError(
      "FFprobe did not report a valid positive media duration.",
      { code: "ffprobe_duration_invalid", retryable: true },
    );
  }
  const streamRows = Array.isArray(streams) ? streams : [];
  const videoCodec = readCodec(streamRows, "video");
  const audioCodec = readCodec(streamRows, "audio");
  const containerFormat = boundedProbeValue(
    (format as { format_name?: unknown }).format_name,
    240,
  );
  return {
    durationMs,
    ...(containerFormat ? { containerFormat } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
  };
}

function parseFfprobeVersion(output: string): string | undefined {
  const line = output.split(/\r?\n/u)[0]?.trim();
  if (!line) return undefined;
  const match = /^ffprobe version\s+([^\s]+)(?:\s|$)/u.exec(line);
  return match ? boundedProbeValue(match[1], 120) : undefined;
}

function parseFfmpegVersion(output: string): string | undefined {
  const line = output.split(/\r?\n/u)[0]?.trim();
  if (!line) return undefined;
  const match = /^ffmpeg version\s+([^\s]+)(?:\s|$)/u.exec(line);
  return match ? boundedProbeValue(match[1], 120) : undefined;
}

function readCodec(streams: unknown[], type: "video" | "audio") {
  const stream = streams.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as { codec_type?: unknown }).codec_type === type,
  ) as { codec_name?: unknown } | undefined;
  return boundedProbeValue(stream?.codec_name, 120);
}

function boundedProbeValue(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._,+-]{1,240}$/u.test(normalized) &&
    normalized.length <= maximumLength
    ? normalized
    : undefined;
}

function malformedFfprobeOutput() {
  return new ExportSourceInspectionError(
    "FFprobe returned malformed inspection data. Retry this export after checking the local media tools.",
    { code: "ffprobe_output_malformed" },
  );
}

function inspectionCanceled() {
  return new ExportSourceInspectionError("Media inspection was canceled.", {
    code: "source_inspection_canceled",
    retryable: true,
  });
}

function renderCanceled() {
  return new FfmpegRenderError("Media rendering was canceled.", {
    code: "ffmpeg_render_canceled",
    retryable: true,
  });
}

async function createAttemptDirectory(scratchRoot: string, attemptId: string) {
  const { mkdtemp } = await import("node:fs/promises");
  const directory = await mkdtemp(join(resolve(scratchRoot), `${attemptId}-`));
  await chmod(directory, 0o700);
  return directory;
}

async function cleanupAttemptDirectory(path: string) {
  await rm(path, { recursive: true, force: true });
  const remains = await access(path).then(
    () => true,
    () => false,
  );
  if (remains) {
    throw new Error("scratch directory remains after deletion");
  }
}

function isInsideScratchDirectory(directory: string, path: string) {
  const root = `${resolve(directory)}${sep}`;
  return resolve(path).startsWith(root);
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
  if (!directory || directory.includes("\0") || resolve(directory) === sep) {
    throw new MediaAcquisitionError("Media scratch directory is invalid.");
  }
}

function validateAttemptId(attemptId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(attemptId)) {
    throw new ExportSourceAcquisitionError("Export attempt ID is invalid.", {
      code: "invalid_export_attempt",
      retryable: false,
    });
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

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/(?:[A-Za-z]:)?\/(?:[^\s'"]+)/gu, "<path>")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 500);
}
