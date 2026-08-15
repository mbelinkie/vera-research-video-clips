import {
  TranscriptSourcePlanSchema,
  type BatchSourcePolicy,
  type CaptionTrackCandidate,
  type NormalizedTranscript,
  type TranscriptSourcePlan,
} from "@research-video/contracts";
import { normalizeTranslatedTranscript } from "@research-video/transcript";

export type VideoMetadata = {
  videoId: string;
  title: string;
  channel?: string;
  durationMs?: number;
  sourceLanguage?: string;
};

export type NormalizedYouTubeVideo = {
  videoId: string;
  canonicalUrl: string;
};

export class InvalidYouTubeUrlError extends Error {
  readonly statusCode = 400;
  readonly code = "invalid_youtube_url";
}

export interface VideoMetadataProvider {
  resolve(videoId: string): Promise<VideoMetadata>;
}

export interface CaptionDiscoveryProvider {
  discover(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<CaptionTrackCandidate[]>;
}

export type AcquiredCaption = {
  videoId: string;
  track: CaptionTrackCandidate;
  path: string;
  format: "vtt";
  byteSize: number;
  provider: string;
};

export interface CaptionAcquisitionProvider {
  acquire(
    videoId: string,
    track: CaptionTrackCandidate,
    scratchDirectory: string,
    signal?: AbortSignal,
  ): Promise<AcquiredCaption>;
}

export interface CaptionProvider
  extends CaptionDiscoveryProvider, CaptionAcquisitionProvider {}

export class ProviderExecutionError extends Error {
  readonly code = "provider_execution_failed";
  readonly retryable = true;
}

export type TranscriptSourceSelectionOptions = {
  targetLanguage: string;
  sourceLanguage?: string;
  sourcePolicy: BatchSourcePolicy;
};

export class TranscriptSourceResolver {
  constructor(private readonly captions: CaptionDiscoveryProvider) {}

  async resolve(
    videoId: string,
    options: TranscriptSourceSelectionOptions,
    signal?: AbortSignal,
  ): Promise<TranscriptSourcePlan> {
    const tracks = await this.captions.discover(videoId, signal);
    return selectTranscriptSource(tracks, options);
  }
}

export type AcquiredTranscriptSource =
  | {
      plan: Extract<TranscriptSourcePlan, { strategy: "caption" }>;
      caption: AcquiredCaption;
    }
  | {
      plan: Extract<TranscriptSourcePlan, { strategy: "speech-to-text" }>;
    };

export class TranscriptSourceAcquirer {
  readonly #resolver: TranscriptSourceResolver;

  constructor(private readonly captions: CaptionProvider) {
    this.#resolver = new TranscriptSourceResolver(captions);
  }

  async resolveAndAcquire(
    videoId: string,
    options: TranscriptSourceSelectionOptions,
    scratchDirectory: string,
    signal?: AbortSignal,
  ): Promise<AcquiredTranscriptSource> {
    const plan = await this.#resolver.resolve(videoId, options, signal);
    if (plan.strategy === "speech-to-text") return { plan };
    const caption = await this.captions.acquire(
      videoId,
      plan.track,
      scratchDirectory,
      signal,
    );
    return { plan, caption };
  }
}

export function selectTranscriptSource(
  tracks: readonly CaptionTrackCandidate[],
  options: TranscriptSourceSelectionOptions,
): TranscriptSourcePlan {
  if (options.sourcePolicy === "force-generate") {
    return generatedPlan(options.targetLanguage, "forced-generation");
  }
  const available = tracks.filter(
    (track) => track.downloadAccess === "available",
  );
  if (available.length === 0) {
    return generatedPlan(
      options.targetLanguage,
      tracks.length === 0
        ? "no-caption-tracks"
        : "no-downloadable-caption-tracks",
    );
  }
  const ranked = [...available].sort(
    (left, right) =>
      captionRank(left, options) - captionRank(right, options) ||
      left.language.localeCompare(right.language) ||
      left.id.localeCompare(right.id),
  );
  const track = ranked[0]!;
  const targetMatch = sameLanguage(track.language, options.targetLanguage);
  return TranscriptSourcePlanSchema.parse({
    strategy: "caption",
    track,
    sourceLanguage: track.language,
    targetLanguage: options.targetLanguage,
    requiresTranslation: !targetMatch,
    reason: targetMatch
      ? track.kind === "manual"
        ? "manual-target-language"
        : "automatic-target-language"
      : track.kind === "manual"
        ? "manual-original-language"
        : "automatic-original-language",
  });
}

function captionRank(
  track: CaptionTrackCandidate,
  options: TranscriptSourceSelectionOptions,
) {
  const targetMatch = sameLanguage(track.language, options.targetLanguage);
  const sourceMatch = options.sourceLanguage
    ? sameLanguage(track.language, options.sourceLanguage)
    : false;
  const category = targetMatch
    ? track.kind === "manual"
      ? 0
      : 1
    : track.kind === "manual"
      ? 2
      : 3;
  const exactTarget =
    normalizeLanguage(track.language) ===
    normalizeLanguage(options.targetLanguage);
  return (
    category * 10 +
    (targetMatch && !exactTarget ? 1 : 0) +
    (sourceMatch ? 0 : 2)
  );
}

function sameLanguage(left: string, right: string) {
  return primaryLanguage(left) === primaryLanguage(right);
}

function primaryLanguage(language: string) {
  return normalizeLanguage(language).split("-")[0];
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase().replaceAll("_", "-");
}

function generatedPlan(
  targetLanguage: string,
  reason:
    | "forced-generation"
    | "no-caption-tracks"
    | "no-downloadable-caption-tracks"
    | "caption-acquisition-failed",
): TranscriptSourcePlan {
  return TranscriptSourcePlanSchema.parse({
    strategy: "speech-to-text",
    targetLanguage,
    requiresLanguageDetection: true,
    reason,
  });
}

export interface SpeechToTextProvider {
  transcribe(input: {
    videoId: string;
    inputPath: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<NormalizedTranscript>;
}

export type TranslationRequest = {
  sourceLanguage: string;
  targetLanguage: string;
  segments: ReadonlyArray<{ id: string; text: string }>;
  signal?: AbortSignal;
};

export type TranslationResult = {
  provider: string;
  model?: string;
  segments: Array<{ sourceSegmentId: string; text: string }>;
};

export interface TranslationProvider {
  translate(input: TranslationRequest): Promise<TranslationResult>;
}

export async function translateCanonicalTranscript(
  provider: TranslationProvider,
  sourceTranscript: NormalizedTranscript,
  targetLanguage = "en",
  signal?: AbortSignal,
): Promise<NormalizedTranscript> {
  const translated = await provider.translate({
    sourceLanguage: sourceTranscript.track.language,
    targetLanguage,
    segments: sourceTranscript.segments.map(({ id, text }) => ({ id, text })),
    ...(signal ? { signal } : {}),
  });
  return normalizeTranslatedTranscript({
    sourceTranscript,
    targetLanguage,
    provider: translated.provider,
    ...(translated.model ? { model: translated.model } : {}),
    translations: translated.segments,
  });
}

export interface AlignmentProvider {
  align(input: unknown, mediaPath: string): Promise<unknown>;
}

const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function normalizeYouTubeUrl(input: string): NormalizedYouTubeVideo {
  const candidate = input.trim();
  if (youtubeIdPattern.test(candidate)) return normalized(candidate);

  let url: URL;
  try {
    url = new URL(
      /^(?:https?:)?\/\//i.test(candidate)
        ? candidate.startsWith("//")
          ? `https:${candidate}`
          : candidate
        : `https://${candidate}`,
    );
  } catch {
    throw new InvalidYouTubeUrlError("Enter a valid YouTube video URL.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let videoId: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (youtubeHosts.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? ""))
      videoId = parts[1] ?? null;
  }

  if (!videoId || !youtubeIdPattern.test(videoId)) {
    throw new InvalidYouTubeUrlError(
      "Enter a YouTube watch, short, live, embed, youtu.be URL, or video ID.",
    );
  }
  return normalized(videoId);
}

function normalized(videoId: string): NormalizedYouTubeVideo {
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export class YouTubeOEmbedMetadataProvider implements VideoMetadataProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = "https://www.youtube.com/oembed",
  ) {}

  async resolve(videoId: string): Promise<VideoMetadata> {
    if (!youtubeIdPattern.test(videoId)) {
      throw new InvalidYouTubeUrlError("Invalid YouTube video ID.");
    }
    const url = new URL(this.endpoint);
    url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
    url.searchParams.set("format", "json");
    const response = await this.fetcher(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`YouTube metadata lookup failed (${response.status}).`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const channel =
      typeof payload.author_name === "string"
        ? payload.author_name.trim()
        : undefined;
    if (!title) throw new Error("YouTube metadata response omitted the title.");
    return {
      videoId,
      title,
      ...(channel ? { channel } : {}),
    };
  }
}
