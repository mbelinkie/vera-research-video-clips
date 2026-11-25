import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from "@aws-sdk/client-transcribe";
import {
  NormalizedTranscriptSchema,
  normalizeLanguageTag,
  type NormalizedTranscript,
} from "@research-video/contracts";
import { normalizeGeneratedTranscript } from "@research-video/transcript";

import { ProviderExecutionError, type SpeechToTextProvider } from "./index.ts";
import type { TranscriptionProviderAdapterFactory } from "./language-service-registry.ts";

const model = "amazon-transcribe-standard";
const operationPrefix = "research-video-transcribe";
const supportedMediaFormats = new Set([
  "mp3",
  "mp4",
  "wav",
  "flac",
  "ogg",
  "amr",
  "webm",
  "m4a",
]);

export type AwsPrivateObjectReference = Readonly<{
  bucket: string;
  key: string;
}>;

export type AwsTranscribeOperationState =
  | "created"
  | "staged"
  | "running"
  | "completed_pending_cleanup"
  | "failed_pending_cleanup"
  | "succeeded"
  | "failed";

/** Provider-private durable operation record. `getOrCreate` must be atomic. */
export type AwsTranscribeOperation = Readonly<{
  id: string;
  jobName: string;
  videoId: string;
  language?: string;
  mediaFormat: AwsTranscribeMediaFormat;
  input: AwsPrivateObjectReference;
  output: AwsPrivateObjectReference;
  state: AwsTranscribeOperationState;
  result?: NormalizedTranscript;
}>;

export interface AwsTranscribeOperationStore {
  getOrCreate(
    operation: AwsTranscribeOperation,
  ): Promise<Readonly<{ operation: AwsTranscribeOperation; created: boolean }>>;
  save(operation: AwsTranscribeOperation): Promise<void>;
}

export interface AwsTranscribeOperationDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

/** PostgreSQL-backed operation store for crash/redelivery-safe paid jobs. */
export class DatabaseAwsTranscribeOperationStore implements AwsTranscribeOperationStore {
  readonly #database: AwsTranscribeOperationDatabase;

  constructor(database: AwsTranscribeOperationDatabase) {
    this.#database = database;
  }

  async getOrCreate(operation: AwsTranscribeOperation) {
    const inserted = await this.#database.query(
      `INSERT INTO amazon_transcribe_operations
         (id, job_name, video_id, language, media_format, input_bucket,
          input_key, output_bucket, output_key, state, normalized_result,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      operationValues(operation),
    );
    if (inserted.rows[0]) {
      return {
        operation: mapDatabaseOperation(inserted.rows[0]),
        created: true,
      };
    }
    const existing = await this.#database.query(
      "SELECT * FROM amazon_transcribe_operations WHERE id = $1",
      [operation.id],
    );
    if (!existing.rows[0]) {
      throw new ProviderExecutionError(
        "The durable transcription operation could not be recovered.",
      );
    }
    return {
      operation: mapDatabaseOperation(existing.rows[0]),
      created: false,
    };
  }

  async save(operation: AwsTranscribeOperation) {
    const updated = await this.#database.query(
      `UPDATE amazon_transcribe_operations
       SET job_name = $2, video_id = $3, language = $4, media_format = $5,
           input_bucket = $6, input_key = $7, output_bucket = $8,
           output_key = $9, state = $10, normalized_result = $11,
           updated_at = now()
       WHERE id = $1 RETURNING id`,
      operationValues(operation),
    );
    if (!updated.rows[0]) {
      throw new ProviderExecutionError(
        "The durable transcription operation no longer exists.",
      );
    }
  }
}

/** Deterministic in-memory implementation for tests and local composition. */
export class InMemoryAwsTranscribeOperationStore implements AwsTranscribeOperationStore {
  readonly #operations = new Map<string, AwsTranscribeOperation>();

  async getOrCreate(operation: AwsTranscribeOperation) {
    const existing = this.#operations.get(operation.id);
    if (existing) return { operation: existing, created: false };
    this.#operations.set(operation.id, operation);
    return { operation, created: true };
  }

  async save(operation: AwsTranscribeOperation) {
    this.#operations.set(operation.id, operation);
  }
}

export type AwsTranscribeMediaFormat =
  "mp3" | "mp4" | "wav" | "flac" | "ogg" | "amr" | "webm" | "m4a";

export interface AwsTranscribePrivateStorage {
  inputFor(
    operationId: string,
    mediaFormat: AwsTranscribeMediaFormat,
  ): AwsPrivateObjectReference;
  outputFor(operationId: string): AwsPrivateObjectReference;
  putInput(input: {
    reference: AwsPrivateObjectReference;
    body: Uint8Array;
    mediaFormat: AwsTranscribeMediaFormat;
    signal?: AbortSignal;
  }): Promise<void>;
  readOutput(input: {
    reference: AwsPrivateObjectReference;
    signal?: AbortSignal;
  }): Promise<Uint8Array>;
  delete(input: {
    reference: AwsPrivateObjectReference;
    signal?: AbortSignal;
  }): Promise<void>;
}

/** Narrow injected S3 seam; SDK responses never leave this module. */
export interface AwsS3Sender {
  put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<void>;
  get(input: {
    bucket: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array>;
  delete(input: {
    bucket: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export class AwsS3PrivateTranscriptionStorage implements AwsTranscribePrivateStorage {
  readonly #bucket: string;
  readonly #sender: AwsS3Sender;

  constructor(options: { bucket: string; sender: AwsS3Sender }) {
    this.#bucket = validBucket(options.bucket);
    this.#sender = options.sender;
  }

  inputFor(operationId: string, mediaFormat: AwsTranscribeMediaFormat) {
    return {
      bucket: this.#bucket,
      key: `${operationPrefix}/${operationId}/input.${mediaFormat}`,
    };
  }

  outputFor(operationId: string) {
    return {
      bucket: this.#bucket,
      key: `${operationPrefix}/${operationId}/output.json`,
    };
  }

  async putInput(input: {
    reference: AwsPrivateObjectReference;
    body: Uint8Array;
    mediaFormat: AwsTranscribeMediaFormat;
    signal?: AbortSignal;
  }) {
    await this.#sender.put({
      bucket: input.reference.bucket,
      key: input.reference.key,
      body: input.body,
      contentType: `audio/${input.mediaFormat}`,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async readOutput(input: {
    reference: AwsPrivateObjectReference;
    signal?: AbortSignal;
  }) {
    return this.#sender.get({
      bucket: input.reference.bucket,
      key: input.reference.key,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async delete(input: {
    reference: AwsPrivateObjectReference;
    signal?: AbortSignal;
  }) {
    await this.#sender.delete({
      bucket: input.reference.bucket,
      key: input.reference.key,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }
}

export type AwsTranscribeJobStatus = "running" | "completed" | "failed";

/** Narrow injected Transcribe seam; SDK output remains provider-private. */
export interface AwsTranscribeSender {
  start(input: {
    jobName: string;
    mediaFileUri: string;
    mediaFormat: AwsTranscribeMediaFormat;
    outputBucket: string;
    outputKey: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<void>;
  get(input: {
    jobName: string;
    signal?: AbortSignal;
  }): Promise<Readonly<{ status: AwsTranscribeJobStatus }>>;
  delete(input: { jobName: string; signal?: AbortSignal }): Promise<void>;
}

export type AwsTranscribeProviderOptions = {
  region: string;
  operationStore: AwsTranscribeOperationStore;
  storage?: AwsTranscribePrivateStorage;
  storageBucket?: string;
  s3Sender?: AwsS3Sender;
  transcribeSender?: AwsTranscribeSender;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

export class AwsTranscribeSpeechToTextProvider implements SpeechToTextProvider {
  readonly #store: AwsTranscribeOperationStore;
  readonly #storage: AwsTranscribePrivateStorage;
  readonly #transcribe: AwsTranscribeSender;
  readonly #maxPollAttempts: number;
  readonly #pollIntervalMs: number;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: AwsTranscribeProviderOptions) {
    this.#store = options.operationStore;
    this.#storage =
      options.storage ??
      new AwsS3PrivateTranscriptionStorage({
        bucket: validBucket(options.storageBucket ?? ""),
        sender: options.s3Sender ?? createAwsS3Sender(options.region),
      });
    this.#transcribe =
      options.transcribeSender ?? createAwsTranscribeSender(options.region);
    this.#maxPollAttempts = boundedPositiveInteger(
      options.maxPollAttempts ?? 180,
      "maximum poll attempts",
    );
    this.#pollIntervalMs = boundedPositiveInteger(
      options.pollIntervalMs ?? 1_000,
      "poll interval",
    );
    this.#wait = options.wait ?? waitFor;
  }

  async transcribe(input: {
    videoId: string;
    inputPath: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<NormalizedTranscript> {
    const prepared = await prepareInput(input);
    const operationId = operationIdentity(prepared);
    const seed: AwsTranscribeOperation = {
      id: operationId,
      jobName: `${operationPrefix}-${operationId.slice(0, 40)}`,
      videoId: prepared.videoId,
      ...(prepared.language ? { language: prepared.language } : {}),
      mediaFormat: prepared.mediaFormat,
      input: this.#storage.inputFor(operationId, prepared.mediaFormat),
      output: this.#storage.outputFor(operationId),
      state: "created",
    };
    let { operation } = await this.#store.getOrCreate(seed);

    if (operation.state === "succeeded" && operation.result) {
      return operation.result;
    }
    if (operation.state === "failed") throw executionFailure();
    if (operation.state === "completed_pending_cleanup") {
      return this.#finishSuccess(operation, input.signal);
    }
    if (operation.state === "failed_pending_cleanup") {
      return this.#finishFailure(operation, input.signal);
    }

    try {
      if (operation.state === "created") {
        await this.#storage.putInput({
          reference: operation.input,
          body: prepared.body,
          mediaFormat: operation.mediaFormat,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        operation = await this.#save(operation, "staged");
      }

      if (operation.state === "staged") {
        await this.#startOrRecover(operation, input.signal);
        operation = await this.#save(operation, "running");
      }

      const status = await this.#poll(operation, input.signal);
      if (status === "failed") {
        operation = await this.#save(operation, "failed_pending_cleanup");
        return this.#finishFailure(operation, input.signal);
      }

      const result = await normalizeAwsTranscribeOutput({
        body: await this.#storage.readOutput({
          reference: operation.output,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
        videoId: operation.videoId,
        ...(operation.language ? { languageHint: operation.language } : {}),
      });
      operation = { ...operation, state: "completed_pending_cleanup", result };
      await this.#store.save(operation);
      return this.#finishSuccess(operation, input.signal);
    } catch (error) {
      if (error instanceof AwsTranscribeOperationPendingError) throw error;
      if (operation.state === "failed_pending_cleanup") {
        return this.#finishFailure(operation, input.signal);
      }
      operation = await this.#save(operation, "failed_pending_cleanup");
      return this.#finishFailure(operation, input.signal);
    }
  }

  async #save(
    operation: AwsTranscribeOperation,
    state: AwsTranscribeOperationState,
  ) {
    const next = { ...operation, state } as AwsTranscribeOperation;
    await this.#store.save(next);
    return next;
  }

  async #startOrRecover(
    operation: AwsTranscribeOperation,
    signal?: AbortSignal,
  ) {
    try {
      await this.#transcribe.start({
        jobName: operation.jobName,
        mediaFileUri: s3Uri(operation.input),
        mediaFormat: operation.mediaFormat,
        outputBucket: operation.output.bucket,
        outputKey: operation.output.key,
        ...(operation.language ? { language: operation.language } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (!isExistingJobError(error)) throw error;
      await this.#transcribe.get({
        jobName: operation.jobName,
        ...(signal ? { signal } : {}),
      });
    }
  }

  async #poll(operation: AwsTranscribeOperation, signal?: AbortSignal) {
    for (let attempt = 0; attempt < this.#maxPollAttempts; attempt += 1) {
      const { status } = await this.#transcribe.get({
        jobName: operation.jobName,
        ...(signal ? { signal } : {}),
      });
      if (status !== "running") return status;
      if (attempt + 1 < this.#maxPollAttempts) {
        await this.#wait(this.#pollIntervalMs, signal);
      }
    }
    throw new AwsTranscribeOperationPendingError();
  }

  async #finishSuccess(
    operation: AwsTranscribeOperation,
    signal?: AbortSignal,
  ): Promise<NormalizedTranscript> {
    if (!operation.result) throw executionFailure();
    const result = operation.result;
    try {
      await this.#cleanup(operation, signal);
    } catch {
      // Keep the successful provider result and its terminal-cleanup state
      // durable.  Treating a cleanup retry as a failed recognition would lose
      // the completed result and could cause the caller to pay for a second
      // transcription job.
      throw new AwsTranscribeOperationPendingError(
        "Amazon Transcribe completed, but private terminal cleanup must be retried.",
      );
    }
    const completed = { ...operation, state: "succeeded" as const };
    await this.#store.save(completed);
    return result;
  }

  async #finishFailure(
    operation: AwsTranscribeOperation,
    signal?: AbortSignal,
  ): Promise<never> {
    try {
      await this.#cleanup(operation, signal);
    } catch {
      throw executionFailure();
    }
    await this.#store.save({ ...operation, state: "failed" });
    throw executionFailure();
  }

  async #cleanup(operation: AwsTranscribeOperation, signal?: AbortSignal) {
    const outcomes = await Promise.allSettled([
      this.#storage.delete({
        reference: operation.output,
        ...(signal ? { signal } : {}),
      }),
      this.#storage.delete({
        reference: operation.input,
        ...(signal ? { signal } : {}),
      }),
      this.#transcribe.delete({
        jobName: operation.jobName,
        ...(signal ? { signal } : {}),
      }),
    ]);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      throw new Error("Amazon Transcribe terminal cleanup did not complete.");
    }
  }
}

export class AwsTranscribeOperationPendingError extends Error {
  readonly code = "provider_operation_pending";
  readonly retryable = true;

  constructor(
    message = "Amazon Transcribe is still running; resume the same operation later.",
  ) {
    super(message);
  }
}

export function createAwsTranscribeProviderAdapterFactory(
  options: AwsTranscribeProviderOptions,
): TranscriptionProviderAdapterFactory {
  return {
    descriptor: {
      id: "amazon-transcribe",
      service: "transcription",
      displayName: "Amazon Transcribe",
      adapterContractVersion: 1,
      configurationRevision: `amazon-transcribe-v1-${shortHash(options.region)}`,
      capabilityRevision: "amazon-transcribe-standard-v1",
      supportedLanguages: [],
      inputModes: ["object_uri", "direct_upload"],
      disclosure: {
        version: 1,
        title: "Amazon Transcribe disclosure",
        summary:
          "Authorized job-scoped audio is sent to Amazon Transcribe and private output is deleted after terminal processing.",
        dataCategories: ["audio_media", "metadata"],
        publishedAt: "2026-08-26T00:00:00.000Z",
      },
      pricing: {
        currency: "USD",
        unit: "audio_seconds",
        amountMicros: 0,
        quantity: 1,
        effectiveAt: "2026-08-26T00:00:00.000Z",
      },
      state: "enabled",
    },
    create: (configuration) => {
      if (
        configuration?.protectedCredentialReference &&
        configuration.protectedCredentialReference !== "credential:aws-default"
      ) {
        throw new ProviderExecutionError(
          "The configured protected AWS credential reference is unavailable to this adapter.",
        );
      }
      return new AwsTranscribeSpeechToTextProvider({
        ...options,
        region: configuration?.region ?? options.region,
      });
    },
  };
}

export async function normalizeAwsTranscribeOutput(input: {
  body: Uint8Array;
  videoId: string;
  languageHint?: string;
}): Promise<NormalizedTranscript> {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(input.body));
  } catch {
    throw executionFailure();
  }
  const parsed = parseAwsTranscribeOutput(payload, input.languageHint);
  const generated = await normalizeGeneratedTranscript({
    videoId: input.videoId,
    language: parsed.language,
    provider: "amazon-transcribe",
    model,
    segments: parsed.segments,
  });
  const bounds = new Map(
    generated.segments.map((segment, index) => [
      segment.id,
      parsed.segments[index]!,
    ]),
  );
  return NormalizedTranscriptSchema.parse({
    ...generated,
    track: { ...generated.track, timingPrecision: "word" },
    tokens: generated.tokens.map((token) => {
      const segment = bounds.get(token.segmentId);
      if (!segment) throw executionFailure();
      return {
        ...token,
        startMs: segment.startMs,
        endMs: segment.endMs,
        timingConfidence: 1,
      };
    }),
  });
}

function parseAwsTranscribeOutput(payload: unknown, languageHint?: string) {
  if (!payload || typeof payload !== "object") throw executionFailure();
  const results = (payload as { results?: unknown }).results;
  if (!results || typeof results !== "object") throw executionFailure();
  const language = readLanguage(results, languageHint);
  const items = (results as { items?: unknown }).items;
  if (!Array.isArray(items)) throw executionFailure();
  const segments: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") throw executionFailure();
    const record = item as Record<string, unknown>;
    const alternative = Array.isArray(record.alternatives)
      ? record.alternatives[0]
      : undefined;
    const content =
      alternative && typeof alternative === "object"
        ? (alternative as { content?: unknown }).content
        : undefined;
    if (typeof content !== "string" || !content.trim())
      throw executionFailure();
    if (record.type === "punctuation") {
      const previous = segments.at(-1);
      if (!previous) throw executionFailure();
      previous.text += content;
      continue;
    }
    if (record.type !== "pronunciation") throw executionFailure();
    const startMs = secondsToMilliseconds(record.start_time);
    const endMs = secondsToMilliseconds(record.end_time);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      throw executionFailure();
    }
    segments.push({ startMs, endMs, text: content.trim() });
  }
  if (segments.length === 0) throw executionFailure();
  return { language, segments };
}

function readLanguage(results: object, languageHint?: string) {
  const value = (results as { language_code?: unknown }).language_code;
  if (typeof value === "string" && value.trim()) {
    return normalizeLanguageTag(value);
  }
  if (languageHint?.trim()) return normalizeLanguageTag(languageHint);
  throw executionFailure();
}

async function prepareInput(input: {
  videoId: string;
  inputPath: string;
  language?: string;
}) {
  const videoId = input.videoId.trim();
  if (!videoId || videoId.length > 64) throw executionFailure();
  const inputPath = input.inputPath.trim();
  if (!inputPath || inputPath.includes("\0") || inputPath.includes("://")) {
    throw executionFailure();
  }
  const mediaFormat = extname(inputPath).slice(1).toLowerCase();
  if (!supportedMediaFormats.has(mediaFormat)) throw executionFailure();
  const body = await readFile(inputPath).catch(() => undefined);
  if (!body?.byteLength) throw executionFailure();
  return {
    videoId,
    body: new Uint8Array(body),
    mediaFormat: mediaFormat as AwsTranscribeMediaFormat,
    ...(input.language?.trim()
      ? { language: normalizeLanguageTag(input.language) }
      : {}),
  };
}

function operationIdentity(input: {
  videoId: string;
  body: Uint8Array;
  mediaFormat: AwsTranscribeMediaFormat;
  language?: string;
}) {
  const contentHash = createHash("sha256").update(input.body).digest("hex");
  return shortHash(
    `${input.videoId}\0${contentHash}\0${input.mediaFormat}\0${input.language ?? "auto"}`,
    48,
  );
}

function operationValues(operation: AwsTranscribeOperation) {
  return [
    operation.id,
    operation.jobName,
    operation.videoId,
    operation.language ?? null,
    operation.mediaFormat,
    operation.input.bucket,
    operation.input.key,
    operation.output.bucket,
    operation.output.key,
    operation.state,
    operation.result ? JSON.stringify(operation.result) : null,
  ] as const;
}

function mapDatabaseOperation(
  row: Record<string, unknown>,
): AwsTranscribeOperation {
  const rawResult =
    typeof row.normalized_result === "string"
      ? JSON.parse(row.normalized_result)
      : row.normalized_result;
  return {
    id: String(row.id),
    jobName: String(row.job_name),
    videoId: String(row.video_id),
    ...(row.language === null || row.language === undefined
      ? {}
      : { language: String(row.language) }),
    mediaFormat: parseMediaFormat(String(row.media_format)),
    input: {
      bucket: String(row.input_bucket),
      key: String(row.input_key),
    },
    output: {
      bucket: String(row.output_bucket),
      key: String(row.output_key),
    },
    state: operationState(String(row.state)),
    ...(rawResult === null || rawResult === undefined
      ? {}
      : { result: NormalizedTranscriptSchema.parse(rawResult) }),
  };
}

function operationState(value: string): AwsTranscribeOperationState {
  if (
    value === "created" ||
    value === "staged" ||
    value === "running" ||
    value === "completed_pending_cleanup" ||
    value === "failed_pending_cleanup" ||
    value === "succeeded" ||
    value === "failed"
  ) {
    return value;
  }
  throw new ProviderExecutionError(
    "The durable transcription operation has an invalid state.",
  );
}

function parseMediaFormat(value: string): AwsTranscribeMediaFormat {
  if (supportedMediaFormats.has(value))
    return value as AwsTranscribeMediaFormat;
  throw new ProviderExecutionError(
    "The durable transcription operation has an invalid media format.",
  );
}

function createAwsS3Sender(region: string): AwsS3Sender {
  const client = new S3Client({ region: validRegion(region) });
  return {
    put: async (input) => {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
    },
    get: async (input) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
      const body = response.Body as
        { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) throw executionFailure();
      return body.transformToByteArray();
    },
    delete: async (input) => {
      await client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
    },
  };
}

function createAwsTranscribeSender(region: string): AwsTranscribeSender {
  const client = new TranscribeClient({ region: validRegion(region) });
  return {
    start: async (input) => {
      await client.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: input.jobName,
          Media: { MediaFileUri: input.mediaFileUri },
          MediaFormat: input.mediaFormat,
          OutputBucketName: input.outputBucket,
          OutputKey: input.outputKey,
          ...(input.language
            ? { LanguageCode: input.language as never }
            : { IdentifyLanguage: true }),
        }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
    },
    get: async (input) => {
      const response = await client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: input.jobName }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
      const status = response.TranscriptionJob?.TranscriptionJobStatus;
      if (status === "COMPLETED") return { status: "completed" };
      if (status === "FAILED") return { status: "failed" };
      return { status: "running" };
    },
    delete: async (input) => {
      await client.send(
        new DeleteTranscriptionJobCommand({
          TranscriptionJobName: input.jobName,
        }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
    },
  };
}

function s3Uri(reference: AwsPrivateObjectReference) {
  return `s3://${reference.bucket}/${reference.key}`;
}

function secondsToMilliseconds(value: unknown) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value)) {
    return undefined;
  }
  const milliseconds = Math.round(Number(value) * 1_000);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : undefined;
}

function isExistingJobError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ConflictException"
  );
}

function validRegion(region: string) {
  const value = region.trim();
  if (!value || value.length > 160) throw executionFailure();
  return value;
}

function validBucket(bucket: string) {
  const value = bucket.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)) {
    throw executionFailure();
  }
  return value;
}

function boundedPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new ProviderExecutionError(`Amazon Transcribe ${label} is invalid.`);
  }
  return value;
}

function shortHash(value: string, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function executionFailure() {
  return new ProviderExecutionError(
    "Amazon Transcribe did not produce a usable transcript; retry the full source with the configured local speech provider.",
  );
}

function waitFor(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
