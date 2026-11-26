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
import {
  DerivedTranslationSchema,
  NormalizedTranscriptSchema,
} from "@research-video/contracts";
import {
  applyAcousticAlignment,
  normalizeGeneratedTranscript,
  normalizeTranscriptFixture,
} from "@research-video/transcript";
import {
  ProviderExecutionError,
  translateCanonicalTranscript,
  type TranslationRequest,
} from "@research-video/providers";
import { AlignmentShutdownUnconfirmedError } from "@research-video/providers/alignment-local";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import {
  createTranscriptPipelineExecutor,
  LocalTranslationUnavailableError,
  executeDerivedTranslation,
  HttpTranscriptPublicationClient,
  type ClaimedTranslationClient,
  type TranscriptPublicationClient,
} from "./pipeline.ts";
import {
  ActionableLanguageGateError,
  type TranscriptionExecutionContext,
} from "./worker.ts";

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

describe("HTTP transcript publication", () => {
  it("proxies memory upload targets through the authenticated cloud API", async () => {
    const jobId = randomUUID();
    const uploadId = randomUUID();
    const projectId = randomUUID();
    const catalogVideoId = randomUUID();
    const lineageId = randomUUID();
    const objectKey = `projects/${projectId}/videos/${catalogVideoId}/transcripts/${lineageId}/v1/${uploadId}/english-normalized.json`;
    const bytes = new TextEncoder().encode('{"fixture":true}');
    const finalized = {
      type: "english-normalized" as const,
      objectKey,
      objectVersionId: randomUUID(),
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith(`/api/transcription-jobs/${jobId}/transcript-uploads`)
        ) {
          return new Response(
            JSON.stringify({
              uploadId,
              jobId,
              projectId,
              catalogVideoId,
              lineageId,
              version: 1,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              targets: [
                {
                  type: "manifest",
                  objectKey: `${objectKey}.manifest`,
                  uploadUrl: `memory-upload://${encodeURIComponent(`${objectKey}.manifest`)}`,
                },
                {
                  type: "english-normalized",
                  objectKey,
                  uploadUrl: `memory-upload://${encodeURIComponent(objectKey)}`,
                },
              ],
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(finalized), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const client = new HttpTranscriptPublicationClient({
      baseUrl: "https://api.example.test",
      authorization: "Bearer fixture-worker",
      fetcher: fetchMock as unknown as typeof fetch,
    });

    const grant = await client.createUpload(jobId, {
      attempt: 2,
      lineageId,
      version: 1,
      artifactTypes: ["english-normalized"],
    });
    await expect(
      client.upload(grant.targets[1]!, bytes, "application/json"),
    ).resolves.toEqual(finalized);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `https://api.example.test/api/transcription-jobs/${jobId}/transcript-uploads/${uploadId}/artifacts`,
    );
    const uploadRequest = JSON.parse(
      String((fetchMock.mock.calls[1]![1] as RequestInit).body),
    );
    expect(uploadRequest).toMatchObject({
      attempt: 2,
      type: "english-normalized",
      objectKey,
      contentType: "application/json",
      bytesBase64: Buffer.from(bytes).toString("base64"),
      sha256: finalized.sha256,
    });
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

function executionContext(
  overrides: Partial<TranscriptionExecutionContext> = {},
): TranscriptionExecutionContext {
  return {
    signal: new AbortController().signal,
    setStage: async () => undefined,
    recordSourcePlan: async () => undefined,
    observeLanguageEvidence: async (request) => ({
      evidence: request.evidence,
      gate: {
        state: "ready",
        status: "confirmed",
        remediationReason: "none",
      },
    }),
    ...overrides,
  };
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
    await executor(claimedJob(), executionContext());
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
      executor(claimedJob(), executionContext()),
    ).rejects.toMatchObject({
      code: "recognizer_not_configured",
      retryable: false,
    });
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("fails terminally before upload when English translation is not enabled", async () => {
    const scratchRoot = await mkdtemp(
      join(tmpdir(), "pipeline-no-translation-"),
    );
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
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
    });
    await expect(
      executor(claimedJob(), executionContext()),
    ).rejects.toBeInstanceOf(LocalTranslationUnavailableError);
    expect(publication.finalize).not.toHaveBeenCalled();
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("stops with an actionable language gate when a confirmed language has no translation capability", async () => {
    const scratchRoot = await mkdtemp(
      join(tmpdir(), "pipeline-no-translation-gate-"),
    );
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const transcript = normalizeGeneratedTranscript({
      videoId: "M7lc1UVf-VE",
      language: "es",
      provider: "fixture-asr",
      model: "fixture-model",
      segments: [{ startMs: 0, endMs: 1_000, text: "Hola mundo." }],
    });
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      media: {
        acquireAuthorizedSource: async (videoId, scratch) => {
          const scratchPath = join(scratch, "audio.flac");
          await writeFile(scratchPath, "temporary audio");
          return {
            videoId,
            scratchPath,
            byteSize: 15,
            format: "flac",
            provider: "fixture",
            contentSha256: "0".repeat(64),
          };
        },
      },
      speechToText: {
        checkLanguageSupport: () => ({
          state: "supported",
          provider: "fixture-asr",
          operation: "speech_to_text",
          sourceLanguage: "es",
          version: "fixture-v1",
        }),
        transcribe: async () => transcript,
      },
    });
    await expect(
      executor(
        withLanguageDecision(claimedJob(), languageDecision("es", 1)),
        executionContext(),
      ),
    ).rejects.toBeInstanceOf(ActionableLanguageGateError);
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
    await executor(
      claimedJob(),
      executionContext({
        recordSourcePlan: async (plan) => void plans.push(plan),
      }),
    );
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

  it.each(["caption", "generated", "canceled", "unconfirmed"] as const)(
    "keeps the %s word alignment inside the job audio lifetime",
    async (source) => {
      const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-align-"));
      temporaryDirectories.add(scratchRoot);
      const publication = publicationFixture();
      const controller = new AbortController();
      const lostLease = new Error("Lease expired during alignment.");
      const failed = source === "canceled" || source === "unconfirmed";
      const stages: string[] = [];
      let alignmentCalls = 0;
      const acquireAuthorizedSource = vi.fn(
        async (videoId: string, scratch: string) => {
          const scratchPath = join(scratch, "audio.flac");
          await writeFile(scratchPath, "temporary audio");
          return {
            videoId,
            scratchPath,
            byteSize: 15,
            format: "flac" as const,
            provider: "fixture",
            contentSha256: "0".repeat(64),
          };
        },
      );
      const transcribe = vi.fn(async () =>
        normalizeGeneratedTranscript({
          videoId: "M7lc1UVf-VE",
          language: "en",
          provider: "fixture-asr",
          model: "fixture-model",
          segments: [{ startMs: 0, endMs: 1_000, text: "Hello world." }],
        }),
      );
      const executor = createTranscriptPipelineExecutor({
        scratchRoot,
        publication: publication.client,
        ...(source === "caption"
          ? {
              captions: {
                discover: async () => [
                  {
                    id: "english:manual",
                    language: "en",
                    kind: "manual" as const,
                    translatable: false,
                    downloadAccess: "available" as const,
                  },
                ],
                acquire: async (videoId, track, scratch) => {
                  const path = join(scratch, "captions.vtt");
                  const vtt =
                    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello world.\n";
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
            }
          : {}),
        media: { acquireAuthorizedSource },
        speechToText: {
          checkLanguageSupport: () => ({
            state: "supported",
            provider: "fixture-asr",
            operation: "speech_to_text",
            sourceLanguage: "en",
            version: "fixture-v1",
          }),
          transcribe,
        },
        alignment: {
          supports: () => true,
          align: async ({ transcript, inputPath, signal }) => {
            alignmentCalls += 1;
            expect(signal).toBe(controller.signal);
            expect(transcript.track.source).toBe(
              source === "caption" ? "youtube-manual" : "generated",
            );
            if (failed) controller.abort(lostLease);
            await expect(readFile(inputPath, "utf8")).resolves.toBe(
              "temporary audio",
            );
            if (source === "unconfirmed")
              throw new AlignmentShutdownUnconfirmedError();
            return applyAcousticAlignment(transcript, {
              artifactId: `sha256:${"a".repeat(64)}`,
              tokens: transcript.tokens.map(({ id }, index) =>
                index === 0
                  ? {
                      tokenId: id,
                      status: "acoustic",
                      startMs: 160,
                      endMs: 480,
                    }
                  : {
                      tokenId: id,
                      status: "unaligned",
                      startMs: null,
                      endMs: null,
                    },
              ),
            });
          },
        },
      });
      const claimed = withLanguageDecision(
        claimedJob(),
        languageDecision("en", 1),
      );
      const result = executor(
        claimed,
        executionContext({
          signal: controller.signal,
          setStage: async (stage) => void stages.push(stage),
        }),
      );
      if (failed) {
        if (source === "unconfirmed")
          await expect(result).rejects.toBeInstanceOf(
            AlignmentShutdownUnconfirmedError,
          );
        else await expect(result).rejects.toBe(lostLease);
        expect(publication.uploaded.size).toBe(0);
        expect(publication.finalize).not.toHaveBeenCalled();
      } else {
        await result;
        const transcript = JSON.parse(
          new TextDecoder().decode(
            publication.uploaded.get("english-normalized"),
          ),
        ) as NormalizedTranscript;
        expect(transcript.tokens[0]).toMatchObject({
          text: "Hello",
          startMs: 160,
          endMs: 480,
          alignmentStatus: "acoustic",
        });
        expect(transcript.tokens[1]).toMatchObject({
          alignmentStatus: "unaligned",
        });
        expect(transcript.track.alignment?.artifactId).toBe(
          `sha256:${"a".repeat(64)}`,
        );
        expect(publication.finalize).toHaveBeenCalledOnce();
      }
      expect(stages).toEqual([
        "resolving",
        "acquiring",
        ...(source === "caption" ? [] : ["transcribing"]),
        "aligning",
        ...(failed ? [] : ["uploading"]),
      ]);
      expect(acquireAuthorizedSource).toHaveBeenCalledOnce();
      expect(transcribe).toHaveBeenCalledTimes(source === "caption" ? 0 : 1);
      const remaining = await readdir(scratchRoot);
      if (source === "unconfirmed") {
        expect(remaining).toHaveLength(2);
        expect(remaining).toContain(`.alignment-${claimed.job.id}`);
        const retained = remaining.find((entry) =>
          entry.startsWith(claimed.job.id),
        );
        expect(retained).toBeDefined();
        await expect(
          readFile(join(scratchRoot, retained!, "audio.flac"), "utf8"),
        ).resolves.toBe("temporary audio");
        await expect(
          executor(
            {
              job: { ...claimed.job, attempt: 2 },
              lease: { ...claimed.lease, attempt: 2 },
            },
            executionContext(),
          ),
        ).rejects.toMatchObject({ code: "previous_alignment_pending" });
        expect(alignmentCalls).toBe(1);
        expect((await readdir(scratchRoot)).sort()).toEqual(remaining.sort());
      } else expect(remaining).toEqual([]);
    },
  );

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
    await executor(claimedJob(), executionContext());
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

  it("uploads and pins original evidence before requesting claimed cloud translation", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const claimed = claimedJob();
    const consent = {
      provider: "amazon-translate" as const,
      disclosureVersion: 1 as const,
      transcriptTextTransferAccepted: true as const,
    };
    claimed.job.payload = {
      ...claimed.job.payload,
      translationConsent: consent,
    };
    const translate = vi.fn<ClaimedTranslationClient["translate"]>(
      async (input) => {
        const uploaded = publication.uploaded.get("original-normalized");
        expect(uploaded).toBeDefined();
        expect(input).not.toHaveProperty("source");
        const source = NormalizedTranscriptSchema.parse(
          JSON.parse(new TextDecoder().decode(uploaded)),
        );
        const transcript = await translateCanonicalTranscript(
          {
            translate: async (request) => ({
              provider: "amazon-translate",
              segments: request.segments.map((segment) => ({
                sourceSegmentId: segment.id,
                text: "Cloud-produced English.",
              })),
            }),
          },
          source,
          "en",
        );
        return {
          transcript,
          normalizedArtifact: {
            type: "english-normalized",
            objectKey: "fixture/english-normalized.json",
            objectVersionId: randomUUID(),
            byteSize: 512,
            sha256: "d".repeat(64),
          },
          subtitleArtifact: {
            type: "english-srt",
            objectKey: "fixture/english-srt.json",
            objectVersionId: randomUUID(),
            byteSize: 80,
            sha256: "e".repeat(64),
          },
        };
      },
    );
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:manual:ro",
            language: "ro",
            kind: "manual",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const path = join(scratch, "caption.vtt");
          const contents = "WEBVTT\n\n00:00.000 --> 00:00:01.000\nBună ziua.\n";
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
      claimedTranslation: { translate },
    });

    await executor(claimed, executionContext());

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: claimed.job.id,
        attempt: claimed.lease.attempt,
        consent,
        uploadId: expect.any(String),
        sourceArtifact: expect.objectContaining({
          type: "original-normalized",
          objectVersionId: expect.any(String),
        }),
      }),
    );
    expect(publication.finalize).toHaveBeenCalledOnce();
  });

  it("discards a failed cloud translation and retries the whole source through the local provider only", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      translationConsent: {
        provider: "provider-alpha",
        disclosureVersion: 3,
        transcriptTextTransferAccepted: true,
      },
    };
    const cloudTranslate = vi.fn(async () => {
      throw new ProviderExecutionError("fixture cloud failure");
    });
    const localTranslate = vi.fn(async (request) => ({
      provider: "argos-local",
      model: "fixture-es-en",
      segments: request.segments.map(
        (segment: { id: string; text: string }) => ({
          sourceSegmentId: segment.id,
          text: "Local English.",
        }),
      ),
    }));
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
            "WEBVTT\n\n00:00.000 --> 00:00:01.000\nHola mundo.\n";
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
      claimedTranslation: { translate: cloudTranslate },
      translation: { translate: localTranslate },
    });

    await executor(claimed, executionContext());

    expect(cloudTranslate).toHaveBeenCalledOnce();
    expect(localTranslate).toHaveBeenCalledOnce();
    expect(localTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: "es", targetLanguage: "en" }),
    );
    expect(
      NormalizedTranscriptSchema.parse(
        JSON.parse(
          new TextDecoder().decode(
            publication.uploaded.get("english-normalized"),
          ),
        ),
      ).track,
    ).toMatchObject({ provider: "argos-local", model: "fixture-es-en" });
    expect(publication.finalize).toHaveBeenCalledOnce();
  });

  it("uses local translation by default even when a cloud client is configured", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const cloudTranslate = vi.fn();
    const localTranslate = vi.fn(async (request) => ({
      provider: "argos-local",
      model: "fixture-ro-en",
      segments: request.segments.map(
        (segment: { id: string; text: string }) => ({
          sourceSegmentId: segment.id,
          text: "Local English.",
        }),
      ),
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: async () => [
          {
            id: "fixture:manual:ro",
            language: "ro",
            kind: "manual",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, scratch) => {
          const path = join(scratch, "caption.vtt");
          const contents = "WEBVTT\n\n00:00.000 --> 00:00:01.000\nBună ziua.\n";
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
      claimedTranslation: { translate: cloudTranslate },
      translation: { translate: localTranslate },
    });

    await executor(claimedJob(), executionContext());

    expect(cloudTranslate).not.toHaveBeenCalled();
    expect(localTranslate).toHaveBeenCalledOnce();
    expect(localTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: "ro", targetLanguage: "en" }),
    );
    expect(publication.finalize).toHaveBeenCalledOnce();
  });

  it("publishes YouTube-style WebVTT captions without falling back to ASR", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const speechToText = { transcribe: vi.fn() };
    const acquire = vi.fn(async (videoId, track, scratch) => {
      if (acquire.mock.calls.length === 1) {
        throw new Error("transient caption request failure");
      }
      const path = join(scratch, "caption.vtt");
      const contents =
        "WEBVTT\nKind: captions\nLanguage: es\n\n00:00.500 --> 00:02.500\nEste es un ejemplo breve.\n";
      await writeFile(path, contents);
      return {
        videoId,
        track,
        path,
        format: "vtt" as const,
        byteSize: Buffer.byteLength(contents),
        provider: "fixture",
      };
    });
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
        acquire,
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
    const unverifiedDecision = {
      ...languageDecision("es", 6),
      status: "unverified" as const,
      basis: "creator_metadata" as const,
    };
    claimed.job.payload = {
      ...claimed.job.payload,
      creatorReportedLanguage: "es",
      languageDecision: unverifiedDecision,
    };
    const plans: unknown[] = [];
    const stages: string[] = [];

    await executor(
      claimed,
      executionContext({
        setStage: async (stage) => void stages.push(stage),
        recordSourcePlan: async (plan) => void plans.push(plan),
      }),
    );

    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(speechToText.transcribe).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledTimes(2);
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
    expect(
      JSON.parse(new TextDecoder().decode(publication.uploaded.get("manifest")))
        .languageDecision,
    ).toEqual(unverifiedDecision);
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
      speechToText: {
        checkLanguageSupport: () => ({
          state: "supported",
          provider: "fixture-asr",
          operation: "speech_to_text",
          sourceLanguage: "en",
          version: "fixture-v1",
        }),
        transcribe: speechToText,
      },
    });
    const plans: Array<{ reason?: string }> = [];
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      languageDecision: languageDecision("en", 1),
    };

    await executor(
      claimed,
      executionContext({
        recordSourcePlan: async (plan) => void plans.push(plan),
      }),
    );

    expect(plans).toContainEqual(
      expect.objectContaining({ reason: "caption-acquisition-failed" }),
    );
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

  it("resolves an opaque cloud transcription provider and falls back only to local ASR", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const localTranscribe = vi.fn(async () =>
      normalizeGeneratedTranscript({
        videoId: "M7lc1UVf-VE",
        language: "en",
        provider: "whisper-local",
        model: "fixture-local",
        segments: [{ startMs: 0, endMs: 1_000, text: "Local fallback." }],
      }),
    );
    const cloudTranscribe = vi.fn(async () => {
      throw new ProviderExecutionError("fixture cloud failure");
    });
    const resolveCloudSpeechToText = vi.fn((providerId: string) =>
      providerId === "provider-beta"
        ? {
            checkLanguageSupport: () => ({
              state: "supported" as const,
              provider: providerId,
              operation: "speech_to_text" as const,
              sourceLanguage: "en",
              version: "fixture-v1",
            }),
            transcribe: cloudTranscribe,
          }
        : undefined,
    );
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      sourcePolicy: "force-generate",
      languageDecision: languageDecision("en", 4),
      transcriptionExecutionPolicy: {
        schemaVersion: 1,
        execution: "cloud",
        providerId: "provider-beta",
        fallback: "local",
      },
      transcriptionGrantId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
    };
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
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
      speechToText: {
        checkLanguageSupport: () => ({
          state: "supported",
          provider: "whisper-local",
          operation: "speech_to_text",
          sourceLanguage: "en",
          version: "fixture-local-v1",
        }),
        transcribe: localTranscribe,
      },
      resolveCloudSpeechToText,
    });

    await executor(claimed, executionContext());

    expect(resolveCloudSpeechToText).toHaveBeenCalledWith(
      "provider-beta",
      expect.objectContaining({
        grantId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
        operationId: claimed.job.id,
        attempt: claimed.lease.attempt,
      }),
    );
    expect(cloudTranscribe).toHaveBeenCalledOnce();
    expect(localTranscribe).toHaveBeenCalledOnce();
  });

  it("observes conflicting Korean automatic caption evidence before any provider work", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const acquire = vi.fn();
    const media = { acquireAuthorizedSource: vi.fn() };
    const transcribe = vi.fn();
    const translate = vi.fn();
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      languageDecision: languageDecision("dz", 1),
    };
    const observeLanguageEvidence = vi.fn(async (request) => ({
      evidence: request.evidence,
      gate: {
        state: "needs_language_confirmation" as const,
        status: "conflict" as const,
        providerEvidence: request.evidence,
        remediationReason: "resolve_conflict" as const,
      },
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: {
        discover: vi.fn(async () => [automaticCaption("ko")]),
        acquire,
      },
      media,
      speechToText: { transcribe },
      translation: { translate },
    });

    await expect(
      executor(claimed, executionContext({ observeLanguageEvidence })),
    ).rejects.toMatchObject({ code: "language_gate_actionable" });

    expect(observeLanguageEvidence).toHaveBeenCalledOnce();
    expect(observeLanguageEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: claimed.lease.attempt,
        evidence: expect.objectContaining({
          source: "caption",
          provider: "caption-discovery",
          reportedLanguage: "ko",
          captionKind: "automatic",
          trackFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
    expect(publication.uploaded).toEqual(new Map());
  });

  it("blocks unsupported confirmed speech before media acquisition", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const transcribe = vi.fn();
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      sourcePolicy: "force-generate",
      languageDecision: languageDecision("dz", 2),
    };
    const observeLanguageEvidence = vi.fn(async (request) => ({
      evidence: request.evidence,
      gate: {
        state: "needs_transcript" as const,
        status: "confirmed" as const,
        speechCapability: request.speechCapability,
        remediationReason: "select_supported_provider" as const,
      },
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      media,
      speechToText: {
        checkLanguageSupport: () => ({
          state: "unsupported",
          provider: "fixture-speech",
          operation: "speech_to_text",
          sourceLanguage: "dz",
          reason: "language_not_supported",
        }),
        transcribe,
      },
    });

    await expect(
      executor(claimed, executionContext({ observeLanguageEvidence })),
    ).rejects.toMatchObject({ code: "language_gate_actionable" });

    expect(observeLanguageEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        speechCapability: expect.objectContaining({ state: "unsupported" }),
      }),
    );
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
  });

  it("blocks speech acquisition when no language decision is snapshotted", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const media = { acquireAuthorizedSource: vi.fn() };
    const transcribe = vi.fn();
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      sourcePolicy: "force-generate",
    };
    const observeLanguageEvidence = vi.fn(async (request) => ({
      evidence: request.evidence,
      gate: {
        state: "needs_language_confirmation" as const,
        status: "unknown" as const,
        remediationReason: "confirm_language" as const,
      },
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      media,
      speechToText: { transcribe },
    });

    await expect(
      executor(claimed, executionContext({ observeLanguageEvidence })),
    ).rejects.toMatchObject({ code: "language_gate_actionable" });

    expect(observeLanguageEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          source: "speech_detection",
          provider: "speech-to-text",
        }),
      }),
    );
    expect(media.acquireAuthorizedSource).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
  });

  it("blocks unsupported confirmed translation before caption acquisition", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const acquire = vi.fn();
    const claimed = claimedJob();
    claimed.job.payload = {
      ...claimed.job.payload,
      languageDecision: languageDecision("dz", 3),
    };
    const observeLanguageEvidence = vi.fn(async (request) => ({
      evidence: request.evidence,
      gate: {
        state: "needs_translation" as const,
        status: "confirmed" as const,
        translationCapability: request.translationCapability,
        remediationReason: "select_supported_provider" as const,
      },
    }));
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
      captions: { discover: async () => [automaticCaption("dz")], acquire },
      media: { acquireAuthorizedSource: vi.fn() },
      speechToText: { transcribe: vi.fn() },
      translation: {
        checkLanguagePair: () => ({
          state: "unsupported",
          provider: "fixture-translation",
          operation: "translation",
          sourceLanguage: "dz",
          targetLanguage: "en",
          reason: "language_not_supported",
        }),
        translate: vi.fn(),
      },
    });

    await expect(
      executor(claimed, executionContext({ observeLanguageEvidence })),
    ).rejects.toMatchObject({ code: "language_gate_actionable" });
    expect(observeLanguageEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        translationCapability: expect.objectContaining({
          state: "unsupported",
          sourceLanguage: "dz",
          targetLanguage: "en",
        }),
      }),
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(publication.finalize).not.toHaveBeenCalled();
  });

  it("passes a supported confirmed hint and persists the exact claimed decision", async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), "pipeline-"));
    temporaryDirectories.add(scratchRoot);
    const publication = publicationFixture();
    const claimed = claimedJob();
    const snapshot = languageDecision("ko", 4);
    claimed.job.payload = {
      ...claimed.job.payload,
      sourcePolicy: "force-generate",
      languageDecision: snapshot,
    };
    const transcribe = vi.fn(async () =>
      normalizeGeneratedTranscript({
        videoId: "M7lc1UVf-VE",
        language: "ko",
        provider: "fixture-speech",
        model: "fixture-model",
        segments: [{ startMs: 0, endMs: 1_000, text: "한국어" }],
      }),
    );
    const executor = createTranscriptPipelineExecutor({
      scratchRoot,
      publication: publication.client,
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
      speechToText: {
        checkLanguageSupport: () => ({
          state: "supported",
          provider: "fixture-speech",
          operation: "speech_to_text",
          sourceLanguage: "ko",
          version: "fixture-v1",
        }),
        transcribe,
      },
      translation: {
        checkLanguagePair: () => ({
          state: "supported",
          provider: "fixture-translation",
          operation: "translation",
          sourceLanguage: "ko",
          targetLanguage: "en",
          version: "fixture-v1",
        }),
        translate: async (input) => ({
          provider: "fixture-translation",
          segments: input.segments.map((segment) => ({
            sourceSegmentId: segment.id,
            text: "Korean example.",
          })),
        }),
      },
    });

    await executor(claimed, executionContext());

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: "ko" }),
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(publication.uploaded.get("manifest")),
    );
    expect(manifest.languageDecision).toEqual(snapshot);
    const laterDecision = languageDecision("en", 5);
    expect(manifest.languageDecision).not.toEqual(laterDecision);
  });
});

function automaticCaption(language: string) {
  return {
    id: `fixture:auto:${language}`,
    language,
    kind: "automatic" as const,
    translatable: false,
    downloadAccess: "available" as const,
  };
}

function withLanguageDecision(
  claimed: ClaimedTranscriptionJob,
  decision: ReturnType<typeof languageDecision>,
): ClaimedTranscriptionJob {
  claimed.job.payload = { ...claimed.job.payload, languageDecision: decision };
  return claimed;
}

function languageDecision(language: string, decisionVersion: number) {
  return {
    schemaVersion: 1 as const,
    decisionId: `00000000-0000-4000-8000-${String(decisionVersion).padStart(12, "0")}`,
    decisionVersion,
    status: "confirmed" as const,
    basis: "user_confirmation" as const,
    resolvedLanguage: language,
  };
}
