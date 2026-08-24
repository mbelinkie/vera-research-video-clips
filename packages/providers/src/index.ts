import {
  SourceIdentityV1Schema,
  SourceSearchCandidateSchema,
  TranscriptSourcePlanSchema,
  languagesEquivalent,
  normalizeLanguageTag,
  type BatchSourcePolicy,
  type CaptionTrackCandidate,
  type LanguageCapabilityResult,
  type LanguageDecisionSnapshot,
  type NormalizedTranscript,
  type SourceCapabilityState,
  type SourceIdentityV1,
  type SourceProvider,
  type SourceSearchCandidate,
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

export type SourceSearchInput = {
  query: string;
  pageSize: number;
  cursor?: string;
  signal?: AbortSignal;
};

export type SourceSearchPage = {
  candidates: SourceSearchCandidate[];
  nextCursor?: string;
};

export interface SourceSearchProvider {
  readonly provider: SourceProvider;
  search(input: SourceSearchInput): Promise<SourceSearchPage>;
}

export class SourceSearchProviderError extends Error {
  constructor(
    message: string,
    readonly state: Exclude<SourceCapabilityState, "available"> | "failed",
  ) {
    super(message);
  }
}

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
  /**
   * Answers only from the adapter's pinned capability metadata.  Implementations
   * must not acquire media or start a recognition command for this preflight.
   */
  checkLanguageSupport?(language: string): LanguageCapabilityResult;
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
  /**
   * Answers only from the adapter's pinned capability metadata.  Implementations
   * must not send transcript text to a remote translation provider here.
   */
  checkLanguagePair?(
    sourceLanguage: string,
    targetLanguage: string,
  ): LanguageCapabilityResult;
  translate(input: TranslationRequest): Promise<TranslationResult>;
}

/**
 * Provider-reported caption language is evidence, not a label callers may
 * overwrite. This pure gate preserves the selected candidate exactly when it
 * is usable and rejects conflicting evidence before caption acquisition.
 */
export type CaptionLanguageGateInput = {
  track: CaptionTrackCandidate;
  creatorLanguage?: string;
  confirmedDecision?: LanguageDecisionSnapshot;
};

export type CaptionLanguageGateResult =
  | {
      state: "accepted";
      track: CaptionTrackCandidate;
      providerLanguage: string;
      resolvedLanguage: string;
    }
  | {
      state: "conflict";
      track: CaptionTrackCandidate;
      providerLanguage: string;
      creatorLanguage?: string;
      confirmedLanguage?: string;
      reason:
        | "provider_creator_language_conflict"
        | "provider_confirmed_language_conflict";
    };

export function gateCaptionLanguage(
  input: CaptionLanguageGateInput,
): CaptionLanguageGateResult {
  const providerLanguage = normalizeLanguageTag(input.track.language);
  const creatorLanguage = input.creatorLanguage
    ? normalizeLanguageTag(input.creatorLanguage)
    : undefined;
  const confirmedLanguage =
    input.confirmedDecision?.status === "confirmed" &&
    input.confirmedDecision.resolvedLanguage
      ? normalizeLanguageTag(input.confirmedDecision.resolvedLanguage)
      : undefined;

  if (
    confirmedLanguage &&
    !languagesEquivalent(providerLanguage, confirmedLanguage)
  ) {
    return {
      state: "conflict",
      track: input.track,
      providerLanguage,
      ...(creatorLanguage ? { creatorLanguage } : {}),
      confirmedLanguage,
      reason: "provider_confirmed_language_conflict",
    };
  }
  if (
    !confirmedLanguage &&
    creatorLanguage &&
    !languagesEquivalent(providerLanguage, creatorLanguage)
  ) {
    return {
      state: "conflict",
      track: input.track,
      providerLanguage,
      creatorLanguage,
      ...(confirmedLanguage ? { confirmedLanguage } : {}),
      reason: "provider_creator_language_conflict",
    };
  }

  return {
    state: "accepted",
    track: input.track,
    providerLanguage,
    resolvedLanguage: confirmedLanguage ?? creatorLanguage ?? providerLanguage,
  };
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

export function youtubeSourceIdentity(input: string): SourceIdentityV1 {
  const normalizedVideo = normalizeYouTubeUrl(input);
  return SourceIdentityV1Schema.parse({
    schemaVersion: 1,
    provider: "youtube",
    providerMediaId: normalizedVideo.videoId,
    canonicalUrl: normalizedVideo.canonicalUrl,
  });
}

/** Product-qualified normalization currently supports YouTube only. Future
 * adapters extend this switch without leaking provider parsing into business
 * logic. */
export function normalizeSourceUrl(input: string): SourceIdentityV1 {
  return youtubeSourceIdentity(input);
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

type YouTubeSearchPayload = {
  nextPageToken?: unknown;
  items?: unknown;
};

/** Official YouTube Data API v3 search adapter. Credentials stay in this
 * backend-only adapter and neither raw responses nor query text are logged. */
export class YouTubeDataApiSearchProvider implements SourceSearchProvider {
  readonly provider = "youtube" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = "https://www.googleapis.com/youtube/v3/search",
  ) {
    if (!apiKey.trim()) throw new Error("A YouTube Data API key is required.");
  }

  async search(input: SourceSearchInput): Promise<SourceSearchPage> {
    const query = input.query.trim();
    if (!query || query.length > 500) {
      throw new SourceSearchProviderError(
        "Enter a search query between 1 and 500 characters.",
        "unavailable",
      );
    }
    const pageSize = Math.max(1, Math.min(25, Math.trunc(input.pageSize)));
    const url = new URL(this.endpoint);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(pageSize));
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoSyndicated", "true");
    url.searchParams.set("key", this.apiKey);
    if (input.cursor) url.searchParams.set("pageToken", input.cursor);

    const response = await this.fetcher(url, {
      headers: { accept: "application/json" },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!response.ok) {
      throw await mapYouTubeSearchFailure(response);
    }

    let payload: YouTubeSearchPayload;
    try {
      payload = (await response.json()) as YouTubeSearchPayload;
    } catch {
      throw new SourceSearchProviderError(
        "YouTube search returned an unreadable response.",
        "failed",
      );
    }
    if (!Array.isArray(payload.items)) {
      throw new SourceSearchProviderError(
        "YouTube search returned a malformed response.",
        "failed",
      );
    }

    const candidates = payload.items
      .map((item, resultPosition) =>
        normalizeYouTubeSearchItem(item, resultPosition),
      )
      .filter((item): item is SourceSearchCandidate => item !== undefined);
    const nextCursor =
      typeof payload.nextPageToken === "string" && payload.nextPageToken
        ? payload.nextPageToken
        : undefined;
    return {
      candidates,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }
}

function normalizeYouTubeSearchItem(
  value: unknown,
  resultPosition: number,
): SourceSearchCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const id = item.id as Record<string, unknown> | undefined;
  const snippet = item.snippet as Record<string, unknown> | undefined;
  const videoId = typeof id?.videoId === "string" ? id.videoId : "";
  const title = typeof snippet?.title === "string" ? snippet.title.trim() : "";
  if (!youtubeIdPattern.test(videoId) || !title) return undefined;
  const thumbnails = snippet?.thumbnails as Record<string, unknown> | undefined;
  const thumbnail = ["high", "medium", "default"]
    .map((key) => thumbnails?.[key])
    .find((entry) => entry && typeof entry === "object") as
    Record<string, unknown> | undefined;
  const thumbnailUrl =
    typeof thumbnail?.url === "string" ? thumbnail.url : undefined;
  const creator =
    typeof snippet?.channelTitle === "string" && snippet.channelTitle.trim()
      ? snippet.channelTitle.trim()
      : undefined;
  const publishedAt =
    typeof snippet?.publishedAt === "string" &&
    !Number.isNaN(Date.parse(snippet.publishedAt))
      ? new Date(snippet.publishedAt).toISOString()
      : undefined;
  const sourceIdentity = youtubeSourceIdentity(videoId);
  const candidate = {
    sourceIdentity,
    title: decodeYouTubeText(title),
    ...(creator ? { creator: decodeYouTubeText(creator) } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    availability: "available" as const,
    provenance: { provider: "youtube" as const, resultPosition },
  };
  const parsed = SourceSearchCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function mapYouTubeSearchFailure(
  response: Response,
): Promise<SourceSearchProviderError> {
  let reasons: string[] = [];
  try {
    const body = (await response.json()) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    reasons = (body.error?.errors ?? [])
      .map((entry) => entry.reason)
      .filter((reason): reason is string => typeof reason === "string");
  } catch {
    // Status remains sufficient; never include the raw provider response.
  }
  if (
    response.status === 429 ||
    reasons.some((reason) =>
      ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(
        reason,
      ),
    )
  ) {
    return new SourceSearchProviderError(
      "YouTube search quota is currently exhausted. Try again later.",
      "quota-limited",
    );
  }
  if (
    response.status === 401 ||
    reasons.some((reason) =>
      [
        "keyInvalid",
        "ipRefererBlocked",
        "accessNotConfigured",
        "forbidden",
      ].includes(reason),
    )
  ) {
    return new SourceSearchProviderError(
      "YouTube search credentials are not authorized.",
      "auth-required",
    );
  }
  return new SourceSearchProviderError(
    `YouTube search is temporarily unavailable (${response.status}).`,
    "unavailable",
  );
}

function decodeYouTubeText(value: string) {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
  };
  return value.replace(
    /&(amp|quot|#39|lt|gt);/gu,
    (entity) => entities[entity] ?? entity,
  );
}
