import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import fixture from "../../../tests/fixtures/transcripts/english-cue.json" with { type: "json" };
import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };
import bilingualFixture from "../../../tests/fixtures/transcripts/spanish-bilingual.json" with { type: "json" };

import {
  deriveTranscriptSelection,
  normalizeTranscriptFixture,
  normalizeGeneratedTranscript,
  normalizeTranslatedTranscript,
  normalizeWebVttCaption,
  searchTranscript,
  segmentAtTime,
  timedTranscriptTokens,
  tokenAtTime,
  transcriptVirtualWindow,
  transcriptToSrt,
  updateTranscriptSelectionExportBounds,
  type TranscriptSegment,
} from "./index.ts";

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
});

const webVttFixture = new URL(
  "../../../tests/fixtures/transcripts/caption-sample.vtt",
  import.meta.url,
);
const autoWordTimedFixture = new URL(
  "../../../tests/fixtures/transcripts/auto-word-timed.vtt",
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
