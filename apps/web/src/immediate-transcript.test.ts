import { describe, expect, it } from "vitest";

import { TranscriptionBatchItemSchema } from "@research-video/contracts";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };

import {
  immediateBatchRequest,
  immediateProgress,
  verifiedEnglishTranscript,
} from "./immediate-transcript.ts";

const url = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
const youtubeVideoId = "M7lc1UVf-VE";
const catalogVideoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
const versionId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
const date = "2026-11-12T12:00:00.000Z";

function item(overrides: Record<string, unknown> = {}) {
  return TranscriptionBatchItemSchema.parse({
    id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
    batchId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
    inputIndex: 0,
    input: url,
    youtubeVideoId,
    canonicalUrl: url,
    catalogVideoId,
    status: "ready",
    processingNeed: "transcription",
    state: "queued",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 1,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  });
}

const english = normalizeTranscriptFixture(wordFixture);
function response(
  overrides: {
    transcriptVersionId?: string;
    source?: string;
    transcript?: unknown;
  } = {},
) {
  return {
    transcriptVersionId: versionId,
    source: "verified-local-cache",
    transcript: english,
    ...overrides,
  };
}

const expected = { youtubeVideoId, transcriptVersionId: versionId };

describe("immediate Research transcript adapter", () => {
  it("canonicalizes exactly one YouTube input using the existing local batch contract", () => {
    expect(immediateBatchRequest("https://youtu.be/M7lc1UVf-VE?t=30")).toEqual({
      name: "Immediate review",
      inputs: [url],
      targetLanguage: "en",
      transcriptionProfile: "default",
      sourcePolicy: "prefer-existing",
      executionLocation: "local",
      priority: "high",
    });
    expect(immediateBatchRequest(url).inputs).toHaveLength(1);
    expect(() =>
      immediateBatchRequest("https://example.com/not-a-video"),
    ).toThrow();
    expect(() => immediateBatchRequest(" ")).toThrow();
  });

  it.each([
    ["draft", "Preparing the transcript request."],
    ["preflight", "Checking video availability."],
    ["queued", "Waiting for the local transcription worker."],
    ["resolving", "Checking for an existing transcript or captions."],
    ["acquiring", "Fetching authorized captions or audio."],
    ["transcribing", "Transcribing with the local recognizer."],
    ["translating", "Preparing the English transcript."],
    ["aligning", "Preparing transcript timing."],
    ["uploading", "Saving the verified transcript."],
  ])("reports %s without treating it as ready", (state, message) => {
    expect(immediateProgress(item({ state }))).toEqual({
      kind: "working",
      message,
    });
  });

  it("requires both verified identity IDs and the exact active transcript version", () => {
    expect(immediateProgress(item({ state: "ready_for_review" }))).toEqual({
      kind: "failed",
      message:
        "The completed transcript is missing its verified identity or version.",
    });
    expect(
      immediateProgress(
        item({
          state: "ready_for_review",
          activeTranscriptVersionId: versionId,
        }),
      ),
    ).toEqual({
      kind: "ready",
      catalogVideoId,
      youtubeVideoId,
      transcriptVersionId: versionId,
    });
    for (const field of ["catalogVideoId", "youtubeVideoId"]) {
      expect(
        immediateProgress(
          item({
            state: "ready_for_review",
            activeTranscriptVersionId: versionId,
            [field]: undefined,
          }),
        ).kind,
      ).toBe("failed");
    }
  });

  it("fails closed on bad preflight statuses even if state appears ready", () => {
    for (const status of ["metadata-failed", "unsupported", "duplicate"]) {
      const result = immediateProgress(
        item({
          state: "ready_for_review",
          status,
          activeTranscriptVersionId: versionId,
        }),
      );
      expect(result.kind).toBe("failed");
      if (result.kind === "failed")
        expect(result.message).toMatch(/^[^\r\n]+\.$/);
    }
  });

  it("maps canceled, blocked, captionless and unavailable to safe terminal text", () => {
    expect(immediateProgress(item({ state: "blocked" }))).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("needs action"),
    });
    expect(immediateProgress(item({ state: "canceled" }))).toMatchObject({
      kind: "failed",
      message: expect.stringContaining("canceled"),
    });
    expect(
      immediateProgress(
        item({
          state: "failed",
          error: {
            code: "recognizer_not_configured",
            message: "/private/model-path",
            retryable: false,
          },
        }),
      ),
    ).toEqual({
      kind: "failed",
      message:
        "No captions are available and local speech recognition is not configured.",
    });
    expect(
      immediateProgress(
        item({
          state: "failed",
          error: {
            code: "source_unavailable",
            message: "stderr: secret",
            retryable: true,
          },
        }),
      ),
    ).toEqual({
      kind: "failed",
      message: "This video cannot be fetched for authorized transcription.",
    });
  });

  it("never leaks arbitrary worker error strings (including filesystem paths)", () => {
    for (const state of ["failed", "blocked", "canceled"]) {
      const result = immediateProgress(
        item({
          state,
          error: {
            code: "worker_execution_failed",
            message: "/private/secrets/whisper stdout Bearer secret",
            retryable: true,
          },
        }),
      );
      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        expect(result.message).not.toMatch(
          /private|whisper stdout|Bearer|secret/,
        );
        expect(result.message).toMatch(/[.]$/);
      }
    }
  });

  it("accepts the actual normalized English document from a verified store", () => {
    for (const source of ["verified-local-cache", "shared-store"]) {
      expect(verifiedEnglishTranscript(response({ source }), expected)).toEqual(
        english,
      );
    }
  });

  it("rejects stale/wrong-version and wrong-video local responses", () => {
    expect(() =>
      verifiedEnglishTranscript(
        response({ transcriptVersionId: catalogVideoId }),
        expected,
      ),
    ).toThrow(/does not match/);
    expect(() =>
      verifiedEnglishTranscript(
        response({
          transcript: {
            ...english,
            track: { ...english.track, videoId: "other-video" },
          },
        }),
        expected,
      ),
    ).toThrow(/does not match/);
    expect(() =>
      verifiedEnglishTranscript(response(), {
        ...expected,
        transcriptVersionId: catalogVideoId,
      }),
    ).toThrow(/does not match/);
  });

  it("never accepts an original-language track, spoofed source or bad schema", () => {
    expect(() =>
      verifiedEnglishTranscript(
        response({
          transcript: {
            ...english,
            track: { ...english.track, kind: "original" },
          },
        }),
        expected,
      ),
    ).toThrow(/does not match/);
    expect(() =>
      verifiedEnglishTranscript(
        response({ source: "unverified-memory" }),
        expected,
      ),
    ).toThrow();
    expect(() =>
      verifiedEnglishTranscript(response({ transcript: {} }), expected),
    ).toThrow();
    expect(() =>
      verifiedEnglishTranscript(
        { ...response(), transcriptVersionId: undefined },
        expected,
      ),
    ).toThrow();
  });
});
