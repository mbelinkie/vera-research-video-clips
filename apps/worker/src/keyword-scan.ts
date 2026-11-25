import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  ActiveTranscriptBundleSchema,
  ApiErrorSchema,
  ClaimProjectKeywordScanRequestSchema,
  CreateProjectKeywordScanArtifactUploadRequestSchema,
  FailProjectKeywordScanRequestSchema,
  FinalizeProjectKeywordScanRequestSchema,
  GetProjectKeywordScanInputRequestSchema,
  HeartbeatProjectKeywordScanRequestSchema,
  NormalizedTranscriptSchema,
  ProjectKeywordMatchArtifactDescriptorSchema,
  ProjectKeywordScanArtifactUploadGrantSchema,
  ProjectKeywordScanClaimSchema,
  ProjectKeywordScanInputSnapshotSchema,
  ProjectKeywordScanSummarySchema,
  TranscriptManifestSchema,
  languagesEquivalent,
  type FinalizeProjectKeywordScanRequest,
  type NormalizedTranscript,
  type ProjectKeywordScanArtifactUploadGrant,
  type ProjectKeywordScanClaim,
  type ProjectKeywordScanInputSnapshot,
  type ProjectKeywordScanSummary,
  type TranscriptDownloadTarget,
} from "@research-video/contracts";
import { scanProjectKeywords } from "@research-video/transcript";

const MaximumTranscriptArtifactBytes = 100_000_000;
const PersistableKeywordScanFailureCodes = new Set([
  "keyword_scan_input_mismatch",
  "keyword_scan_upload_mismatch",
  "keyword_scan_upload_failed",
  "keyword_scan_upload_unversioned",
  "keyword_scan_transcript_download_failed",
  "keyword_scan_control_plane_failed",
  "keyword_scan_transcript_integrity_failed",
  "keyword_scan_lease_lost",
]);

export interface ProjectKeywordScanControlPlane {
  claim(): Promise<ProjectKeywordScanClaim | undefined>;
  getInput(
    claim: ProjectKeywordScanClaim,
  ): Promise<ProjectKeywordScanInputSnapshot>;
  heartbeat(claim: ProjectKeywordScanClaim): Promise<ProjectKeywordScanClaim>;
  createUpload(
    claim: ProjectKeywordScanClaim,
  ): Promise<ProjectKeywordScanArtifactUploadGrant>;
  upload(
    grant: ProjectKeywordScanArtifactUploadGrant,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<string>;
  finalize(
    claim: ProjectKeywordScanClaim,
    input: FinalizeProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanSummary>;
  fail(
    claim: ProjectKeywordScanClaim,
    error: { code: string; message: string },
  ): Promise<ProjectKeywordScanSummary>;
  download(
    target: TranscriptDownloadTarget,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

export class ProjectKeywordScanWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ProjectKeywordScanWorkerError";
    this.code = options.code ?? "keyword_scan_worker_failed";
    this.retryable = options.retryable ?? true;
  }
}

export type ProjectKeywordScanWorkerResult =
  "idle" | "processed" | "failed" | "lease-lost";

export class ClaimingProjectKeywordScanWorker {
  readonly #heartbeatIntervalMs: number;

  constructor(
    private readonly controlPlane: ProjectKeywordScanControlPlane,
    options: { heartbeatIntervalMs?: number } = {},
  ) {
    this.#heartbeatIntervalMs = boundedInteger(
      options.heartbeatIntervalMs ?? 40_000,
      1,
      1_200_000,
      "heartbeatIntervalMs",
    );
  }

  async runOnce(): Promise<ProjectKeywordScanWorkerResult> {
    const claim = await this.controlPlane.claim();
    if (!claim) return "idle";

    const abortController = new AbortController();
    let heartbeat: Promise<void> | undefined;
    let heartbeatFailure: unknown;
    const renew = () => {
      if (heartbeat || heartbeatFailure) return heartbeat;
      heartbeat = this.controlPlane
        .heartbeat(claim)
        .then(() => undefined)
        .catch((error) => {
          heartbeatFailure = error;
          abortController.abort(error);
        })
        .finally(() => {
          heartbeat = undefined;
        });
      return heartbeat;
    };
    const timer = setInterval(() => void renew(), this.#heartbeatIntervalMs);
    timer.unref?.();

    try {
      await executeProjectKeywordScan(
        this.controlPlane,
        claim,
        abortController.signal,
      );
      clearInterval(timer);
      await heartbeat;
      // A terminal finalize is authoritative even if a heartbeat raced it.
      return "processed";
    } catch (error) {
      clearInterval(timer);
      await heartbeat;
      try {
        await this.controlPlane.fail(claim, boundedFailure(error));
        return "failed";
      } catch {
        return "lease-lost";
      }
    }
  }
}

export type ProjectKeywordScanWorkerServiceSummary = {
  processed: number;
  failed: number;
  leaseLost: number;
  unexpectedErrors: number;
};

export class ProjectKeywordScanWorkerService {
  readonly #idlePollMs: number;
  readonly #errorBackoffMs: number;
  readonly #onUnexpectedError: ((error: unknown) => void) | undefined;

  constructor(
    private readonly worker: Pick<ClaimingProjectKeywordScanWorker, "runOnce">,
    options: {
      idlePollMs?: number;
      errorBackoffMs?: number;
      onUnexpectedError?: (error: unknown) => void;
    } = {},
  ) {
    this.#idlePollMs = boundedInteger(
      options.idlePollMs ?? 2_000,
      1,
      60_000,
      "idlePollMs",
    );
    this.#errorBackoffMs = boundedInteger(
      options.errorBackoffMs ?? 5_000,
      1,
      60_000,
      "errorBackoffMs",
    );
    this.#onUnexpectedError = options.onUnexpectedError;
  }

  async run(
    signal: AbortSignal,
  ): Promise<ProjectKeywordScanWorkerServiceSummary> {
    const summary: ProjectKeywordScanWorkerServiceSummary = {
      processed: 0,
      failed: 0,
      leaseLost: 0,
      unexpectedErrors: 0,
    };
    while (!signal.aborted) {
      try {
        const result = await this.worker.runOnce();
        if (result === "processed") summary.processed += 1;
        if (result === "failed") summary.failed += 1;
        if (result === "lease-lost") summary.leaseLost += 1;
        if (result === "idle" && !signal.aborted) {
          await waitForAbortableDelay(this.#idlePollMs, signal);
        }
      } catch (error) {
        summary.unexpectedErrors += 1;
        try {
          this.#onUnexpectedError?.(error);
        } catch {
          // Observability must not terminate the scan lane.
        }
        if (!signal.aborted) {
          await waitForAbortableDelay(this.#errorBackoffMs, signal);
        }
      }
    }
    return summary;
  }
}

export async function executeProjectKeywordScan(
  controlPlane: ProjectKeywordScanControlPlane,
  claim: ProjectKeywordScanClaim,
  signal?: AbortSignal,
): Promise<ProjectKeywordScanSummary> {
  throwIfAborted(signal);
  const snapshot = ProjectKeywordScanInputSnapshotSchema.parse(
    await controlPlane.getInput(claim),
  );
  if (
    snapshot.job.id !== claim.job.id ||
    snapshot.job.projectId !== claim.job.projectId ||
    snapshot.job.projectVideoId !== claim.job.projectVideoId ||
    snapshot.job.transcriptVersionId !== claim.job.transcriptVersionId ||
    snapshot.job.keywordSetVersion !== claim.job.keywordSetVersion ||
    snapshot.job.scannerSchemaVersion !== claim.job.scannerSchemaVersion ||
    snapshot.attempt !== claim.attempt
  ) {
    throw new ProjectKeywordScanWorkerError(
      "The keyword scan input does not match the claimed exact job.",
      { code: "keyword_scan_input_mismatch", retryable: false },
    );
  }
  const tracks = await downloadVerifiedTranscriptTracks(
    controlPlane,
    snapshot,
    signal,
  );
  throwIfAborted(signal);
  const result = await scanProjectKeywords({
    projectId: snapshot.job.projectId,
    projectVideoId: snapshot.job.projectVideoId,
    transcriptVersionId: snapshot.job.transcriptVersionId,
    keywordSetVersion: snapshot.job.keywordSetVersion,
    tracks,
    aliases: snapshot.aliases,
  });
  throwIfAborted(signal);
  const grant = ProjectKeywordScanArtifactUploadGrantSchema.parse(
    await controlPlane.createUpload(claim),
  );
  if (grant.scanId !== claim.job.id) {
    throw new ProjectKeywordScanWorkerError(
      "The keyword scan upload grant belongs to another scan.",
      { code: "keyword_scan_upload_mismatch", retryable: false },
    );
  }
  const objectVersionId = await controlPlane.upload(
    grant,
    result.bytes,
    signal,
  );
  throwIfAborted(signal);
  const artifact = ProjectKeywordMatchArtifactDescriptorSchema.parse({
    objectKey: grant.objectKey,
    objectVersionId,
    sha256: result.sha256,
    sizeBytes: result.bytes.byteLength,
    schemaVersion: snapshot.job.scannerSchemaVersion,
  });
  const durationMs =
    snapshot.durationMs ??
    Math.max(
      0,
      ...tracks.flatMap((track) =>
        track.segments.map((segment) => segment.endMs),
      ),
    );
  const keywordCountMap = new Map<string, number>();
  for (const occurrence of result.artifact.occurrences) {
    keywordCountMap.set(
      occurrence.keywordId,
      (keywordCountMap.get(occurrence.keywordId) ?? 0) + 1,
    );
  }
  const keywordCounts = [...keywordCountMap]
    .map(([keywordId, occurrenceCount]) => ({ keywordId, occurrenceCount }))
    .sort((left, right) => left.keywordId.localeCompare(right.keywordId));
  return controlPlane.finalize(
    claim,
    FinalizeProjectKeywordScanRequestSchema.parse({
      attempt: claim.attempt,
      artifact,
      occurrenceCount: result.occurrenceCount,
      matchedKeywordCount: result.matchedKeywordCount,
      keywordCounts,
      ...(durationMs > 0 ? { durationMs } : {}),
    }),
  );
}

export async function downloadVerifiedTranscriptTracks(
  controlPlane: Pick<ProjectKeywordScanControlPlane, "download">,
  snapshotInput: ProjectKeywordScanInputSnapshot,
  signal?: AbortSignal,
): Promise<NormalizedTranscript[]> {
  const snapshot = ProjectKeywordScanInputSnapshotSchema.parse(snapshotInput);
  const bundle = ActiveTranscriptBundleSchema.parse(snapshot.transcript);
  const targets = new Map(
    bundle.downloads.map((target) => [target.type, target] as const),
  );
  if (targets.size !== bundle.downloads.length) {
    throw integrityError("Transcript download targets are not unique.");
  }
  if (targets.size !== bundle.manifest.artifacts.length + 1) {
    throw integrityError("Transcript download targets are not complete.");
  }
  const manifestTarget = targets.get("manifest");
  if (
    !manifestTarget ||
    !sameTranscriptObject(manifestTarget, bundle.manifestObject)
  ) {
    throw integrityError("Transcript manifest download target is not exact.");
  }
  const manifestBytes = await verifiedDownload(
    controlPlane,
    manifestTarget,
    signal,
  );
  let downloadedManifest;
  try {
    downloadedManifest = TranscriptManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    );
  } catch {
    throw integrityError("Downloaded transcript manifest is invalid.");
  }
  if (!isDeepStrictEqual(downloadedManifest, bundle.manifest)) {
    throw integrityError(
      "Downloaded transcript manifest changed after authorization.",
    );
  }
  for (const artifact of bundle.manifest.artifacts) {
    const target = targets.get(artifact.type);
    if (
      !artifact.objectVersionId ||
      !target ||
      !sameTranscriptObject(target, artifact)
    ) {
      throw integrityError(
        `Transcript ${artifact.type} download target is not exact.`,
      );
    }
  }

  const readTrack = async (
    type: "original-normalized" | "english-normalized",
  ): Promise<NormalizedTranscript | undefined> => {
    const descriptor = bundle.manifest.artifacts.find(
      (artifact) => artifact.type === type,
    );
    if (!descriptor?.objectVersionId) return undefined;
    const target = targets.get(type);
    if (!target || !sameTranscriptObject(target, descriptor)) {
      throw integrityError(`Transcript ${type} download target is not exact.`);
    }
    const stored = await verifiedDownload(controlPlane, target, signal);
    let bytes = stored;
    if (descriptor.objectKey.toLowerCase().endsWith(".gz")) {
      try {
        bytes = gunzipSync(stored, {
          maxOutputLength: MaximumTranscriptArtifactBytes,
        });
      } catch {
        throw integrityError(`Transcript ${type} compression is invalid.`);
      }
    }
    try {
      return NormalizedTranscriptSchema.parse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
    } catch {
      throw integrityError(`Transcript ${type} bytes are invalid.`);
    }
  };

  const english = await readTrack("english-normalized");
  if (!english) {
    throw integrityError("The exact transcript bundle has no English track.");
  }
  assertTrackIdentity(english, bundle, "english", "en");
  const sourceIsEnglish = languagesEquivalent(
    bundle.manifest.sourceLanguage,
    "en",
  );
  const original = sourceIsEnglish
    ? english
    : await readTrack("original-normalized");
  if (!original) {
    throw integrityError(
      "The exact foreign-language bundle has no original track.",
    );
  }
  if (!sourceIsEnglish) {
    assertTrackIdentity(
      original,
      bundle,
      "original",
      bundle.manifest.sourceLanguage,
    );
    if (
      english.track.sourceTrackId !== original.track.id ||
      english.track.timingPrecision !== original.track.timingPrecision
    ) {
      throw integrityError(
        "The exact English track is not time-linked to its original track.",
      );
    }
  }
  return original === english ? [english] : [original, english];
}

export class HttpProjectKeywordScanControlPlane implements ProjectKeywordScanControlPlane {
  readonly #baseUrl: URL;
  readonly #authorization: string;
  readonly #leaseSeconds: number;
  readonly #fetcher: typeof fetch;

  constructor(options: {
    baseUrl: string;
    authorization: string;
    leaseSeconds?: number;
    fetcher?: typeof fetch;
  }) {
    this.#baseUrl = new URL(options.baseUrl);
    this.#authorization = options.authorization;
    this.#leaseSeconds = options.leaseSeconds ?? 120;
    this.#fetcher = options.fetcher ?? fetch;
    ClaimProjectKeywordScanRequestSchema.parse({
      leaseSeconds: this.#leaseSeconds,
    });
  }

  async claim(): Promise<ProjectKeywordScanClaim | undefined> {
    const response = await this.api("/api/keyword-scans/claim", {
      leaseSeconds: this.#leaseSeconds,
    });
    return response === undefined
      ? undefined
      : ProjectKeywordScanClaimSchema.parse(response);
  }

  async getInput(
    claim: ProjectKeywordScanClaim,
  ): Promise<ProjectKeywordScanInputSnapshot> {
    const body = GetProjectKeywordScanInputRequestSchema.parse({
      attempt: claim.attempt,
    });
    return ProjectKeywordScanInputSnapshotSchema.parse(
      await this.api(scanPath(claim, "input"), body),
    );
  }

  async heartbeat(
    claim: ProjectKeywordScanClaim,
  ): Promise<ProjectKeywordScanClaim> {
    const body = HeartbeatProjectKeywordScanRequestSchema.parse({
      attempt: claim.attempt,
      leaseSeconds: this.#leaseSeconds,
    });
    return ProjectKeywordScanClaimSchema.parse(
      await this.api(scanPath(claim, "heartbeat"), body),
    );
  }

  async createUpload(
    claim: ProjectKeywordScanClaim,
  ): Promise<ProjectKeywordScanArtifactUploadGrant> {
    return ProjectKeywordScanArtifactUploadGrantSchema.parse(
      await this.api(
        scanPath(claim, "artifact-upload"),
        CreateProjectKeywordScanArtifactUploadRequestSchema.parse({
          attempt: claim.attempt,
        }),
      ),
    );
  }

  async upload(
    grant: ProjectKeywordScanArtifactUploadGrant,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.#fetcher(grant.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: Buffer.from(bytes),
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ProjectKeywordScanWorkerError(
        `Keyword scan artifact upload failed (${response.status}).`,
        { code: "keyword_scan_upload_failed" },
      );
    }
    const objectVersionId = response.headers.get("x-amz-version-id");
    if (!objectVersionId) {
      throw new ProjectKeywordScanWorkerError(
        "Keyword scan upload did not return an immutable object version ID.",
        { code: "keyword_scan_upload_unversioned", retryable: false },
      );
    }
    return objectVersionId;
  }

  async finalize(
    claim: ProjectKeywordScanClaim,
    input: FinalizeProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanSummary> {
    return ProjectKeywordScanSummarySchema.parse(
      await this.api(
        scanPath(claim, "finalize"),
        FinalizeProjectKeywordScanRequestSchema.parse(input),
      ),
    );
  }

  async fail(
    claim: ProjectKeywordScanClaim,
    error: { code: string; message: string },
  ): Promise<ProjectKeywordScanSummary> {
    return ProjectKeywordScanSummarySchema.parse(
      await this.api(
        scanPath(claim, "fail"),
        FailProjectKeywordScanRequestSchema.parse({
          attempt: claim.attempt,
          error,
        }),
      ),
    );
  }

  async download(
    target: TranscriptDownloadTarget,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.#fetcher(target.downloadUrl, {
      method: "GET",
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ProjectKeywordScanWorkerError(
        `Transcript artifact download failed (${response.status}).`,
        { code: "keyword_scan_transcript_download_failed" },
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async api(path: string, body: unknown): Promise<unknown> {
    const response = await this.#fetcher(new URL(path, this.#baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: this.#authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.status === 204) return undefined;
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new ProjectKeywordScanWorkerError(
        parsed.success
          ? parsed.data.error.message
          : "Keyword scan control-plane request failed.",
        {
          code: parsed.success
            ? parsed.data.error.code
            : "keyword_scan_control_plane_failed",
          retryable: parsed.success
            ? parsed.data.error.retryable
            : response.status >= 500,
        },
      );
    }
    return payload;
  }
}

function scanPath(claim: ProjectKeywordScanClaim, suffix: string): string {
  return `/api/projects/${encodeURIComponent(claim.job.projectId)}/keyword-scans/${encodeURIComponent(claim.job.id)}/${suffix}`;
}

async function verifiedDownload(
  controlPlane: Pick<ProjectKeywordScanControlPlane, "download">,
  target: TranscriptDownloadTarget,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (target.byteSize > MaximumTranscriptArtifactBytes) {
    throw integrityError("Transcript artifact exceeds the scan worker limit.");
  }
  throwIfAborted(signal);
  const bytes = await controlPlane.download(target, signal);
  if (
    bytes.byteLength !== target.byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== target.sha256
  ) {
    throw integrityError("Downloaded transcript artifact failed verification.");
  }
  return bytes;
}

function sameTranscriptObject(
  left: {
    type: string;
    objectKey: string;
    objectVersionId?: string | undefined;
    byteSize: number;
    sha256: string;
  },
  right: {
    type: string;
    objectKey: string;
    objectVersionId?: string | undefined;
    byteSize: number;
    sha256: string;
  },
): boolean {
  return (
    left.type === right.type &&
    left.objectKey === right.objectKey &&
    left.objectVersionId === right.objectVersionId &&
    left.byteSize === right.byteSize &&
    left.sha256 === right.sha256
  );
}

function assertTrackIdentity(
  transcript: NormalizedTranscript,
  bundle: ProjectKeywordScanInputSnapshot["transcript"],
  kind: "original" | "english",
  language: string,
): void {
  if (
    transcript.track.videoId !== bundle.manifest.videoId ||
    transcript.track.kind !== kind ||
    !languagesEquivalent(transcript.track.language, language) ||
    transcript.track.timingPrecision !== bundle.manifest.timingPrecision ||
    transcript.track.schemaVersion !==
      bundle.manifest.normalizationSchemaVersion
  ) {
    throw integrityError(
      `Downloaded ${kind} transcript identity does not match its manifest.`,
    );
  }
}

function integrityError(message: string): ProjectKeywordScanWorkerError {
  return new ProjectKeywordScanWorkerError(message, {
    code: "keyword_scan_transcript_integrity_failed",
    retryable: false,
  });
}

function boundedFailure(error: unknown): { code: string; message: string } {
  const workerError =
    error instanceof ProjectKeywordScanWorkerError ? error : undefined;
  const safeMessage =
    workerError && PersistableKeywordScanFailureCodes.has(workerError.code)
      ? workerError.message.trim().slice(0, 500)
      : undefined;
  return {
    code: (workerError?.code ?? "keyword_scan_worker_failed").slice(0, 120),
    // Only this worker's deliberately bounded errors are safe to persist.
    // API, fetch, and provider messages can contain private object keys,
    // presigned URLs, local paths, or credentials, so all others collapse.
    message: safeMessage || "Keyword scan worker failed.",
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new ProjectKeywordScanWorkerError("The keyword scan lease was lost.", {
          code: "keyword_scan_lease_lost",
        });
  }
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function waitForAbortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}
