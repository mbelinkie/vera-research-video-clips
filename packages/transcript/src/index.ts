import {
  ClipLanguageEvidenceV2Schema,
  NormalizedTranscriptSchema,
  ProjectKeywordMatchArtifactSchema,
  ProjectKeywordScanAliasInputSchema,
  ProjectKeywordScannerSchemaVersion,
  TranscriptSelectionSchema,
  languagesEquivalent,
  normalizeLanguageTag,
  type ClipLanguageEvidenceV2,
  type NormalizedTranscript,
  type PreferredTranscriptResolution,
  type ProjectKeywordMatchArtifact,
  type ProjectKeywordMatchEvidence,
  type ProjectKeywordScanAliasInput,
  type TranscriptSegment,
  type TranscriptSelection,
  type TranscriptToken,
  type TranscriptTrack,
} from "@research-video/contracts";

export type { TranscriptSegment, TranscriptToken, TranscriptTrack };

export type DeterministicKeywordScanInput = {
  projectId: string;
  projectVideoId: string;
  transcriptVersionId: string;
  keywordSetVersion: number;
  tracks: readonly NormalizedTranscript[];
  aliases: readonly ProjectKeywordScanAliasInput[];
};

export type DeterministicKeywordScanResult = {
  artifact: ProjectKeywordMatchArtifact;
  bytes: Uint8Array;
  sha256: string;
  occurrenceCount: number;
  matchedKeywordCount: number;
};

/**
 * Produces byte-stable private scan evidence from already verified transcript
 * tracks. It deliberately performs exact-language literal matching only.
 */
export async function scanProjectKeywords(
  input: DeterministicKeywordScanInput,
): Promise<DeterministicKeywordScanResult> {
  const aliases = input.aliases
    .map((alias) => ProjectKeywordScanAliasInputSchema.parse(alias))
    .sort((left, right) =>
      [left.keywordId, left.aliasId]
        .join(":")
        .localeCompare([right.keywordId, right.aliasId].join(":")),
    );
  const tracks = input.tracks
    .map((track) => NormalizedTranscriptSchema.parse(track))
    .sort((left, right) => left.track.id.localeCompare(right.track.id));
  const evidence: ProjectKeywordMatchEvidence[] = [];

  for (const track of tracks) {
    const trackLanguage = normalizeLanguageTag(track.track.language);
    const trackAliases = aliases.filter(
      (alias) => normalizeLanguageTag(alias.language) === trackLanguage,
    );
    if (trackAliases.length === 0) continue;
    const searchable = buildKeywordSearchTrack(track);
    for (const alias of trackAliases) {
      const terms = keywordTerms(alias.phrase);
      if (terms.length === 0) continue;
      for (
        let index = 0;
        index <= searchable.terms.length - terms.length;
        index += 1
      ) {
        if (
          !terms.every(
            (term, offset) => searchable.terms[index + offset]?.term === term,
          )
        ) {
          continue;
        }
        const matched = searchable.terms.slice(index, index + terms.length);
        const segmentIndexes = [
          ...new Set(matched.map((term) => term.segmentIndex)),
        ];
        if (segmentIndexes.length > 20) continue;
        const segments = segmentIndexes.map(
          (segmentIndex) => track.segments[segmentIndex]!,
        );
        const timedTokens = matched.map((term) => term.token).filter(Boolean);
        const hasExactWordBounds =
          timedTokens.length === matched.length &&
          timedTokens.every(
            (token) =>
              token?.startMs !== undefined && token.endMs !== undefined,
          );
        const startMs = hasExactWordBounds
          ? timedTokens[0]!.startMs!
          : Math.min(...segments.map((segment) => segment.startMs));
        const endMs = hasExactWordBounds
          ? timedTokens.at(-1)!.endMs!
          : Math.max(...segments.map((segment) => segment.endMs));
        evidence.push({
          keywordId: alias.keywordId,
          aliasId: alias.aliasId,
          trackId: track.track.id,
          language: trackLanguage,
          segmentIds: segments.map((segment) => segment.id),
          startMs,
          endMs,
          timingPrecision: hasExactWordBounds
            ? "word"
            : track.track.timingPrecision === "estimated"
              ? "estimated"
              : "cue",
          context: boundedKeywordContext(segments),
        });
      }
    }
  }

  const occurrences = [];
  const keywordIds = [
    ...new Set(evidence.map((match) => match.keywordId)),
  ].sort();
  for (const keywordId of keywordIds) {
    const remaining = evidence
      .filter((match) => match.keywordId === keywordId)
      .sort(compareKeywordEvidence);
    while (remaining.length > 0) {
      const component = [remaining.shift()!];
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const candidate = remaining[index]!;
          const repeatsSameTrackAlias = component.some(
            (match) =>
              match.trackId === candidate.trackId &&
              match.aliasId === candidate.aliasId,
          );
          if (
            !repeatsSameTrackAlias &&
            component.some((match) => intervalsOverlap(match, candidate))
          ) {
            component.push(candidate);
            remaining.splice(index, 1);
            expanded = true;
          }
        }
      }
      component.sort(compareKeywordEvidence);
      const startMs = Math.min(...component.map((match) => match.startMs));
      const endMs = Math.max(...component.map((match) => match.endMs));
      occurrences.push({
        id: await stableUuid(
          `keyword-occurrence:${input.projectId}:${input.projectVideoId}:${input.transcriptVersionId}:${input.keywordSetVersion}:${keywordId}:${startMs}:${endMs}:${component.map((match) => `${match.trackId}:${match.aliasId}:${match.startMs}:${match.endMs}`).join("|")}`,
        ),
        keywordId,
        startMs,
        endMs,
        timingPrecision: leastPrecise(
          component.map((match) => match.timingPrecision),
        ),
        evidence: component,
      });
    }
  }
  occurrences.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.keywordId.localeCompare(right.keywordId),
  );
  const artifact = ProjectKeywordMatchArtifactSchema.parse({
    schemaVersion: ProjectKeywordScannerSchemaVersion,
    projectId: input.projectId,
    projectVideoId: input.projectVideoId,
    transcriptVersionId: input.transcriptVersionId,
    keywordSetVersion: input.keywordSetVersion,
    scannerSchemaVersion: ProjectKeywordScannerSchemaVersion,
    occurrences,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(artifact));
  return {
    artifact,
    bytes,
    sha256: await sha256Hex(bytes),
    occurrenceCount: artifact.occurrences.length,
    matchedKeywordCount: new Set(
      artifact.occurrences.map((occurrence) => occurrence.keywordId),
    ).size,
  };
}

type KeywordSearchTerm = {
  term: string;
  segmentIndex: number;
  token?: TranscriptToken;
};

function buildKeywordSearchTrack(track: NormalizedTranscript): {
  terms: KeywordSearchTerm[];
} {
  const tokensBySegment = new Map<string, TranscriptToken[]>();
  for (const token of track.tokens) {
    const tokens = tokensBySegment.get(token.segmentId) ?? [];
    tokens.push(token);
    tokensBySegment.set(token.segmentId, tokens);
  }
  const terms: KeywordSearchTerm[] = [];
  track.segments.forEach((segment, segmentIndex) => {
    const segmentTerms = keywordTerms(segment.text);
    const tokens = (tokensBySegment.get(segment.id) ?? []).sort(
      (left, right) => left.ordinal - right.ordinal,
    );
    const tokenTerms = tokens.flatMap((token) =>
      keywordTerms(token.text).map((term) => ({ term, token })),
    );
    const exactTokenMap =
      tokenTerms.length === segmentTerms.length &&
      tokenTerms.every((entry, index) => entry.term === segmentTerms[index]);
    segmentTerms.forEach((term, index) => {
      terms.push({
        term,
        segmentIndex,
        ...(exactTokenMap ? { token: tokenTerms[index]!.token } : {}),
      });
    });
  });
  return { terms };
}

function keywordTerms(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
  );
}

function boundedKeywordContext(segments: readonly TranscriptSegment[]): string {
  const text = segments.map((segment) => segment.text.trim()).join(" ");
  return text.length <= 500 ? text : `${text.slice(0, 499).trimEnd()}…`;
}

function intervalsOverlap(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function compareKeywordEvidence(
  left: ProjectKeywordMatchEvidence,
  right: ProjectKeywordMatchEvidence,
): number {
  return (
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.trackId.localeCompare(right.trackId) ||
    left.aliasId.localeCompare(right.aliasId)
  );
}

function leastPrecise(
  values: readonly ("word" | "cue" | "estimated")[],
): "word" | "cue" | "estimated" {
  if (values.includes("estimated")) return "estimated";
  if (values.includes("cue")) return "cue";
  return "word";
}

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

export type ManualTimedTranscriptImportFormat = "srt" | "vtt";

export class ManualTimedTranscriptImportError extends Error {
  readonly retryable = false;

  constructor(
    readonly code:
      | "manual_import_invalid_language"
      | "manual_import_invalid_duration"
      | "manual_import_invalid_utf8"
      | "manual_import_too_large"
      | "manual_import_invalid_format"
      | "manual_import_empty"
      | "manual_import_too_many_cues"
      | "manual_import_cue_text_too_large"
      | "manual_import_total_text_too_large"
      | "manual_import_cue_order_invalid"
      | "manual_import_cue_overlap"
      | "manual_import_cue_out_of_bounds",
  ) {
    super(manualTimedImportErrorMessage(code));
    this.name = "ManualTimedTranscriptImportError";
  }
}

export async function normalizeManualTimedBilingualImport(input: {
  importId: string;
  videoId: string;
  sourceLanguage: string;
  durationMs: number;
  original: {
    format: ManualTimedTranscriptImportFormat;
    bytes: Uint8Array;
  };
  english: {
    format: ManualTimedTranscriptImportFormat;
    bytes: Uint8Array;
  };
  schemaVersion?: number;
  version?: number;
}): Promise<{
  original: NormalizedTranscript;
  english: NormalizedTranscript;
  originalSrt: string;
  englishSrt: string;
}> {
  let sourceLanguage: string;
  try {
    sourceLanguage = normalizeLanguageTag(input.sourceLanguage);
  } catch {
    throw new ManualTimedTranscriptImportError(
      "manual_import_invalid_language",
    );
  }
  if (
    languagesEquivalent(sourceLanguage, "en") ||
    sourceLanguage === "und" ||
    sourceLanguage === "mul"
  ) {
    throw new ManualTimedTranscriptImportError(
      "manual_import_invalid_language",
    );
  }
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    throw new ManualTimedTranscriptImportError(
      "manual_import_invalid_duration",
    );
  }
  const originalCues = parseStrictManualTimedText(
    input.original.bytes,
    input.original.format,
    input.durationMs,
  );
  const englishCues = parseStrictManualTimedText(
    input.english.bytes,
    input.english.format,
    input.durationMs,
  );
  const schemaVersion = input.schemaVersion ?? 1;
  const version = input.version ?? 1;
  const original = await normalizeManualTimedTrack({
    importId: input.importId,
    videoId: input.videoId,
    language: sourceLanguage,
    role: "original",
    cues: originalCues,
    schemaVersion,
    version,
  });
  const english = await normalizeManualTimedTrack({
    importId: input.importId,
    videoId: input.videoId,
    language: "en",
    role: "english",
    sourceTrackId: original.track.id,
    cues: englishCues,
    schemaVersion,
    version,
  });
  return {
    original,
    english,
    originalSrt: serializeSrtCues(originalCues),
    englishSrt: serializeSrtCues(englishCues),
  };
}

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
        primaryLanguage(input.targetLanguage) === "en"
          ? "english"
          : "translation",
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

export type TranscriptSearchRange = Readonly<{
  segmentId: string;
  startOffset: number;
  endOffset: number;
}>;

export type TranscriptSearchOccurrence = Readonly<{
  id: string;
  startSegmentId: string;
  startMs: number;
  timingPrecision: "word" | "cue";
  ranges: readonly TranscriptSearchRange[];
}>;

export function searchTranscriptOccurrences(
  transcript: NormalizedTranscript | undefined,
  query: string,
): TranscriptSearchOccurrence[] {
  if (!transcript) return [];
  const normalizedQuery = query
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const characters: string[] = [];
  const origins: Array<{ segmentIndex: number; offset: number }> = [];
  let pendingWhitespace = false;
  transcript.segments.forEach((segment, segmentIndex) => {
    if (characters.length) pendingWhitespace = true;
    for (let offset = 0; offset < segment.text.length; offset += 1) {
      const character = segment.text[offset]!;
      if (/\s/u.test(character)) {
        pendingWhitespace = true;
        continue;
      }
      if (pendingWhitespace && characters.length) {
        characters.push(" ");
        origins.push({ segmentIndex, offset });
      }
      pendingWhitespace = false;
      for (const lowerCharacter of character.toLocaleLowerCase()) {
        characters.push(lowerCharacter);
        origins.push({ segmentIndex, offset });
      }
    }
  });

  const normalizedTranscript = characters.join("");
  const occurrences: TranscriptSearchOccurrence[] = [];
  let cursor = 0;
  while (cursor <= normalizedTranscript.length - normalizedQuery.length) {
    const matchStart = normalizedTranscript.indexOf(normalizedQuery, cursor);
    if (matchStart < 0) break;
    const matchEnd = matchStart + normalizedQuery.length;
    const startOrigin = origins[matchStart];
    const endOrigin = origins[matchEnd - 1];
    if (!startOrigin || !endOrigin) break;

    const ranges: TranscriptSearchRange[] = [];
    for (
      let segmentIndex = startOrigin.segmentIndex;
      segmentIndex <= endOrigin.segmentIndex;
      segmentIndex += 1
    ) {
      const segment = transcript.segments[segmentIndex]!;
      ranges.push({
        segmentId: segment.id,
        startOffset:
          segmentIndex === startOrigin.segmentIndex ? startOrigin.offset : 0,
        endOffset:
          segmentIndex === endOrigin.segmentIndex
            ? endOrigin.offset + 1
            : segment.text.length,
      });
    }

    const firstSegment = transcript.segments[startOrigin.segmentIndex]!;
    const segmentTokens = transcript.tokens.filter(
      (token) => token.segmentId === firstSegment.id,
    );
    let tokenCursor = 0;
    const timedToken = segmentTokens.find((token) => {
      const tokenOffset = firstSegment.text.indexOf(token.text, tokenCursor);
      if (tokenOffset < 0) return false;
      tokenCursor = tokenOffset + token.text.length;
      return (
        token.startMs !== undefined &&
        startOrigin.offset >= tokenOffset &&
        startOrigin.offset < tokenOffset + token.text.length
      );
    });
    occurrences.push({
      id: `${matchStart}:${matchEnd}`,
      startSegmentId: firstSegment.id,
      startMs: timedToken?.startMs ?? firstSegment.startMs,
      timingPrecision: timedToken?.startMs === undefined ? "cue" : "word",
      ranges,
    });
    cursor = matchEnd;
  }
  return occurrences;
}

export function transcriptTextForTimeRange(
  transcript: NormalizedTranscript,
  startMs: number,
  endMs: number,
): string {
  const parsed = NormalizedTranscriptSchema.parse(transcript);
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  ) {
    throw new Error("Transcript evidence bounds are invalid.");
  }
  const text = parsed.segments
    .filter((segment) => segment.endMs > startMs && segment.startMs < endMs)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) {
    throw new Error("The selected range has no transcript evidence.");
  }
  return text;
}

export function buildClipLanguageEvidence(input: {
  original: NormalizedTranscript;
  english: NormalizedTranscript;
  preferred?: NormalizedTranscript;
  startMs: number;
  endMs: number;
}): ClipLanguageEvidenceV2 {
  const original = NormalizedTranscriptSchema.parse(input.original);
  const english = NormalizedTranscriptSchema.parse(input.english);
  if (!languagesEquivalent(english.track.language, "en")) {
    throw new Error("Clip logging requires a canonical English track.");
  }
  if (
    english.track.id !== original.track.id &&
    english.track.sourceTrackId !== original.track.id
  ) {
    throw new Error("The English track is not linked to the native track.");
  }
  const preferred = input.preferred
    ? NormalizedTranscriptSchema.parse(input.preferred)
    : undefined;
  const includePreferred =
    preferred &&
    !languagesEquivalent(preferred.track.language, "en") &&
    !languagesEquivalent(preferred.track.language, original.track.language);
  if (
    includePreferred &&
    (preferred.track.kind !== "translation" ||
      preferred.track.sourceTrackId !== original.track.id)
  ) {
    throw new Error(
      "The preferred track must be a direct translation of the native track.",
    );
  }
  const snapshot = (
    role: "native" | "english" | "preferred",
    transcript: NormalizedTranscript,
  ) => ({
    role,
    language: transcript.track.language,
    text: transcriptTextForTimeRange(transcript, input.startMs, input.endMs),
    trackId: transcript.track.id,
    trackVersion: transcript.track.version,
    ...(transcript.track.sourceTrackId
      ? { sourceTrackId: transcript.track.sourceTrackId }
      : {}),
    timingPrecision: transcript.track.timingPrecision,
  });
  return ClipLanguageEvidenceV2Schema.parse({
    schemaVersion: 2,
    native: snapshot("native", original),
    english: snapshot("english", english),
    ...(includePreferred
      ? { preferred: snapshot("preferred", preferred) }
      : {}),
  });
}

export async function resolvePreferredTranscript(input: {
  preferredLanguage: string;
  original: NormalizedTranscript;
  english: NormalizedTranscript;
  findLocal?: (
    targetLanguage: string,
  ) => Promise<NormalizedTranscript | undefined>;
  findShared?: (
    targetLanguage: string,
  ) => Promise<NormalizedTranscript | undefined>;
  requestTranslation?: (
    targetLanguage: string,
  ) => Promise<NormalizedTranscript | undefined>;
}): Promise<PreferredTranscriptResolution> {
  const preferredLanguage = normalizeLanguageTag(input.preferredLanguage);
  const original = NormalizedTranscriptSchema.parse(input.original);
  const english = NormalizedTranscriptSchema.parse(input.english);
  if (languagesEquivalent(original.track.language, preferredLanguage)) {
    return { state: "ready", source: "original", transcript: original };
  }
  if (languagesEquivalent(preferredLanguage, "en")) {
    if (!languagesEquivalent(english.track.language, "en")) {
      return {
        state: "preferred_translation_unavailable",
        targetLanguage: preferredLanguage,
        reason: "The canonical English track is unavailable.",
      };
    }
    return { state: "ready", source: "english", transcript: english };
  }
  const usable = (candidate: NormalizedTranscript | undefined) => {
    if (!candidate) return undefined;
    const parsed = NormalizedTranscriptSchema.safeParse(candidate);
    if (!parsed.success) return undefined;
    const track = parsed.data.track;
    return track.kind === "translation" &&
      track.sourceTrackId === original.track.id &&
      languagesEquivalent(track.language, preferredLanguage)
      ? parsed.data
      : undefined;
  };
  const local = usable(await input.findLocal?.(preferredLanguage));
  if (local) return { state: "ready", source: "local", transcript: local };
  const shared = usable(await input.findShared?.(preferredLanguage));
  if (shared) return { state: "ready", source: "shared", transcript: shared };
  if (!input.requestTranslation) {
    return { state: "needs_translation", targetLanguage: preferredLanguage };
  }
  try {
    const generated = usable(await input.requestTranslation(preferredLanguage));
    return generated
      ? { state: "ready", source: "generated", transcript: generated }
      : {
          state: "preferred_translation_unavailable",
          targetLanguage: preferredLanguage,
          reason: "The translation provider returned no usable track.",
        };
  } catch (error) {
    return {
      state: "preferred_translation_unavailable",
      targetLanguage: preferredLanguage,
      reason:
        error instanceof Error
          ? error.message
          : "The preferred translation is unavailable.",
    };
  }
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
    selectionType: "transcript_range",
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

/**
 * Derives exact transcript evidence for a manually marked player range without
 * changing the range's speech classification. A missing strict overlap is an
 * ordinary `undefined` result, never evidence that the range contains no
 * speech.
 */
export function derivePlayerRangeTranscriptAttachment(input: {
  transcript: NormalizedTranscript;
  sourceStartMs: number;
  sourceEndMs: number;
  exportStartMs: number;
  exportEndMs: number;
}): TranscriptSelection | undefined {
  const transcript = NormalizedTranscriptSchema.parse(input.transcript);
  const sourceStartMs = validNonnegativeInteger(
    input.sourceStartMs,
    "Player source start",
  );
  const sourceEndMs = validPositiveInteger(
    input.sourceEndMs,
    "Player source end",
  );
  const exportStartMs = validNonnegativeInteger(
    input.exportStartMs,
    "Player export start",
  );
  const exportEndMs = validPositiveInteger(
    input.exportEndMs,
    "Player export end",
  );
  if (sourceEndMs <= sourceStartMs) {
    throw new Error("Player source end must be after its start.");
  }
  if (exportStartMs > sourceStartMs || exportEndMs < sourceEndMs) {
    throw new Error("Player export bounds must include the source range.");
  }

  const segments = transcript.segments
    .filter(
      (segment) =>
        segment.endMs > sourceStartMs && segment.startMs < sourceEndMs,
    )
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  if (!firstSegment || !lastSegment) return undefined;

  const segmentIds = new Set(segments.map((segment) => segment.id));
  const timedTokens = transcript.tokens
    .filter(
      (token) =>
        segmentIds.has(token.segmentId) &&
        token.startMs !== undefined &&
        token.endMs !== undefined &&
        token.endMs > sourceStartMs &&
        token.startMs < sourceEndMs,
    )
    .toSorted(
      (left, right) =>
        left.startMs! - right.startMs! || left.ordinal - right.ordinal,
    );
  const firstToken = timedTokens[0];
  const lastToken = timedTokens.at(-1);
  const useWordEvidence = Boolean(firstToken && lastToken);
  const transcriptStartMs = Math.max(
    sourceStartMs,
    useWordEvidence ? firstToken!.startMs! : firstSegment.startMs,
  );
  const transcriptEndMs = Math.min(
    sourceEndMs,
    useWordEvidence ? lastToken!.endMs! : lastSegment.endMs,
  );
  if (transcriptEndMs <= transcriptStartMs) return undefined;
  const text = (useWordEvidence ? timedTokens : segments)
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return undefined;

  return TranscriptSelectionSchema.parse({
    selectionType: "transcript_range",
    trackId: transcript.track.id,
    transcriptVersion: transcript.track.version,
    firstSegmentId: firstSegment.id,
    lastSegmentId: lastSegment.id,
    ...(useWordEvidence
      ? {
          firstTokenId: firstToken!.id,
          lastTokenId: lastToken!.id,
        }
      : {}),
    transcriptStartMs,
    transcriptEndMs,
    exportStartMs,
    exportEndMs,
    text,
    timingPrecision: useWordEvidence
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
  return serializeSrtCues(normalized.segments);
}

export type ClipRelativeSrtCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export class SrtValidationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "SrtValidationError";
    this.code = options.code ?? "srt_invalid";
    this.retryable = options.retryable ?? true;
  }
}

/**
 * Produces source-order cues for exactly one export range. Source transcript
 * timing remains untouched; only the returned sidecar representation is
 * clipped and shifted to zero.
 */
export function deriveClipRelativeSrtCues(input: {
  transcript: NormalizedTranscript;
  startMs: number;
  endMs: number;
  missingCue?: { code: string; message: string };
}): ClipRelativeSrtCue[] {
  const transcript = NormalizedTranscriptSchema.parse(input.transcript);
  assertSrtBounds(input.startMs, input.endMs, "export range");
  const cues = transcript.segments
    .filter(
      (segment) =>
        segment.endMs > input.startMs && segment.startMs < input.endMs,
    )
    .map((segment) => ({
      startMs: Math.max(segment.startMs, input.startMs) - input.startMs,
      endMs: Math.min(segment.endMs, input.endMs) - input.startMs,
      text: segment.text,
      ordinal: segment.ordinal,
    }))
    .toSorted(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.ordinal - right.ordinal,
    )
    .map(({ ordinal: _ordinal, ...cue }) => cue);
  if (cues.length === 0) {
    throw new SrtValidationError(
      input.missingCue?.message ??
        "The verified English transcript has no cue in the resolved export range. Adjust the range or retry after verifying the transcript.",
      { code: input.missingCue?.code ?? "english_subtitle_cue_missing" },
    );
  }
  validateClipRelativeSrtCues(cues, input.endMs - input.startMs);
  return cues;
}

export function serializeSrtCues(cues: readonly ClipRelativeSrtCue[]): string {
  if (cues.length === 0) {
    throw new SrtValidationError("SRT output requires at least one cue.", {
      code: "srt_empty",
    });
  }
  return cues
    .map((cue, index) => {
      assertSrtCueText(cue.text);
      return `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text.trim()}\n`;
    })
    .join("\n");
}

export function parseSrt(input: string | Uint8Array): ClipRelativeSrtCue[] {
  let source: string;
  try {
    source =
      typeof input === "string"
        ? input
        : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new SrtValidationError("SRT content is not valid UTF-8.", {
      code: "srt_invalid_utf8",
      retryable: false,
    });
  }
  if (new TextEncoder().encode(source).byteLength > 20 * 1024 * 1024) {
    throw new SrtValidationError("SRT content exceeds the 20 MB limit.", {
      code: "srt_too_large",
      retryable: false,
    });
  }
  const blocks = source
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .split(/\n{2,}/u);
  if (blocks.length === 0 || (blocks.length === 1 && !blocks[0])) {
    throw new SrtValidationError("SRT content contains no cues.", {
      code: "srt_empty",
      retryable: false,
    });
  }
  if (blocks.length > maxWebVttCues) {
    throw new SrtValidationError("SRT content contains too many cues.", {
      code: "srt_too_many_cues",
      retryable: false,
    });
  }
  return blocks.map((block, index) => parseSrtBlock(block, index + 1));
}

export function validateClipRelativeSrtCues(
  cues: readonly ClipRelativeSrtCue[],
  renderedDurationMs: number,
): void {
  if (!Number.isSafeInteger(renderedDurationMs) || renderedDurationMs <= 0) {
    throw new SrtValidationError("Verified rendered duration is invalid.", {
      code: "subtitle_rendered_duration_invalid",
      retryable: false,
    });
  }
  if (cues.length === 0) {
    throw new SrtValidationError("SRT output requires at least one cue.", {
      code: "srt_empty",
      retryable: false,
    });
  }
  let previousStartMs = -1;
  for (const cue of cues) {
    assertSrtBounds(cue.startMs, cue.endMs, "SRT cue");
    assertSrtCueText(cue.text);
    if (cue.startMs < previousStartMs) {
      throw new SrtValidationError("SRT cue ordering is invalid.", {
        code: "srt_order_invalid",
        retryable: false,
      });
    }
    if (cue.endMs > renderedDurationMs) {
      throw new SrtValidationError(
        "SRT cue timing exceeds the verified rendered duration.",
        { code: "srt_out_of_range", retryable: false },
      );
    }
    previousStartMs = cue.startMs;
  }
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

const manualTimedImportMaxBytes = 20 * 1024 * 1024;
const manualTimedImportMaxCues = 100_000;
const manualTimedImportMaxCueTextBytes = 20_000;
const manualTimedImportMaxTotalTextBytes = 10 * 1024 * 1024;

function parseStrictManualTimedText(
  bytes: Uint8Array,
  format: ManualTimedTranscriptImportFormat,
  durationMs: number,
): ClipRelativeSrtCue[] {
  if (bytes.byteLength === 0) {
    throw new ManualTimedTranscriptImportError("manual_import_empty");
  }
  if (bytes.byteLength > manualTimedImportMaxBytes) {
    throw new ManualTimedTranscriptImportError("manual_import_too_large");
  }
  let cues: ClipRelativeSrtCue[];
  if (format === "srt") {
    try {
      cues = parseSrt(bytes);
    } catch (error) {
      if (error instanceof SrtValidationError) {
        if (error.code === "srt_invalid_utf8") {
          throw new ManualTimedTranscriptImportError(
            "manual_import_invalid_utf8",
          );
        }
        if (error.code === "srt_too_large") {
          throw new ManualTimedTranscriptImportError("manual_import_too_large");
        }
        if (error.code === "srt_empty") {
          throw new ManualTimedTranscriptImportError("manual_import_empty");
        }
        if (error.code === "srt_too_many_cues") {
          throw new ManualTimedTranscriptImportError(
            "manual_import_too_many_cues",
          );
        }
      }
      throw new ManualTimedTranscriptImportError(
        "manual_import_invalid_format",
      );
    }
  } else if (format === "vtt") {
    try {
      cues = parseWebVtt(decodeWebVtt(bytes)).map(
        ({ startMs, endMs, text }) => ({ startMs, endMs, text }),
      );
    } catch (error) {
      if (
        error instanceof WebVttNormalizationError &&
        error.message.includes("not valid UTF-8")
      ) {
        throw new ManualTimedTranscriptImportError(
          "manual_import_invalid_utf8",
        );
      }
      throw new ManualTimedTranscriptImportError(
        "manual_import_invalid_format",
      );
    }
  } else {
    throw new ManualTimedTranscriptImportError("manual_import_invalid_format");
  }
  if (cues.length === 0) {
    throw new ManualTimedTranscriptImportError("manual_import_empty");
  }
  if (cues.length > manualTimedImportMaxCues) {
    throw new ManualTimedTranscriptImportError("manual_import_too_many_cues");
  }
  let totalTextBytes = 0;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    const previous = cues[index - 1];
    if (!cue.text.trim() || cue.text.includes("\0")) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_invalid_format",
      );
    }
    const cueTextBytes = new TextEncoder().encode(cue.text).byteLength;
    if (cueTextBytes > manualTimedImportMaxCueTextBytes) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_cue_text_too_large",
      );
    }
    totalTextBytes += cueTextBytes;
    if (totalTextBytes > manualTimedImportMaxTotalTextBytes) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_total_text_too_large",
      );
    }
    if (cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > durationMs) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_cue_out_of_bounds",
      );
    }
    if (previous && cue.startMs <= previous.startMs) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_cue_order_invalid",
      );
    }
    if (previous && cue.startMs < previous.endMs) {
      throw new ManualTimedTranscriptImportError("manual_import_cue_overlap");
    }
  }
  return cues;
}

async function normalizeManualTimedTrack(input: {
  importId: string;
  videoId: string;
  language: string;
  role: "original" | "english";
  sourceTrackId?: string;
  cues: readonly ClipRelativeSrtCue[];
  schemaVersion: number;
  version: number;
}): Promise<NormalizedTranscript> {
  const canonicalCues = input.cues.map((cue, ordinal) => ({
    ordinal,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text.trim(),
  }));
  const contentSha256 = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonicalCues)),
  );
  const trackId = await stableUuid(
    `manual-import:${input.importId}:${input.role}:${input.videoId}:${input.language}:${contentSha256}`,
  );
  const segments = await Promise.all(
    canonicalCues.map(async (cue) => ({
      id: await stableUuid(
        `manual-import-segment:${trackId}:${cue.ordinal}:${cue.startMs}:${cue.endMs}:${cue.text}`,
      ),
      trackId,
      ...cue,
    })),
  );
  const tokens = (
    await Promise.all(
      segments.map(async (segment) =>
        Promise.all(
          (segment.text.match(/\S+/gu) ?? []).map(async (text, ordinal) => ({
            id: await stableUuid(
              `manual-import-token:${segment.id}:${ordinal}:${text}`,
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
      kind: input.role,
      source: "manual-import",
      provider: "researcher-timed-import",
      ...(input.sourceTrackId ? { sourceTrackId: input.sourceTrackId } : {}),
      timingPrecision: "cue",
      schemaVersion: input.schemaVersion,
      contentSha256,
      version: input.version,
    },
    segments,
    tokens,
  });
  assertOrdered(transcript.segments);
  return transcript;
}

function manualTimedImportErrorMessage(
  code: ManualTimedTranscriptImportError["code"],
) {
  switch (code) {
    case "manual_import_invalid_language":
      return "The confirmed source language is not eligible for bilingual import.";
    case "manual_import_invalid_duration":
      return "A verified positive video duration is required for timed import.";
    case "manual_import_invalid_utf8":
      return "A timed transcript is not valid UTF-8.";
    case "manual_import_too_large":
      return "A timed transcript exceeds the 20 MB limit.";
    case "manual_import_empty":
      return "A timed transcript contains no cues.";
    case "manual_import_too_many_cues":
      return "A timed transcript contains too many cues.";
    case "manual_import_cue_text_too_large":
      return "A timed transcript cue contains too much text.";
    case "manual_import_total_text_too_large":
      return "A timed transcript contains too much cue text.";
    case "manual_import_cue_order_invalid":
      return "Timed transcript cues must be in strict source order.";
    case "manual_import_cue_overlap":
      return "Timed transcript cues must not overlap.";
    case "manual_import_cue_out_of_bounds":
      return "Timed transcript cues must stay within the verified video duration.";
    default:
      return "The timed transcript format is invalid.";
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

function parseSrtBlock(
  block: string,
  expectedIndex: number,
): ClipRelativeSrtCue {
  const lines = block.split("\n");
  const index = Number(lines.shift());
  if (!Number.isSafeInteger(index) || index !== expectedIndex) {
    throw new SrtValidationError("SRT cue indexes must be contiguous.", {
      code: "srt_index_invalid",
      retryable: false,
    });
  }
  const timing = lines.shift();
  const match =
    timing === undefined
      ? undefined
      : /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/u.exec(
          timing,
        );
  if (!match) {
    throw new SrtValidationError("SRT cue timing is malformed.", {
      code: "srt_timing_invalid",
      retryable: false,
    });
  }
  const startMs = srtMilliseconds(match.slice(1, 5));
  const endMs = srtMilliseconds(match.slice(5, 9));
  const text = lines.join("\n").trim();
  assertSrtBounds(startMs, endMs, "SRT cue");
  assertSrtCueText(text);
  return { startMs, endMs, text };
}

function srtMilliseconds(parts: readonly string[]) {
  const [hours, minutes, seconds, milliseconds] = parts.map(Number);
  const value =
    hours! * 3_600_000 + minutes! * 60_000 + seconds! * 1_000 + milliseconds!;
  if (!Number.isSafeInteger(value)) {
    throw new SrtValidationError("SRT cue timing is invalid.", {
      code: "srt_timing_invalid",
      retryable: false,
    });
  }
  return value;
}

function assertSrtBounds(startMs: number, endMs: number, label: string) {
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  ) {
    throw new SrtValidationError(`${label} timing is invalid.`, {
      code: "srt_timing_invalid",
      retryable: false,
    });
  }
}

function assertSrtCueText(text: string) {
  if (!text.trim() || text.includes("\0")) {
    throw new SrtValidationError("SRT cue text is invalid.", {
      code: "srt_text_invalid",
      retryable: false,
    });
  }
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
  const firstSeparator = lines.findIndex((line) => line.trim() === "");
  const headerMetadata =
    firstSeparator >= 0 ? lines.slice(0, firstSeparator) : [];
  const bodyLines =
    firstSeparator >= 0 && headerMetadata.every((line) => !line.includes("-->"))
      ? lines.slice(firstSeparator + 1)
      : lines;
  const blocks = bodyLines.join("\n").split(/\n{2,}/u);
  const cues: ParsedCue[] = [];
  let parsedCueCount = 0;
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    const blockLines = block.split("\n");
    const first = blockLines[0]!.trim();
    if (/^(?:NOTE(?:[\t ].*)?|STYLE|REGION)$/u.test(first)) continue;
    const cueNumber = ++parsedCueCount;
    if (parsedCueCount > maxWebVttCues) {
      throw new WebVttNormalizationError(
        "WebVTT input exceeds the 100,000 cue limit.",
      );
    }
    const timingIndex = first.includes("-->") ? 0 : 1;
    const timing = blockLines[timingIndex]?.trim();
    if (!timing || !timing.includes("-->")) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cueNumber} has no timing line.`,
      );
    }
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/u.exec(timing);
    if (!match?.[1] || !match[2]) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cueNumber} has invalid timing.`,
      );
    }
    const startMs = parseWebVttTimestamp(match[1]);
    const endMs = parseWebVttTimestamp(match[2]);
    if (endMs <= startMs) {
      throw new WebVttNormalizationError(
        `WebVTT cue ${cueNumber} must end after it starts.`,
      );
    }
    const text = normalizeCueText(blockLines.slice(timingIndex + 1));
    // YouTube automatic captions emit empty transition cues between rolling
    // lines. They carry no transcript content, so ignore them while retaining
    // strict validation for timing and for files with no usable cues at all.
    if (!text) continue;
    cues.push({ inputOrdinal: cues.length, startMs, endMs, text });
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
