import { describe, expect, it, vi } from "vitest";

import type { NormalizedTranscript } from "@research-video/contracts";

import { HttpClaimedTranslationClient } from "./translation-cloud.ts";

const source = {
  track: {
    id: "019fbb95-cd76-7920-93fa-e23ba755ee31",
    videoId: "Romanian001",
    language: "ro",
    kind: "original",
    source: "generated",
    provider: "fixture",
    timingPrecision: "cue",
    schemaVersion: 1,
    contentSha256: "a".repeat(64),
    version: 1,
  },
  segments: [
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee32",
      trackId: "019fbb95-cd76-7920-93fa-e23ba755ee31",
      ordinal: 0,
      startMs: 0,
      endMs: 1_000,
      text: "Bună ziua",
    },
  ],
  tokens: [],
} satisfies NormalizedTranscript;

const sourceArtifact = {
  type: "original-normalized" as const,
  objectKey: "projects/project/transcripts/upload/original-normalized.json",
  objectVersionId: "version-1",
  byteSize: 512,
  sha256: "c".repeat(64),
};
const normalizedArtifact = {
  type: "english-normalized" as const,
  objectKey: "projects/project/transcripts/upload/english-normalized.json",
  objectVersionId: "version-english-1",
  byteSize: 512,
  sha256: "d".repeat(64),
};
const subtitleArtifact = {
  type: "english-srt" as const,
  objectKey: "projects/project/transcripts/upload/english-srt.json",
  objectVersionId: "version-srt-1",
  byteSize: 80,
  sha256: "e".repeat(64),
};

const translated = {
  track: {
    ...source.track,
    id: "019fbb95-cd76-7920-93fa-e23ba755ee33",
    language: "en",
    kind: "english",
    source: "translated",
    provider: "amazon-translate",
    sourceTrackId: source.track.id,
    contentSha256: "b".repeat(64),
  },
  segments: [
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee34",
      trackId: "019fbb95-cd76-7920-93fa-e23ba755ee33",
      ordinal: 0,
      startMs: 0,
      endMs: 1_000,
      text: "Hello",
    },
  ],
  tokens: [],
} satisfies NormalizedTranscript;

describe("HttpClaimedTranslationClient", () => {
  it("sends the exact claimed job and closed consent to the cloud API", async () => {
    const fetcher = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            transcript: translated,
            normalizedArtifact,
            subtitleArtifact,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const client = new HttpClaimedTranslationClient({
      baseUrl: "https://api.example.test",
      authorization: "Bearer access-token",
      fetcher: fetcher as typeof fetch,
    });

    await expect(
      client.translate({
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee35",
        attempt: 2,
        consent: {
          provider: "amazon-translate",
          disclosureVersion: 1,
          transcriptTextTransferAccepted: true,
        },
        uploadId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        sourceArtifact,
        targetLanguage: "en",
      }),
    ).resolves.toEqual({
      transcript: translated,
      normalizedArtifact,
      subtitleArtifact,
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.example.test/api/transcription-jobs/019fbb95-cd76-7920-93fa-e23ba755ee35/translate",
    );
    expect(init?.headers).toMatchObject({
      authorization: "Bearer access-token",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      attempt: 2,
      consent: { transcriptTextTransferAccepted: true },
      uploadId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
      sourceArtifact: { objectVersionId: "version-1" },
      targetLanguage: "en",
    });
  });

  it("returns only the bounded API failure", async () => {
    const client = new HttpClaimedTranslationClient({
      baseUrl: "https://api.example.test",
      authorization: "Bearer access-token",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "cloud_translation_unavailable",
              message: "Cloud translation is currently unavailable.",
              retryable: true,
            },
          }),
          { status: 503 },
        ),
    });

    await expect(
      client.translate({
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee35",
        attempt: 1,
        consent: {
          provider: "amazon-translate",
          disclosureVersion: 1,
          transcriptTextTransferAccepted: true,
        },
        uploadId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        sourceArtifact,
        targetLanguage: "en",
      }),
    ).rejects.toThrow("Cloud translation is currently unavailable.");
  });
});
