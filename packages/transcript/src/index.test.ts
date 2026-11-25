import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };
import bilingualFixture from "../../../tests/fixtures/transcripts/spanish-bilingual.json" with { type: "json" };
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import {
  applyAcousticAlignment,
  clipRelativeSrt,
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
  transcriptNavigationTokens,
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
  it("uses exact caption starts and derived last-word ends for reverse selection and export padding", async () => {
    const transcript = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    expect(transcript.tokens[1]).toMatchObject({
      startMs: 11_840,
      endMs: 12_030,
      endTiming: "derived",
    });
    const selection = deriveTranscriptSelection({
      transcript,
      anchor: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[3]!.id,
      },
      focus: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[1]!.id,
      },
      paddingBeforeMs: 200,
      paddingAfterMs: 500,
      sourceDurationMs: 13_350,
    });
    expect(selection).toMatchObject({
      transcriptStartMs: 11_840,
      transcriptEndMs: 13_100,
      exportStartMs: 11_640,
      exportEndMs: 13_350,
      text: "closely now please",
      timingPrecision: "estimated",
      endTiming: "derived",
    });
    expect(
      updateTranscriptSelectionExportBounds(selection, {
        startMs: 11_500,
        endMs: 13_200,
      }),
    ).toMatchObject({
      transcriptStartMs: 11_840,
      transcriptEndMs: 13_100,
      endTiming: "derived",
      exportStartMs: 11_500,
      exportEndMs: 13_200,
    });
  });

  it("falls back to cue bounds rather than inventing partial word selection", async () => {
    const transcript = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    const incomplete = {
      ...transcript,
      tokens: transcript.tokens.map((token, index) =>
        index === 3
          ? {
              ...token,
              startMs: undefined,
              endMs: undefined,
              endTiming: undefined,
            }
          : token,
      ),
    };
    const selection = deriveTranscriptSelection({
      transcript: incomplete,
      anchor: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[1]!.id,
      },
      focus: {
        segmentId: transcript.segments[0]!.id,
        tokenId: transcript.tokens[3]!.id,
      },
    });
    expect(selection).toMatchObject({
      transcriptStartMs: 11_500,
      transcriptEndMs: 13_100,
      timingPrecision: "estimated",
    });
    expect(selection).not.toHaveProperty("endTiming");
  });

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

  it("uses cue bounds when an aligned selection starts or ends on an unaligned token", async () => {
    const source = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    const aligned = await applyAcousticAlignment(source, {
      artifactId: "recognition-fixture",
      tokens: source.tokens.slice(1).map((token, index) =>
        index === 0
          ? {
              tokenId: token.id,
              status: "acoustic" as const,
              startMs: 11_840,
              endMs: 12_020,
            }
          : {
              tokenId: token.id,
              status: "unaligned" as const,
              startMs: null,
              endMs: null,
            },
      ),
    });
    const segment = aligned.segments[0]!;
    const selection = deriveTranscriptSelection({
      transcript: aligned,
      anchor: { segmentId: segment.id, tokenId: aligned.tokens[0]!.id },
      focus: { segmentId: segment.id, tokenId: aligned.tokens[1]!.id },
    });

    expect(selection).toMatchObject({
      transcriptStartMs: segment.startMs,
      transcriptEndMs: segment.endMs,
      timingPrecision: "cue",
    });
    expect(selection).not.toHaveProperty("endTiming");
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

  it("links translation to the aligned speech track without copying acoustic status", async () => {
    const source = normalizeTranscriptFixture(wordFixture);
    const alignedOriginal = await applyAcousticAlignment(source, {
      artifactId: "recognition-fixture",
      tokens: source.tokens.map((token) => ({
        tokenId: token.id,
        status: "acoustic" as const,
        startMs: token.startMs!,
        endMs: token.endMs!,
      })),
    });
    const translated = await normalizeTranslatedTranscript({
      sourceTranscript: alignedOriginal,
      targetLanguage: "es",
      provider: "fixture",
      translations: source.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: "Una traducción de ejemplo.",
      })),
    });

    expect(translated.track.sourceTrackId).toBe(alignedOriginal.track.id);
    expect(
      translated.tokens.every((token) => token.alignmentStatus === undefined),
    ).toBe(true);
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

describe("acoustic alignment normalization", () => {
  it("preserves token identity and order, fingerprints timings, and clears stale estimates", async () => {
    const source = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    const alignment = {
      artifactId: "recognition-fixture",
      tokens: [
        {
          tokenId: source.tokens[1]!.id,
          status: "acoustic" as const,
          startMs: 11_840,
          endMs: 12_020,
        },
        {
          tokenId: source.tokens[2]!.id,
          status: "unaligned" as const,
          startMs: null,
          endMs: null,
        },
      ],
    };

    const aligned = await applyAcousticAlignment(source, alignment);
    const repeated = await applyAcousticAlignment(source, alignment);

    expect(aligned.track).toMatchObject({
      timingPrecision: "cue",
      alignment: {
        artifactId: "recognition-fixture",
        sourceContentSha256: source.track.contentSha256,
      },
    });
    expect(aligned.track.id).not.toBe(source.track.id);
    expect(aligned.track.contentSha256).toBe(
      aligned.track.alignment?.fingerprint,
    );
    expect(aligned.track.id).toBe(repeated.track.id);
    expect(aligned.track.alignment?.fingerprint).toBe(
      repeated.track.alignment?.fingerprint,
    );
    expect(
      aligned.segments.map(({ id, text, ordinal }) => ({ id, text, ordinal })),
    ).toEqual(
      source.segments.map(({ id, text, ordinal }) => ({ id, text, ordinal })),
    );
    expect(
      aligned.tokens.map(({ id, text, ordinal }) => ({ id, text, ordinal })),
    ).toEqual(
      source.tokens.map(({ id, text, ordinal }) => ({ id, text, ordinal })),
    );
    expect(aligned.tokens.slice(0, 4)).toMatchObject([
      { alignmentStatus: "unaligned" },
      {
        startMs: 11_840,
        endMs: 12_020,
        alignmentStatus: "acoustic",
      },
      { alignmentStatus: "unaligned" },
      { alignmentStatus: "unaligned" },
    ]);
    expect(
      aligned.tokens.every(
        (token) => !("endTiming" in token) && !("timingConfidence" in token),
      ),
    ).toBe(true);

    const changed = await applyAcousticAlignment(source, {
      ...alignment,
      tokens: [
        {
          tokenId: source.tokens[1]!.id,
          status: "acoustic",
          startMs: 11_850,
          endMs: 12_020,
        },
        alignment.tokens[1]!,
      ],
    });
    expect(changed.track.alignment?.fingerprint).not.toBe(
      aligned.track.alignment?.fingerprint,
    );
  });

  it("rejects unexpected IDs and invalid acoustic bounds", async () => {
    const source = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    await expect(
      applyAcousticAlignment(source, {
        artifactId: "recognition-fixture",
        tokens: [
          {
            tokenId: "unexpected-token",
            status: "unaligned",
            startMs: null,
            endMs: null,
          },
        ],
      }),
    ).rejects.toThrow(/unknown token/u);
    await expect(
      applyAcousticAlignment(source, {
        artifactId: "recognition-fixture",
        tokens: [
          {
            tokenId: source.tokens[0]!.id,
            status: "acoustic",
            startMs: -1,
            endMs: 100,
          },
        ],
      }),
    ).rejects.toThrow(/bounds .* invalid/u);
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

describe("clip-relative SRT sidecars", () => {
  it("clamps and zero-bases English cues at the exported range, not selected speech", () => {
    const transcript = normalizeTranscriptFixture(wordFixture);
    const before = structuredClone(transcript);
    const cues = deriveClipRelativeSrtCues({
      transcript,
      startMs: 1_000,
      endMs: 2_500,
    });
    expect(cues).toEqual([
      {
        startMs: 0,
        endMs: 800,
        text: "This fixture has accurate word timing.",
      },
      { startMs: 800, endMs: 1_500, text: "Click any word to seek precisely." },
    ]);
    expect(clipRelativeSrt({ transcript, startMs: 1_000, endMs: 2_500 })).toBe(
      "1\n00:00:00,000 --> 00:00:00,800\nThis fixture has accurate word timing.\n\n" +
        "2\n00:00:00,800 --> 00:00:01,500\nClick any word to seek precisely.\n",
    );
    expect(transcript).toEqual(before);
  });

  it("retains cue timing and padded handle coverage for non-word transcript", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    expect(
      deriveClipRelativeSrtCues({ transcript, startMs: 900, endMs: 2_200 }),
    ).toEqual([
      { startMs: 0, endMs: 900, text: "This fixture is intentionally short." },
      {
        startMs: 900,
        endMs: 1_300,
        text: "It tests cue-level transcript behavior.",
      },
    ]);
  });

  it("produces independent clip-bounded original and translated subtitles", () => {
    for (const input of [bilingualFixture.original, bilingualFixture.english]) {
      const transcript = normalizeTranscriptFixture(input);
      const srt = clipRelativeSrt({ transcript, startMs: 1_000, endMs: 1_800 });
      expect(srt).toContain("00:00:00,000 --> 00:00:00,800");
      expect(srt).not.toContain("00:00:02,500");
      expect(srt).toContain(transcript.segments[0]!.text);
    }
  });

  it("rejects inverted, invalid, empty and edge-only ranges", () => {
    const transcript = normalizeTranscriptFixture(fixture);
    for (const bounds of [
      { startMs: -1, endMs: 10 },
      { startMs: 1_000, endMs: 1_000 },
      { startMs: 2_000, endMs: 1_000 },
      { startMs: 0.5, endMs: 1_000 },
      { startMs: 0, endMs: Number.POSITIVE_INFINITY },
    ]) {
      expect(() =>
        deriveClipRelativeSrtCues({ transcript, ...bounds }),
      ).toThrow(/bounds/u);
    }
    expect(() =>
      clipRelativeSrt({ transcript, startMs: 4_000, endMs: 5_000 }),
    ).toThrow(/no cues/u);
    expect(() =>
      clipRelativeSrt({ transcript, startMs: 9_000, endMs: 10_000 }),
    ).toThrow(/no cues/u);
  });
});

const webVttFixture = new URL(
  "../../../tests/fixtures/transcripts/caption-sample.vtt",
  import.meta.url,
);
const autoWordTimedFixture = new URL(
  "../../../tests/fixtures/transcripts/auto-word-timed.vtt",
  import.meta.url,
);

const rollingAutoCaptionFixture = new URL(
  "../../../tests/fixtures/transcripts/youtube-auto-rolling.vtt",
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

  it("preserves exact word bounds and estimates untimed positions inside a cue", () => {
    const cue = {
      id: "cue",
      trackId: "track",
      ordinal: 0,
      startMs: 1_000,
      endMs: 2_000,
      text: "one two three four",
    };
    const estimated = transcriptNavigationTokens(
      [cue],
      ["one", "two", "three", "four"].map((text, ordinal) => ({
        id: `estimated-${ordinal}`,
        segmentId: cue.id,
        ordinal,
        text,
      })),
    );

    expect(
      estimated.map(({ startMs, endMs, timingPrecision }) => ({
        startMs,
        endMs,
        timingPrecision,
      })),
    ).toEqual([
      { startMs: 1_000, endMs: 1_250, timingPrecision: "estimated" },
      { startMs: 1_250, endMs: 1_500, timingPrecision: "estimated" },
      { startMs: 1_500, endMs: 1_750, timingPrecision: "estimated" },
      { startMs: 1_750, endMs: 2_000, timingPrecision: "estimated" },
    ]);
    expect(tokenAtTime(estimated, 1_510)?.text).toBe("three");

    const exact = transcriptNavigationTokens(
      [cue],
      [
        {
          id: "exact",
          segmentId: cue.id,
          ordinal: 0,
          text: "exact",
          startMs: 1_123,
          endMs: 1_456,
        },
      ],
    );
    expect(exact[0]).toMatchObject({
      startMs: 1_123,
      endMs: 1_456,
      timingPrecision: "word",
    });
  });

  it("clamps short cue estimates and leaves tokenless segments cue-only", () => {
    const shortCue = {
      id: "short-cue",
      trackId: "track",
      ordinal: 0,
      startMs: 2_000,
      endMs: 2_001,
      text: "a b c",
    };
    const short = transcriptNavigationTokens(
      [shortCue],
      ["a", "b", "c"].map((text, ordinal) => ({
        id: `short-${ordinal}`,
        segmentId: shortCue.id,
        ordinal,
        text,
      })),
    );
    expect(short).toHaveLength(3);
    expect(
      short.every(
        (token) =>
          token.startMs === shortCue.startMs &&
          token.endMs === shortCue.endMs &&
          token.timingPrecision === "estimated",
      ),
    ).toBe(true);

    const single = transcriptNavigationTokens(
      [{ ...shortCue, startMs: 3_000, endMs: 3_500 }],
      [
        {
          id: "single",
          segmentId: shortCue.id,
          ordinal: 0,
          text: "single",
        },
      ],
    );
    expect(single[0]).toMatchObject({ startMs: 3_000, endMs: 3_500 });
    expect(transcriptNavigationTokens([shortCue], [])).toEqual([]);
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
  it("preserves exact inline auto-caption starts and caps only derived ends", async () => {
    const transcript = await normalizeWebVttCaption({
      contents: await readFile(autoWordTimedFixture),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });

    expect(transcript.track).toMatchObject({
      timingPrecision: "estimated",
      schemaVersion: 2,
    });
    expect(
      transcript.segments.map(({ startMs, endMs, text }) => ({
        startMs,
        endMs,
        text,
      })),
    ).toEqual([
      { startMs: 11_500, endMs: 13_100, text: "Look closely now please" },
      { startMs: 13_000, endMs: 15_500, text: "Résumé & José" },
      { startMs: 3_723_004, endMs: 3_724_000, text: "hours count" },
    ]);
    expect(
      transcript.tokens.map(({ text, startMs, endMs }) => ({
        text,
        startMs,
        endMs,
      })),
    ).toEqual([
      { text: "Look", startMs: 11_500, endMs: 11_840 },
      { text: "closely", startMs: 11_840, endMs: 12_030 },
      { text: "now", startMs: 12_030, endMs: 12_530 },
      { text: "please", startMs: 12_900, endMs: 13_100 },
      { text: "Résumé", startMs: 13_200, endMs: 13_600 },
      { text: "&", startMs: 13_600, endMs: 14_100 },
      { text: "José", startMs: 14_200, endMs: 14_700 },
      { text: "hours", startMs: 3_723_120, endMs: 3_723_300 },
      { text: "count", startMs: 3_723_300, endMs: 3_723_800 },
    ]);
    expect(
      tokenAtTime(timedTranscriptTokens(transcript.tokens), 11_840)?.text,
    ).toBe("closely");
    expect(transcript.track.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses a new identity for changed inline timing, but not CRLF or display-only markup", async () => {
    const contents = await readFile(autoWordTimedFixture, "utf8");
    const input = {
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto" as const,
      provider: "yt-dlp",
    };
    const baseline = await normalizeWebVttCaption(input);
    const changed = await normalizeWebVttCaption({
      ...input,
      contents: contents.replace("<00:00:11.840>", "<00:00:11.841>"),
    });
    expect(changed.segments.map((segment) => segment.text)).toEqual(
      baseline.segments.map((segment) => segment.text),
    );
    expect(changed.track.contentSha256).not.toBe(baseline.track.contentSha256);
    expect(changed.track.id).not.toBe(baseline.track.id);
    expect(changed.tokens[1]?.startMs).toBe(11_841);
    const equivalent = await normalizeWebVttCaption({
      ...input,
      contents: contents
        .replaceAll("\n", "\r\n")
        .replaceAll("<c>", "<c.green>"),
    });
    expect(equivalent).toEqual(baseline);
  });

  it("keeps manual captions cue timed even if their VTT contains inline markers", async () => {
    const contents = await readFile(autoWordTimedFixture, "utf8");
    const input = {
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-manual" as const,
      provider: "yt-dlp",
    };
    const actual = await normalizeWebVttCaption(input);
    const withoutMarkup = await normalizeWebVttCaption({
      ...input,
      contents: contents.replaceAll(/<[^>]*>/gu, ""),
    });
    expect(actual).toEqual(withoutMarkup);
    expect(actual.track).toMatchObject({
      timingPrecision: "cue",
      schemaVersion: 1,
    });
    expect(actual.tokens.every((token) => token.startMs === undefined)).toBe(
      true,
    );
  });

  it("never invents starts for multiword, missing, invalid or word-internal markers", async () => {
    const contents = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.000",
      "<00:00:01.100><c> two words</c> plain<00:00:01.800><c> safe</c><00:00:02.100><c> solo</c>",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "Hel<00:00:04.500>lo <00:00:04.800><c> there</c>",
      "",
      "00:00:07.000 --> 00:00:09.000",
      "<00:00:07.100><c> first</c><00:00:07.100><c> repeat</c><00:00:07.050><c> backward</c><00:00:07.800><c> recover</c>",
      "",
      "00:00:10.000 --> 00:00:12.000",
      "No inline word timestamp here",
      "",
    ].join("\n");
    const transcript = await normalizeWebVttCaption({
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    const byText = new Map(
      transcript.tokens.map((token) => [token.text, token]),
    );
    for (const word of [
      "two",
      "words",
      "plain",
      "Hello",
      "repeat",
      "backward",
      "No",
      "inline",
      "word",
      "timestamp",
      "here",
    ]) {
      expect(byText.get(word)?.startMs, word).toBeUndefined();
    }
    expect(byText.get("safe")).toMatchObject({ startMs: 1_800, endMs: 2_100 });
    expect(byText.get("solo")).toMatchObject({ startMs: 2_100, endMs: 2_600 });
    expect(byText.get("there")).toMatchObject({ startMs: 4_800, endMs: 5_300 });
    expect(byText.get("first")).toMatchObject({ startMs: 7_100, endMs: 7_600 });
    expect(byText.get("recover")).toMatchObject({
      startMs: 7_800,
      endMs: 8_300,
    });
    expect(transcript.track.timingPrecision).toBe("estimated");
  });

  it("stays cue-only if all available inline spans are ambiguous", async () => {
    const input = {
      contents:
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<00:00:01.200><c> two words</c>\n",
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto" as const,
      provider: "yt-dlp",
    };
    const transcript = await normalizeWebVttCaption(input);
    expect(transcript.track).toMatchObject({
      timingPrecision: "cue",
      schemaVersion: 1,
    });
    expect(
      transcript.tokens.every((token) => token.startMs === undefined),
    ).toBe(true);
  });

  it("rejects out-of-cue starts and malformed inline markers without moving valid words", async () => {
    const transcript = await normalizeWebVttCaption({
      contents: [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "<00:00:00.950><c> early</c><00:00:01.100><c> valid</c><00:00:02.000><c> late</c><00:00:99.123><c> bad</c>",
      ].join("\n"),
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });
    expect(
      transcript.tokens.map(({ text, startMs, endMs }) => ({
        text,
        startMs,
        endMs,
      })),
    ).toEqual([
      { text: "early", startMs: undefined, endMs: undefined },
      { text: "valid", startMs: 1_100, endMs: 1_600 },
      { text: "late", startMs: undefined, endMs: undefined },
      { text: "bad", startMs: undefined, endMs: undefined },
    ]);
  });

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
      contents:
        "WEBVTT\r\nKind: captions\r\nLanguage: en\r\n\r\n00:00.000 --> 00:01.250\r\nHello\r\n",
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

  it("skips empty cues while preserving the following speech cues", async () => {
    const transcript = await normalizeWebVttCaption({
      contents:
        "WEBVTT\n\n00:00.000 --> 00:01.000\nFirst word\n\n" +
        "00:01.000 --> 00:02.000\n<c></c>\n\n" +
        "00:02.000 --> 00:03.000\nSecond word\n",
      videoId: "M7lc1UVf-VE",
      language: "en",
      provider: "fixture",
      source: "youtube-auto",
    });
    expect(
      transcript.segments.map(({ startMs, text }) => [startMs, text]),
    ).toEqual([
      [0, "First word"],
      [2_000, "Second word"],
    ]);
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

  it("merges YouTube automatic rolling caption windows into spoken lines", async () => {
    const contents = await readFile(rollingAutoCaptionFixture);
    const transcript = await normalizeWebVttCaption({
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-auto",
      provider: "yt-dlp",
    });

    // Each spoken line appears once. A repeated line that carries inline
    // timing tags is newly spoken (the speaker repeated it) and is retained.
    expect(
      transcript.segments.map(({ startMs, endMs, text }) => ({
        startMs,
        endMs,
        text,
      })),
    ).toEqual([
      { startMs: 1_000, endMs: 3_000, text: "alpha bravo charlie" },
      { startMs: 3_010, endMs: 5_000, text: "delta echo foxtrot" },
      { startMs: 5_010, endMs: 7_000, text: "delta echo foxtrot" },
      { startMs: 7_010, endMs: 9_000, text: "golf" },
    ]);
    expect(transcript.tokens.map((token) => token.text)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
      "delta",
      "echo",
      "foxtrot",
      "golf",
    ]);
    expect(transcript.track.timingPrecision).toBe("estimated");
    expect(transcript.tokens.map(({ startMs }) => startMs)).toEqual([
      1_000,
      1_500,
      2_000,
      3_010,
      3_500,
      4_000,
      5_010,
      5_500,
      6_000,
      undefined,
    ]);
  });

  it("keeps rolling-window repeats in manual captions untouched", async () => {
    const contents = await readFile(rollingAutoCaptionFixture);
    const transcript = await normalizeWebVttCaption({
      contents,
      videoId: "M7lc1UVf-VE",
      language: "en",
      source: "youtube-manual",
      provider: "yt-dlp",
    });

    expect(transcript.segments).toHaveLength(7);
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
