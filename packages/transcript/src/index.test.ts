import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };
import bilingualFixture from "../../../tests/fixtures/transcripts/spanish-bilingual.json" with { type: "json" };
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import {
  deriveClipRelativeSrtCues,
  buildClipLanguageEvidence,
  deriveTranscriptSelection,
  derivePlayerRangeTranscriptAttachment,
  normalizeTranscriptFixture,
  normalizeGeneratedTranscript,
  normalizeManualTimedBilingualImport,
  normalizeTranslatedTranscript,
  normalizeWebVttCaption,
  parseSrt,
  resolvePreferredTranscript,
  scanProjectKeywords,
  searchTranscript,
  searchTranscriptOccurrences,
  segmentAtTime,
  timedTranscriptTokens,
  tokenAtTime,
  transcriptVirtualWindow,
  transcriptToSrt,
  validateClipRelativeSrtCues,
  updateTranscriptSelectionExportBounds,
  type TranscriptSegment,
} from "./index.ts";

describe("deterministic project keyword scanning", () => {
  const ids = {
    project: "019fbb95-cd76-7920-93fa-e23ba755ee01",
    projectVideo: "019fbb95-cd76-7920-93fa-e23ba755ee02",
    transcriptVersion: "019fbb95-cd76-7920-93fa-e23ba755ee03",
    keyword: "019fbb95-cd76-7920-93fa-e23ba755ee04",
    englishAlias: "019fbb95-cd76-7920-93fa-e23ba755ee05",
    spanishAlias: "019fbb95-cd76-7920-93fa-e23ba755ee06",
    regionalAlias: "019fbb95-cd76-7920-93fa-e23ba755ee07",
    englishTrack: "019fbb95-cd76-7920-93fa-e23ba755ee08",
    spanishTrack: "019fbb95-cd76-7920-93fa-e23ba755ee09",
    englishSegment: "019fbb95-cd76-7920-93fa-e23ba755ee10",
    spanishSegment: "019fbb95-cd76-7920-93fa-e23ba755ee11",
    token1: "019fbb95-cd76-7920-93fa-e23ba755ee12",
    token2: "019fbb95-cd76-7920-93fa-e23ba755ee13",
  };

  const baseInput = {
    projectId: ids.project,
    projectVideoId: ids.projectVideo,
    transcriptVersionId: ids.transcriptVersion,
    keywordSetVersion: 2,
    aliases: [
      {
        keywordId: ids.keyword,
        aliasId: ids.englishAlias,
        language: "en",
        phrase: "CLIMATE—change",
      },
      {
        keywordId: ids.keyword,
        aliasId: ids.spanishAlias,
        language: "es",
        phrase: "cambio climático",
      },
      {
        keywordId: ids.keyword,
        aliasId: ids.regionalAlias,
        language: "en-US",
        phrase: "ignored regional alias",
      },
    ],
    tracks: [
      {
        track: {
          id: ids.englishTrack,
          videoId: "keyword-fixture",
          language: "en",
          kind: "english" as const,
          source: "fixture" as const,
          provider: "fixture",
          timingPrecision: "word" as const,
          schemaVersion: 1,
          contentSha256: "a".repeat(64),
          version: 1,
        },
        segments: [
          {
            id: ids.englishSegment,
            trackId: ids.englishTrack,
            ordinal: 0,
            startMs: 1_000,
            endMs: 3_000,
            text: "Climate,   change matters; not climatic changes.",
          },
        ],
        tokens: [
          {
            id: ids.token1,
            segmentId: ids.englishSegment,
            ordinal: 0,
            text: "Climate,",
            startMs: 1_100,
            endMs: 1_500,
          },
          {
            id: ids.token2,
            segmentId: ids.englishSegment,
            ordinal: 1,
            text: "change",
            startMs: 1_500,
            endMs: 1_900,
          },
          ...["matters;", "not", "climatic", "changes."].map((text, index) => ({
            id: `019fbb95-cd76-7920-93fa-e23ba755ee${14 + index}`,
            segmentId: ids.englishSegment,
            ordinal: index + 2,
            text,
          })),
        ],
      },
      {
        track: {
          id: ids.spanishTrack,
          videoId: "keyword-fixture",
          language: "es",
          kind: "original" as const,
          source: "fixture" as const,
          provider: "fixture",
          timingPrecision: "cue" as const,
          schemaVersion: 1,
          contentSha256: "b".repeat(64),
          version: 1,
        },
        segments: [
          {
            id: ids.spanishSegment,
            trackId: ids.spanishTrack,
            ordinal: 0,
            startMs: 1_000,
            endMs: 3_000,
            text: "El cambio climático importa.",
          },
        ],
        tokens: [],
      },
    ],
  };

  it("deduplicates linked-language overlap while preserving exact and cue evidence", async () => {
    const result = await scanProjectKeywords(baseInput);
    const replay = await scanProjectKeywords({
      ...baseInput,
      tracks: [...baseInput.tracks].reverse(),
      aliases: [...baseInput.aliases].reverse(),
    });

    expect(replay).toEqual(result);
    expect(result.occurrenceCount).toBe(1);
    expect(result.matchedKeywordCount).toBe(1);
    expect(result.artifact.occurrences[0]).toMatchObject({
      keywordId: ids.keyword,
      startMs: 1_000,
      endMs: 3_000,
      timingPrecision: "cue",
    });
    expect(result.artifact.occurrences[0]!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aliasId: ids.englishAlias,
          startMs: 1_100,
          endMs: 1_900,
          timingPrecision: "word",
        }),
        expect.objectContaining({
          aliasId: ids.spanishAlias,
          startMs: 1_000,
          endMs: 3_000,
          timingPrecision: "cue",
        }),
      ]),
    );
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses Unicode term boundaries and exact normalized language tags", async () => {
    const result = await scanProjectKeywords({
      ...baseInput,
      aliases: [
        {
          keywordId: ids.keyword,
          aliasId: ids.englishAlias,
          language: "en",
          phrase: "climatic change",
        },
        {
          keywordId: ids.keyword,
          aliasId: ids.regionalAlias,
          language: "en-US",
          phrase: "climate change",
        },
      ],
      tracks: [baseInput.tracks[0]!],
    });

    expect(result.occurrenceCount).toBe(0);
  });

  it("preserves repeated literal occurrences inside one cue", async () => {
    const spanish = baseInput.tracks[1]!;
    const result = await scanProjectKeywords({
      ...baseInput,
      aliases: [baseInput.aliases[1]!],
      tracks: [
        {
          ...spanish,
          segments: [
            {
              ...spanish.segments[0]!,
              text: "Cambio climático y cambio climático.",
            },
          ],
        },
      ],
    });

    expect(result.occurrenceCount).toBe(2);
    expect(
      result.artifact.occurrences.map((entry) => entry.timingPrecision),
    ).toEqual(["cue", "cue"]);
  });
});

describe("transcript range selection", () => {
  it("normalizes reverse DOM selection into stable word-timed bounds", () => {
    const transcript = normalizeTranscriptFixture(wordFixture);
    const selection = deriveTranscriptSelection({
      transcript,
      anchor: {
        segmentId: transcript.segments[1]!.id,
        tokenId: transcript.tokens[5]!.id,
      },
      focus: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[1]!.id,
      },
    });

    expect(selection).toMatchObject({
      selectionType: "transcript_range",
      firstSegmentId: transcript.segments[0]!.id,
      lastSegmentId: transcript.segments[1]!.id,
      firstTokenId: transcript.tokens[1]!.id,
      lastTokenId: transcript.tokens[5]!.id,
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 300,
      exportEndMs: 2_900,
      text: "fixture has accurate word timing. Click any word",
      timingPrecision: "word",
    });
  });

  it("derives strict, clipped player-range transcript evidence without inference", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    const attachment = derivePlayerRangeTranscriptAttachment({
      transcript,
      sourceStartMs: 1_000,
      sourceEndMs: 3_000,
      exportStartMs: 500,
      exportEndMs: 3_500,
    });

    expect(attachment).toMatchObject({
      selectionType: "transcript_range",
      trackId: transcript.track.id,
      transcriptVersion: transcript.track.version,
      firstSegmentId: transcript.segments[0]!.id,
      lastSegmentId: transcript.segments[1]!.id,
      transcriptStartMs: 1_000,
      transcriptEndMs: 3_000,
      exportStartMs: 500,
      exportEndMs: 3_500,
      timingPrecision: "cue",
    });
  });

  it("returns no player attachment when strict time overlap is absent", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    expect(
      derivePlayerRangeTranscriptAttachment({
        transcript,
        sourceStartMs: 4_000,
        sourceEndMs: 5_000,
        exportStartMs: 4_000,
        exportEndMs: 5_000,
      }),
    ).toBeUndefined();
  });

  it("uses honest cue bounds when word timing is unavailable", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    const selection = deriveTranscriptSelection({
      transcript,
      anchor: { segmentId: transcript.segments[0]!.id },
      focus: { segmentId: transcript.segments[1]!.id },
    });

    expect(selection).toMatchObject({
      transcriptStartMs: 0,
      transcriptEndMs: 4_000,
      exportStartMs: 0,
      exportEndMs: 4_000,
      text: "This fixture is intentionally short. It tests cue-level transcript behavior.",
      timingPrecision: "cue",
    });
  });

  it("keeps source selection bounds immutable while padding export bounds", () => {
    const transcript = normalizeTranscriptFixture(wordFixture);
    const selection = deriveTranscriptSelection({
      transcript,
      anchor: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[1]!.id,
      },
      focus: {
        segmentId: transcript.segments[1]!.id,
        tokenId: transcript.tokens[5]!.id,
      },
      paddingBeforeMs: 500,
      paddingAfterMs: 500,
      sourceDurationMs: 3_000,
    });

    expect(selection).toMatchObject({
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 0,
      exportEndMs: 3_000,
    });
    expect(() =>
      updateTranscriptSelectionExportBounds(selection, {
        startMs: 400,
        endMs: 3_000,
      }),
    ).toThrow(/include the transcript selection/u);
  });
});

describe("translated transcript normalization", () => {
  it("creates a separate time-linked English cue track", async () => {
    const original = normalizeTranscriptFixture(bilingualFixture.original);
    const translated = await normalizeTranslatedTranscript({
      sourceTranscript: original,
      targetLanguage: "en",
      provider: "amazon-translate",
      translations: [
        {
          sourceSegmentId: original.segments[0]!.id,
          text: "This is a short example.",
        },
      ],
    });

    expect(translated.track).toMatchObject({
      language: "en",
      kind: "english",
      source: "translated",
      provider: "amazon-translate",
      sourceTrackId: original.track.id,
      timingPrecision: "cue",
    });
    expect(translated.segments[0]).toMatchObject({
      startMs: original.segments[0]!.startMs,
      endMs: original.segments[0]!.endMs,
      text: "This is a short example.",
    });
    expect(
      translated.tokens.every((token) => token.startMs === undefined),
    ).toBe(true);
  });

  it("rejects missing, duplicate, or empty translated segments", async () => {
    const original = normalizeTranscriptFixture(bilingualFixture.original);
    await expect(
      normalizeTranslatedTranscript({
        sourceTranscript: original,
        targetLanguage: "en",
        provider: "fixture",
        translations: [],
      }),
    ).rejects.toMatchObject({ code: "invalid_translation", retryable: false });
  });

  it("creates non-English supplemental tracks without relabeling them original", async () => {
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const translated = await normalizeTranslatedTranscript({
      sourceTranscript: original,
      targetLanguage: "es",
      provider: "fixture",
      translations: original.segments.map((segment, index) => ({
        sourceSegmentId: segment.id,
        text: index === 0 ? "Este es un ejemplo rumano." : "Sigue por tiempo.",
      })),
    });
    expect(translated.track).toMatchObject({
      kind: "translation",
      language: "es",
      sourceTrackId: original.track.id,
    });
  });

  it("resolves preferred tracks in local, shared, then provider order", async () => {
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const english = normalizeTranscriptFixture(multilingualFixture.english);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const calls: string[] = [];
    const local = await resolvePreferredTranscript({
      preferredLanguage: "es-MX",
      original,
      english,
      findLocal: async () => {
        calls.push("local");
        return spanish;
      },
      findShared: async () => {
        calls.push("shared");
        return spanish;
      },
      requestTranslation: async () => {
        calls.push("provider");
        return spanish;
      },
    });
    expect(local).toMatchObject({ state: "ready", source: "local" });
    expect(calls).toEqual(["local"]);

    calls.length = 0;
    const generated = await resolvePreferredTranscript({
      preferredLanguage: "es",
      original,
      english,
      findLocal: async () => {
        calls.push("local");
        return undefined;
      },
      findShared: async () => {
        calls.push("shared");
        return undefined;
      },
      requestTranslation: async () => {
        calls.push("provider");
        return spanish;
      },
    });
    expect(generated).toMatchObject({ state: "ready", source: "generated" });
    expect(calls).toEqual(["local", "shared", "provider"]);
    await expect(
      resolvePreferredTranscript({
        preferredLanguage: "ro",
        original,
        english,
        requestTranslation: async () => {
          throw new Error("must not run");
        },
      }),
    ).resolves.toMatchObject({ state: "ready", source: "original" });
  });

  it("resolves a general English-to-French target and exposes provider capability failures", async () => {
    const english = normalizeTranscriptFixture(wordFixture);
    const requestedTargets: string[] = [];
    const french = await resolvePreferredTranscript({
      preferredLanguage: "fr_CA",
      original: english,
      english,
      requestTranslation: async (targetLanguage) => {
        requestedTargets.push(targetLanguage);
        return normalizeTranslatedTranscript({
          sourceTranscript: english,
          targetLanguage,
          provider: "fixture-general-target",
          translations: english.segments.map((segment) => ({
            sourceSegmentId: segment.id,
            text: `Traduction ${segment.ordinal + 1}`,
          })),
        });
      },
    });
    expect(requestedTargets).toEqual(["fr-CA"]);
    expect(french).toMatchObject({
      state: "ready",
      source: "generated",
      transcript: {
        track: {
          language: "fr-CA",
          kind: "translation",
          sourceTrackId: english.track.id,
        },
      },
    });

    await expect(
      resolvePreferredTranscript({
        preferredLanguage: "tlh",
        original: english,
        english,
        requestTranslation: async () => {
          throw new Error(
            "The configured translation provider does not support Klingon.",
          );
        },
      }),
    ).resolves.toEqual({
      state: "preferred_translation_unavailable",
      targetLanguage: "tlh",
      reason: "The configured translation provider does not support Klingon.",
    });
  });

  it("builds Romanian, English, and Spanish clip evidence by source time", () => {
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const english = normalizeTranscriptFixture(multilingualFixture.english);
    const preferred = normalizeTranscriptFixture(multilingualFixture.spanish);
    expect(
      buildClipLanguageEvidence({
        original,
        english,
        preferred,
        startMs: 1_000,
        endMs: 2_500,
      }),
    ).toMatchObject({
      schemaVersion: 2,
      native: {
        language: "ro",
        text: "Acesta este un exemplu românesc. Selecția rămâne legată de timp.",
      },
      english: {
        language: "en",
        text: "This is a Romanian example. The selection stays linked by time.",
      },
      preferred: {
        language: "es",
        text: "Este es un ejemplo rumano. La selección permanece vinculada por tiempo.",
      },
    });
  });

  it("omits redundant preferred roles and allows English native/canonical to share a track", async () => {
    const spanishOriginal = normalizeTranscriptFixture(
      bilingualFixture.original,
    );
    const spanishEnglish = normalizeTranscriptFixture(bilingualFixture.english);
    expect(
      buildClipLanguageEvidence({
        original: spanishOriginal,
        english: spanishEnglish,
        preferred: spanishOriginal,
        startMs: 0,
        endMs: 1_000,
      }),
    ).not.toHaveProperty("preferred");

    const english = normalizeTranscriptFixture(fixture);
    const french = await normalizeTranslatedTranscript({
      sourceTranscript: english,
      targetLanguage: "fr",
      provider: "fixture-general-target",
      translations: english.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: `Traduction ${segment.ordinal + 1}`,
      })),
    });
    const evidence = buildClipLanguageEvidence({
      original: english,
      english,
      preferred: french,
      startMs: 0,
      endMs: 2_000,
    });
    expect(evidence.native.trackId).toBe(evidence.english.trackId);
    expect(evidence.preferred).toMatchObject({
      language: "fr",
      sourceTrackId: english.track.id,
    });
  });
});

describe("generated transcript normalization", () => {
  it("preserves generated segment timing without inventing word timing", async () => {
    const transcript = await normalizeGeneratedTranscript({
      videoId: "fixture-spanish",
      language: "es",
      provider: "whisper.cpp",
      model: "large-v3-turbo",
      segments: [
        { startMs: 500, endMs: 2_500, text: " Este es un ejemplo breve. " },
      ],
    });

    expect(transcript.track).toMatchObject({
      language: "es",
      kind: "original",
      source: "generated",
      provider: "whisper.cpp",
      model: "large-v3-turbo",
      timingPrecision: "cue",
    });
    expect(transcript.segments).toMatchObject([
      { startMs: 500, endMs: 2_500, text: "Este es un ejemplo breve." },
    ]);
    expect(
      transcript.tokens.every((token) => token.startMs === undefined),
    ).toBe(true);
  });
});

describe("SRT serialization", () => {
  it("serializes canonical source-video cue timing", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    expect(transcriptToSrt(transcript)).toContain(
      "1\n00:00:00,000 --> 00:00:01,800\nThis fixture is intentionally short.\n",
    );
  });

  it("trims source cues and shifts them to clip-relative zero without changing source timing", () => {
    const transcript = normalizeTranscriptFixture({
      track: {
        id: "019fbb95-cd76-7920-93fa-e23ba755e101",
        videoId: "fixture-english",
        language: "en",
        kind: "english",
        source: "youtube-manual",
        provider: "fixture",
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 1,
      },
      segments: [
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e111",
          ordinal: 0,
          startMs: 500,
          endMs: 1_500,
          text: "Before",
        },
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e112",
          ordinal: 1,
          startMs: 1_500,
          endMs: 3_500,
          text: "Inside",
        },
      ],
    });
    const cues = deriveClipRelativeSrtCues({
      transcript,
      startMs: 1_000,
      endMs: 3_000,
    });
    expect(cues).toEqual([
      { startMs: 0, endMs: 500, text: "Before" },
      { startMs: 500, endMs: 2_000, text: "Inside" },
    ]);
    expect(transcript.segments[0]).toMatchObject({
      startMs: 500,
      endMs: 1_500,
    });
    expect(() =>
      validateClipRelativeSrtCues(
        [{ startMs: 0, endMs: 2_001, text: "Bad" }],
        2_000,
      ),
    ).toThrow(/exceeds/u);
    expect(() => parseSrt("1\nnot a timestamp\nMalformed")).toThrow(
      /malformed/u,
    );
  });
});

const webVttFixture = new URL(
  "../../../tests/fixtures/transcripts/caption-sample.vtt",
  import.meta.url,
);

const segments: TranscriptSegment[] = [
  {
    id: "a",
    trackId: "track",
    ordinal: 0,
    startMs: 0,
    endMs: 1_000,
    text: "Hello",
  },
  {
    id: "b",
    trackId: "track",
    ordinal: 1,
    startMs: 1_000,
    endMs: 2_000,
    text: "World",
  },
];

describe("segmentAtTime", () => {
  it("uses half-open source-time ranges", () => {
    expect(segmentAtTime(segments, 999)?.id).toBe("a");
    expect(segmentAtTime(segments, 1_000)?.id).toBe("b");
    expect(segmentAtTime(segments, 2_000)).toBeUndefined();
  });
});

describe("timed transcript navigation", () => {
  it("uses exact token bounds without inventing timing for untimed tokens", () => {
    const timed = timedTranscriptTokens([
      {
        id: "019fbb95-cd76-7920-93fa-e23ba755e401",
        segmentId: "019fbb95-cd76-7920-93fa-e23ba755e402",
        ordinal: 0,
        text: "untimed",
      },
      {
        id: "019fbb95-cd76-7920-93fa-e23ba755e403",
        segmentId: "019fbb95-cd76-7920-93fa-e23ba755e402",
        ordinal: 1,
        text: "timed",
        startMs: 1_200,
        endMs: 1_600,
      },
    ]);

    expect(timed).toHaveLength(1);
    expect(tokenAtTime(timed, 1_450)?.text).toBe("timed");
    expect(tokenAtTime(timed, 1_600)).toBeUndefined();
  });

  it("windows a ten-thousand-segment transcript to a small render range", () => {
    expect(
      transcriptVirtualWindow({
        itemCount: 10_000,
        scrollTop: 72_000,
        viewportHeight: 504,
        rowHeight: 72,
      }),
    ).toEqual({
      startIndex: 995,
      endIndex: 1_012,
      offsetTop: 71_640,
      totalHeight: 720_000,
    });
  });
});

describe("normalized transcript fixtures", () => {
  it("attaches segments to their canonical track and preserves cue timing", () => {
    const transcript = normalizeTranscriptFixture(fixture);

    expect(transcript.track.timingPrecision).toBe("cue");
    expect(transcript.segments[0]?.trackId).toBe(transcript.track.id);
    expect(segmentAtTime(transcript.segments, 1_900)?.ordinal).toBe(1);
  });

  it("supports literal case-insensitive segment search", () => {
    const transcript = normalizeTranscriptFixture(fixture);

    expect(searchTranscript(transcript.segments, "CUE-LEVEL")).toHaveLength(1);
    expect(searchTranscript(transcript.segments, "")).toHaveLength(2);
  });

  it("returns stable cross-cue occurrences without filtering the transcript", () => {
    const transcript = normalizeTranscriptFixture(wordFixture);

    const matches = searchTranscriptOccurrences(transcript, "TIMING.   click");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.ranges).toHaveLength(2);
    expect(matches[0]?.startSegmentId).toBe(transcript.segments[0]?.id);
    expect(matches[0]?.timingPrecision).toBe("word");
    expect(matches[0]?.startMs).toBe(950);
    expect(transcript.segments).toHaveLength(2);
  });
});

describe("WebVTT normalization", () => {
  it("ignores YouTube header metadata before the first cue", async () => {
    const transcript = await normalizeWebVttCaption({
      contents:
        "WEBVTT\nKind: captions\nLanguage: en-US\n\n00:00:27.360 --> 00:00:28.400\nSynthetic caption.\n",
      videoId: "M7lc1UVf-VE",
      language: "en-US",
      source: "youtube-manual",
      provider: "yt-dlp",
    });

    expect(transcript.segments).toMatchObject([
      {
        ordinal: 0,
        startMs: 27_360,
        endMs: 28_400,
        text: "Synthetic caption.",
      },
    ]);
    expect(transcript.tokens.map((token) => token.text)).toEqual([
      "Synthetic",
      "caption.",
    ]);
  });

  it("normalizes metadata, cue settings, markup, entities, and overlap honestly", async () => {
    const contents = await readFile(webVttFixture);
    const transcript = await normalizeWebVttCaption({
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en-US",
      source: "youtube-manual",
      provider: "yt-dlp",
    });

    expect(transcript.track).toMatchObject({
      videoId: "M7lc1UVf-VE",
      language: "en-US",
      kind: "english",
      source: "youtube-manual",
      provider: "yt-dlp",
      timingPrecision: "cue",
    });
    expect(transcript.track.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(transcript.segments).toMatchObject([
      {
        ordinal: 0,
        startMs: 1_000,
        endMs: 4_000,
        text: "First <overlapping> cue.",
      },
      {
        ordinal: 1,
        startMs: 3_500,
        endMs: 5_250,
        text: "Second & final line.",
      },
    ]);
    expect(transcript.tokens.map((token) => token.text)).toEqual([
      "First",
      "<overlapping>",
      "cue.",
      "Second",
      "&",
      "final",
      "line.",
    ]);
    expect(
      transcript.tokens.every((token) => token.startMs === undefined),
    ).toBe(true);
  });

  it("produces stable IDs and hashes for equivalent normalized content", async () => {
    const input = {
      contents: "WEBVTT\r\n\r\n00:00.000 --> 00:01.250\r\nHello\r\n",
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto" as const,
      provider: "yt-dlp",
    };

    const first = await normalizeWebVttCaption(input);
    const second = await normalizeWebVttCaption({
      ...input,
      contents: "WEBVTT\n\n00:00.000 --> 00:01.250\nHello\n",
    });

    expect(second).toEqual(first);
  });

  it("converts hour-form timestamps to integer source milliseconds", async () => {
    const transcript = await normalizeWebVttCaption({
      contents:
        "WEBVTT\n\n01:02:03.004 --> 01:02:05.006 line:90%\nLong-form timing\n",
      videoId: "M7lc1UVf-VE",
      language: "es",
      source: "youtube-auto",
      provider: "yt-dlp",
    });

    expect(transcript.segments[0]).toMatchObject({
      startMs: 3_723_004,
      endMs: 3_725_006,
    });
  });

  it("ignores empty YouTube transition cues when readable cues remain", async () => {
    const transcript = await normalizeWebVttCaption({
      contents:
        "WEBVTT\nKind: captions\nLanguage: en\n\n00:00.000 --> 00:01.000 align:start position:0%\nFirst line\n\n00:01.000 --> 00:01.010 align:start position:0%\n \n \n\n00:01.010 --> 00:02.000 align:start position:0%\nSecond line\n",
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });

    expect(transcript.segments).toMatchObject([
      { ordinal: 0, startMs: 0, endMs: 1_000, text: "First line" },
      { ordinal: 1, startMs: 1_010, endMs: 2_000, text: "Second line" },
    ]);
  });

  it.each([
    ["missing header", "00:00.000 --> 00:01.000\nText"],
    ["invalid timestamp", "WEBVTT\n\n00:61.000 --> 00:62.000\nText"],
    ["backward cue", "WEBVTT\n\n00:02.000 --> 00:01.000\nText"],
    ["empty cue", "WEBVTT\n\n00:00.000 --> 00:01.000\n<c.red></c>"],
  ])("rejects %s", async (_label, contents) => {
    await expect(
      normalizeWebVttCaption({
        contents,
        videoId: "M7lc1UVf-VE",
        language: "en",
        source: "youtube-auto",
        provider: "yt-dlp",
      }),
    ).rejects.toMatchObject({ code: "invalid_webvtt", retryable: false });
  });
});

describe("manual timed bilingual import", () => {
  const originalSrt = new TextEncoder().encode(
    "1\n00:00:00,000 --> 00:00:01,000\nའབྲུག\n\n2\n00:00:01,250 --> 00:00:02,000\nསྐད་ཡིག\n",
  );
  const englishVtt = new TextEncoder().encode(
    "WEBVTT\n\n00:00.000 --> 00:00.800\nBhutan\n\n00:00.900 --> 00:02.000\nLanguage\n",
  );

  it("normalizes distinct valid cue segmentation into directly linked deterministic tracks", async () => {
    const input = {
      importId: "019fbb95-cd76-7920-93fa-e23ba755ee61",
      videoId: "fixture-dzongkha",
      sourceLanguage: "dz",
      durationMs: 2_500,
      original: { format: "srt" as const, bytes: originalSrt },
      english: { format: "vtt" as const, bytes: englishVtt },
    };
    const first = await normalizeManualTimedBilingualImport(input);
    const second = await normalizeManualTimedBilingualImport(input);

    expect(second).toEqual(first);
    expect(first.original.track).toMatchObject({
      language: "dz",
      kind: "original",
      source: "manual-import",
      provider: "researcher-timed-import",
      timingPrecision: "cue",
    });
    expect(first.english.track).toMatchObject({
      language: "en",
      kind: "english",
      source: "manual-import",
      sourceTrackId: first.original.track.id,
    });
    expect(first.original.segments).toHaveLength(2);
    expect(first.english.segments).toHaveLength(2);
    expect(first.originalSrt).toContain("00:00:01,250");
  });

  it.each([
    [
      "invalid UTF-8",
      new Uint8Array([0xc3, 0x28]),
      "manual_import_invalid_utf8",
    ],
    [
      "unordered cues",
      new TextEncoder().encode(
        "1\n00:00:01,000 --> 00:00:01,500\nLater\n\n2\n00:00:00,000 --> 00:00:00,500\nEarlier\n",
      ),
      "manual_import_cue_order_invalid",
    ],
    [
      "overlap",
      new TextEncoder().encode(
        "1\n00:00:00,000 --> 00:00:01,500\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond\n",
      ),
      "manual_import_cue_overlap",
    ],
    [
      "duration overflow",
      new TextEncoder().encode("1\n00:00:00,000 --> 00:00:03,000\nToo long\n"),
      "manual_import_cue_out_of_bounds",
    ],
  ])("rejects %s with a closed safe code", async (_label, bytes, code) => {
    await expect(
      normalizeManualTimedBilingualImport({
        importId: "019fbb95-cd76-7920-93fa-e23ba755ee61",
        videoId: "fixture-dzongkha",
        sourceLanguage: "dz",
        durationMs: 2_500,
        original: { format: "srt", bytes },
        english: { format: "vtt", bytes: englishVtt },
      }),
    ).rejects.toMatchObject({ code, retryable: false });
  });

  it("rejects English and unresolved source languages", async () => {
    await expect(
      normalizeManualTimedBilingualImport({
        importId: "019fbb95-cd76-7920-93fa-e23ba755ee61",
        videoId: "fixture-english",
        sourceLanguage: "en",
        durationMs: 2_500,
        original: { format: "srt", bytes: originalSrt },
        english: { format: "vtt", bytes: englishVtt },
      }),
    ).rejects.toMatchObject({ code: "manual_import_invalid_language" });
  });
});
