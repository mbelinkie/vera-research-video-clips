import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ActiveTranscriptBundleSchema,
  FinalizedObjectSchema,
  TranscriptManifestSchema,
  TranscriptSourcePlanSchema,
  TranscriptUploadGrantSchema,
  TranscriptionJobPayloadSchema,
  WorkerCreateTranscriptUploadRequestSchema,
  WorkerFinalizeTranscriptRequestSchema,
  type ActiveTranscriptBundle,
  type FinalizedObject,
  type NormalizedTranscript,
  type TranscriptArtifact,
  type TranscriptManifest,
  type TranscriptUploadGrant,
} from "@research-video/contracts";
import type { MediaAcquisitionProvider } from "@research-video/media";
import {
  TranscriptSourceResolver,
  translateCanonicalTranscript,
  type CaptionProvider,
  type SpeechToTextProvider,
  type TranslationProvider,
} from "@research-video/providers";
import { normalizeAcquiredCaption } from "@research-video/providers/captions-local";
import { transcriptToSrt } from "@research-video/transcript";

import type {
  TranscriptionExecutionContext,
  TranscriptionJobExecutor,
} from "./worker.ts";

type UploadArtifactType = Exclude<TranscriptArtifact["type"], "manifest">;

export interface TranscriptPublicationClient {
  createUpload(
    jobId: string,
    input: {
      attempt: number;
      lineageId: string;
      version: number;
      artifactTypes: UploadArtifactType[];
    },
  ): Promise<TranscriptUploadGrant>;
  upload(
    target: TranscriptUploadGrant["targets"][number],
    bytes: Uint8Array,
    contentType: string,
  ): Promise<FinalizedObject>;
  finalize(
    jobId: string,
    input: {
      attempt: number;
      uploadId: string;
      idempotencyKey: string;
      manifest: FinalizedObject & { type: "manifest" };
    },
  ): Promise<ActiveTranscriptBundle>;
}

export type TranscriptPipelineOptions = {
  captions?: CaptionProvider;
  media: MediaAcquisitionProvider;
  speechToText: SpeechToTextProvider;
  translation?: TranslationProvider;
  publication: TranscriptPublicationClient;
  scratchRoot: string;
  now?: () => Date;
};

export class TranscriptPipelineError extends Error {
  readonly code = "transcript_pipeline_failed";
  readonly retryable = true;
}

export function createTranscriptPipelineExecutor(
  options: TranscriptPipelineOptions,
): TranscriptionJobExecutor {
  const now = options.now ?? (() => new Date());
  return async (claimed, context) => {
    const payload = TranscriptionJobPayloadSchema.parse(claimed.job.payload);
    if (!claimed.job.projectId) {
      throw new TranscriptPipelineError(
        "A transcription job must belong to a shared project.",
      );
    }
    if (primaryLanguage(payload.targetLanguage) !== "en") {
      throw new TranscriptPipelineError(
        "The current review workflow requires an English target transcript.",
      );
    }
    await mkdir(options.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(
      join(options.scratchRoot, `${claimed.job.id}-a${claimed.lease.attempt}-`),
    );
    let cleaned = false;
    try {
      const source = await resolveSourceTranscript(
        options,
        payload,
        scratch,
        context,
      );
      const english = await resolveEnglishTranscript(
        options.translation,
        source,
        payload.targetLanguage,
        context,
      );
      await context.setStage("uploading");
      const lineageId = await stableUuid(
        `lineage:${claimed.job.projectId}:${payload.catalogVideoId}:${source.track.language}:${payload.targetLanguage}`,
      );
      const version = 1;
      const artifacts = artifactPayloads(source, english);
      const grant = await options.publication.createUpload(claimed.job.id, {
        attempt: claimed.lease.attempt,
        lineageId,
        version,
        artifactTypes: artifacts.map((artifact) => artifact.type),
      });
      const finalizedArtifacts: FinalizedObject[] = [];
      for (const artifact of artifacts) {
        const target = requiredTarget(grant, artifact.type);
        finalizedArtifacts.push(
          await options.publication.upload(
            target,
            artifact.bytes,
            artifact.contentType,
          ),
        );
      }
      const transcriptVersionId = await stableUuid(
        `transcript-version:${claimed.job.id}:${source.track.contentSha256}:${english.track.contentSha256}`,
      );
      const manifest = TranscriptManifestSchema.parse({
        schemaVersion: 1,
        id: transcriptVersionId,
        projectId: grant.projectId,
        catalogVideoId: grant.catalogVideoId,
        videoId: payload.youtubeVideoId,
        lineageId,
        version,
        sourceLanguage: source.track.language,
        targetLanguage: english.track.language,
        timingPrecision: english.track.timingPrecision,
        provider: source.track.provider,
        ...(source.track.model ? { model: source.track.model } : {}),
        normalizationSchemaVersion: english.track.schemaVersion,
        jobId: claimed.job.id,
        createdBy: claimed.lease.workerId,
        createdAt: now().toISOString(),
        artifacts: finalizedArtifacts,
      });
      const manifestBytes = encodeJson(manifest);
      const manifestObject = await options.publication.upload(
        requiredTarget(grant, "manifest"),
        manifestBytes,
        "application/json",
      );
      if (manifestObject.type !== "manifest") {
        throw new TranscriptPipelineError(
          "Publication adapter returned the wrong manifest artifact type.",
        );
      }

      await cleanupScratch(scratch);
      cleaned = true;
      await options.publication.finalize(claimed.job.id, {
        attempt: claimed.lease.attempt,
        uploadId: grant.uploadId,
        idempotencyKey: `finalize:${transcriptVersionId}`,
        manifest: { ...manifestObject, type: "manifest" },
      });
    } finally {
      if (!cleaned) await cleanupScratch(scratch);
    }
  };
}

async function resolveSourceTranscript(
  options: TranscriptPipelineOptions,
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
  scratch: string,
  context: TranscriptionExecutionContext,
) {
  await context.setStage("resolving");
  const resolver = new TranscriptSourceResolver(
    options.captions ?? { discover: async () => [] },
  );
  let plan = await resolver.resolve(
    payload.youtubeVideoId,
    {
      targetLanguage: payload.targetLanguage,
      sourcePolicy: payload.sourcePolicy,
    },
    context.signal,
  );

  if (plan.strategy === "caption" && options.captions) {
    try {
      await context.setStage("acquiring");
      const caption = await options.captions.acquire(
        payload.youtubeVideoId,
        plan.track,
        scratch,
        context.signal,
      );
      const transcript = await normalizeAcquiredCaption(caption);
      await context.recordSourcePlan(plan);
      return transcript;
    } catch (error) {
      if (context.signal.aborted) throw context.signal.reason;
      plan = TranscriptSourcePlanSchema.parse({
        strategy: "speech-to-text",
        targetLanguage: payload.targetLanguage,
        requiresLanguageDetection: true,
        reason: "caption-acquisition-failed",
      });
    }
  }

  await context.recordSourcePlan(plan);
  await context.setStage("acquiring");
  const media = await options.media.acquireAuthorizedSource(
    payload.youtubeVideoId,
    scratch,
    context.signal,
  );
  await context.setStage("transcribing");
  return options.speechToText.transcribe({
    videoId: payload.youtubeVideoId,
    inputPath: media.scratchPath,
    signal: context.signal,
  });
}

async function resolveEnglishTranscript(
  translation: TranslationProvider | undefined,
  source: NormalizedTranscript,
  targetLanguage: string,
  context: TranscriptionExecutionContext,
) {
  if (
    primaryLanguage(source.track.language) === primaryLanguage(targetLanguage)
  ) {
    return source;
  }
  if (!translation) {
    throw new TranscriptPipelineError(
      "A translation provider is required for the detected source language.",
    );
  }
  await context.setStage("translating");
  return translateCanonicalTranscript(
    translation,
    source,
    targetLanguage,
    context.signal,
  );
}

function artifactPayloads(
  source: NormalizedTranscript,
  english: NormalizedTranscript,
): Array<{ type: UploadArtifactType; bytes: Uint8Array; contentType: string }> {
  const englishArtifacts = [
    {
      type: "english-normalized" as const,
      bytes: encodeJson(english),
      contentType: "application/json",
    },
    {
      type: "english-srt" as const,
      bytes: new TextEncoder().encode(transcriptToSrt(english)),
      contentType: "application/x-subrip",
    },
  ];
  if (source.track.id === english.track.id) return englishArtifacts;
  return [
    {
      type: "original-normalized",
      bytes: encodeJson(source),
      contentType: "application/json",
    },
    {
      type: "original-srt",
      bytes: new TextEncoder().encode(transcriptToSrt(source)),
      contentType: "application/x-subrip",
    },
    ...englishArtifacts,
  ];
}

function requiredTarget(
  grant: TranscriptUploadGrant,
  type: TranscriptArtifact["type"],
) {
  const target = grant.targets.find((candidate) => candidate.type === type);
  if (!target) {
    throw new TranscriptPipelineError(
      `Transcript upload grant omitted the ${type} target.`,
    );
  }
  return target;
}

async function cleanupScratch(path: string) {
  await rm(path, { recursive: true, force: true });
  const remains = await access(path).then(
    () => true,
    () => false,
  );
  if (remains) {
    throw new TranscriptPipelineError(
      "Job scratch cleanup could not be verified before finalization.",
    );
  }
}

function primaryLanguage(language: string) {
  return language.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
}

function encodeJson(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function stableUuid(seed: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class HttpTranscriptPublicationClient implements TranscriptPublicationClient {
  readonly #baseUrl: URL;
  readonly #authorization: string;
  readonly #fetcher: typeof fetch;

  constructor(options: {
    baseUrl: string;
    authorization: string;
    fetcher?: typeof fetch;
  }) {
    this.#baseUrl = new URL(options.baseUrl);
    this.#authorization = options.authorization;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async createUpload(
    jobId: string,
    input: {
      attempt: number;
      lineageId: string;
      version: number;
      artifactTypes: UploadArtifactType[];
    },
  ) {
    const body = WorkerCreateTranscriptUploadRequestSchema.parse(input);
    const response = await this.api(
      `/api/transcription-jobs/${encodeURIComponent(jobId)}/transcript-uploads`,
      body,
    );
    return TranscriptUploadGrantSchema.parse(response);
  }

  async upload(
    target: TranscriptUploadGrant["targets"][number],
    bytes: Uint8Array,
    contentType: string,
  ): Promise<FinalizedObject> {
    const response = await this.#fetcher(target.uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: Buffer.from(bytes),
    });
    if (!response.ok) {
      throw new TranscriptPipelineError(
        `Transcript artifact upload failed (${response.status}).`,
      );
    }
    const objectVersionId = response.headers.get("x-amz-version-id");
    if (!objectVersionId) {
      throw new TranscriptPipelineError(
        "Transcript upload did not return an object version ID.",
      );
    }
    return FinalizedObjectSchema.parse({
      type: target.type,
      objectKey: target.objectKey,
      objectVersionId,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  async finalize(
    jobId: string,
    input: {
      attempt: number;
      uploadId: string;
      idempotencyKey: string;
      manifest: FinalizedObject & { type: "manifest" };
    },
  ) {
    const body = WorkerFinalizeTranscriptRequestSchema.parse(input);
    return ActiveTranscriptBundleSchema.parse(
      await this.api(
        `/api/transcription-jobs/${encodeURIComponent(jobId)}/finalize`,
        body,
      ),
    );
  }

  private async api(path: string, body: unknown) {
    const response = await this.#fetcher(new URL(path, this.#baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: this.#authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new TranscriptPipelineError(
        `Transcript publication API failed (${response.status}).`,
      );
    }
    return response.json();
  }
}
