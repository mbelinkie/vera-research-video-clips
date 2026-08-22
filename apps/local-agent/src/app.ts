import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  CreateExportOnlyRequestSchema,
  ClipLibraryQuerySchema,
  VerifyLocalArtifactVersionRequestSchema,
  UpdateLocalClipLibrarySelectionSchema,
  ClaimLoggedExportDeliveryResponseSchema,
  ExportSettingsPreviewRequestSchema,
  ProcessAcceptedLoggedExportRequestSchema,
  ProcessAcceptedLoggedExportResponseSchema,
  type HeartbeatExportWorkerRequest,
  type ArtifactLocatorSummary,
  type ArtifactVersionSummary,
  type ClipLibraryQuery,
  type LocalClipLibraryPage,
  type UpdateLocalClipLibrarySelection,
  type AcceptLoggedExportDeliveryRequest,
  type ClaimLoggedExportDeliveryRequest,
  type ClaimLoggedExportDeliveryResponse,
  type LoggedExportDelivery,
  type LoggedExportFailure,
  type LoggedExportFailureResult,
  type LoggedExportCanceled,
  type LoggedExportCanceledResult,
  type LoggedExportExecution,
  type LoggedExportProgressSnapshot,
  type StartLoggedExportExecutionRequest,
  type StartLoggedExportExecutionResponse,
  type HeartbeatLoggedExportExecutionRequest,
  type HeartbeatLoggedExportExecutionResponse,
  type LoggedExportSuccess,
  type LoggedExportSuccessResult,
  type ReconcileLoggedExportFailureRequest,
  type ReconcileLoggedExportCanceledRequest,
  type ReconcileLoggedExportSuccessRequest,
  type RegisterExportWorkerRequest,
  type RegisteredExportWorker,
  type CreateExportOnlyRequest,
  type ExportRequest,
  type ExportSettingsPreview,
  type ExportSettingsPreviewRequest,
  type ResolvedExportSettingsSnapshot,
  HealthResponseSchema,
} from "@research-video/contracts";
import {
  currentExportWorkerAdvertisement,
  validateStoredResolvedSettingsSnapshot,
  withInstalledExportWorkerAvailability,
  type ExportWorkerCapabilityProvider,
} from "@research-video/export-settings";
import type {
  LocalExportWorkerIdentity,
  LocalExportWorkerIdentityRepository,
} from "@research-video/db-local";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";

import type { LocalExportOnceResult } from "./export-run-once.ts";

export interface LocalAgentDependencies {
  resolveClipLibrary?(input: {
    projectId: string;
    authorization: string;
    query: ClipLibraryQuery;
  }): Promise<LocalClipLibraryPage>;
  resolveLatestClipLibrary?(input: {
    projectId: string;
    authorization: string;
  }): Promise<LocalClipLibraryPage>;
  updateClipLibrarySelection?(input: {
    projectId: string;
    authorization: string;
    command: UpdateLocalClipLibrarySelection;
  }): string[];
  resolveArtifactVersion?(input: {
    projectId: string;
    clipId: string;
    artifactVersionId: string;
    authorization: string;
  }): Promise<ArtifactVersionSummary>;
  verifyArtifactVersion?(input: {
    rootId: string;
    artifactVersion: ArtifactVersionSummary;
  }): Promise<ArtifactLocatorSummary>;
  resolveTranscript?(input: {
    projectId: string;
    catalogVideoId: string;
    authorization: string;
  }): Promise<WorkspaceTranscriptResolution>;
  previewExportSettings?(input: {
    request: ExportSettingsPreviewRequest;
    authorization: string;
  }): Promise<ExportSettingsPreview>;
  capabilityProvider?: ExportWorkerCapabilityProvider;
  createExportOnly?(
    input: CreateExportOnlyRequest,
    snapshot?: ResolvedExportSettingsSnapshot,
  ): unknown;
  findExportOnlyByIdempotencyKey?(
    idempotencyKey: string,
  ): ExportRequest | undefined;
  listExportRequests?(): ExportRequest[];
  workerIdentity?: Pick<
    LocalExportWorkerIdentityRepository,
    "get" | "prepareRegistration"
  >;
  registerExportWorker?(input: {
    request: RegisterExportWorkerRequest;
    authorization: string;
  }): Promise<RegisteredExportWorker>;
  heartbeatExportWorker?(input: {
    request: HeartbeatExportWorkerRequest;
    authorization: string;
  }): Promise<RegisteredExportWorker>;
  claimLoggedExportDelivery?(input: {
    request: ClaimLoggedExportDeliveryRequest;
    authorization: string;
  }): Promise<ClaimLoggedExportDeliveryResponse>;
  acceptLoggedExportDelivery?(input: {
    request: AcceptLoggedExportDeliveryRequest;
    authorization: string;
  }): Promise<LoggedExportDelivery>;
  importLoggedDeliveryPending?(delivery: LoggedExportDelivery): ExportRequest;
  activateLoggedDelivery?(delivery: LoggedExportDelivery): ExportRequest;
  rejectPendingLoggedDelivery?(delivery: LoggedExportDelivery): void;
  getPendingLoggedDelivery?(): LoggedExportDelivery | undefined;
  getAcceptedLoggedDelivery?(
    requestId: string,
  ): LoggedExportDelivery | undefined;
  buildLoggedExportSuccessResult?(requestId: string): LoggedExportSuccessResult;
  buildLoggedExportFailureResult?(requestId: string): LoggedExportFailureResult;
  buildLoggedExportCanceledResult?(
    requestId: string,
  ): LoggedExportCanceledResult;
  getLoggedExecution?(requestId: string): LoggedExportExecution | undefined;
  getLoggedExportProgress?(
    requestId: string,
  ): LoggedExportProgressSnapshot | undefined;
  reconcileLoggedExportProgress?(
    progress: LoggedExportProgressSnapshot,
  ): LoggedExportProgressSnapshot;
  startLoggedExportExecution?(input: {
    request: StartLoggedExportExecutionRequest;
    authorization: string;
  }): Promise<StartLoggedExportExecutionResponse>;
  heartbeatLoggedExportExecution?(input: {
    request: HeartbeatLoggedExportExecutionRequest;
    authorization: string;
  }): Promise<HeartbeatLoggedExportExecutionResponse>;
  activateLoggedExecution?(
    execution: LoggedExportExecution,
  ): LoggedExportExecution;
  recordLoggedExecutionHeartbeat?(execution: LoggedExportExecution): void;
  recordLoggedExportNotStartedCancellation?(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
    cancelRequestedAt?: string,
  ): void;
  recordLoggedExportPersistedFailureCancellation?(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
    cancelRequestedAt?: string,
  ): void;
  runLoggedExportOnce?(input: {
    requestId: string;
    authorizationConfirmed: boolean;
    signal?: AbortSignal;
    requireLoggedExecution?: boolean;
  }): Promise<LocalExportOnceResult>;
  discardCompletedLoggedExportForCancellation?(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
  ): Promise<void>;
  reconcileLoggedExportSuccess?(input: {
    request: ReconcileLoggedExportSuccessRequest;
    authorization: string;
  }): Promise<LoggedExportSuccess>;
  reconcileLoggedExportFailure?(input: {
    request: ReconcileLoggedExportFailureRequest;
    authorization: string;
  }): Promise<LoggedExportFailure>;
  reconcileLoggedExportCanceled?(input: {
    request: ReconcileLoggedExportCanceledRequest;
    authorization: string;
  }): Promise<LoggedExportCanceled>;
  executionHeartbeatIntervalMs?: number;
}

const TranscriptParamsSchema = z.object({
  projectId: z.uuid(),
  videoId: z.uuid(),
});
const LocalProjectParamsSchema = z.object({ projectId: z.uuid() });

class LocalAuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
}

class LocalExportSettingsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly issues?: ExportSettingsPreview["issues"],
  ) {
    super(message);
  }
}

async function withLocalWorkerCapability(
  preview: ExportSettingsPreview,
  provider?: ExportWorkerCapabilityProvider,
): Promise<ExportSettingsPreview> {
  const localIssues = validateStoredResolvedSettingsSnapshot(preview.snapshot);
  const issues = [...preview.issues];
  for (const issue of localIssues) {
    if (
      !issues.some(
        (candidate) =>
          candidate.field === issue.field && candidate.code === issue.code,
      )
    )
      issues.push(issue);
  }
  const validated = { ...preview, issues };
  return provider
    ? withInstalledExportWorkerAvailability(
        validated,
        await provider.discover(),
      )
    : validated;
}

export function createLocalAgent(
  dependencies?: LocalAgentDependencies,
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as Error & {
      statusCode?: number;
      code?: string;
      issues?: unknown;
    };
    const statusCode =
      error instanceof ZodError ? 400 : (candidate.statusCode ?? 500);
    return reply.status(statusCode).send({
      error: {
        code:
          error instanceof ZodError
            ? "invalid_request"
            : (candidate.code ?? "internal_error"),
        message:
          statusCode === 500 ? "Internal server error." : candidate.message,
        retryable: statusCode >= 500,
        ...(candidate.issues ? { issues: candidate.issues } : {}),
      },
    });
  });

  app.get("/health", async () =>
    HealthResponseSchema.parse({
      service: "local-agent",
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );

  if (dependencies?.resolveClipLibrary) {
    app.get("/api/projects/:projectId/clip-library", async (request) => {
      const { projectId } = LocalProjectParamsSchema.parse(request.params);
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to read the Clip Library.",
        );
      }
      return dependencies.resolveClipLibrary!({
        projectId,
        authorization,
        query: ClipLibraryQuerySchema.parse(request.query),
      });
    });
  }

  if (dependencies?.resolveLatestClipLibrary) {
    app.get("/api/projects/:projectId/clip-library/latest", async (request) => {
      const { projectId } = LocalProjectParamsSchema.parse(request.params);
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to restore the Clip Library.",
        );
      }
      return dependencies.resolveLatestClipLibrary!({
        projectId,
        authorization,
      });
    });
  }

  if (dependencies?.updateClipLibrarySelection) {
    app.put(
      "/api/projects/:projectId/clip-library/selection",
      async (request) => {
        const { projectId } = LocalProjectParamsSchema.parse(request.params);
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to update Clip Library selection.",
          );
        }
        return {
          selectedClipIds: dependencies.updateClipLibrarySelection!({
            projectId,
            authorization,
            command: UpdateLocalClipLibrarySelectionSchema.parse(request.body),
          }),
        };
      },
    );
  }

  if (
    dependencies?.resolveArtifactVersion &&
    dependencies.verifyArtifactVersion
  ) {
    app.post("/api/artifact-locators/verify", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to verify a project artifact.",
        );
      }
      const command = VerifyLocalArtifactVersionRequestSchema.parse(
        request.body,
      );
      const artifactVersion = await dependencies.resolveArtifactVersion!({
        projectId: command.projectId,
        clipId: command.clipId,
        artifactVersionId: command.artifactVersionId,
        authorization,
      });
      return dependencies.verifyArtifactVersion!({
        rootId: command.rootId,
        artifactVersion,
      });
    });
  }

  if (dependencies?.resolveTranscript) {
    app.get(
      "/api/projects/:projectId/videos/:videoId/transcript",
      async (request) => {
        const { projectId, videoId } = TranscriptParamsSchema.parse(
          request.params,
        );
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to resolve a project transcript.",
          );
        }
        const resolution = await dependencies.resolveTranscript!({
          projectId,
          catalogVideoId: videoId,
          authorization,
        });
        return {
          transcriptVersionId: resolution.bundle.transcriptVersionId,
          source: resolution.source,
          transcript: resolution.transcript,
        };
      },
    );
  }

  if (dependencies?.createExportOnly) {
    if (dependencies.previewExportSettings) {
      app.post("/api/export-settings/preview", async (request) => {
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to resolve personal export settings.",
          );
        }
        return withLocalWorkerCapability(
          await dependencies.previewExportSettings!({
            request: ExportSettingsPreviewRequestSchema.parse(request.body),
            authorization,
          }),
          dependencies.capabilityProvider,
        );
      });
    }
    app.post("/api/exports", async (request, reply) => {
      const parsed = CreateExportOnlyRequestSchema.parse(request.body);
      const replay = dependencies.findExportOnlyByIdempotencyKey?.(
        parsed.idempotencyKey,
      );
      if (replay) return reply.status(201).send(replay);
      let resolved: ResolvedExportSettingsSnapshot | undefined;
      if (parsed.settingsSelection) {
        const authorization = request.headers.authorization;
        if (!authorization || !dependencies.previewExportSettings) {
          throw new LocalAuthenticationError(
            "Authentication is required to create an export from catalog settings.",
          );
        }
        const preview = await withLocalWorkerCapability(
          await dependencies.previewExportSettings({
            request: {
              sourceLanguageClass: parsed.sourceLanguageClass,
              selection: parsed.settingsSelection,
            },
            authorization,
          }),
          dependencies.capabilityProvider,
        );
        if (
          preview.snapshot.resolutionFingerprint !==
          parsed.expectedResolutionFingerprint
        ) {
          throw new LocalExportSettingsError(
            "Export settings changed after preview. Resolve them again before exporting.",
            "export_settings_stale",
            409,
          );
        }
        if (preview.issues.length) {
          throw new LocalExportSettingsError(
            "The current worker cannot render the resolved export settings.",
            "export_settings_unsupported",
            422,
            preview.issues,
          );
        }
        resolved = preview.snapshot;
      }
      const created = dependencies.createExportOnly!(parsed, resolved);
      return reply.status(201).send(created);
    });
  }

  if (
    dependencies?.workerIdentity &&
    dependencies.capabilityProvider &&
    dependencies.registerExportWorker
  ) {
    app.post("/api/export-workers/register", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to register a local export worker.",
        );
      }
      // Discovery is the only source of advertised installed capability data.
      const advertisement = currentExportWorkerAdvertisement(
        await dependencies.capabilityProvider!.discover(),
      );
      const identity = dependencies.workerIdentity!.prepareRegistration(
        advertisement.advertisementFingerprint,
      );
      return dependencies.registerExportWorker!({
        authorization,
        request: {
          workerId: identity.workerId,
          epoch: identity.epoch,
          ...advertisement,
        },
      });
    });
  }

  if (dependencies?.workerIdentity && dependencies.heartbeatExportWorker) {
    app.post("/api/export-workers/heartbeat", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to heartbeat a local export worker.",
        );
      }
      const identity: LocalExportWorkerIdentity | undefined =
        dependencies.workerIdentity!.get();
      if (!identity) {
        throw new LocalExportSettingsError(
          "Register this local export worker before sending a heartbeat.",
          "worker_registration_required",
          409,
        );
      }
      return dependencies.heartbeatExportWorker!({
        authorization,
        request: { workerId: identity.workerId, epoch: identity.epoch },
      });
    });
  }

  if (
    dependencies?.workerIdentity &&
    dependencies.claimLoggedExportDelivery &&
    dependencies.acceptLoggedExportDelivery &&
    dependencies.importLoggedDeliveryPending &&
    dependencies.activateLoggedDelivery &&
    dependencies.rejectPendingLoggedDelivery &&
    dependencies.getPendingLoggedDelivery
  ) {
    app.post("/api/export-deliveries/claim", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to deliver a logged export.",
        );
      }
      const identity = dependencies.workerIdentity!.get();
      if (!identity) {
        throw new LocalExportSettingsError(
          "Register this local export worker before claiming logged exports.",
          "worker_registration_required",
          409,
        );
      }
      const pending = dependencies.getPendingLoggedDelivery!();
      if (pending) {
        try {
          const accepted = await dependencies.acceptLoggedExportDelivery!({
            authorization,
            request: {
              workerId: identity.workerId,
              workerEpoch: identity.epoch,
              deliveryId: pending.deliveryId,
              generation: pending.generation,
              reservationToken: pending.reservationToken,
            },
          });
          dependencies.activateLoggedDelivery!(accepted);
          return ClaimLoggedExportDeliveryResponseSchema.parse({
            delivery: accepted,
          });
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode !== 409)
            throw error;
          dependencies.rejectPendingLoggedDelivery!(pending);
        }
      }
      const claimed = ClaimLoggedExportDeliveryResponseSchema.parse(
        await dependencies.claimLoggedExportDelivery!({
          authorization,
          request: {
            workerId: identity.workerId,
            workerEpoch: identity.epoch,
          },
        }),
      );
      if (!claimed.delivery) return claimed;
      if (
        claimed.delivery.workerId !== identity.workerId ||
        claimed.delivery.workerEpoch !== identity.epoch
      ) {
        throw new LocalExportSettingsError(
          "Cloud delivery ownership does not match this registered local worker.",
          "export_delivery_ownership_mismatch",
          409,
        );
      }

      dependencies.importLoggedDeliveryPending!(claimed.delivery);
      let accepted: LoggedExportDelivery;
      try {
        accepted = await dependencies.acceptLoggedExportDelivery!({
          authorization,
          request: {
            workerId: identity.workerId,
            workerEpoch: identity.epoch,
            deliveryId: claimed.delivery.deliveryId,
            generation: claimed.delivery.generation,
            reservationToken: claimed.delivery.reservationToken,
          },
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 409) {
          dependencies.rejectPendingLoggedDelivery!(claimed.delivery);
        }
        throw error;
      }
      dependencies.activateLoggedDelivery!(accepted);
      return ClaimLoggedExportDeliveryResponseSchema.parse({
        delivery: accepted,
      });
    });
  }

  if (
    dependencies?.workerIdentity &&
    dependencies.getAcceptedLoggedDelivery &&
    dependencies.buildLoggedExportSuccessResult &&
    dependencies.runLoggedExportOnce &&
    dependencies.reconcileLoggedExportSuccess
  ) {
    app.post("/api/export-deliveries/process", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to process a delivered logged export.",
        );
      }
      const command = ProcessAcceptedLoggedExportRequestSchema.parse(
        request.body,
      );
      const identity = dependencies.workerIdentity!.get();
      if (!identity) {
        throw new LocalExportSettingsError(
          "Register this local export worker before processing logged exports.",
          "worker_registration_required",
          409,
        );
      }
      const delivery = dependencies.getAcceptedLoggedDelivery!(
        command.requestId,
      );
      if (!delivery) {
        throw new LocalExportSettingsError(
          "This logged export has not been durably accepted by the local worker.",
          "logged_export_delivery_not_accepted",
          409,
        );
      }
      if (delivery.workerId !== identity.workerId) {
        throw new LocalExportSettingsError(
          "The accepted delivery belongs to a different local worker identity.",
          "export_delivery_ownership_mismatch",
          409,
        );
      }

      if (
        dependencies.buildLoggedExportCanceledResult &&
        dependencies.reconcileLoggedExportCanceled
      ) {
        let persistedCancellation: LoggedExportCanceledResult | undefined;
        try {
          persistedCancellation = dependencies.buildLoggedExportCanceledResult(
            command.requestId,
          );
        } catch (error) {
          if (
            (error as { code?: string }).code !==
            "logged_export_cancellation_not_recorded"
          ) {
            throw error;
          }
        }
        if (persistedCancellation) {
          const persistedExecution = persistedCancellation.executionId
            ? dependencies.getLoggedExecution?.(command.requestId)
            : undefined;
          if (
            persistedCancellation.executionId &&
            (!persistedExecution ||
              persistedExecution.executionId !==
                persistedCancellation.executionId)
          ) {
            throw new LocalExportSettingsError(
              "Persisted cancellation execution ownership is unavailable.",
              "logged_export_execution_ownership_mismatch",
              409,
            );
          }
          const canceled = await dependencies.reconcileLoggedExportCanceled({
            authorization,
            request: {
              workerId: delivery.workerId,
              workerEpoch: delivery.workerEpoch,
              deliveryId: delivery.deliveryId,
              generation: delivery.generation,
              reservationToken: delivery.reservationToken,
              ...(persistedExecution
                ? {
                    executionId: persistedExecution.executionId,
                    leaseToken: persistedExecution.leaseToken,
                  }
                : {}),
              result: persistedCancellation,
            },
          });
          return ProcessAcceptedLoggedExportResponseSchema.parse({
            execution: "canceled",
            canceled,
          });
        }
      }

      if (
        dependencies.buildLoggedExportFailureResult &&
        dependencies.reconcileLoggedExportFailure
      ) {
        let persistedFailure: LoggedExportFailureResult | undefined;
        try {
          persistedFailure = dependencies.buildLoggedExportFailureResult(
            command.requestId,
          );
        } catch (error) {
          if (
            (error as { code?: string }).code !==
            "logged_export_failure_not_recorded"
          ) {
            throw error;
          }
        }
        if (persistedFailure) {
          const failure = await dependencies.reconcileLoggedExportFailure({
            authorization,
            request: {
              workerId: delivery.workerId,
              workerEpoch: delivery.workerEpoch,
              deliveryId: delivery.deliveryId,
              generation: delivery.generation,
              reservationToken: delivery.reservationToken,
              result: persistedFailure,
            },
          });
          return ProcessAcceptedLoggedExportResponseSchema.parse({
            execution: "failed",
            failure,
          });
        }
      }

      if (delivery.workerEpoch !== identity.epoch) {
        throw new LocalExportSettingsError(
          "The accepted delivery belongs to a different local worker epoch.",
          "export_delivery_ownership_mismatch",
          409,
        );
      }

      let executionControl: LoggedExportExecution | undefined;
      let executionCredential: StartLoggedExportExecutionRequest | undefined;
      let controller: AbortController | undefined;
      let stopHeartbeat: (() => Promise<void>) | undefined;
      if (
        dependencies.startLoggedExportExecution &&
        dependencies.heartbeatLoggedExportExecution &&
        dependencies.activateLoggedExecution &&
        dependencies.recordLoggedExecutionHeartbeat &&
        dependencies.recordLoggedExportNotStartedCancellation &&
        dependencies.buildLoggedExportCanceledResult &&
        dependencies.reconcileLoggedExportCanceled
      ) {
        const credential = {
          workerId: delivery.workerId,
          workerEpoch: delivery.workerEpoch,
          deliveryId: delivery.deliveryId,
          generation: delivery.generation,
          reservationToken: delivery.reservationToken,
        };
        executionCredential = credential;
        const started = await dependencies.startLoggedExportExecution({
          authorization,
          request: credential,
        });
        if (started.status === "cancel_requested") {
          dependencies.recordLoggedExportNotStartedCancellation(
            command.requestId,
            "user_requested",
            started.cancelRequestedAt,
          );
          const result = dependencies.buildLoggedExportCanceledResult(
            command.requestId,
          );
          const canceled = await dependencies.reconcileLoggedExportCanceled({
            authorization,
            request: { ...credential, result },
          });
          return ProcessAcceptedLoggedExportResponseSchema.parse({
            execution: "canceled",
            canceled,
          });
        }
        executionControl = dependencies.activateLoggedExecution(
          started.execution,
        );
        if (started.progress && dependencies.reconcileLoggedExportProgress) {
          dependencies.reconcileLoggedExportProgress(started.progress);
        }
        controller = new AbortController();
        if (executionControl.cancelRequestedAt) {
          controller.abort(
            Object.assign(new Error("Export cancellation was requested."), {
              code: "user_requested",
            }),
          );
        } else {
          const heartbeat = startExecutionHeartbeatLoop({
            execution: executionControl,
            credential,
            authorization,
            controller,
            intervalMs: dependencies.executionHeartbeatIntervalMs ?? 5_000,
            heartbeat: dependencies.heartbeatLoggedExportExecution,
            persist: dependencies.recordLoggedExecutionHeartbeat,
            ...(dependencies.getLoggedExportProgress
              ? {
                  readProgress: () =>
                    dependencies.getLoggedExportProgress!(command.requestId),
                }
              : {}),
          });
          stopHeartbeat = heartbeat.stop;
        }
      }

      let execution: LocalExportOnceResult;
      try {
        execution = await dependencies.runLoggedExportOnce!({
          requestId: command.requestId,
          authorizationConfirmed: command.authorizationConfirmed,
          ...(controller ? { signal: controller.signal } : {}),
          ...(executionControl ? { requireLoggedExecution: true } : {}),
        });
      } finally {
        if (stopHeartbeat) await stopHeartbeat();
      }
      if (
        executionControl &&
        dependencies.heartbeatLoggedExportExecution &&
        dependencies.recordLoggedExecutionHeartbeat &&
        controller &&
        !controller.signal.aborted
      ) {
        try {
          const progress = dependencies.getLoggedExportProgress?.(
            command.requestId,
          );
          const finalHeartbeat =
            await dependencies.heartbeatLoggedExportExecution({
              authorization,
              request: {
                workerId: delivery.workerId,
                workerEpoch: delivery.workerEpoch,
                deliveryId: delivery.deliveryId,
                generation: delivery.generation,
                reservationToken: delivery.reservationToken,
                executionId: executionControl.executionId,
                attempt: executionControl.attempt,
                leaseToken: executionControl.leaseToken,
                ...(progress ? { progress } : {}),
              },
            });
          dependencies.recordLoggedExecutionHeartbeat(finalHeartbeat.execution);
          if (finalHeartbeat.execution.cancelRequestedAt) {
            controller.abort(
              Object.assign(new Error("Export cancellation was requested."), {
                code: "user_requested",
              }),
            );
          }
        } catch (error) {
          controller.abort(
            Object.assign(new Error("Export execution ownership was lost."), {
              code: "execution_lease_lost",
              cause: error,
            }),
          );
        }
      }

      if (controller?.signal.aborted || execution.status === "canceled") {
        const reason =
          (controller?.signal.reason as { code?: unknown } | undefined)
            ?.code === "user_requested"
            ? "user_requested"
            : "execution_lease_lost";
        if (
          execution.status === "failed" &&
          dependencies.recordLoggedExportPersistedFailureCancellation
        ) {
          dependencies.recordLoggedExportPersistedFailureCancellation(
            command.requestId,
            reason,
            executionControl?.cancelRequestedAt,
          );
        } else if (
          execution.status !== "canceled" &&
          execution.status !== "failed" &&
          dependencies.discardCompletedLoggedExportForCancellation
        ) {
          await dependencies.discardCompletedLoggedExportForCancellation(
            command.requestId,
            reason,
          );
        }
        const result = dependencies.buildLoggedExportCanceledResult!(
          command.requestId,
        );
        const canceled = await dependencies.reconcileLoggedExportCanceled!({
          authorization,
          request: {
            workerId: delivery.workerId,
            workerEpoch: delivery.workerEpoch,
            deliveryId: delivery.deliveryId,
            generation: delivery.generation,
            reservationToken: delivery.reservationToken,
            ...(executionControl
              ? {
                  executionId: executionControl.executionId,
                  leaseToken: executionControl.leaseToken,
                }
              : {}),
            result,
          },
        });
        return ProcessAcceptedLoggedExportResponseSchema.parse({
          execution: "canceled",
          canceled,
        });
      }
      if (execution.status === "failed") {
        if (
          dependencies.buildLoggedExportFailureResult &&
          dependencies.reconcileLoggedExportFailure
        ) {
          const result = dependencies.buildLoggedExportFailureResult(
            command.requestId,
          );
          let failure: LoggedExportFailure;
          try {
            failure = await dependencies.reconcileLoggedExportFailure({
              authorization,
              request: {
                workerId: delivery.workerId,
                workerEpoch: delivery.workerEpoch,
                deliveryId: delivery.deliveryId,
                generation: delivery.generation,
                reservationToken: delivery.reservationToken,
                result,
              },
            });
          } catch (error) {
            if (
              (error as { statusCode?: number }).statusCode !== 409 ||
              !executionControl ||
              !executionCredential ||
              !dependencies.startLoggedExportExecution ||
              !dependencies.recordLoggedExportPersistedFailureCancellation ||
              !dependencies.buildLoggedExportCanceledResult ||
              !dependencies.reconcileLoggedExportCanceled
            ) {
              throw error;
            }
            const replay = await dependencies.startLoggedExportExecution({
              authorization,
              request: executionCredential,
            });
            if (
              replay.status !== "started" ||
              replay.execution.executionId !== executionControl.executionId ||
              !replay.execution.cancelRequestedAt
            ) {
              throw error;
            }
            dependencies.recordLoggedExportPersistedFailureCancellation(
              command.requestId,
              "user_requested",
              replay.execution.cancelRequestedAt,
            );
            const canceledResult = dependencies.buildLoggedExportCanceledResult(
              command.requestId,
            );
            const canceled = await dependencies.reconcileLoggedExportCanceled({
              authorization,
              request: {
                ...executionCredential,
                executionId: executionControl.executionId,
                leaseToken: executionControl.leaseToken,
                result: canceledResult,
              },
            });
            return ProcessAcceptedLoggedExportResponseSchema.parse({
              execution: "canceled",
              canceled,
            });
          }
          return ProcessAcceptedLoggedExportResponseSchema.parse({
            execution: "failed",
            failure,
          });
        }
        throw new LocalExportSettingsError(
          execution.error?.message ?? "Local export processing failed.",
          execution.error?.code ?? "export_runtime_failed",
          409,
        );
      }
      const result = dependencies.buildLoggedExportSuccessResult!(
        command.requestId,
      );
      let reconciliation: LoggedExportSuccess;
      try {
        reconciliation = await dependencies.reconcileLoggedExportSuccess!({
          authorization,
          request: {
            workerId: identity.workerId,
            workerEpoch: identity.epoch,
            deliveryId: delivery.deliveryId,
            generation: delivery.generation,
            reservationToken: delivery.reservationToken,
            result,
          },
        });
      } catch (error) {
        if (
          (error as { statusCode?: number }).statusCode !== 409 ||
          !executionControl ||
          !executionCredential ||
          !dependencies.startLoggedExportExecution ||
          !dependencies.discardCompletedLoggedExportForCancellation ||
          !dependencies.buildLoggedExportCanceledResult ||
          !dependencies.reconcileLoggedExportCanceled
        ) {
          throw error;
        }
        const replay = await dependencies.startLoggedExportExecution({
          authorization,
          request: executionCredential,
        });
        if (
          replay.status !== "started" ||
          replay.execution.executionId !== executionControl.executionId ||
          !replay.execution.cancelRequestedAt
        ) {
          throw error;
        }
        await dependencies.discardCompletedLoggedExportForCancellation(
          command.requestId,
          "user_requested",
        );
        const canceledResult = dependencies.buildLoggedExportCanceledResult(
          command.requestId,
        );
        const canceled = await dependencies.reconcileLoggedExportCanceled({
          authorization,
          request: {
            ...executionCredential,
            executionId: executionControl.executionId,
            leaseToken: executionControl.leaseToken,
            result: canceledResult,
          },
        });
        return ProcessAcceptedLoggedExportResponseSchema.parse({
          execution: "canceled",
          canceled,
        });
      }
      return ProcessAcceptedLoggedExportResponseSchema.parse({
        execution: execution.status,
        reconciliation,
      });
    });
  }

  if (dependencies?.listExportRequests) {
    app.get("/api/exports", async () => dependencies.listExportRequests!());
  }

  return app;
}

function startExecutionHeartbeatLoop(input: {
  execution: LoggedExportExecution;
  credential: StartLoggedExportExecutionRequest;
  authorization: string;
  controller: AbortController;
  intervalMs: number;
  heartbeat: NonNullable<
    LocalAgentDependencies["heartbeatLoggedExportExecution"]
  >;
  persist: NonNullable<
    LocalAgentDependencies["recordLoggedExecutionHeartbeat"]
  >;
  readProgress?: () => LoggedExportProgressSnapshot | undefined;
}): { stop: () => Promise<void> } {
  let stopped = false;
  let chain = Promise.resolve();
  const interval = Math.max(10, Math.min(input.intervalMs, 10_000));
  const timer = setInterval(() => {
    chain = chain.then(async () => {
      if (stopped || input.controller.signal.aborted) return;
      try {
        const progress = input.readProgress?.();
        const response = await input.heartbeat({
          authorization: input.authorization,
          request: {
            ...input.credential,
            executionId: input.execution.executionId,
            attempt: input.execution.attempt,
            leaseToken: input.execution.leaseToken,
            ...(progress ? { progress } : {}),
          },
        });
        input.persist(response.execution);
        if (response.execution.cancelRequestedAt) {
          input.controller.abort(
            Object.assign(new Error("Export cancellation was requested."), {
              code: "user_requested",
            }),
          );
        }
      } catch (error) {
        input.controller.abort(
          Object.assign(new Error("Export execution ownership was lost."), {
            code: "execution_lease_lost",
            cause: error,
          }),
        );
      }
    });
  }, interval);
  timer.unref?.();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await chain;
    },
  };
}
