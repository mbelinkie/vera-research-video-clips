import { z } from "zod";

import {
  CreateTranscriptionBatchRequestSchema,
  NormalizedTranscriptSchema,
  TranscriptionBatchItemSchema,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";

type BatchItem = z.infer<typeof TranscriptionBatchItemSchema>;

/** Immediate review is one ordinary project batch, never a separate job path. */
export function immediateBatchRequest(videoUrl: string) {
  const { canonicalUrl } = normalizeYouTubeUrl(videoUrl);
  return CreateTranscriptionBatchRequestSchema.parse({
    name: "Immediate review",
    inputs: [canonicalUrl],
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "high",
  });
}

export type ImmediateProgress =
  | { kind: "working"; message: string }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      catalogVideoId: string;
      youtubeVideoId: string;
      transcriptVersionId: string;
    };

const stageMessages: Partial<Record<BatchItem["state"], string>> = {
  draft: "Preparing the transcript request.",
  preflight: "Checking video availability.",
  queued: "Waiting for the local transcription worker.",
  resolving: "Checking for an existing transcript or captions.",
  acquiring: "Fetching authorized captions or audio.",
  transcribing: "Transcribing with the local recognizer.",
  translating: "Preparing the English transcript.",
  aligning: "Preparing transcript timing.",
  uploading: "Saving the verified transcript.",
};

/** Never display item.error.message: workers can put paths or stderr in it. */
export function immediateProgress(item: BatchItem): ImmediateProgress {
  if (item.status === "metadata-failed") {
    return {
      kind: "failed",
      message: "This video is unavailable for metadata lookup.",
    };
  }
  if (item.status === "unsupported" || item.status === "duplicate") {
    return {
      kind: "failed",
      message: "Enter a supported YouTube video URL.",
    };
  }
  if (item.state === "ready_for_review") {
    return item.youtubeVideoId &&
      item.catalogVideoId &&
      item.activeTranscriptVersionId
      ? {
          kind: "ready",
          youtubeVideoId: item.youtubeVideoId,
          catalogVideoId: item.catalogVideoId,
          transcriptVersionId: item.activeTranscriptVersionId,
        }
      : {
          kind: "failed",
          message:
            "The completed transcript is missing its verified identity or version.",
        };
  }
  if (item.state === "blocked") {
    return {
      kind: "failed",
      message: "This video needs action before transcription can continue.",
    };
  }
  if (item.state === "canceled") {
    return { kind: "failed", message: "Transcript processing was canceled." };
  }
  if (item.state === "failed") {
    const message =
      item.error?.code === "recognizer_not_configured"
        ? "No captions are available and local speech recognition is not configured."
        : item.error?.code === "translation_not_configured"
          ? "English translation is not configured for this source language."
          : item.error?.code === "source_unavailable"
            ? "This video cannot be fetched for authorized transcription."
            : "Transcript processing failed; check the local worker and retry.";
    return { kind: "failed", message };
  }
  return {
    kind: "working",
    message: stageMessages[item.state] ?? "Preparing transcript.",
  };
}

/** Shape of the authenticated local-agent transcript response. */
const ResolvedTranscriptSchema = z.object({
  transcriptVersionId: z.uuid(),
  source: z.enum(["verified-local-cache", "shared-store"]),
  transcript: NormalizedTranscriptSchema,
});

/** Fail closed on a response for another YouTube video or immutable version. */
export function verifiedEnglishTranscript(
  payload: unknown,
  expected: { youtubeVideoId: string; transcriptVersionId: string },
) {
  const resolved = ResolvedTranscriptSchema.parse(payload);
  if (
    resolved.transcriptVersionId !== expected.transcriptVersionId ||
    resolved.transcript.track.videoId !== expected.youtubeVideoId ||
    resolved.transcript.track.kind !== "english"
  ) {
    throw new Error(
      "The verified transcript does not match the selected video and version.",
    );
  }
  return resolved.transcript;
}
