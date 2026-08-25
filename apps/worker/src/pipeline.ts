import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ActiveTranscriptBundleSchema,
  FinalizedObjectSchema,
  NormalizedTranscriptSchema,
  TranscriptManifestSchema,
  TranscriptSourcePlanSchema,
  TranscriptUploadGrantSchema,
  TranscriptionJobPayloadSchema,
  WorkerCreateTranscriptUploadRequestSchema,
  WorkerFinalizeTranscriptRequestSchema,
  type ActiveTranscriptBundle,
  type ClaimedTranscriptionJob,
  type CloudTranslationConsent,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
  type FinalizedObject,
  type LanguageCapabilityResult,
  type ProviderLanguageEvidence,
  type NormalizedTranscript,
  type TranscriptArtifact,
  type TranscriptManifest,
  type TranscriptUploadGrant,
  type WorkerTranslateTranscriptResponse,
} from "@research-video/contracts";
import {
  languagesEquivalent,
  normalizeLanguageTag,
} from "@research-video/contracts";
import type { MediaAcquisitionProvider } from "@research-video/media";
import {
  TranscriptSourceResolver,
  gateCaptionLanguage,
  translateCanonicalTranscript,
  type CaptionProvider,
  type SpeechToTextProvider,
  type TranslationProvider,
} from "@research-video/providers";
import { normalizeAcquiredCaption } from "@research-video/providers/captions-local";
import { transcriptToSrt } from "@research-video/transcript";

import {
  ActionableLanguageGateError,
  type TranscriptionExecutionContext,
  type TranscriptionJobExecutor,
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
  claimedTranslation?: ClaimedTranslationClient;
  publication: TranscriptPublicationClient;
  scratchRoot: string;
  now?: () => Date;
};

export interface ClaimedTranslationClient {
  translate(input: {
    jobId: string;
    attempt: number;
    consent: CloudTranslationConsent;
    uploadId: string;
    sourceArtifact: FinalizedObject & { type: "original-normalized" };
    targetLanguage: string;
    signal?: AbortSignal;
  }): Promise<WorkerTranslateTranscriptResponse>;
}

export interface DerivedTranslationPublicationClient {
  publish(input: {
    identity: DerivedTranslationIdentity;
    idempotencyKey: string;
    transcript: NormalizedTranscript;
  }): Promise<DerivedTranslation>;
}

export async function executeDerivedTranslation(input: {
  identity: DerivedTranslationIdentity;
  idempotencyKey: string;
  original: NormalizedTranscript;
  translation: TranslationProvider;
  publication: DerivedTranslationPublicationClient;
  signal?: AbortSignal;
}): Promise<DerivedTranslation> {
  const original = NormalizedTranscriptSchema.parse(input.original);
  if (
    original.track.id !== input.identity.originalTrackId ||
    original.track.contentSha256 !== input.identity.originalContentSha256
  ) {
    throw new TranscriptPipelineError(
      "The preferred translation job does not match its original track snapshot.",
    );
  }
  if (
    languagesEquivalent(
      original.track.language,
      input.identity.targetLanguage,
    ) ||
    languagesEquivalent(input.identity.targetLanguage, "en")
  ) {
    throw new TranscriptPipelineError(
      "Supplemental translation work requires a distinct non-English target.",
    );
  }
  const transcript = await translateCanonicalTranscript(
    input.translation,
    original,
    input.identity.targetLanguage,
    input.signal,
  );
  if (
    transcript.track.kind !== "translation" ||
    transcript.track.sourceTrackId !== original.track.id ||
    !languagesEquivalent(
      transcript.track.language,
      input.identity.targetLanguage,
    )
  ) {
    throw new TranscriptPipelineError(
      "The translation provider returned the wrong preferred track.",
    );
  }
  return input.publication.publish({
    identity: input.identity,
    idempotencyKey: input.idempotencyKey,
    transcript,
  });
}

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
    if (
      payload.languageDecision &&
      !["confirmed", "unverified"].includes(payload.languageDecision.status)
    ) {
      throw new ActionableLanguageGateError();
    }
    await mkdir(options.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(
      join(options.scratchRoot, `${claimed.job.id}-a${claimed.lease.attempt}-`),
    );
    let cleaned = false;
    try {
      const resolvedSource = await resolveSourceTranscript(
        options,
        claimed,
        payload,
        scratch,
        context,
        now,
      );
      const source = resolvedSource.transcript;
      const lineageId = await stableUuid(
        `lineage:${claimed.job.projectId}:${payload.catalogVideoId}:${source.track.language}:${payload.targetLanguage}:${languageDecisionIdentity(payload.languageDecision)}`,
      );
      const version = 1;
      const requiresTranslation =
        primaryLanguage(source.track.language) !==
        primaryLanguage(payload.targetLanguage);
      const artifactTypes: UploadArtifactType[] = requiresTranslation
        ? [
            "original-normalized",
            "original-srt",
            "english-normalized",
            "english-srt",
          ]
        : ["english-normalized", "english-srt"];
      const grant = await options.publication.createUpload(claimed.job.id, {
        attempt: claimed.lease.attempt,
        lineageId,
        version,
        artifactTypes,
      });
      const finalizedArtifacts: FinalizedObject[] = [];
      let uploadedTranslationSource:
        (FinalizedObject & { type: "original-normalized" }) | undefined;
      if (requiresTranslation && options.claimedTranslation) {
        const artifact = await options.publication.upload(
          requiredTarget(grant, "original-normalized"),
          encodeJson(source),
          "application/json",
        );
        if (artifact.type !== "original-normalized") {
          throw new TranscriptPipelineError(
            "Publication adapter returned the wrong translation source artifact type.",
          );
        }
        uploadedTranslationSource = {
          ...artifact,
          type: "original-normalized",
        };
      }
      const resolvedEnglish = await resolveEnglishTranscript(
        options,
        claimed,
        payload,
        source,
        grant.uploadId,
        uploadedTranslationSource,
        context,
      );
      const english = resolvedEnglish.transcript;
      await context.setStage("uploading");
      const artifacts = artifactPayloads(source, english);
      if (uploadedTranslationSource) {
        finalizedArtifacts.push(uploadedTranslationSource);
      }
      finalizedArtifacts.push(...resolvedEnglish.serverArtifacts);
      const serverArtifactTypes = new Set<UploadArtifactType>(
        resolvedEnglish.serverArtifacts.map((artifact) => artifact.type),
      );
      for (const artifact of artifacts) {
        if (
          artifact.type === uploadedTranslationSource?.type ||
          serverArtifactTypes.has(artifact.type)
        )
          continue;
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
        `transcript-version:${claimed.job.id}:${source.track.contentSha256}:${english.track.contentSha256}:${languageDecisionIdentity(payload.languageDecision)}`,
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
        ...(payload.languageDecision
          ? { languageDecision: payload.languageDecision }
          : {}),
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
  claimed: ClaimedTranscriptionJob,
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
  scratch: string,
  context: TranscriptionExecutionContext,
  now: () => Date,
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
    const captionGate = gateCaptionLanguage({
      track: plan.track,
      ...(payload.creatorReportedLanguage
        ? { creatorLanguage: payload.creatorReportedLanguage }
        : {}),
      ...(payload.languageDecision
        ? { confirmedDecision: payload.languageDecision }
        : {}),
    });
    const translationCapability = translationCapabilityFor(
      options,
      plan.sourceLanguage,
      payload.targetLanguage,
      payload.languageDecision,
    );
    await context.recordSourcePlan(plan);
    const observed = await observeLanguageEvidence(
      context,
      claimed,
      payload,
      {
        source: "caption",
        provider: "caption-discovery",
        reportedLanguage: normalizeLanguageTag(plan.sourceLanguage),
        trackFingerprint: trackFingerprint(plan.track),
        captionKind: plan.track.kind,
      },
      translationCapability,
      now,
    );
    if (
      captionGate.state !== "accepted" ||
      (translationCapability && translationCapability.state !== "supported") ||
      observed.gate.state !== "ready"
    ) {
      throw new ActionableLanguageGateError();
    }
    try {
      await context.setStage("acquiring");
      const caption = await options.captions.acquire(
        payload.youtubeVideoId,
        plan.track,
        scratch,
        context.signal,
      );
      const transcript = await normalizeAcquiredCaption(caption);
      return { transcript };
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
  const confirmedLanguage = confirmedLanguageFrom(payload);
  if (!confirmedLanguage) {
    await observeLanguageEvidence(
      context,
      claimed,
      payload,
      {
        source: "speech_detection",
        provider: "speech-to-text",
      },
      undefined,
      now,
    );
    throw new ActionableLanguageGateError();
  } else {
    const speechCapability = speechCapabilityFor(
      options.speechToText,
      confirmedLanguage,
    );
    const observed = await observeLanguageEvidence(
      context,
      claimed,
      payload,
      {
        source: "speech_detection",
        provider: speechCapability.provider,
      },
      undefined,
      now,
      speechCapability,
    );
    if (
      speechCapability.state !== "supported" ||
      observed.gate.state !== "ready"
    ) {
      throw new ActionableLanguageGateError();
    }
  }
  await context.setStage("acquiring");
  const media = await options.media.acquireAuthorizedSource(
    payload.youtubeVideoId,
    scratch,
    context.signal,
  );
  await context.setStage("transcribing");
  const transcript = await options.speechToText.transcribe({
    videoId: payload.youtubeVideoId,
    inputPath: media.scratchPath,
    ...(confirmedLanguage ? { language: confirmedLanguage } : {}),
    signal: context.signal,
  });
  const translationCapability = translationCapabilityFor(
    options,
    transcript.track.language,
    payload.targetLanguage,
    payload.languageDecision,
  );
  const observed = await observeLanguageEvidence(
    context,
    claimed,
    payload,
    {
      source: "speech_detection",
      provider: transcript.track.provider,
      reportedLanguage: normalizeLanguageTag(transcript.track.language),
      trackFingerprint: transcript.track.contentSha256,
    },
    translationCapability,
    now,
  );
  if (
    (translationCapability && translationCapability.state !== "supported") ||
    observed.gate.state !== "ready"
  ) {
    throw new ActionableLanguageGateError();
  }
  return { transcript };
}

async function resolveEnglishTranscript(
  options: TranscriptPipelineOptions,
  claimed: ClaimedTranscriptionJob,
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
  source: NormalizedTranscript,
  uploadId: string,
  uploadedSource:
    (FinalizedObject & { type: "original-normalized" }) | undefined,
  context: TranscriptionExecutionContext,
) {
  if (
    primaryLanguage(source.track.language) ===
    primaryLanguage(payload.targetLanguage)
  ) {
    return { transcript: source, serverArtifacts: [] };
  }
  if (options.claimedTranslation) {
    if (!payload.translationConsent) {
      throw new TranscriptPipelineError(
        "Cloud translation requires the submitting user's explicit transcript-transfer consent.",
      );
    }
    await context.setStage("translating");
    if (!uploadedSource) {
      throw new TranscriptPipelineError(
        "Cloud translation requires a verified uploaded source artifact.",
      );
    }
    const published = await options.claimedTranslation.translate({
      jobId: claimed.job.id,
      attempt: claimed.lease.attempt,
      consent: payload.translationConsent,
      uploadId,
      sourceArtifact: uploadedSource,
      targetLanguage: payload.targetLanguage,
      signal: context.signal,
    });
    return {
      transcript: published.transcript,
      serverArtifacts: [
        published.normalizedArtifact,
        published.subtitleArtifact,
      ],
    };
  }
  if (!options.translation) {
    throw new TranscriptPipelineError(
      "A translation provider is required for the detected source language.",
    );
  }
  await context.setStage("translating");
  return {
    transcript: await translateCanonicalTranscript(
      options.translation,
      source,
      payload.targetLanguage,
      context.signal,
    ),
    serverArtifacts: [],
  };
}

function confirmedLanguageFrom(
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
) {
  return payload.languageDecision?.status === "confirmed"
    ? payload.languageDecision.resolvedLanguage
    : undefined;
}

function speechCapabilityFor(
  provider: SpeechToTextProvider,
  language: string,
): LanguageCapabilityResult {
  if (provider.checkLanguageSupport) {
    return provider.checkLanguageSupport(language);
  }
  return {
    state: "unknown",
    provider: "speech-to-text",
    operation: "speech_to_text",
    sourceLanguage: normalizeLanguageTag(language),
    reason: "capability_not_advertised",
  };
}

function translationCapabilityFor(
  options: TranscriptPipelineOptions,
  sourceLanguage: string,
  targetLanguage: string,
  decision: ReturnType<
    typeof TranscriptionJobPayloadSchema.parse
  >["languageDecision"],
): LanguageCapabilityResult | undefined {
  if (languagesEquivalent(sourceLanguage, targetLanguage)) return undefined;
  if (options.translation?.checkLanguagePair) {
    return options.translation.checkLanguagePair(
      sourceLanguage,
      targetLanguage,
    );
  }
  if (!decision || decision.status !== "confirmed") return undefined;
  return {
    state: "unknown",
    provider: options.claimedTranslation
      ? "amazon-translate"
      : "translation-provider",
    operation: "translation",
    sourceLanguage: normalizeLanguageTag(sourceLanguage),
    targetLanguage: normalizeLanguageTag(targetLanguage),
    reason: "capability_not_advertised",
  };
}

async function observeLanguageEvidence(
  context: TranscriptionExecutionContext,
  claimed: ClaimedTranscriptionJob,
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
  evidence: Omit<
    ProviderLanguageEvidence,
    "id" | "projectId" | "videoId" | "jobId" | "attempt" | "createdAt"
  >,
  translationCapability: LanguageCapabilityResult | undefined,
  now: () => Date,
  speechCapability?: LanguageCapabilityResult,
) {
  return context.observeLanguageEvidence({
    attempt: claimed.lease.attempt,
    evidence: {
      id: randomUUID(),
      projectId: claimed.job.projectId!,
      videoId: payload.catalogVideoId,
      ...evidence,
      jobId: claimed.job.id,
      attempt: claimed.lease.attempt,
      createdAt: now().toISOString(),
    },
    ...(speechCapability ? { speechCapability } : {}),
    ...(translationCapability ? { translationCapability } : {}),
  });
}

function trackFingerprint(track: {
  id: string;
  language: string;
  kind: "manual" | "automatic";
  translatable: boolean;
  downloadAccess: "available" | "authorization-required" | "unavailable";
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: track.id,
        language: track.language,
        kind: track.kind,
        translatable: track.translatable,
        downloadAccess: track.downloadAccess,
      }),
    )
    .digest("hex");
}

function languageDecisionIdentity(
  decision: ReturnType<
    typeof TranscriptionJobPayloadSchema.parse
  >["languageDecision"],
) {
  return JSON.stringify(decision ?? null);
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
  readonly #memoryTargets = new Map<
    string,
    { jobId: string; attempt: number; uploadId: string }
  >();

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
    const grant = TranscriptUploadGrantSchema.parse(response);
    for (const target of grant.targets) {
      if (new URL(target.uploadUrl).protocol === "memory-upload:") {
        this.#memoryTargets.set(target.objectKey, {
          jobId,
          attempt: input.attempt,
          uploadId: grant.uploadId,
        });
      }
    }
    return grant;
  }

  async upload(
    target: TranscriptUploadGrant["targets"][number],
    bytes: Uint8Array,
    contentType: string,
  ): Promise<FinalizedObject> {
    if (new URL(target.uploadUrl).protocol === "memory-upload:") {
      const context = this.#memoryTargets.get(target.objectKey);
      if (!context) {
        throw new TranscriptPipelineError(
          "Memory transcript upload target is missing its claimed-job context.",
        );
      }
      return FinalizedObjectSchema.parse(
        await this.api(
          `/api/transcription-jobs/${encodeURIComponent(context.jobId)}/transcript-uploads/${encodeURIComponent(context.uploadId)}/artifacts`,
          {
            attempt: context.attempt,
            type: target.type,
            objectKey: target.objectKey,
            contentType,
            bytesBase64: Buffer.from(bytes).toString("base64"),
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ),
      );
    }
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
    const finalized = ActiveTranscriptBundleSchema.parse(
      await this.api(
        `/api/transcription-jobs/${encodeURIComponent(jobId)}/finalize`,
        body,
      ),
    );
    for (const [objectKey, context] of this.#memoryTargets) {
      if (context.uploadId === input.uploadId)
        this.#memoryTargets.delete(objectKey);
    }
    return finalized;
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
