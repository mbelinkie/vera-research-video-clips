import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SpawnMediaCommandRunner,
  type MediaCommandRunner,
} from "@research-video/media";

export type SocialSpikePlatform = "tiktok" | "instagram" | "facebook";

export type SocialSpikeInput = {
  platform: SocialSpikePlatform;
  url: string;
  authorizationConfirmed: true;
  rightsCleared: true;
  ytDlpPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
};

export type SocialSpikeResult = {
  status: "passed";
  platform: SocialSpikePlatform;
  providerMediaId: string;
  canonicalUrlOrigin: string;
  ytDlpVersion: string;
  metadata: {
    title?: string;
    creator?: string;
    durationMs?: number;
    thumbnailDiscovered: boolean;
    manualCaptionLanguages: string[];
    automaticCaptionLanguages: string[];
  };
  media: {
    byteSize: number;
    contentSha256: string;
    container?: string;
    videoCodec?: string;
    audioCodec?: string;
    durationMs?: number;
  };
  cleanup: { scratchRemoved: true };
};

type SocialSpikeDependencies = {
  runner?: MediaCommandRunner;
  createScratch?: () => Promise<string>;
  removeScratch?: (path: string) => Promise<void>;
};

/**
 * Non-shipping feasibility harness. It deliberately does not write project,
 * transcript, clip, queue, or authoring records.
 */
export async function runSocialAcquisitionSpike(
  input: SocialSpikeInput,
  dependencies: SocialSpikeDependencies = {},
): Promise<SocialSpikeResult> {
  if (!input.authorizationConfirmed || !input.rightsCleared) {
    throw spikeError(
      "social_spike_authorization_required",
      "Explicit rights clearance and authorization are required.",
    );
  }
  const identity = normalizeSocialSpikeUrl(input.platform, input.url);
  const runner = dependencies.runner ?? new SpawnMediaCommandRunner();
  const createScratch = dependencies.createScratch ?? createPrivateScratch;
  const removeScratch =
    dependencies.removeScratch ??
    ((path: string) => rm(path, { recursive: true, force: true }));
  const ytDlpPath = input.ytDlpPath ?? "yt-dlp";
  const ffprobePath = input.ffprobePath ?? "ffprobe";
  let scratch: string | undefined;
  let result: Omit<SocialSpikeResult, "cleanup"> | undefined;
  try {
    scratch = await createScratch();
    const version = await runner.run(ytDlpPath, ["--version"], {
      timeoutMs: 10_000,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const metadataResult = await runner.run(
      ytDlpPath,
      [
        "--no-config",
        "--no-playlist",
        "--no-cookies",
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        "--",
        identity.canonicalUrl,
      ],
      {
        timeoutMs: 120_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const metadata = sanitizeMetadata(
      metadataResult.stdout,
      identity.providerMediaId,
    );
    const outputTemplate = join(scratch, "source.%(ext)s");
    await runner.run(
      ytDlpPath,
      [
        "--no-config",
        "--no-playlist",
        "--no-cookies",
        "--no-progress",
        "--max-filesize",
        "1G",
        "--format",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--output",
        outputTemplate,
        "--",
        identity.canonicalUrl,
      ],
      {
        timeoutMs: 15 * 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const mediaPath = await findSingleMedia(scratch);
    const mediaStat = await stat(mediaPath);
    if (
      !mediaStat.isFile() ||
      mediaStat.size <= 0 ||
      mediaStat.size > 1024 ** 3
    ) {
      throw spikeError(
        "social_spike_media_invalid",
        "Acquired media was invalid.",
      );
    }
    const probe = await runner.run(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name",
        "-of",
        "json",
        "--",
        mediaPath,
      ],
      {
        timeoutMs: 30_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const inspection = sanitizeProbe(probe.stdout);
    result = {
      status: "passed",
      platform: input.platform,
      providerMediaId: identity.providerMediaId,
      canonicalUrlOrigin: new URL(identity.canonicalUrl).origin,
      ytDlpVersion: version.stdout.trim().slice(0, 80),
      metadata,
      media: {
        byteSize: mediaStat.size,
        contentSha256: await hashFile(mediaPath),
        ...inspection,
      },
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw spikeError("social_spike_canceled", "The spike was canceled.");
    }
    throw classifySpikeFailure(error);
  } finally {
    if (scratch) {
      try {
        await removeScratch(scratch);
      } catch {
        throw spikeError(
          "social_spike_cleanup_failed",
          "Spike scratch cleanup failed.",
        );
      }
    }
  }
  if (!result) throw spikeError("social_spike_failed", "The spike failed.");
  return { ...result, cleanup: { scratchRemoved: true } };
}

export function normalizeSocialSpikeUrl(
  platform: SocialSpikePlatform,
  input: string,
) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw spikeError("social_spike_url_invalid", "Enter a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw spikeError(
      "social_spike_url_invalid",
      "The test URL must use HTTPS.",
    );
  }
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  let providerMediaId: string | undefined;
  if (platform === "tiktok" && host === "tiktok.com") {
    providerMediaId = url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/u)?.[1];
  }
  if (platform === "instagram" && host === "instagram.com") {
    providerMediaId = url.pathname.match(
      /^\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)\/?$/u,
    )?.[1];
  }
  if (platform === "facebook" && host === "facebook.com") {
    providerMediaId =
      (url.pathname.match(/^\/watch\/?$/u)
        ? url.searchParams.get("v")?.match(/^\d+$/u)?.[0]
        : undefined) ??
      url.pathname.match(/^\/reel\/(\d+)\/?$/u)?.[1] ??
      url.pathname.match(/^\/[^/]+\/videos\/(\d+)\/?$/u)?.[1];
  }
  if (!providerMediaId) {
    const expectedUrl =
      platform === "tiktok"
        ? "TikTok video"
        : platform === "instagram"
          ? "Instagram post or reel"
          : "Facebook watch, reel, or video";
    throw spikeError(
      "social_spike_url_invalid",
      `Enter a canonical public ${expectedUrl} URL.`,
    );
  }
  if (platform === "facebook") {
    return {
      providerMediaId,
      canonicalUrl: `https://www.facebook.com/watch/?v=${providerMediaId}`,
    };
  }
  url.search = "";
  url.hash = "";
  return { providerMediaId, canonicalUrl: url.toString() };
}

function sanitizeMetadata(raw: string, expectedId: string) {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw spikeError(
      "social_spike_metadata_malformed",
      "Metadata was malformed.",
    );
  }
  const extractedId = typeof value.id === "string" ? value.id : "";
  if (!extractedId || extractedId !== expectedId) {
    throw spikeError(
      "social_spike_identity_mismatch",
      "Provider metadata did not match the requested stable media ID.",
    );
  }
  const subtitles = languageKeys(value.subtitles);
  const automatic = languageKeys(value.automatic_captions);
  return {
    ...(typeof value.title === "string" && value.title.trim()
      ? { title: value.title.trim().slice(0, 500) }
      : {}),
    ...(typeof value.uploader === "string" && value.uploader.trim()
      ? { creator: value.uploader.trim().slice(0, 300) }
      : {}),
    ...(typeof value.duration === "number" && value.duration >= 0
      ? { durationMs: Math.round(value.duration * 1_000) }
      : {}),
    thumbnailDiscovered:
      typeof value.thumbnail === "string" &&
      value.thumbnail.startsWith("https://"),
    manualCaptionLanguages: subtitles,
    automaticCaptionLanguages: automatic,
  };
}

function languageKeys(value: unknown) {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => /^[A-Za-z0-9_-]{1,35}$/u.test(key))
    .sort()
    .slice(0, 100);
}

async function findSingleMedia(scratch: string) {
  const files = (await readdir(scratch)).filter((name) =>
    /^source\.[A-Za-z0-9]+$/u.test(name),
  );
  if (files.length !== 1) {
    throw spikeError(
      "social_spike_media_invalid",
      "Acquisition did not produce exactly one source file.",
    );
  }
  return join(scratch, files[0]!);
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sanitizeProbe(raw: string) {
  let value: {
    format?: Record<string, unknown>;
    streams?: Array<Record<string, unknown>>;
  };
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    throw spikeError(
      "social_spike_probe_malformed",
      "FFprobe output was malformed.",
    );
  }
  const video = value.streams?.find((stream) => stream.codec_type === "video");
  const audio = value.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(value.format?.duration);
  if (!video || !audio || !Number.isFinite(duration) || duration <= 0) {
    throw spikeError(
      "social_spike_probe_invalid",
      "Media did not contain valid video and audio.",
    );
  }
  return {
    ...(typeof value.format?.format_name === "string"
      ? { container: value.format.format_name.slice(0, 100) }
      : {}),
    ...(typeof video.codec_name === "string"
      ? { videoCodec: video.codec_name.slice(0, 100) }
      : {}),
    ...(typeof audio.codec_name === "string"
      ? { audioCodec: audio.codec_name.slice(0, 100) }
      : {}),
    durationMs: Math.round(duration * 1_000),
  };
}

function classifySpikeFailure(error: unknown) {
  if (error instanceof Error && "code" in error) return error;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = /login|sign in|cookies|private/u.test(message)
    ? "social_spike_auth_required"
    : /region|geo/u.test(message)
      ? "social_spike_region_restricted"
      : /age/u.test(message)
        ? "social_spike_age_restricted"
        : /removed|unavailable|not available/u.test(message)
          ? "social_spike_unavailable"
          : "social_spike_provider_failed";
  return spikeError(
    code,
    "The provider could not acquire this authorized source.",
  );
}

function spikeError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function createPrivateScratch() {
  const path = await mkdtemp(join(tmpdir(), "research-video-social-spike-"));
  await chmod(path, 0o700);
  return path;
}

export function parseSocialSpikeCommandLine(argv: readonly string[]) {
  const values = new Map<string, string>();
  let authorizationConfirmed = false;
  let rightsCleared = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--authorization-confirmed") authorizationConfirmed = true;
    else if (argument === "--rights-cleared") rightsCleared = true;
    else if (
      ["--platform", "--url", "--yt-dlp", "--ffprobe"].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || values.has(argument))
        throw spikeError(
          "social_spike_arguments_invalid",
          "Invalid spike arguments.",
        );
      values.set(argument, value);
      index += 1;
    } else
      throw spikeError(
        "social_spike_arguments_invalid",
        "Invalid spike arguments.",
      );
  }
  const platform = values.get("--platform");
  const url = values.get("--url");
  if (
    !isSocialSpikePlatform(platform) ||
    !url ||
    !authorizationConfirmed ||
    !rightsCleared
  ) {
    throw spikeError(
      "social_spike_arguments_invalid",
      "Platform, URL, rights clearance, and authorization are required.",
    );
  }
  return {
    platform,
    url,
    authorizationConfirmed: true as const,
    rightsCleared: true as const,
    ...(values.get("--yt-dlp") ? { ytDlpPath: values.get("--yt-dlp")! } : {}),
    ...(values.get("--ffprobe")
      ? { ffprobePath: values.get("--ffprobe")! }
      : {}),
  };
}

function isSocialSpikePlatform(
  value: string | undefined,
): value is SocialSpikePlatform {
  return value === "tiktok" || value === "instagram" || value === "facebook";
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    const parsed = parseSocialSpikeCommandLine(process.argv.slice(2));
    const result = await runSocialAcquisitionSpike({
      ...parsed,
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", code: (error as { code?: string }).code ?? "social_spike_failed" })}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
