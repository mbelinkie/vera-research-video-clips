import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  CaptionTrackCandidateSchema,
  type CaptionTrackCandidate,
} from "@research-video/contracts";

import {
  ProviderExecutionError,
  type AcquiredCaption,
  type CaptionProvider,
} from "./index.ts";
import { normalizeWebVttCaption } from "@research-video/transcript";

export type CommandResult = { stdout: string; stderr: string };

export interface CommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  async run(
    executable: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    validateExecutable(executable);
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let stdout = "";
      let stderr = "";
      const maxOutputBytes = 4 * 1024 * 1024;
      const append = (current: string, chunk: Buffer) =>
        (current + chunk.toString("utf8")).slice(-maxOutputBytes);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(
        () => child.kill("SIGTERM"),
        options.timeoutMs ?? 120_000,
      );
      timeout.unref?.();
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(
          new ProviderExecutionError(
            `Could not run the configured local provider: ${error.message}`,
          ),
        );
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolve({ stdout, stderr });
        else {
          const detail = sanitizeProviderDetail(stderr);
          reject(
            new ProviderExecutionError(
              `Local provider exited ${signal ? `after ${signal}` : `with code ${code ?? "unknown"}`}${detail ? `: ${detail}` : "."}`,
            ),
          );
        }
      });
    });
  }
}

type YtDlpMetadata = {
  language?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};

export type YtDlpCaptionProviderOptions = {
  executable?: string;
  runner?: CommandRunner;
  timeoutMs?: number;
};

export type CaptionProviderConfiguration = {
  mode: "disabled" | "yt-dlp";
  ytDlpPath: string;
};

export function createCaptionProvider(
  configuration: CaptionProviderConfiguration,
  runner?: CommandRunner,
): CaptionProvider | undefined {
  return configuration.mode === "yt-dlp"
    ? new YtDlpCaptionProvider({
        executable: configuration.ytDlpPath,
        ...(runner ? { runner } : {}),
      })
    : undefined;
}

export class YtDlpCaptionProvider implements CaptionProvider {
  readonly #executable: string;
  readonly #runner: CommandRunner;
  readonly #timeoutMs: number;

  constructor(options: YtDlpCaptionProviderOptions = {}) {
    this.#executable = options.executable ?? "yt-dlp";
    validateExecutable(this.#executable);
    this.#runner = options.runner ?? new SpawnCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async discover(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<CaptionTrackCandidate[]> {
    validateVideoId(videoId);
    const result = await this.#runner.run(
      this.#executable,
      [
        "--no-config",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        "--",
        canonicalVideoUrl(videoId),
      ],
      { timeoutMs: this.#timeoutMs, ...(signal ? { signal } : {}) },
    );
    let metadata: YtDlpMetadata;
    try {
      metadata = JSON.parse(result.stdout) as YtDlpMetadata;
    } catch {
      throw new ProviderExecutionError(
        "Caption provider returned invalid metadata JSON.",
      );
    }
    return [
      ...captionCandidates(metadata.subtitles, "manual"),
      ...captionCandidates(
        metadata.automatic_captions,
        "automatic",
        metadata.language,
      ),
    ];
  }

  async acquire(
    videoId: string,
    track: CaptionTrackCandidate,
    scratchDirectory: string,
    signal?: AbortSignal,
  ): Promise<AcquiredCaption> {
    validateVideoId(videoId);
    CaptionTrackCandidateSchema.parse(track);
    if (track.downloadAccess !== "available") {
      throw new ProviderExecutionError(
        "The selected caption track is not available to this provider.",
      );
    }
    const providerLanguage = ytDlpProviderLanguage(track);
    if (!scratchDirectory || scratchDirectory.includes("\0")) {
      throw new ProviderExecutionError("Caption scratch directory is invalid.");
    }
    await mkdir(scratchDirectory, { recursive: true, mode: 0o700 });
    const basename = captionBasename(videoId, track);
    const existing = await findCaptionFile(scratchDirectory, basename);
    if (existing) return acquiredCaption(videoId, track, existing);

    await this.#runner.run(
      this.#executable,
      [
        "--no-config",
        "--no-playlist",
        "--skip-download",
        track.kind === "manual" ? "--write-subs" : "--write-auto-subs",
        track.kind === "manual" ? "--no-write-auto-subs" : "--no-write-subs",
        "--sub-langs",
        providerLanguage,
        "--sub-format",
        "vtt",
        "--output",
        join(scratchDirectory, `${basename}.%(ext)s`),
        "--",
        canonicalVideoUrl(videoId),
      ],
      { timeoutMs: this.#timeoutMs, ...(signal ? { signal } : {}) },
    );
    const path = await findCaptionFile(scratchDirectory, basename);
    if (!path) {
      throw new ProviderExecutionError(
        "Caption provider completed without producing the selected VTT track.",
      );
    }
    return acquiredCaption(videoId, track, path);
  }
}

export async function normalizeAcquiredCaption(caption: AcquiredCaption) {
  const contents = await readFile(caption.path);
  return normalizeWebVttCaption({
    contents,
    videoId: caption.videoId,
    language: caption.track.language,
    source: caption.track.kind === "manual" ? "youtube-manual" : "youtube-auto",
    provider: caption.provider,
  });
}

function captionCandidates(
  source: Record<string, unknown> | undefined,
  kind: "manual" | "automatic",
  sourceLanguage?: string,
): CaptionTrackCandidate[] {
  if (!source) return [];
  let entries = Object.entries(source);
  if (kind === "automatic") {
    const originals = entries.filter(([language]) =>
      language.endsWith("-orig"),
    );
    entries =
      originals.length > 0
        ? originals
        : sourceLanguage
          ? entries.filter(([language]) =>
              sameLanguage(language, sourceLanguage),
            )
          : [];
  }
  return entries
    .filter(
      ([providerLanguage, formats]) =>
        normalizedProviderLanguage(providerLanguage).length >= 2 &&
        normalizedProviderLanguage(providerLanguage).length <= 35 &&
        Array.isArray(formats) &&
        formats.length > 0,
    )
    .map(([providerLanguage]) => {
      const language = normalizedProviderLanguage(providerLanguage);
      return CaptionTrackCandidateSchema.parse({
        id: `yt-dlp:${kind}:${providerLanguage}`,
        language,
        kind,
        translatable: false,
        downloadAccess: "available",
      });
    })
    .sort(
      (left, right) =>
        left.language.localeCompare(right.language) ||
        left.id.localeCompare(right.id),
    );
}

function sameLanguage(left: string, right: string) {
  return (
    normalizeLanguage(left).split("-")[0] ===
    normalizeLanguage(right).split("-")[0]
  );
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase().replaceAll("_", "-");
}

function normalizedProviderLanguage(providerLanguage: string) {
  return providerLanguage.endsWith("-orig")
    ? providerLanguage.slice(0, -"-orig".length)
    : providerLanguage;
}

function ytDlpProviderLanguage(track: CaptionTrackCandidate) {
  const prefix = `yt-dlp:${track.kind}:`;
  if (!track.id.startsWith(prefix)) {
    throw new ProviderExecutionError(
      "The selected caption track does not belong to this provider.",
    );
  }
  const providerLanguage = track.id.slice(prefix.length);
  if (!providerLanguage || providerLanguage.includes(",")) {
    throw new ProviderExecutionError(
      "The selected caption track has an invalid provider language.",
    );
  }
  return providerLanguage;
}

function captionBasename(videoId: string, track: CaptionTrackCandidate) {
  const digest = createHash("sha256")
    .update(`${track.kind}:${track.language}:${track.id}`)
    .digest("hex")
    .slice(0, 12);
  return `caption-${videoId}-${digest}`;
}

async function findCaptionFile(
  scratchDirectory: string,
  basename: string,
): Promise<string | undefined> {
  const candidates = (await readdir(scratchDirectory))
    .filter((name) => name.startsWith(`${basename}.`) && name.endsWith(".vtt"))
    .sort();
  for (const name of candidates) {
    const path = join(scratchDirectory, name);
    const details = await stat(path);
    if (details.isFile() && details.size > 0) return path;
  }
  return undefined;
}

async function acquiredCaption(
  videoId: string,
  track: CaptionTrackCandidate,
  path: string,
): Promise<AcquiredCaption> {
  const details = await stat(path);
  return {
    videoId,
    track,
    path,
    format: "vtt",
    byteSize: details.size,
    provider: "yt-dlp",
  };
}

function canonicalVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function validateVideoId(videoId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new ProviderExecutionError("Invalid YouTube video ID.");
  }
}

function validateExecutable(executable: string) {
  if (!executable.trim() || executable.includes("\0")) {
    throw new ProviderExecutionError(
      "Configured caption-provider executable is invalid.",
    );
  }
}

function sanitizeProviderDetail(stderr: string) {
  return stderr
    .replaceAll(/https?:\/\/\S+/gi, "[URL redacted]")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
