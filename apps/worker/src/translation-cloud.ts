import {
  ApiErrorSchema,
  WorkerTranslateTranscriptRequestSchema,
  WorkerTranslateTranscriptResponseSchema,
  type CloudTranslationConsent,
  type FinalizedObject,
  type WorkerTranslateTranscriptResponse,
} from "@research-video/contracts";

import {
  TranscriptPipelineError,
  type ClaimedTranslationClient,
} from "./pipeline.ts";

export class HttpClaimedTranslationClient implements ClaimedTranslationClient {
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

  async translate(input: {
    jobId: string;
    attempt: number;
    consent: CloudTranslationConsent;
    uploadId: string;
    sourceArtifact: FinalizedObject & { type: "original-normalized" };
    targetLanguage: string;
    signal?: AbortSignal;
  }): Promise<WorkerTranslateTranscriptResponse> {
    const body = WorkerTranslateTranscriptRequestSchema.parse({
      attempt: input.attempt,
      consent: input.consent,
      uploadId: input.uploadId,
      sourceArtifact: input.sourceArtifact,
      targetLanguage: input.targetLanguage,
    });
    const response = await this.#fetcher(
      new URL(
        `/api/transcription-jobs/${encodeURIComponent(input.jobId)}/translate`,
        this.#baseUrl,
      ),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: this.#authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new TranscriptPipelineError(
        parsed.success
          ? parsed.data.error.message
          : `Cloud translation failed (${response.status}).`,
      );
    }
    return WorkerTranslateTranscriptResponseSchema.parse(payload);
  }
}
