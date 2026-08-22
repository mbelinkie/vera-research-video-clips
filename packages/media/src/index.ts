import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  rmdir,
  rm,
  stat,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  ExportObservedMediaPropertiesSchema,
  type ExportObservedMediaProperties,
  type ExportSettings,
} from "@research-video/contracts";
import {
  rendererCapabilityForSettings,
  validateExportSettingsCapabilities,
  type ExportWorkerCapabilityProvider,
  type InstalledExportWorkerCapabilities,
} from "@research-video/export-settings";

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
    if (options.signal?.aborted) {
      throw new MediaAcquisitionError(
        "The configured media provider was canceled before it started.",
      );
    }
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let forceKill: ReturnType<typeof setTimeout> | undefined;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        options.signal?.removeEventListener("abort", abort);
        callback();
      };
      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        forceKill = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 2_000);
        forceKill.unref?.();
      };
      const abort = () => terminate();
      const append = (current: string, chunk: Buffer) =>
        (current + chunk.toString("utf8")).slice(-(4 * 1024 * 1024));
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(
        terminate,
        options.timeoutMs ?? 6 * 60 * 60 * 1_000,
      );
      timeout.unref?.();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      child.once("error", (error) => {
        if (options.signal?.aborted) return;
        settle(() =>
          reject(
            new MediaAcquisitionError(
              `Could not run the configured media provider: ${error.message}`,
            ),
          ),
        );
      });
      child.once("close", (code, childSignal) => {
        if (code === 0 && !options.signal?.aborted) {
          settle(() => resolve({ stdout, stderr }));
        } else {
          const detail = sanitizedDetail(stderr);
          settle(() =>
            reject(
              new MediaAcquisitionError(
                options.signal?.aborted
                  ? "The configured media provider was canceled and terminated."
                  : `Media provider exited ${childSignal ? `after ${childSignal}` : `with code ${code ?? "unknown"}`}${detail ? `: ${detail}` : "."}`,
              ),
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
  /** Durable local job identity; it is the only scratch-directory namespace. */
  jobId: string;
  /** Positive, monotonically increasing source attempt for this job. */
  attempt: number;
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
  validateExportJobId(input.jobId);
  validateExportAttempt(input.attempt);
  const scratchDirectory = await createAttemptDirectory(
    input.scratchRoot,
    input.jobId,
    input.attempt,
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
      await cleanupAttemptDirectory(
        scratchDirectory,
        input.scratchRoot,
        input.jobId,
      );
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
  observedProperties?: ExportObservedMediaProperties;
};

export interface ExportSourceInspector {
  inspect(path: string, signal?: AbortSignal): Promise<ExportSourceInspection>;
}

export type EditingMp4RenderSettings = ExportSettings;

export type FfmpegRangeRenderInput = {
  sourcePath: string;
  stagingDirectory: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  settings: EditingMp4RenderSettings;
  /** Processor-owned, validated clip-relative English SRT; never user input. */
  englishSubtitlePath?: string;
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

export const ClipThumbnailMaxWidth = 1_280;
export const ClipThumbnailMaxHeight = 720;
export const ClipThumbnailJpegQuality = 3;

export type FfmpegJpegThumbnailExtractionInput = {
  renderedVideoPath: string;
  stagingDirectory: string;
  outputPath: string;
  extractionTimeMs: number;
  signal?: AbortSignal;
};

/** A narrow, independently replaceable boundary for one clip-derived JPEG. */
export interface FfmpegJpegThumbnailExtractionAdapter {
  extract(input: FfmpegJpegThumbnailExtractionInput): Promise<void>;
}

export type JpegThumbnailInspection = {
  codecName: string;
  width: number;
  height: number;
};

/** Kept separate from source inspection because a thumbnail has no audio/duration contract. */
export interface JpegThumbnailInspector {
  inspect(path: string, signal?: AbortSignal): Promise<JpegThumbnailInspection>;
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

export class FfmpegThumbnailError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "FfmpegThumbnailError";
    this.code = options.code ?? "thumbnail_extraction_failed";
    this.retryable = options.retryable ?? true;
  }
}

export type FfmpegH264AacRangeRendererOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

export type FfmpegCapabilityDiscoveryProviderOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

/** Discovers only the installed FFmpeg primitives used by the fixed allowlist. */
export class FfmpegCapabilityDiscoveryProvider implements ExportWorkerCapabilityProvider {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: FfmpegCapabilityDiscoveryProviderOptions = {}) {
    this.#executable = options.executable ?? "ffmpeg";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async discover(
    signal?: AbortSignal,
  ): Promise<InstalledExportWorkerCapabilities> {
    if (signal?.aborted) throw renderCanceled();
    try {
      const [encoders, muxers, filters, version] = await Promise.all([
        this.#runner.run(this.#executable, ["-hide_banner", "-encoders"], {
          timeoutMs: this.#timeoutMs,
          ...(signal ? { signal } : {}),
        }),
        this.#runner.run(this.#executable, ["-hide_banner", "-muxers"], {
          timeoutMs: this.#timeoutMs,
          ...(signal ? { signal } : {}),
        }),
        this.#runner.run(this.#executable, ["-hide_banner", "-filters"], {
          timeoutMs: this.#timeoutMs,
          ...(signal ? { signal } : {}),
        }),
        this.#runner.run(this.#executable, ["-version"], {
          timeoutMs: Math.min(this.#timeoutMs, 5_000),
          ...(signal ? { signal } : {}),
        }),
      ]);
      if (signal?.aborted) throw renderCanceled();
      const ffmpegVersion = parseFfmpegVersion(version.stdout);
      return {
        encoders: parseFfmpegListing(encoders.stdout, "encoder"),
        muxers: parseFfmpegListing(muxers.stdout, "muxer"),
        filters: parseFfmpegListing(filters.stdout, "filter"),
        ...(ffmpegVersion ? { ffmpegVersion } : {}),
      };
    } catch (error) {
      if (error instanceof FfmpegRenderError) throw error;
      if (signal?.aborted) throw renderCanceled();
      throw new FfmpegRenderError(
        "Installed FFmpeg capabilities could not be discovered. Check the configured media tool before retrying.",
        { code: "capability_discovery_failed", retryable: true },
      );
    }
  }
}

export type FfmpegJpegThumbnailExtractorOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

export class FfmpegJpegThumbnailExtractor implements FfmpegJpegThumbnailExtractionAdapter {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: FfmpegJpegThumbnailExtractorOptions = {}) {
    this.#executable = options.executable ?? "ffmpeg";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async extract(input: FfmpegJpegThumbnailExtractionInput): Promise<void> {
    await validateThumbnailInput(input);
    if (input.signal?.aborted) throw thumbnailCanceled();
    try {
      await this.#runner.run(
        this.#executable,
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          resolve(input.renderedVideoPath),
          "-ss",
          formatFfmpegTime(input.extractionTimeMs),
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          `scale=w='min(${ClipThumbnailMaxWidth},iw)':h='min(${ClipThumbnailMaxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          "-c:v",
          "mjpeg",
          "-q:v",
          String(ClipThumbnailJpegQuality),
          "-pix_fmt",
          "yuvj420p",
          "-f",
          "image2",
          "-n",
          resolve(input.outputPath),
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    } catch {
      if (input.signal?.aborted) throw thumbnailCanceled();
      throw new FfmpegThumbnailError(
        "FFmpeg could not extract the clip thumbnail. Retry this export after checking the local media tools.",
        { code: "thumbnail_extraction_failed" },
      );
    }
    if (input.signal?.aborted) throw thumbnailCanceled();
  }
}

/** One software-only renderer whose pure builder maps stable settings to fixed literals. */
export class FfmpegCapabilityRangeRenderer implements FfmpegRangeRenderer {
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
    assertSupportedExportRenderSettings(input.settings);
    await validateRenderInput(input);
    if (input.signal?.aborted) throw renderCanceled();
    try {
      if (input.settings.embedEnglishSubtitleTrack) {
        const intermediatePath = join(
          input.stagingDirectory,
          `rendered-video-audio.${input.settings.container}`,
        );
        await this.#runner.run(
          this.#executable,
          buildFfmpegRenderArguments({
            sourcePath: input.sourcePath,
            stagingDirectory: input.stagingDirectory,
            outputPath: intermediatePath,
            startMs: input.startMs,
            endMs: input.endMs,
            settings: { ...input.settings, embedEnglishSubtitleTrack: false },
            ...(input.signal ? { signal: input.signal } : {}),
          }),
          {
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
        await validateRenderedOutput(intermediatePath);
        await this.#runner.run(
          this.#executable,
          buildFfmpegSoftSubtitleMuxArguments(input, intermediatePath),
          {
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
        await rm(intermediatePath, { force: true });
      } else {
        await this.#runner.run(
          this.#executable,
          buildFfmpegRenderArguments(input),
          {
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
          },
        );
      }
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

/** Historical class name retained for callers; it now serves the full allowlist. */
export class FfmpegH264AacRangeRenderer extends FfmpegCapabilityRangeRenderer {}

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
    settings.audioSampleRate !== undefined ||
    settings.audioChannels !== undefined ||
    settings.embedEnglishSubtitleTrack
  ) {
    throw new FfmpegRenderError(
      "This worker currently supports only the editing-friendly H.264/AAC MP4 snapshot. Choose that preset without advanced overrides and retry.",
      { code: "export_settings_unsupported", retryable: true },
    );
  }
}

export function assertSupportedExportRenderSettings(
  settings: EditingMp4RenderSettings,
): void {
  const issues = validateExportSettingsCapabilities(settings);
  if (issues.length || !rendererCapabilityForSettings(settings)) {
    throw new FfmpegRenderError(
      `Resolved export settings are unsupported: ${issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join(" ")}`,
      {
        code: issues[0]?.code ?? "export_settings_unsupported",
        retryable: false,
      },
    );
  }
}

const frameRateLiterals: Record<
  Exclude<ExportSettings["frameRate"], "source">,
  string
> = {
  "23.976": "24000/1001",
  "24": "24/1",
  "25": "25/1",
  "29.97": "30000/1001",
  "30": "30/1",
};

/** Pure, allowlist-only FFmpeg argument construction. */
export function buildFfmpegRenderArguments(
  input: FfmpegRangeRenderInput,
): string[] {
  assertSupportedExportRenderSettings(input.settings);
  const family = rendererCapabilityForSettings(input.settings)!;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-i",
    resolve(input.sourcePath),
    ...(input.settings.embedEnglishSubtitleTrack
      ? [
          "-itsoffset",
          formatFfmpegTime(input.startMs),
          "-i",
          resolve(input.englishSubtitlePath!),
        ]
      : []),
    "-ss",
    formatFfmpegTime(input.startMs),
    "-t",
    formatFfmpegTime(input.endMs - input.startMs),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    ...(input.settings.embedEnglishSubtitleTrack ? [] : ["-sn"]),
    "-dn",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
  ];
  if (input.settings.embedEnglishSubtitleTrack) {
    args.push(
      "-map",
      "1:s:0",
      "-c:s",
      input.settings.container === "mkv" ? "srt" : "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:0",
      "title=English",
      "-disposition:s:0",
      "0",
    );
  }
  const filters: string[] = [];
  if (input.settings.maxWidth !== undefined) {
    filters.push(
      `scale=w='min(iw,${input.settings.maxWidth})':h=-2:flags=lanczos`,
    );
  }
  if (input.settings.frameRate !== "source") {
    filters.push(
      `fps=fps=${frameRateLiterals[input.settings.frameRate]}:round=near`,
    );
  }
  if (filters.length) args.push("-vf", filters.join(","));
  if (family.id === "h264_mp4") {
    args.push("-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p");
  } else if (family.id === "hevc_mkv") {
    args.push("-c:v", "libx265", "-profile:v", "main", "-pix_fmt", "yuv420p");
  } else {
    args.push(
      "-c:v",
      "prores_ks",
      "-profile:v",
      "2",
      "-pix_fmt",
      "yuv422p10le",
    );
  }
  if (input.settings.videoRateControl.mode === "crf") {
    args.push("-crf", String(input.settings.videoRateControl.value));
  } else if (input.settings.videoRateControl.mode === "bitrate") {
    args.push("-b:v", `${input.settings.videoRateControl.kilobitsPerSecond}k`);
  }
  args.push("-c:a", input.settings.audioCodec === "aac" ? "aac" : "pcm_s16le");
  if (input.settings.audioKilobitsPerSecond !== undefined) {
    args.push("-b:a", `${input.settings.audioKilobitsPerSecond}k`);
  }
  if (
    input.settings.audioSampleRate !== undefined &&
    input.settings.audioSampleRate !== "source"
  ) {
    args.push("-ar", input.settings.audioSampleRate);
  }
  if (
    input.settings.audioChannels !== undefined &&
    input.settings.audioChannels !== "source"
  ) {
    args.push("-ac", input.settings.audioChannels);
  }
  if (family.id === "h264_mp4") {
    args.push("-movflags", "+faststart", "-f", "mp4");
  } else if (family.id === "hevc_mkv") {
    args.push("-f", "matroska");
  } else {
    args.push("-f", "mov");
  }
  args.push("-n", resolve(input.outputPath));
  return args;
}

/** Fixed second pass: preserves the verified video/audio bytes and muxes zero-based SRT. */
export function buildFfmpegSoftSubtitleMuxArguments(
  input: FfmpegRangeRenderInput,
  renderedVideoAudioPath: string,
): string[] {
  if (!input.settings.embedEnglishSubtitleTrack || !input.englishSubtitlePath)
    throw new FfmpegRenderError(
      "Embedded English subtitle input is required.",
      { code: "english_subtitle_input_invalid", retryable: false },
    );
  const subtitleCodec = input.settings.container === "mkv" ? "srt" : "mov_text";
  const format =
    input.settings.container === "mkv" ? "matroska" : input.settings.container;
  return [
    "-hide_banner",
    "-nostdin",
    "-i",
    resolve(renderedVideoAudioPath),
    "-i",
    resolve(input.englishSubtitlePath),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-map",
    "1:s:0",
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-c:s",
    subtitleCodec,
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-metadata:s:s:0",
    "language=eng",
    "-metadata:s:s:0",
    "title=English",
    "-disposition:s:0",
    "0",
    "-f",
    format,
    "-n",
    resolve(input.outputPath),
  ];
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
  sourceInspection: ExportSourceInspection;
  signal?: AbortSignal;
}): Promise<ExportSourceInspection> {
  assertSupportedExportRenderSettings(input.settings);
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
  const observed = inspection.observedProperties;
  const source = input.sourceInspection.observedProperties;
  if (!observed || !source) {
    throw new FfmpegRenderError(
      "FFprobe did not return normalized conformance evidence for the rendered output and source.",
      { code: "render_output_conformance_missing", retryable: true },
    );
  }
  assertObservedMediaConformance({
    observed,
    source,
    settings: input.settings,
    expectedDurationMs,
  });
  return inspection;
}

const FrameRateTolerance = 0.001;
const AspectRatioTolerance = 0.005;

function assertObservedMediaConformance(input: {
  observed: ExportObservedMediaProperties;
  source: ExportObservedMediaProperties;
  settings: ExportSettings;
  expectedDurationMs: number;
}): void {
  const { observed, source, settings } = input;
  const fail = (code: string, property: string) => {
    throw new FfmpegRenderError(
      `Rendered output ${property} does not match the immutable export settings. Retry after checking the selected renderer.`,
      { code, retryable: false },
    );
  };
  if (
    observed.streamCounts.total !==
      (settings.embedEnglishSubtitleTrack ? 3 : 2) ||
    observed.streamCounts.video !== 1 ||
    observed.streamCounts.audio !== 1 ||
    observed.streamCounts.subtitle !==
      (settings.embedEnglishSubtitleTrack ? 1 : 0) ||
    observed.streamCounts.data !== 0 ||
    observed.streamCounts.other !== 0
  ) {
    fail("render_output_stream_count_mismatch", "stream counts");
  }
  if (settings.embedEnglishSubtitleTrack) {
    const subtitle = observed.subtitle;
    const expectedCodec = settings.container === "mkv" ? "subrip" : "mov_text";
    if (
      !subtitle ||
      subtitle.codec !== expectedCodec ||
      subtitle.language !== "eng" ||
      subtitle.default ||
      subtitle.forced
    )
      fail("render_output_subtitle_stream_mismatch", "English subtitle stream");
  } else if (observed.subtitle) {
    fail("render_output_subtitle_stream_mismatch", "subtitle stream");
  }
  const formats = new Set(observed.container.formatNames);
  if (
    (settings.container === "mp4" &&
      (!formats.has("mp4") ||
        !observed.container.majorBrand ||
        observed.container.majorBrand === "qt")) ||
    (settings.container === "mkv" && !formats.has("matroska")) ||
    (settings.container === "mov" &&
      (!formats.has("mov") || observed.container.majorBrand !== "qt"))
  ) {
    fail("render_output_container_mismatch", "container or major brand");
  }
  const family = rendererCapabilityForSettings(settings)!;
  const expectedVideo =
    family.id === "h264_mp4"
      ? { codec: "h264", profiles: ["high"], pixel: "yuv420p" }
      : family.id === "hevc_mkv"
        ? { codec: "hevc", profiles: ["main"], pixel: "yuv420p" }
        : {
            codec: "prores",
            profiles: ["standard", "prores 422"],
            pixel: "yuv422p10le",
          };
  if (observed.video.codec !== expectedVideo.codec)
    fail("render_output_video_codec_mismatch", "video codec");
  if (!expectedVideo.profiles.includes(observed.video.profile.toLowerCase()))
    fail("render_output_video_profile_mismatch", "video profile");
  if (observed.video.pixelFormat !== expectedVideo.pixel)
    fail("render_output_pixel_format_mismatch", "pixel format");
  const expectedWidth =
    settings.maxWidth === undefined
      ? source.video.width
      : Math.min(source.video.width, settings.maxWidth);
  const expectedHeight =
    expectedWidth === source.video.width
      ? source.video.height
      : Math.max(
          2,
          Math.round(
            (source.video.height * expectedWidth) / source.video.width / 2,
          ) * 2,
        );
  if (
    observed.video.width !== expectedWidth ||
    observed.video.height !== expectedHeight
  ) {
    fail("render_output_dimensions_mismatch", "dimensions");
  }
  if (
    relativeDifference(
      rationalValue(observed.video.sampleAspectRatio),
      rationalValue(source.video.sampleAspectRatio),
    ) > AspectRatioTolerance
  ) {
    fail("render_output_sample_aspect_ratio_mismatch", "sample aspect ratio");
  }
  if (
    relativeDifference(
      rationalValue(observed.video.displayAspectRatio),
      rationalValue(source.video.displayAspectRatio),
    ) > AspectRatioTolerance
  ) {
    fail("render_output_aspect_ratio_mismatch", "display aspect ratio");
  }
  const expectedFrameRate =
    settings.frameRate === "source"
      ? rationalValue(source.video.averageFrameRate)
      : rationalLiteralValue(frameRateLiterals[settings.frameRate]);
  if (
    Math.abs(
      rationalValue(observed.video.averageFrameRate) - expectedFrameRate,
    ) > FrameRateTolerance
  ) {
    fail("render_output_frame_rate_mismatch", "average frame rate");
  }
  const expectedAudioCodec =
    settings.audioCodec === "aac" ? "aac" : "pcm_s16le";
  if (observed.audio.codec !== expectedAudioCodec)
    fail("render_output_audio_codec_mismatch", "audio codec");
  const sourceRate = source.audio.sampleRate;
  const expectedSampleRate =
    settings.audioSampleRate === undefined ||
    settings.audioSampleRate === "source"
      ? sourceRate
      : Number(settings.audioSampleRate);
  if (observed.audio.sampleRate !== expectedSampleRate)
    fail("render_output_audio_sample_rate_mismatch", "audio sample rate");
  const expectedChannels =
    settings.audioChannels === undefined || settings.audioChannels === "source"
      ? source.audio.channels
      : Number(settings.audioChannels);
  if (observed.audio.channels !== expectedChannels)
    fail("render_output_audio_channels_mismatch", "audio channel count");
  const expectedLayout =
    expectedChannels === 1
      ? "mono"
      : expectedChannels === 2
        ? "stereo"
        : source.audio.channelLayout;
  if (observed.audio.channelLayout !== expectedLayout)
    fail("render_output_audio_layout_mismatch", "audio channel layout");
  if (
    settings.audioKilobitsPerSecond !== undefined &&
    observed.audio.reportedBitRate !== undefined
  ) {
    const expected = settings.audioKilobitsPerSecond * 1_000;
    const tolerance = Math.max(32_000, expected * 0.2);
    if (Math.abs(observed.audio.reportedBitRate - expected) > tolerance)
      fail("render_output_audio_bitrate_mismatch", "reported audio bitrate");
  }
  if (
    Math.abs(observed.durationMs - input.expectedDurationMs) >
    RenderDurationToleranceMs
  ) {
    fail("render_output_duration_mismatch", "duration");
  }
  if (!observed.ffprobeVersion) {
    fail("render_output_tool_version_missing", "FFprobe tool version");
  }
}

function rationalValue(value: { numerator: number; denominator: number }) {
  return value.numerator / value.denominator;
}

function rationalLiteralValue(value: string) {
  const [numerator, denominator] = value.split("/").map(Number);
  return numerator! / denominator!;
}

function relativeDifference(left: number, right: number) {
  return Math.abs(left - right) / Math.max(Math.abs(right), Number.EPSILON);
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
          "format=duration,format_name,nb_streams:format_tags=major_brand:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,sample_aspect_ratio,display_aspect_ratio,avg_frame_rate,sample_rate,channels,channel_layout,bit_rate,disposition:stream_tags=language,title",
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
    return {
      ...inspection,
      ...(ffprobeVersion ? { ffprobeVersion } : {}),
      ...(inspection.observedProperties
        ? {
            observedProperties: {
              ...inspection.observedProperties,
              ...(ffprobeVersion ? { ffprobeVersion } : {}),
            },
          }
        : {}),
    };
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

export type FfprobeJpegThumbnailInspectorOptions = {
  executable?: string;
  runner?: MediaCommandRunner;
  timeoutMs?: number;
};

/** A bounded FFprobe adapter for the one JPEG emitted by the thumbnail boundary. */
export class FfprobeJpegThumbnailInspector implements JpegThumbnailInspector {
  readonly #executable: string;
  readonly #runner: MediaCommandRunner;
  readonly #timeoutMs: number;

  constructor(options: FfprobeJpegThumbnailInspectorOptions = {}) {
    this.#executable = options.executable ?? "ffprobe";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnMediaCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async inspect(
    path: string,
    signal?: AbortSignal,
  ): Promise<JpegThumbnailInspection> {
    await validateRegularNonemptySource(path);
    if (signal?.aborted) throw thumbnailInspectionCanceled();
    let result: MediaCommandResult;
    try {
      result = await this.#runner.run(
        this.#executable,
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
          resolve(path),
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
    } catch {
      if (signal?.aborted) throw thumbnailInspectionCanceled();
      throw new FfmpegThumbnailError(
        "FFprobe could not inspect the generated thumbnail. Retry this export after checking the local media tools.",
        { code: "thumbnail_inspection_failed" },
      );
    }
    if (signal?.aborted) throw thumbnailInspectionCanceled();
    return parseFfprobeJpegThumbnailOutput(result.stdout);
  }
}

export async function inspectAndValidateJpegThumbnail(input: {
  outputPath: string;
  stagingDirectory: string;
  inspector: JpegThumbnailInspector;
  signal?: AbortSignal;
}): Promise<JpegThumbnailInspection> {
  validateScratchDirectory(input.stagingDirectory);
  if (!isInsideScratchDirectory(input.stagingDirectory, input.outputPath)) {
    throw new FfmpegThumbnailError(
      "Thumbnail output is outside its private staging directory.",
      { code: "thumbnail_output_outside_staging", retryable: false },
    );
  }
  await validateThumbnailOutput(input.outputPath);
  if (input.signal?.aborted) throw thumbnailInspectionCanceled();
  const inspection = await input.inspector.inspect(
    input.outputPath,
    input.signal,
  );
  if (input.signal?.aborted) throw thumbnailInspectionCanceled();
  if (
    inspection.codecName !== "mjpeg" ||
    !Number.isSafeInteger(inspection.width) ||
    !Number.isSafeInteger(inspection.height) ||
    inspection.width <= 0 ||
    inspection.height <= 0 ||
    inspection.width > ClipThumbnailMaxWidth ||
    inspection.height > ClipThumbnailMaxHeight ||
    inspection.width % 2 !== 0 ||
    inspection.height % 2 !== 0
  ) {
    throw new FfmpegThumbnailError(
      "Generated thumbnail does not satisfy the verified JPEG dimensions policy. Retry this export.",
      { code: "thumbnail_output_policy_mismatch", retryable: false },
    );
  }
  return inspection;
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
  if (input.settings.embedEnglishSubtitleTrack) {
    if (
      !input.englishSubtitlePath ||
      !isInsideScratchDirectory(
        input.stagingDirectory,
        input.englishSubtitlePath,
      )
    )
      throw new FfmpegRenderError(
        "Embedded English subtitle input is invalid.",
        { code: "english_subtitle_input_invalid", retryable: false },
      );
    await validateRegularNonemptySource(input.englishSubtitlePath);
  } else if (input.englishSubtitlePath) {
    throw new FfmpegRenderError(
      "A subtitle input is not permitted when embedding is disabled.",
      { code: "english_subtitle_input_invalid", retryable: false },
    );
  }
  if (!resolve(input.outputPath).endsWith(`.${input.settings.container}`)) {
    throw new FfmpegRenderError(
      "The rendered output filename must use the selected container extension.",
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

async function validateThumbnailInput(
  input: FfmpegJpegThumbnailExtractionInput,
): Promise<void> {
  validateScratchDirectory(input.stagingDirectory);
  if (
    !Number.isSafeInteger(input.extractionTimeMs) ||
    input.extractionTimeMs < 0
  ) {
    throw new FfmpegThumbnailError("Thumbnail extraction time is invalid.", {
      code: "thumbnail_time_invalid",
      retryable: false,
    });
  }
  if (
    !isInsideScratchDirectory(
      input.stagingDirectory,
      input.renderedVideoPath,
    ) ||
    !isInsideScratchDirectory(input.stagingDirectory, input.outputPath)
  ) {
    throw new FfmpegThumbnailError(
      "Thumbnail input or output is outside its private staging directory.",
      { code: "thumbnail_path_outside_staging", retryable: false },
    );
  }
  if (resolve(input.renderedVideoPath) === resolve(input.outputPath)) {
    throw new FfmpegThumbnailError(
      "Thumbnail output path must differ from the rendered video.",
      { code: "thumbnail_output_path_invalid", retryable: false },
    );
  }
  if (!resolve(input.outputPath).endsWith(".jpg")) {
    throw new FfmpegThumbnailError(
      "Thumbnail output must use a JPEG filename.",
      { code: "thumbnail_output_path_invalid", retryable: false },
    );
  }
  await validateRegularNonemptySource(input.renderedVideoPath);
  const exists = await access(input.outputPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new FfmpegThumbnailError(
      "A thumbnail output already exists for this attempt. Retry the export.",
      { code: "thumbnail_output_already_exists", retryable: true },
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

async function validateThumbnailOutput(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new FfmpegThumbnailError(
      "FFmpeg completed without producing a thumbnail file.",
      { code: "thumbnail_output_missing" },
    );
  }
  if (!info.isFile() || info.size <= 0) {
    throw new FfmpegThumbnailError(
      "Thumbnail output must be a regular nonempty file.",
      { code: "thumbnail_output_invalid", retryable: false },
    );
  }
}

function formatFfmpegTime(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3);
}

export function parseFfprobeOutput(output: string): ExportSourceInspection {
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
  const observedProperties = parseObservedMediaProperties({
    format: format as Record<string, unknown>,
    streams: streamRows,
    durationMs,
  });
  return {
    durationMs,
    ...(containerFormat ? { containerFormat } : {}),
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    observedProperties,
  };
}

function parseObservedMediaProperties(input: {
  format: Record<string, unknown>;
  streams: unknown[];
  durationMs: number;
}): ExportObservedMediaProperties {
  const rows = input.streams.filter(
    (stream): stream is Record<string, unknown> =>
      Boolean(stream) && typeof stream === "object" && !Array.isArray(stream),
  );
  const videoRows = rows.filter((row) => row.codec_type === "video");
  const audioRows = rows.filter((row) => row.codec_type === "audio");
  const subtitleRows = rows.filter((row) => row.codec_type === "subtitle");
  const subtitleCount = subtitleRows.length;
  const dataCount = rows.filter((row) => row.codec_type === "data").length;
  const otherCount =
    rows.length -
    videoRows.length -
    audioRows.length -
    subtitleCount -
    dataCount;
  const video = videoRows[0];
  const audio = audioRows[0];
  const formatNames = boundedProbeValue(input.format.format_name, 240)
    ?.split(",")
    .filter(Boolean);
  const tags =
    input.format.tags &&
    typeof input.format.tags === "object" &&
    !Array.isArray(input.format.tags)
      ? (input.format.tags as Record<string, unknown>)
      : undefined;
  const majorBrand = boundedProbeText(tags?.major_brand, 64);
  const profile = boundedProbeText(video?.profile, 120);
  const pixelFormat = boundedProbeValue(video?.pix_fmt, 120);
  const width = Number(video?.width);
  const height = Number(video?.height);
  const videoCodec = boundedProbeValue(video?.codec_name, 120);
  const audioCodec = boundedProbeValue(audio?.codec_name, 120);
  const sampleRate = Number(audio?.sample_rate);
  const channels = Number(audio?.channels);
  const channelLayout = boundedProbeText(audio?.channel_layout, 120);
  const reportedBitRate = positiveSafeInteger(audio?.bit_rate);
  const subtitleRow = subtitleRows[0];
  const subtitleTags =
    subtitleRow?.tags &&
    typeof subtitleRow.tags === "object" &&
    !Array.isArray(subtitleRow.tags)
      ? (subtitleRow.tags as Record<string, unknown>)
      : undefined;
  const subtitleDisposition =
    subtitleRow?.disposition &&
    typeof subtitleRow.disposition === "object" &&
    !Array.isArray(subtitleRow.disposition)
      ? (subtitleRow.disposition as Record<string, unknown>)
      : undefined;
  const subtitleCodec = boundedProbeValue(subtitleRow?.codec_name, 120);
  const subtitleLanguage = boundedProbeText(subtitleTags?.language, 35);
  const subtitleTitle = boundedProbeText(subtitleTags?.title, 120);
  const sampleAspectRatio = parseProbeRational(video?.sample_aspect_ratio);
  const displayAspectRatio = parseProbeRational(video?.display_aspect_ratio);
  const averageFrameRate = parseProbeRational(video?.avg_frame_rate);
  if (
    !formatNames?.length ||
    !videoCodec ||
    !audioCodec ||
    !profile ||
    !pixelFormat ||
    !channelLayout ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(sampleRate) ||
    !Number.isSafeInteger(channels) ||
    !sampleAspectRatio ||
    !displayAspectRatio ||
    !averageFrameRate
  ) {
    throw malformedFfprobeOutput();
  }
  const parsed = ExportObservedMediaPropertiesSchema.safeParse({
    schemaVersion: 1,
    container: {
      formatNames,
      ...(majorBrand ? { majorBrand } : {}),
    },
    streamCounts: {
      total: rows.length,
      video: videoRows.length,
      audio: audioRows.length,
      subtitle: subtitleCount,
      data: dataCount,
      other: otherCount,
    },
    video: {
      codec: videoCodec,
      profile,
      pixelFormat,
      width,
      height,
      sampleAspectRatio,
      displayAspectRatio,
      averageFrameRate,
    },
    audio: {
      codec: audioCodec,
      sampleRate,
      channels,
      channelLayout,
      ...(reportedBitRate ? { reportedBitRate } : {}),
    },
    ...(subtitleRows.length === 1 && subtitleCodec && subtitleLanguage
      ? {
          subtitle: {
            codec: subtitleCodec,
            language: subtitleLanguage.toLowerCase(),
            ...(subtitleTitle ? { title: subtitleTitle } : {}),
            default: subtitleDisposition?.default === 1,
            forced: subtitleDisposition?.forced === 1,
          },
        }
      : {}),
    durationMs: input.durationMs,
  });
  if (!parsed.success) throw malformedFfprobeOutput();
  return parsed.data;
}

function parseProbeRational(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)[/:](\d+)$/u.exec(value.trim());
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) &&
    Number.isSafeInteger(denominator) &&
    numerator >= 0 &&
    denominator > 0
    ? { numerator, denominator }
    : undefined;
}

function positiveSafeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFfprobeJpegThumbnailOutput(
  output: string,
): JpegThumbnailInspection {
  if (Buffer.byteLength(output, "utf8") > 64 * 1024) {
    throw new FfmpegThumbnailError(
      "FFprobe returned too much inspection data for the thumbnail.",
      { code: "thumbnail_inspection_output_too_large", retryable: true },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw malformedThumbnailInspection();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw malformedThumbnailInspection();
  }
  const streams = (value as { streams?: unknown }).streams;
  if (!Array.isArray(streams) || streams.length !== 1) {
    throw malformedThumbnailInspection();
  }
  const stream = streams[0];
  if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
    throw malformedThumbnailInspection();
  }
  const row = stream as {
    codec_name?: unknown;
    width?: unknown;
    height?: unknown;
  };
  const codecName = boundedProbeValue(row.codec_name, 120);
  const width = Number(row.width);
  const height = Number(row.height);
  if (
    !codecName ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height)
  ) {
    throw malformedThumbnailInspection();
  }
  return { codecName, width, height };
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

function boundedProbeText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replaceAll(/\s+/gu, " ");
  return normalized.length > 0 &&
    normalized.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : undefined;
}

function parseFfmpegListing(
  output: string,
  kind: "encoder" | "muxer" | "filter",
): string[] {
  if (Buffer.byteLength(output, "utf8") > 4 * 1024 * 1024) {
    throw new FfmpegRenderError(
      "FFmpeg capability output exceeded its bound.",
      {
        code: "capability_output_too_large",
        retryable: true,
      },
    );
  }
  const names = new Set<string>();
  const expression =
    kind === "encoder"
      ? /^\s*[A-Z.]{6}\s+([A-Za-z0-9_]+)\s/gmu
      : kind === "muxer"
        ? /^\s*[D. ]?E\s+([A-Za-z0-9_]+)\s/gmu
        : /^\s*[A-Z.|]{2,8}\s+([A-Za-z0-9_]+)\s/gmu;
  for (const match of output.matchAll(expression)) names.add(match[1]!);
  return [...names].sort();
}

function malformedFfprobeOutput() {
  return new ExportSourceInspectionError(
    "FFprobe returned malformed inspection data. Retry this export after checking the local media tools.",
    { code: "ffprobe_output_malformed" },
  );
}

function malformedThumbnailInspection() {
  return new FfmpegThumbnailError(
    "FFprobe returned malformed thumbnail inspection data. Retry this export after checking the local media tools.",
    { code: "thumbnail_inspection_output_malformed", retryable: true },
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

function thumbnailCanceled() {
  return new FfmpegThumbnailError("Thumbnail extraction was canceled.", {
    code: "thumbnail_extraction_canceled",
    retryable: true,
  });
}

function thumbnailInspectionCanceled() {
  return new FfmpegThumbnailError("Thumbnail inspection was canceled.", {
    code: "thumbnail_inspection_canceled",
    retryable: true,
  });
}

/**
 * Resolves the one exact directory permitted for a persisted export attempt.
 * Both normal processing and crash recovery use this helper so a cleanup path
 * can never be sourced from provider output or a persisted filesystem locator.
 */
export function resolveExportSourceScratchAttemptDirectory(input: {
  scratchRoot: string;
  jobId: string;
  attempt: number;
}): string {
  validateScratchDirectory(input.scratchRoot);
  validateExportJobId(input.jobId);
  validateExportAttempt(input.attempt);
  const root = resolve(input.scratchRoot);
  const jobDirectory = join(root, input.jobId);
  const directory = join(jobDirectory, String(input.attempt));
  if (
    !isDirectChild(root, jobDirectory) ||
    !isDirectChild(jobDirectory, directory)
  ) {
    throw new ExportSourceAcquisitionError(
      "Export scratch directory is invalid.",
      { code: "invalid_export_attempt", retryable: false },
    );
  }
  return directory;
}

async function createAttemptDirectory(
  scratchRoot: string,
  jobId: string,
  attempt: number,
) {
  const root = resolve(scratchRoot);
  const directory = resolveExportSourceScratchAttemptDirectory({
    scratchRoot: root,
    jobId,
    attempt,
  });
  const jobDirectory = join(root, jobId);
  await ensurePrivateDirectory(root, true);
  await ensurePrivateDirectory(jobDirectory, false);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ExportSourceAcquisitionError(
        "This export attempt already has a scratch directory.",
        { code: "export_scratch_attempt_exists", retryable: false },
      );
    }
    throw error;
  }
  await ensurePrivateDirectory(directory, false);
  return directory;
}

async function ensurePrivateDirectory(path: string, recursive: boolean) {
  try {
    await mkdir(path, { recursive, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ExportSourceAcquisitionError(
      "Export scratch directory is invalid.",
      { code: "invalid_export_attempt", retryable: false },
    );
  }
  await chmod(path, 0o700);
}

async function cleanupAttemptDirectory(
  path: string,
  scratchRoot: string,
  jobId: string,
) {
  await rm(path, { recursive: true, force: true });
  const remains = await access(path).then(
    () => true,
    () => false,
  );
  if (remains) {
    throw new Error("scratch directory remains after deletion");
  }
  await removeEmptyExportSourceScratchJobDirectory({
    scratchRoot,
    jobId,
  });
}

/** Removes only an empty, validated job parent after its exact attempt child. */
export async function removeEmptyExportSourceScratchJobDirectory(input: {
  scratchRoot: string;
  jobId: string;
}): Promise<void> {
  validateScratchDirectory(input.scratchRoot);
  validateExportJobId(input.jobId);
  const root = resolve(input.scratchRoot);
  const jobDirectory = join(root, input.jobId);
  if (!isDirectChild(root, jobDirectory)) {
    throw new ExportSourceAcquisitionError(
      "Export scratch directory is invalid.",
      { code: "invalid_export_attempt", retryable: false },
    );
  }
  let entry;
  try {
    entry = await lstat(jobDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ExportSourceAcquisitionError(
      "Export scratch directory is invalid.",
      { code: "invalid_export_attempt", retryable: false },
    );
  }
  try {
    await rmdir(jobDirectory);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
    )
      return;
    throw error;
  }
}

function isInsideScratchDirectory(directory: string, path: string) {
  const candidate = relative(resolve(directory), resolve(path));
  return (
    Boolean(candidate) &&
    candidate !== ".." &&
    !candidate.startsWith(`..${sep}`)
  );
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

function validateExportJobId(jobId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      jobId,
    )
  ) {
    throw new ExportSourceAcquisitionError("Export attempt ID is invalid.", {
      code: "invalid_export_attempt",
      retryable: false,
    });
  }
}

function validateExportAttempt(attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt <= 0) {
    throw new ExportSourceAcquisitionError("Export attempt ID is invalid.", {
      code: "invalid_export_attempt",
      retryable: false,
    });
  }
}

function isDirectChild(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return (
    Boolean(path) &&
    !path.startsWith(`..${sep}`) &&
    path !== ".." &&
    !path.includes(sep)
  );
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
