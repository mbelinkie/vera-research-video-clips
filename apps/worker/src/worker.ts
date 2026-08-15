import {
  ApiErrorSchema,
  ClaimedTranscriptionJobSchema,
  TranscriptSourcePlanSchema,
  WorkerClaimRequestSchema,
  WorkerFailureRequestSchema,
  WorkerHeartbeatRequestSchema,
  WorkerLeaseSchema,
  WorkerSourcePlanRequestSchema,
  type ClaimedTranscriptionJob,
  type Job,
  type TranscriptSourcePlan,
  type WorkerFailureRequest,
  type WorkerLease,
  type WorkerProgressStage,
} from "@research-video/contracts";
import type { JobQueue } from "@research-video/sync";

export type JobExecutor = (job: Job) => Promise<void>;

export type QueueWorkerOptions = {
  visibilitySeconds?: number;
  visibilityRenewalMs?: number;
};

export class Worker {
  readonly #visibilitySeconds: number;
  readonly #visibilityRenewalMs: number;

  constructor(
    private readonly queue: JobQueue<Job>,
    private readonly execute: JobExecutor,
    options: QueueWorkerOptions = {},
  ) {
    this.#visibilitySeconds = options.visibilitySeconds ?? 120;
    this.#visibilityRenewalMs = options.visibilityRenewalMs ?? 40_000;
  }

  async runOnce(): Promise<"idle" | "completed" | "released"> {
    const message = await this.queue.receive();
    if (!message) return "idle";

    let renewal: Promise<void> | undefined;
    const renew = () => {
      if (renewal) return;
      renewal = this.queue
        .extendVisibility(message.receipt, this.#visibilitySeconds)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          renewal = undefined;
        });
    };
    const timer = setInterval(renew, this.#visibilityRenewalMs);
    timer.unref?.();

    try {
      await this.execute(message.payload);
      clearInterval(timer);
      await renewal;
      await this.queue.acknowledge(message.receipt);
      return "completed";
    } catch {
      clearInterval(timer);
      await renewal;
      await this.queue.release(message.receipt);
      return "released";
    }
  }
}

export interface TranscriptionWorkerControlPlane {
  claim(): Promise<ClaimedTranscriptionJob | undefined>;
  heartbeat(
    jobId: string,
    attempt: number,
    stage: WorkerProgressStage,
  ): Promise<WorkerLease>;
  recordSourcePlan(
    jobId: string,
    attempt: number,
    plan: TranscriptSourcePlan,
  ): Promise<void>;
  fail(jobId: string, failure: WorkerFailureRequest): Promise<void>;
}

export interface WorkerVisibilityLease {
  renew(
    jobId: string,
    attempt: number,
    visibilitySeconds: number,
  ): Promise<void>;
}

export type TranscriptionExecutionContext = {
  signal: AbortSignal;
  setStage(stage: WorkerProgressStage): Promise<void>;
  recordSourcePlan(plan: TranscriptSourcePlan): Promise<void>;
};

export type TranscriptionJobExecutor = (
  claimed: ClaimedTranscriptionJob,
  context: TranscriptionExecutionContext,
) => Promise<void>;

export type ClaimingWorkerOptions = {
  heartbeatIntervalMs?: number;
  visibilitySeconds?: number;
};

export class ClaimingTranscriptionWorker {
  readonly #heartbeatIntervalMs: number;
  readonly #visibilitySeconds: number;

  constructor(
    private readonly controlPlane: TranscriptionWorkerControlPlane,
    private readonly execute: TranscriptionJobExecutor,
    private readonly visibility?: WorkerVisibilityLease,
    options: ClaimingWorkerOptions = {},
  ) {
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? 40_000;
    this.#visibilitySeconds = options.visibilitySeconds ?? 120;
  }

  async runOnce(): Promise<"idle" | "processed" | "failed" | "lease-lost"> {
    const claimed = await this.controlPlane.claim();
    if (!claimed) return "idle";

    const { id: jobId } = claimed.job;
    const { attempt } = claimed.lease;
    const abortController = new AbortController();
    let stage: WorkerProgressStage = "resolving";
    let heartbeatFailure: unknown;
    let heartbeat: Promise<void> | undefined;

    const renew = () => {
      if (heartbeat || heartbeatFailure) return heartbeat;
      heartbeat = (async () => {
        try {
          await this.controlPlane.heartbeat(jobId, attempt, stage);
          await this.visibility
            ?.renew(jobId, attempt, this.#visibilitySeconds)
            .catch(() => undefined);
        } catch (error) {
          heartbeatFailure = error;
          abortController.abort(error);
        } finally {
          heartbeat = undefined;
        }
      })();
      return heartbeat;
    };

    const timer = setInterval(() => void renew(), this.#heartbeatIntervalMs);
    timer.unref?.();
    const context: TranscriptionExecutionContext = {
      signal: abortController.signal,
      setStage: async (nextStage) => {
        stage = nextStage;
        await renew();
        if (heartbeatFailure) throw heartbeatFailure;
      },
      recordSourcePlan: async (plan) => {
        await this.controlPlane.recordSourcePlan(jobId, attempt, plan);
      },
    };

    try {
      // Executors return only after their durable completion/finalize call succeeds.
      await this.execute(claimed, context);
      clearInterval(timer);
      await heartbeat;
      if (heartbeatFailure) throw heartbeatFailure;
      return "processed";
    } catch (error) {
      clearInterval(timer);
      await heartbeat;
      try {
        await this.controlPlane.fail(jobId, failureFrom(error, attempt));
        return "failed";
      } catch {
        return "lease-lost";
      }
    }
  }
}

export type ClaimingWorkerResult = Awaited<
  ReturnType<ClaimingTranscriptionWorker["runOnce"]>
>;

export interface ClaimingWorkerRunner {
  runOnce(): Promise<ClaimingWorkerResult>;
}

export type TranscriptionWorkerServiceOptions = {
  concurrency?: number;
  idlePollMs?: number;
  errorBackoffMs?: number;
  onUnexpectedError?: (error: unknown) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

export type TranscriptionWorkerServiceSummary = {
  processed: number;
  failed: number;
  leaseLost: number;
  unexpectedErrors: number;
};

/**
 * Runs a fixed number of claim loops. Aborting stops new claims and polling;
 * work already claimed is allowed to finish so its lease can be finalized.
 */
export class TranscriptionWorkerService {
  readonly #concurrency: number;
  readonly #idlePollMs: number;
  readonly #errorBackoffMs: number;
  readonly #onUnexpectedError: ((error: unknown) => void) | undefined;
  readonly #wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly worker: ClaimingWorkerRunner,
    options: TranscriptionWorkerServiceOptions = {},
  ) {
    this.#concurrency = boundedInteger(
      options.concurrency ?? 1,
      1,
      8,
      "concurrency",
    );
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
    this.#wait = options.wait ?? waitForAbortableDelay;
  }

  async run(signal: AbortSignal): Promise<TranscriptionWorkerServiceSummary> {
    const summary: TranscriptionWorkerServiceSummary = {
      processed: 0,
      failed: 0,
      leaseLost: 0,
      unexpectedErrors: 0,
    };
    await Promise.all(
      Array.from({ length: this.#concurrency }, () =>
        this.runLane(signal, summary),
      ),
    );
    return summary;
  }

  private async runLane(
    signal: AbortSignal,
    summary: TranscriptionWorkerServiceSummary,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.worker.runOnce();
        if (result === "processed") summary.processed += 1;
        if (result === "failed") summary.failed += 1;
        if (result === "lease-lost") summary.leaseLost += 1;
        if (signal.aborted) return;
        if (result === "idle") await this.#wait(this.#idlePollMs, signal);
      } catch (error) {
        summary.unexpectedErrors += 1;
        try {
          this.#onUnexpectedError?.(error);
        } catch {
          // Observability must not terminate a worker lane.
        }
        if (!signal.aborted) {
          await this.#wait(this.#errorBackoffMs, signal);
        }
      }
    }
  }
}

export class WorkerControlPlaneError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type HttpWorkerControlPlaneOptions = {
  baseUrl: string;
  authorization: string;
  executionLocation: "local" | "hosted";
  leaseSeconds?: number;
  fetcher?: typeof fetch;
};

export class HttpTranscriptionWorkerControlPlane implements TranscriptionWorkerControlPlane {
  readonly #baseUrl: URL;
  readonly #authorization: string;
  readonly #executionLocation: "local" | "hosted";
  readonly #leaseSeconds: number;
  readonly #fetcher: typeof fetch;

  constructor(options: HttpWorkerControlPlaneOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    this.#authorization = options.authorization;
    this.#executionLocation = options.executionLocation;
    this.#leaseSeconds = options.leaseSeconds ?? 120;
    this.#fetcher = options.fetcher ?? fetch;
    WorkerClaimRequestSchema.parse({
      executionLocation: this.#executionLocation,
      leaseSeconds: this.#leaseSeconds,
    });
  }

  async claim(): Promise<ClaimedTranscriptionJob | undefined> {
    const response = await this.request("/api/transcription-jobs/claim", {
      executionLocation: this.#executionLocation,
      leaseSeconds: this.#leaseSeconds,
    });
    return response === undefined
      ? undefined
      : ClaimedTranscriptionJobSchema.parse(response);
  }

  async heartbeat(
    jobId: string,
    attempt: number,
    stage: WorkerProgressStage,
  ): Promise<WorkerLease> {
    const body = WorkerHeartbeatRequestSchema.parse({
      attempt,
      leaseSeconds: this.#leaseSeconds,
      stage,
    });
    return WorkerLeaseSchema.parse(
      await this.request(
        `/api/transcription-jobs/${encodeURIComponent(jobId)}/heartbeat`,
        body,
      ),
    );
  }

  async recordSourcePlan(
    jobId: string,
    attempt: number,
    plan: TranscriptSourcePlan,
  ): Promise<void> {
    const body = WorkerSourcePlanRequestSchema.parse({
      attempt,
      plan: TranscriptSourcePlanSchema.parse(plan),
    });
    await this.request(
      `/api/transcription-jobs/${encodeURIComponent(jobId)}/source-plan`,
      body,
    );
  }

  async fail(jobId: string, failure: WorkerFailureRequest): Promise<void> {
    await this.request(
      `/api/transcription-jobs/${encodeURIComponent(jobId)}/fail`,
      WorkerFailureRequestSchema.parse(failure),
    );
  }

  private async request(path: string, body: unknown): Promise<unknown> {
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
      throw new WorkerControlPlaneError(
        parsed.success
          ? parsed.data.error.message
          : "Worker API request failed.",
        response.status,
        parsed.success ? parsed.data.error.code : "worker_api_error",
        parsed.success ? parsed.data.error.retryable : response.status >= 500,
      );
    }
    return payload;
  }
}

function failureFrom(error: unknown, attempt: number): WorkerFailureRequest {
  const controlPlaneError =
    error instanceof WorkerControlPlaneError ? error : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message =
    rawMessage.trim().slice(0, 2_000) || "Worker execution failed.";
  return WorkerFailureRequestSchema.parse({
    attempt,
    code: controlPlaneError?.code ?? "worker_execution_failed",
    message,
    retryable: controlPlaneError?.retryable ?? true,
  });
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
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
