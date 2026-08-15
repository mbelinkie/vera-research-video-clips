import {
  NormalizedTranscriptSchema,
  TranscriptSelectionSchema,
  type NormalizedTranscript,
  type TranscriptSegment,
  type TranscriptSelection,
  type TranscriptToken,
  type TranscriptTrack,
} from "@research-video/contracts";

export type { TranscriptSegment, TranscriptToken, TranscriptTrack };

export class TranslationNormalizationError extends Error {
  readonly code = "invalid_translation";
  readonly retryable = false;
}

export type TranslatedSegmentText = {
  sourceSegmentId: string;
  text: string;
};

export type GeneratedTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export async function normalizeGeneratedTranscript(input: {
  videoId: string;
  language: string;
  provider: string;
  model: string;
  segments: readonly GeneratedTranscriptSegment[];
  schemaVersion?: number;
  version?: number;
}): Promise<NormalizedTranscript> {
  const canonicalSegments = input.segments.map((segment, ordinal) => ({
    ordinal,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text.trim(),
  }));
  const contentSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonicalSegments)),
  );
  const trackId = await stableUuid(
    `generated-track:${input.videoId}:${input.language}:${input.provider}:${input.model}:${contentSha256}`,
  );
  const segments = await Promise.all(
    canonicalSegments.map(async (segment) => ({
      id: await stableUuid(
        `generated-segment:${trackId}:${segment.ordinal}:${segment.startMs}:${segment.endMs}:${segment.text}`,
      ),
      trackId,
      ...segment,
    })),
  );
  const tokens = (
    await Promise.all(
      segments.map(async (segment) =>
        Promise.all(
          (segment.text.match(/\S+/gu) ?? []).map(async (text, ordinal) => ({
            id: await stableUuid(
              `generated-token:${segment.id}:${ordinal}:${text}`,
            ),
            segmentId: segment.id,
            ordinal,
            text,
          })),
        ),
      ),
    )
  ).flat();
  const transcript = NormalizedTranscriptSchema.parse({
    track: {
      id: trackId,
      videoId: input.videoId,
      language: input.language,
      kind: primaryLanguage(input.language) === "en" ? "english" : "original",
      source: "generated",
      provider: input.provider,
      model: input.model,
      timingPrecision: "cue",
      schemaVersion: input.schemaVersion ?? 1,
      contentSha256,
      version: input.version ?? 1,
    },
    segments,
    tokens,
  });
  assertOrdered(transcript.segments);
  return transcript;
}

export async function normalizeTranslatedTranscript(input: {
  sourceTranscript: NormalizedTranscript;
  targetLanguage: string;
  provider: string;
  model?: string;
  translations: readonly TranslatedSegmentText[];
  schemaVersion?: number;
  version?: number;
}): Promise<NormalizedTranscript> {
  const source = NormalizedTranscriptSchema.parse(input.sourceTranscript);
  if (
    primaryLanguage(source.track.language) ===
    primaryLanguage(input.targetLanguage)
  ) {
    throw new TranslationNormalizationError(
      "Translation source and target languages must be different.",
    );
  }

  const translatedBySourceId = new Map<string, string>();
  for (const translation of input.translations) {
    if (translatedBySourceId.has(translation.sourceSegmentId)) {
      throw new TranslationNormalizationError(
        `Translation repeated source segment ${translation.sourceSegmentId}.`,
      );
    }
    const text = translation.text.trim();
    if (!text) {
      throw new TranslationNormalizationError(
        `Translation for source segment ${translation.sourceSegmentId} is empty.`,
      );
    }
    translatedBySourceId.set(translation.sourceSegmentId, text);
  }
  if (translatedBySourceId.size !== source.segments.length) {
    throw new TranslationNormalizationError(
      "Translation must contain exactly one result for every source segment.",
    );
  }

  const canonicalSegments = source.segments.map((segment) => {
    const text = translatedBySourceId.get(segment.id);
    if (!text) {
      throw new TranslationNormalizationError(
        `Translation omitted source segment ${segment.id}.`,
      );
    }
    return {
      sourceSegmentId: segment.id,
      ordinal: segment.ordinal,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text,
    };
  });
  const contentSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonicalSegments)),
  );
  const trackId = await stableUuid(
    `translated-track:${source.track.id}:${input.targetLanguage}:${input.provider}:${input.model ?? "default"}:${contentSha256}`,
  );
  const segments = await Promise.all(
    canonicalSegments.map(async (segment) => ({
      id: await stableUuid(
        `translated-segment:${trackId}:${segment.sourceSegmentId}:${segment.text}`,
      ),
      trackId,
      ordinal: segment.ordinal,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  );
  const tokens = (
    await Promise.all(
      segments.map(async (segment) =>
        Promise.all(
          (segment.text.match(/\S+/gu) ?? []).map(async (text, ordinal) => ({
            id: await stableUuid(
              `translated-token:${segment.id}:${ordinal}:${text}`,
            ),
            segmentId: segment.id,
            ordinal,
            text,
          })),
        ),
      ),
    )
  ).flat();

  return NormalizedTranscriptSchema.parse({
    track: {
      id: trackId,
      videoId: source.track.videoId,
      language: input.targetLanguage,
      kind:
        primaryLanguage(input.targetLanguage) === "en" ? "english" : "original",
      source: "translated",
      provider: input.provider,
      ...(input.model ? { model: input.model } : {}),
      sourceTrackId: source.track.id,
      timingPrecision: "cue",
      schemaVersion: input.schemaVersion ?? source.track.schemaVersion,
      contentSha256,
      version: input.version ?? 1,
    },
    segments,
    tokens,
  });
}

type TranscriptFixture = {
  track: TranscriptTrack;
  segments: Array<Omit<TranscriptSegment, "trackId"> & { trackId?: string }>;
  tokens?: TranscriptToken[];
};

export function normalizeTranscriptFixture(
  input: unknown,
): NormalizedTranscript {
  const fixture = input as TranscriptFixture;
  const normalized = NormalizedTranscriptSchema.parse({
    track: fixture.track,
    segments: fixture.segments.map((segment) => ({
      ...segment,
      trackId: segment.trackId ?? fixture.track.id,
    })),
    tokens: fixture.tokens ?? [],
  });
  assertOrdered(normalized.segments);
  return normalized;
}

export class WebVttNormalizationError extends Error {
  readonly code = "invalid_webvtt";
  readonly retryable = false;
}

export type WebVttNormalizationInput = {
  contents: string | Uint8Array;
  videoId: string;
  language: string;
  source: "youtube-manual" | "youtube-auto";
  provider: string;
  schemaVersion?: number;
  version?: number;
};

type ParsedCue = {
  inputOrdinal: number;
  startMs: number;
  endMs: number;
  text: string;
};

const maxWebVttBytes = 20 * 1024 * 1024;
const maxWebVttCues = 100_000;

export async function normalizeWebVttCaption(
  input: WebVttNormalizationInput,
): Promise<NormalizedTranscript> {
  const contents = decodeWebVtt(input.contents);
  const cues = parseWebVtt(contents).toSorted(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.inputOrdinal - right.inputOrdinal,
  );
  const canonicalCues = cues.map(({ startMs, endMs, text }) => ({
    startMs,
    endMs,
    text,
  }));
  const contentSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonicalCues)),
  );
  const trackId = await stableUuid(
    `track:${input.videoId}:${input.language}:${input.source}:${input.provider}:${contentSha256}`,
  );
  const segments = await Promise.all(
    canonicalCues.map(async (cue, ordinal) => ({
      id: await stableUuid(
        `segment:${trackId}:${ordinal}:${cue.startMs}:${cue.endMs}:${cue.text}`,
      ),
      trackId,
      ordinal,
      ...cue,
    })),
  );
  const tokens = (
    await Promise.all(
      segments.map(async (segment) => {
        const words = segment.text.match(/\S+/gu) ?? [];
        return Promise.all(
          words.map(async (text, ordinal) => ({
            id: await stableUuid(`token:${segment.id}:${ordinal}:${text}`),
            segmentId: segment.id,
            ordinal,
            text,
          })),
        );
      }),
    )
  ).flat();
  const transcript = NormalizedTranscriptSchema.parse({
    track: {
      id: trackId,
      videoId: input.videoId,
      language: input.language,
      kind: primaryLanguage(input.language) === "en" ? "english" : "original",
      source: input.source,
      provider: input.provider,
      timingPrecision: "cue",
      schemaVersion: input.schemaVersion ?? 1,
      contentSha256,
      version: input.version ?? 1,
    },
    segments,
    tokens,
  });
  assertOrdered(transcript.segments);
  return transcript;
}

export function segmentAtTime(
  segments: readonly TranscriptSegment[],
  currentMs: number,
): TranscriptSegment | undefined {
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (!segment) return undefined;
    if (currentMs < segment.startMs) high = middle - 1;
    else if (currentMs >= segment.endMs) low = middle + 1;
    else return segment;
  }

  return undefined;
}

export function searchTranscript(
  segments: readonly TranscriptSegment[],
  query: string,
): TranscriptSegment[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...segments];
  return segments.filter((segment) =>
    segment.text.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export type TranscriptSelectionBoundary = {
  segmentId: string;
  tokenId?: string;
};

export function deriveTranscriptSelection(input: {
  transcript: NormalizedTranscript;
  anchor: TranscriptSelectionBoundary;
  focus: TranscriptSelectionBoundary;
  paddingBeforeMs?: number;
  paddingAfterMs?: number;
  sourceDurationMs?: number;
}): TranscriptSelection {
  const transcript = NormalizedTranscriptSchema.parse(input.transcript);
  const paddingBeforeMs = validNonnegativeInteger(
    input.paddingBeforeMs ?? 0,
    "Selection padding before",
  );
  const paddingAfterMs = validNonnegativeInteger(
    input.paddingAfterMs ?? 0,
    "Selection padding after",
  );
  const sourceDurationMs =
    input.sourceDurationMs === undefined
      ? undefined
      : validPositiveInteger(input.sourceDurationMs, "Source duration");
  const orderedSegments = transcript.segments.toSorted(
    (left, right) => left.ordinal - right.ordinal,
  );
  const segmentIndexes = new Map(
    orderedSegments.map((segment, index) => [segment.id, index]),
  );
  const orderedTokens = orderedSegments.flatMap((segment) =>
    transcript.tokens
      .filter((token) => token.segmentId === segment.id)
      .toSorted((left, right) => left.ordinal - right.ordinal),
  );
  const tokenIndexes = new Map(
    orderedTokens.map((token, index) => [token.id, index]),
  );

  const anchor = resolveSelectionBoundary({
    boundary: input.anchor,
    segmentIndexes,
    tokenIndexes,
    tokens: orderedTokens,
  });
  const focus = resolveSelectionBoundary({
    boundary: input.focus,
    segmentIndexes,
    tokenIndexes,
    tokens: orderedTokens,
  });
  const bothBoundariesAreTokens =
    anchor.tokenIndex !== undefined && focus.tokenIndex !== undefined;
  const anchorPosition = bothBoundariesAreTokens
    ? anchor.tokenIndex!
    : anchor.segmentIndex;
  const focusPosition = bothBoundariesAreTokens
    ? focus.tokenIndex!
    : focus.segmentIndex;
  const [rawFirst, rawLast] =
    anchorPosition <= focusPosition ? [anchor, focus] : [focus, anchor];
  const first = bothBoundariesAreTokens
    ? rawFirst
    : { segmentIndex: rawFirst.segmentIndex };
  const last = bothBoundariesAreTokens
    ? rawLast
    : { segmentIndex: rawLast.segmentIndex };
  const firstSegment = orderedSegments[first.segmentIndex]!;
  const lastSegment = orderedSegments[last.segmentIndex]!;
  const firstToken =
    first.tokenIndex === undefined
      ? undefined
      : orderedTokens[first.tokenIndex];
  const lastToken =
    last.tokenIndex === undefined ? undefined : orderedTokens[last.tokenIndex];
  const exactWordBounds =
    firstToken?.startMs !== undefined &&
    firstToken.endMs !== undefined &&
    lastToken?.startMs !== undefined &&
    lastToken.endMs !== undefined
      ? { startMs: firstToken.startMs, endMs: lastToken.endMs }
      : undefined;
  const transcriptStartMs = exactWordBounds?.startMs ?? firstSegment.startMs;
  const transcriptEndMs = exactWordBounds?.endMs ?? lastSegment.endMs;
  const text =
    first.tokenIndex !== undefined && last.tokenIndex !== undefined
      ? orderedTokens
          .slice(first.tokenIndex, last.tokenIndex + 1)
          .map((token) => token.text)
          .join(" ")
      : orderedSegments
          .slice(first.segmentIndex, last.segmentIndex + 1)
          .map((segment) => segment.text)
          .join(" ");
  const unboundedExportEndMs = transcriptEndMs + paddingAfterMs;

  return TranscriptSelectionSchema.parse({
    trackId: transcript.track.id,
    transcriptVersion: transcript.track.version,
    firstSegmentId: firstSegment.id,
    lastSegmentId: lastSegment.id,
    ...(firstToken ? { firstTokenId: firstToken.id } : {}),
    ...(lastToken ? { lastTokenId: lastToken.id } : {}),
    transcriptStartMs,
    transcriptEndMs,
    exportStartMs: Math.max(0, transcriptStartMs - paddingBeforeMs),
    exportEndMs:
      sourceDurationMs === undefined
        ? unboundedExportEndMs
        : Math.min(sourceDurationMs, unboundedExportEndMs),
    text,
    timingPrecision: exactWordBounds
      ? "word"
      : transcript.track.timingPrecision === "estimated"
        ? "estimated"
        : "cue",
  });
}

export function updateTranscriptSelectionExportBounds(
  selection: TranscriptSelection,
  input: {
    startMs: number;
    endMs: number;
    sourceDurationMs?: number;
  },
): TranscriptSelection {
  const startMs = validNonnegativeInteger(input.startMs, "Export start");
  const endMs = validPositiveInteger(input.endMs, "Export end");
  if (input.sourceDurationMs !== undefined) {
    const sourceDurationMs = validPositiveInteger(
      input.sourceDurationMs,
      "Source duration",
    );
    if (endMs > sourceDurationMs) {
      throw new Error("Export end cannot exceed the source duration.");
    }
  }
  return TranscriptSelectionSchema.parse({
    ...TranscriptSelectionSchema.parse(selection),
    exportStartMs: startMs,
    exportEndMs: endMs,
  });
}

type ResolvedSelectionBoundary = {
  segmentIndex: number;
  tokenIndex?: number;
};

function resolveSelectionBoundary(input: {
  boundary: TranscriptSelectionBoundary;
  segmentIndexes: ReadonlyMap<string, number>;
  tokenIndexes: ReadonlyMap<string, number>;
  tokens: readonly TranscriptToken[];
}): ResolvedSelectionBoundary {
  const segmentIndex = input.segmentIndexes.get(input.boundary.segmentId);
  if (segmentIndex === undefined) {
    throw new Error(`Unknown transcript segment ${input.boundary.segmentId}.`);
  }
  if (!input.boundary.tokenId) return { segmentIndex };
  const tokenIndex = input.tokenIndexes.get(input.boundary.tokenId);
  const token = tokenIndex === undefined ? undefined : input.tokens[tokenIndex];
  if (!token || token.segmentId !== input.boundary.segmentId) {
    throw new Error(
      `Transcript token ${input.boundary.tokenId} does not belong to segment ${input.boundary.segmentId}.`,
    );
  }
  return { segmentIndex, tokenIndex: tokenIndex! };
}

function validNonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
  return value;
}

function validPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export function transcriptToSrt(transcript: NormalizedTranscript): string {
  const normalized = NormalizedTranscriptSchema.parse(transcript);
  return normalized.segments
    .map(
      (segment, index) =>
        `${index + 1}\n${srtTimestamp(segment.startMs)} --> ${srtTimestamp(segment.endMs)}\n${segment.text}\n`,
    )
    .join("\n");
}

export function timedTranscriptTokens(
  tokens: readonly TranscriptToken[],
): Array<TranscriptToken & { startMs: number; endMs: number }> {
  return tokens
    .filter(
      (token): token is TranscriptToken & { startMs: number; endMs: number } =>
        token.startMs !== undefined && token.endMs !== undefined,
    )
    .toSorted((left, right) => left.startMs - right.startMs);
}

export function tokenAtTime(
  tokens: readonly (TranscriptToken & { startMs: number; endMs: number })[],
  currentMs: number,
): (TranscriptToken & { startMs: number; endMs: number }) | undefined {
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const token = tokens[middle];
    if (!token) return undefined;
    if (currentMs < token.startMs) high = middle - 1;
    else if (currentMs >= token.endMs) low = middle + 1;
    else return token;
  }
  return undefined;
}

export type VirtualWindow = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
};

export function transcriptVirtualWindow(input: {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
}): VirtualWindow {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const rowHeight = Math.max(1, input.rowHeight);
  const overscan = Math.max(0, Math.floor(input.overscan ?? 5));
  const firstVisible = Math.floor(Math.max(0, input.scrollTop) / rowHeight);
  const visibleCount = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight);
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscan);
  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    totalHeight: itemCount * rowHeight,
  };
}

function assertOrdered(segments: readonly TranscriptSegment[]) {
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]!;
    const previous = segments[index - 1];
    if (current.ordinal !== index) {
      throw new Error("Transcript segment ordinals must be contiguous.");
    }
    if (previous && current.startMs < previous.startMs) {
      throw new Error("Transcript segments must be ordered by source time.");
    }
  }
}

function srtTimestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis
    .toString()
    .padStart(3, "0")}`;
}

function decodeWebVtt(input: string | Uint8Array) {
  const byteLength =
    typeof input === "string"
      ? new TextEncoder().encode(input).byteLength
      : input.byteLength;
  if (byteLength > maxWebVttBytes) {
    throw new WebVttNormalizationError("WebVTT input exceeds the 20 MB limit.");
  }
  try {
    return typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new WebVttNormalizationError("WebVTT input is not valid UTF-8.");
  }
}

function parseWebVtt(input: string): ParsedCue[] {
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const header = lines.shift();
  if (!header || !/^WEBVTT(?:[\t ].*)?$/.test(header)) {
    throw new WebVttNormalizationError("WebVTT header is missing or invalid.");
  }
  const blocks = lines.join("\n").split(/\n{2,}/u);
  const cues: ParsedCue[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    const blockLines = block.split("\n");
    const first = blockLines[0]!.trim();
    if (/^(?:NOTE(?:[\t ].*)?|STYLE|REGION)$/u.test(first)) continue;
    const timingIndex = first.includes("-->") ? 0 : 1;
    const timing = blockLines[timingIndex]?.trim();
    if (!timing || !timing.includes("-->")) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cues.length + 1} has no timing line.`,
      );
    }
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/u.exec(timing);
    if (!match?.[1] || !match[2]) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cues.length + 1} has invalid timing.`,
      );
    }
    const startMs = parseWebVttTimestamp(match[1]);
    const endMs = parseWebVttTimestamp(match[2]);
    if (endMs <= startMs) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cues.length + 1} must end after it starts.`,
      );
    }
    const text = normalizeCueText(blockLines.slice(timingIndex + 1));
    if (!text) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cues.length + 1} has no readable text.`,
      );
    }
    cues.push({ inputOrdinal: cues.length, startMs, endMs, text });
    if (cues.length > maxWebVttCues) {
      throw new WebVttNormalizationError(
        "WebVTT input exceeds the 100,000 cue limit.",
      );
    }
  }
  if (cues.length === 0) {
    throw new WebVttNormalizationError("WebVTT input contains no usable cues.");
  }
  return cues;
}

function parseWebVttTimestamp(timestamp: string) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(timestamp);
  if (!match?.[2] || !match[3] || !match[4]) {
    throw new WebVttNormalizationError(
      `Invalid WebVTT timestamp: ${timestamp.slice(0, 80)}`,
    );
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds;
  if (!Number.isSafeInteger(total)) {
    throw new WebVttNormalizationError("WebVTT timestamp is too large.");
  }
  return total;
}

function normalizeCueText(lines: readonly string[]) {
  return lines
    .map((line) =>
      decodeCueEntities(line.replaceAll(/<[^>]*>/gu, ""))
        .replaceAll(/[\t ]+/gu, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function decodeCueEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    lrm: "\u200e",
    nbsp: "\u00a0",
    rlm: "\u200f",
  };
  return text.replaceAll(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (
      entity,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      try {
        if (decimal) return String.fromCodePoint(Number(decimal));
        if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
        return name ? (named[name.toLowerCase()] ?? entity) : entity;
      } catch {
        return entity;
      }
    },
  );
}

function primaryLanguage(language: string) {
  return language.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function stableUuid(seed: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
