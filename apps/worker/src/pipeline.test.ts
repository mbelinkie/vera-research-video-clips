import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ActiveTranscriptBundle,
  ClaimedTranscriptionJob,
  FinalizedObject,
  NormalizedTranscript,
  TranscriptManifest,
  TranscriptUploadGrant,
} from "@research-video/contracts";
import { normalizeGeneratedTranscript } from "@research-video/transcript";
import type { TranslationRequest } from "@research-video/providers";

import {
  createTranscriptPipelineExecutor,
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
  it("starts a caption-only worker without an audio or recognizer opt-in", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-caption-only-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const vtt = await readFile(
      new URL(
        "../../../tests/fixtures/transcripts/auto-word-timed.vtt",
        import.meta.url,
      ),
    );
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "english:auto",
            language: "en",
            kind: "automatic",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const path = join(scratch, "captions.vtt");
          await writeFile(path, vtt);
          return {
            videoId,
            track,
            path,
            format: "vtt",
            byteSize: vtt.length,
            provider: "fixture",
          };
        },
      },
    });
    await executor(claimedJob(), {
      signal: new AbortController().signal,
      setStage: async () => undefined,
      recordSourcePlan: async () => undefined,
    });
    expect(publication.finalize).toHaveBeenCalledOnce();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("refuses an uncaptioned source immediately without acquiring audio when recognizer is disabled", async () => {
    const scratchRoot = await mkdtemp(
      join(tmpdir(), "pipeline-no-recognizer-"),
    );
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      media,
      captions: { discover: async () => [], acquire: vi.fn() },
    });
    await expect(
      executor(claimedJob(), {
        signal: new AbortController().signal,
        setStage: async () => undefined,
        recordSourcePlan: async () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "recognizer_not_configured",
      retryable: false,
    });
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("publishes and pins an English automatic VTT's word starts and derived ends", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-auto-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const speechToText = { transcribe: vi.fn() };
    const vtt = await readFile(
      new URL(
        "../../../tests/fixtures/transcripts/auto-word-timed.vtt",
        import.meta.url,
      ),
    );
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:automatic:en",
            language: "en",
            kind: "automatic",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const path = join(scratch, "auto.en.vtt");
          await writeFile(path, vtt);
          return {
            videoId,
            track,
            path,
            format: "vtt",
            byteSize: vtt.length,
            provider: "fixture",
          };
        },
      },
      media,
      speechToText,
    });
    const plans: unknown[] = [];
    await executor(claimedJob(), {
      signal: new AbortController().signal,
      setStage: async () => undefined,
      recordSourcePlan: async (plan) => void plans.push(plan),
    });
    const transcript = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("english-normalized")),
    ) as NormalizedTranscript;
    const manifest = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("manifest")),
    ) as TranscriptManifest;
    expect(transcript.track).toMatchObject({
      source: "youtube-auto",
      timingPrecision: "estimated",
      schemaVersion: 2,
    });
    expect(transcript.tokens[1]).toMatchObject({
      text: "closely",
      startMs: 11_840,
      endMs: 12_030,
      endTiming: "derived",
    });
    expect(manifest).toMatchObject({
      timingPrecision: "estimated",
      normalizationSchemaVersion: 2,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ type: "english-normalized" }),
      ]),
    });
    expect([...publication.uploaded.keys()].sort()).toEqual([
      "english-normalized",
      "english-srt",
      "manifest",
    ]);
    expect(plans).toMatchObject([
      { strategy: "caption", sourceLanguage: "en" },
    ]);
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(speechToText.transcribe).not.toHaveBeenCalled();
    expect(publication.finalize).toHaveBeenCalledOnce();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("keeps original foreign auto word starts without transferring them to English translation", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-auto-es-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const translate = vi.fn(async (input: TranslationRequest) => ({
      provider: "fixture-translation",
      segments: input.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: "Hello world",
      })),
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:automatic:es",
            language: "es",
            kind: "automatic",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const contents =
            "WEBVTT\n\n00:00.500 --> 00:02.500\n<00:00:00.610><c> Hola</c><00:00:01.200><c> mundo</c>\n";
          const path = join(scratch, "auto.es.vtt");
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
      media: { acquireAuthorizedSource: vi.fn() },
      speechToText: { transcribe: vi.fn() },
      translation: { translate },
    });
    await executor(claimedJob(), {
      signal: new AbortController().signal,
      setStage: async () => undefined,
      recordSourcePlan: async () => undefined,
    });
    const original = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("original-normalized")),
    ) as NormalizedTranscript;
    const english = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("english-normalized")),
    ) as NormalizedTranscript;
    const manifest = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("manifest")),
    ) as TranscriptManifest;
    expect(original.track.timingPrecision).toBe("estimated");
    expect(original.tokens[0]).toMatchObject({
      startMs: 610,
      endMs: 1_110,
      endTiming: "derived",
    });
    expect(original.tokens[1]).toMatchObject({
      startMs: 1_200,
      endMs: 1_700,
      endTiming: "derived",
    });
    expect(english.track).toMatchObject({
      source: "translated",
      timingPrecision: "cue",
      sourceTrackId: original.track.id,
    });
    expect(
      english.tokens.every(
        (token) => token.startMs === undefined && token.endTiming === undefined,
      ),
    ).toBe(true);
    expect(manifest.timingPrecision).toBe("cue");
    expect(translate).toHaveBeenCalledOnce();
    expect(publication.finalize).toHaveBeenCalledOnce();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

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
    const original = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("original-normalized")),
    ) as NormalizedTranscript;
    const english = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("english-normalized")),
    ) as NormalizedTranscript;
    expect(original.track).toMatchObject({
      source: "youtube-manual",
      timingPrecision: "cue",
    });
    expect(english.track).toMatchObject({
      source: "translated",
      timingPrecision: "cue",
    });
    expect(
      original.tokens.every((token) => token.endTiming === undefined),
    ).toBe(true);
    expect(english.tokens.every((token) => token.endTiming === undefined)).toBe(
      true,
    );
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
    const generated = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("english-normalized")),
    ) as NormalizedTranscript;
    expect(generated.track).toMatchObject({
      source: "generated",
      timingPrecision: "cue",
    });
    expect(
      generated.tokens.every((token) => token.endTiming === undefined),
    ).toBe(true);
    expect(await readdir(scratchRoot)).toEqual([]);
  });
});
