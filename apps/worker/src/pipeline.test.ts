import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ActiveTranscriptBundle,
  ClaimedTranscriptionJob,
  FinalizedObject,
  TranscriptUploadGrant,
} from "@research-video/contracts";
import { DerivedTranslationSchema } from "@research-video/contracts";
import {
  normalizeGeneratedTranscript,
  normalizeTranscriptFixture,
} from "@research-video/transcript";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import {
  createTranscriptPipelineExecutor,
  executeDerivedTranslation,
  type TranscriptPublicationClient,
} from "./pipeline.ts";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

describe("supplemental preferred translation worker", () => {
  it("translates directly from Romanian once and publishes a Spanish derivative", async () => {
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const projectId = randomUUID();
    const catalogVideoId = randomUUID();
    const baseTranscriptVersionId = randomUUID();
    const identity = {
      projectId,
      catalogVideoId,
      baseTranscriptVersionId,
      originalTrackId: original.track.id,
      originalContentSha256: original.track.contentSha256,
      targetLanguage: "es",
      provider: "fixture-translation",
      normalizationSchemaVersion: 1,
    };
    const translate = vi.fn(
      async (input: {
        segments: ReadonlyArray<{ id: string; text: string }>;
      }) => ({
        provider: "fixture-translation",
        segments: input.segments.map((segment, index) => ({
          sourceSegmentId: segment.id,
          text:
            index === 0
              ? "Este es un ejemplo rumano."
              : "La selección permanece vinculada por tiempo.",
        })),
      }),
    );
    const publish = vi.fn(async (input) =>
      DerivedTranslationSchema.parse({
        manifest: {
          schemaVersion: 1,
          id: randomUUID(),
          lineageId: randomUUID(),
          version: 1,
          identity,
          translatedTrackId: input.transcript.track.id,
          translatedTrackVersion: input.transcript.track.version,
          sourceTrackId: original.track.id,
          timingPrecision: "cue",
          idempotencyKey: input.idempotencyKey,
          createdBy: randomUUID(),
          createdAt: new Date().toISOString(),
          artifacts: [
            {
              type: "translated-normalized",
              objectKey: "fixture/translated.normalized.json",
              objectVersionId: "v1",
              byteSize: 123,
              sha256: "a".repeat(64),
            },
          ],
        },
        transcript: input.transcript,
      }),
    );
    const result = await executeDerivedTranslation({
      identity,
      idempotencyKey: "preferred:romanian:spanish",
      original,
      translation: { translate },
      publication: { publish },
    });
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[0]).toMatchObject({
      sourceLanguage: "ro",
      targetLanguage: "es",
    });
    expect(result.transcript.track).toMatchObject({
      kind: "translation",
      language: "es",
      sourceTrackId: original.track.id,
    });
    expect(publish).toHaveBeenCalledOnce();
  });
});

function claimedJob(): ClaimedTranscriptionJob {
  const jobId = randomUUID();
  const workerId = randomUUID();
  const timestamp = new Date().toISOString();
  return {
    job: {
      id: jobId,
      kind: "transcription",
      state: "claimed",
      projectId: randomUUID(),
      idempotencyKey: `transcription:${jobId}`,
      attempt: 1,
      payload: {
        batchId: randomUUID(),
        catalogVideoId: randomUUID(),
        youtubeVideoId: "M7lc1UVf-VE",
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "captions-then-generate",
        executionLocation: "local",
        priority: "normal",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    lease: {
      jobId,
      workerId,
      attempt: 1,
      claimedAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

function publicationFixture() {
  const uploaded = new Map<string, Uint8Array>();
  const finalize = vi.fn(async () => ({}) as ActiveTranscriptBundle);
  const client: TranscriptPublicationClient = {
    createUpload: async (jobId, input) =>
      ({
        uploadId: randomUUID(),
        jobId,
        projectId: randomUUID(),
        catalogVideoId: randomUUID(),
        lineageId: input.lineageId,
        version: input.version,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        targets: ["manifest", ...input.artifactTypes].map((type) => ({
          type,
          objectKey: `fixture/${type}.json`,
          uploadUrl: `https://upload.invalid/${type}`,
        })),
      }) as TranscriptUploadGrant,
    upload: async (target, bytes) => {
      uploaded.set(target.type, bytes.slice());
      return {
        type: target.type,
        objectKey: target.objectKey,
        objectVersionId: randomUUID(),
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      } as FinalizedObject;
    },
    finalize,
  };
  return { client, uploaded, finalize };
}

describe("transcript pipeline", () => {
  it("publishes separate time-linked original and English caption tracks", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const speechToText = { transcribe: vi.fn() };
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:manual:es",
            language: "es",
            kind: "manual",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const path = join(scratch, "caption.vtt");
          const contents =
            "WEBVTT\n\n00:00.500 --> 00:02.500\nEste es un ejemplo breve.\n";
          await writeFile(path, contents);
          return {
            videoId,
            track,
            path,
            format: "vtt",
            byteSize: Buffer.byteLength(contents),
            provider: "fixture",
          };
        },
      },
      media,
      speechToText,
      translation: {
        translate: async (input) => ({
          provider: "fixture-translation",
          segments: input.segments.map((segment) => ({
            sourceSegmentId: segment.id,
            text: "This is a short example.",
          })),
        }),
      },
    });
    const claimed = claimedJob();
    const plans: unknown[] = [];
    const stages: string[] = [];

    await executor(claimed, {
      signal: new AbortController().signal,
      setStage: async (stage) => void stages.push(stage),
      recordSourcePlan: async (plan) => void plans.push(plan),
    });

    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(speechToText.transcribe).not.toHaveBeenCalled();
    expect(stages).toEqual([
      "resolving",
      "acquiring",
      "translating",
      "uploading",
    ]);
    expect(plans).toMatchObject([
      { strategy: "caption", sourceLanguage: "es" },
    ]);
    expect([...publication.uploaded.keys()].sort()).toEqual([
      "english-normalized",
      "english-srt",
      "manifest",
      "original-normalized",
      "original-srt",
    ]);
    expect(
      new TextDecoder().decode(publication.uploaded.get("english-srt")),
    ).toContain("00:00:00,500 --> 00:00:02,500\nThis is a short example.");
    expect(await readdir(scratchRoot)).toEqual([]);
    expect(publication.finalize).toHaveBeenCalledOnce();
  });

  it("falls back from failed caption acquisition to ASR and cleans scratch", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const speechToText = vi.fn(async () =>
      normalizeGeneratedTranscript({
        videoId: "M7lc1UVf-VE",
        language: "en",
        provider: "fixture-asr",
        model: "fixture-model",
        segments: [{ startMs: 0, endMs: 1_000, text: "Generated English." }],
      }),
    );
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:manual:en",
            language: "en",
            kind: "manual",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async () => {
          throw new Error("caption disappeared");
        },
      },
      media: {
        acquireAuthorizedSource: async (videoId, scratch) => {
          const scratchPath = join(scratch, "audio.flac");
          await writeFile(scratchPath, "fixture audio");
          return {
            videoId,
            scratchPath,
            byteSize: 13,
            format: "flac",
            provider: "fixture",
            contentSha256: "0".repeat(64),
          };
        },
      },
      speechToText: { transcribe: speechToText },
    });
    const plans: Array<{ reason?: string }> = [];

    await executor(claimedJob(), {
      signal: new AbortController().signal,
      setStage: async () => undefined,
      recordSourcePlan: async (plan) => void plans.push(plan),
    });

    expect(plans).toMatchObject([{ reason: "caption-acquisition-failed" }]);
    expect(speechToText).toHaveBeenCalledOnce();
    expect([...publication.uploaded.keys()].sort()).toEqual([
      "english-normalized",
      "english-srt",
      "manifest",
    ]);
    expect(await readdir(scratchRoot)).toEqual([]);
  });
});
