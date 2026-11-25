import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@research-video/auth";
import type { SharedProjectCatalog } from "@research-video/catalog";
import type {
  AuthenticatedActor,
  NormalizedTranscript,
} from "@research-video/contracts";
import type { TranslationRequest } from "@research-video/providers";

import { createCloudApi } from "./app.ts";

const actor: AuthenticatedActor = {
  userId: "019fbb95-cd76-7920-93fa-e23ba755ee31",
  externalSubject: "cognito:https://issuer.example:subject",
};
const jobId = "019fbb95-cd76-7920-93fa-e23ba755ee32";
const uploadId = "019fbb95-cd76-7920-93fa-e23ba755ee35";
const source = {
  track: {
    id: "019fbb95-cd76-7920-93fa-e23ba755ee33",
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
      id: "019fbb95-cd76-7920-93fa-e23ba755ee34",
      trackId: "019fbb95-cd76-7920-93fa-e23ba755ee33",
      ordinal: 0,
      startMs: 0,
      endMs: 1_000,
      text: "Bună ziua",
    },
  ],
  tokens: [],
} satisfies NormalizedTranscript;
const consent = {
  provider: "amazon-translate" as const,
  disclosureVersion: 1 as const,
  transcriptTextTransferAccepted: true as const,
};
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

describe("claimed transcription translation route", () => {
  it("authorizes the exact lease and invokes only the injected cloud provider", async () => {
    const loadClaimedTranscriptTranslationSource = vi.fn(async () => source);
    const getClaimedTranscriptTranslationPublication = vi.fn(
      async () => undefined,
    );
    const translate = vi.fn(async (input: TranslationRequest) => ({
      provider: "amazon-translate",
      segments: input.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: "Hello",
      })),
    }));
    const app = createCloudApi({
      catalog: {
        loadClaimedTranscriptTranslationSource,
        getClaimedTranscriptTranslationPublication,
        publishClaimedTranscriptTranslation: async (
          _actor: AuthenticatedActor,
          _jobId: string,
          input: { transcript: NormalizedTranscript },
        ) => ({
          transcript: input.transcript,
          normalizedArtifact,
          subtitleArtifact,
        }),
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
      translationProvider: { translate },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/translate`,
      payload: {
        attempt: 2,
        consent,
        uploadId,
        sourceArtifact,
        targetLanguage: "en",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(loadClaimedTranscriptTranslationSource).toHaveBeenCalledWith(
      actor,
      jobId,
      {
        attempt: 2,
        consent,
        uploadId,
        sourceArtifact,
        targetLanguage: "en",
      },
    );
    expect(translate).toHaveBeenCalledOnce();
    expect(response.json()).toMatchObject({
      transcript: {
        track: {
          kind: "english",
          language: "en",
          provider: "amazon-translate",
          sourceTrackId: source.track.id,
        },
        segments: [{ text: "Hello", startMs: 0, endMs: 1_000 }],
      },
    });
    await app.close();
  });

  it("rejects missing consent before authorization or provider work", async () => {
    const loadClaimedTranscriptTranslationSource = vi.fn();
    const translate = vi.fn();
    const app = createCloudApi({
      catalog: {
        loadClaimedTranscriptTranslationSource,
        getClaimedTranscriptTranslationPublication: vi.fn(),
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
      translationProvider: { translate },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/translate`,
      payload: { attempt: 1, uploadId, sourceArtifact, targetLanguage: "en" },
    });

    expect(response.statusCode).toBe(400);
    expect(loadClaimedTranscriptTranslationSource).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects client-supplied transcript text and bounds provider unavailability", async () => {
    const loadClaimedTranscriptTranslationSource = vi.fn(async () => source);
    const app = createCloudApi({
      catalog: {
        loadClaimedTranscriptTranslationSource,
        getClaimedTranscriptTranslationPublication: async () => undefined,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });

    const extraText = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/translate`,
      payload: {
        attempt: 1,
        consent,
        uploadId,
        sourceArtifact,
        source,
        targetLanguage: "en",
      },
    });
    expect(extraText.statusCode).toBe(400);
    expect(loadClaimedTranscriptTranslationSource).not.toHaveBeenCalled();

    const unavailable = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/translate`,
      payload: {
        attempt: 1,
        consent,
        uploadId,
        sourceArtifact,
        targetLanguage: "en",
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: {
        code: "cloud_translation_unavailable",
        message: "Cloud translation is currently unavailable.",
        retryable: true,
      },
    });
    await app.close();
  });

  it("never calls Translate when project or lease authorization fails", async () => {
    const translate = vi.fn();
    const app = createCloudApi({
      catalog: {
        loadClaimedTranscriptTranslationSource: async () => {
          throw new AuthorizationError("Not authorized.");
        },
        getClaimedTranscriptTranslationPublication: vi.fn(),
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
      translationProvider: { translate },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/translate`,
      payload: {
        attempt: 1,
        consent,
        uploadId,
        sourceArtifact,
        targetLanguage: "en",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(translate).not.toHaveBeenCalled();
    await app.close();
  });
});
