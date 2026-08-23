import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";

import {
  CreateExportOnlyRequestSchema,
  ArtifactLocatorActionRequestSchema,
  AuthoringArtifactDescriptorRequestSchema,
  LocalAuthoringArtifactDescriptorSchema,
  RelinkArtifactLocatorRequestSchema,
  ResolveLocalArtifactRequestSchema,
  ClipLibraryQuerySchema,
  PrepareClipLibraryExportRequestSchema,
  SubmitClipLibraryExportRequestSchema,
  VerifyLocalArtifactVersionRequestSchema,
  UpdateLocalClipLibrarySelectionSchema,
  ClaimLoggedExportDeliveryResponseSchema,
  ExportSettingsPreviewRequestSchema,
  ProcessAcceptedLoggedExportRequestSchema,
  ProcessAcceptedLoggedExportResponseSchema,
  type HeartbeatExportWorkerRequest,
  type ArtifactLocatorSummary,
  type ArtifactRootSummary,
  type ArtifactCompatibilityRequirements,
  type ArtifactLocatorActionResult,
  type AuthoringArtifactDescriptorRequest,
  type LocalAuthoringArtifactDescriptor,
  type ArtifactResolutionResult,
  type ArtifactVersionSummary,
  type ClipLibraryQuery,
  type ClipLibraryExportSubmission,
  type ExportStoragePreflight,
  type LocalClipLibraryPage,
  type PrepareClipLibraryExportRequest,
  type SubmitClipLibraryExportRequest,
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
  LocalOperationFailureSchema,
  LocalRuntimeDrainResultSchema,
  LocalRuntimeQuiescenceSchema,
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
import type { LocalRuntimeCoordinator } from "./local-runtime.ts";

export interface LocalAgentDependencies {
  desktopSession?: {
    secret: string;
    origin: string;
  };
  runtime?: Pick<
    LocalRuntimeCoordinator,
    "beginDrain" | "getQuiescence" | "beginOperation" | "isDraining"
  >;
  authorizeRuntime?(authorization: string): Promise<void>;
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
  prepareClipLibraryExport?(input: {
    projectId: string;
    authorization: string;
    request: PrepareClipLibraryExportRequest;
  }): Promise<ExportStoragePreflight>;
  submitClipLibraryExport?(input: {
    projectId: string;
    authorization: string;
    request: SubmitClipLibraryExportRequest;
  }): Promise<ClipLibraryExportSubmission>;
  prepareAuthoringExport?(input: {
    projectId: string;
    authorization: string;
    request: PrepareClipLibraryExportRequest;
  }): Promise<ExportStoragePreflight>;
  submitAuthoringExport?(input: {
    projectId: string;
    authorization: string;
    request: SubmitClipLibraryExportRequest;
  }): Promise<ClipLibraryExportSubmission>;
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
  resolveArtifact?(input: {
    projectId: string;
    clipId: string;
    authorization: string;
    requirements: ArtifactCompatibilityRequirements;
  }): Promise<ArtifactResolutionResult>;
  actOnArtifactLocator?(input: {
    locatorId: string;
    authorization: string;
    action: "verify" | "reveal" | "open";
  }): Promise<ArtifactLocatorActionResult>;
  relinkArtifactLocator?(input: {
    locatorId: string;
    targetRootId: string;
    authorization: string;
  }): Promise<ArtifactLocatorSummary>;
  createAuthoringArtifactDescriptor?(input: {
    projectId: string;
    clipId: string;
    authorization: string;
    request: AuthoringArtifactDescriptorRequest;
  }): Promise<LocalAuthoringArtifactDescriptor>;
  listArtifactRoots?(input: { authorization: string }): ArtifactRootSummary[];
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
const LocalClipParamsSchema = z.object({
  projectId: z.uuid(),
  clipId: z.uuid(),
});
const ArtifactLocatorParamsSchema = z.object({ locatorId: z.uuid() });

class LocalAuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
}

class LocalArtifactRequestError extends Error {
  readonly statusCode = 409;
  readonly code = "artifact_identity_mismatch";
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
  if (
    dependencies?.desktopSession &&
    (dependencies.desktopSession.secret.length < 43 ||
      dependencies.desktopSession.origin !== "rvc://app")
  ) {
    throw new RangeError("Desktop launch-session configuration is invalid.");
  }
  const app = Fastify({ logger: false });
  const requestCorrelations = new WeakMap<object, string>();
  const requestRuntimeOperations = new WeakMap<object, () => void>();

  app.addHook("onRequest", (request, reply, done) => {
    const correlationId = randomUUID();
    requestCorrelations.set(request, correlationId);
    reply.header("x-correlation-id", correlationId);
    done();
  });
  const finishRuntimeOperation = (request: FastifyRequest) => {
    requestRuntimeOperations.get(request)?.();
    requestRuntimeOperations.delete(request);
  };
  app.addHook("onSend", (request, _reply, payload, done) => {
    finishRuntimeOperation(request);
    done(null, payload);
  });
  app.addHook("onError", (request, _reply, _error, done) => {
    finishRuntimeOperation(request);
    done();
  });
  app.addHook("preHandler", async (request) => {
    if (dependencies?.desktopSession && request.url !== "/health") {
      const suppliedSession = request.headers["x-research-video-session"];
      const origin = request.headers.origin;
      if (
        typeof suppliedSession !== "string" ||
        suppliedSession !== dependencies.desktopSession.secret ||
        origin !== dependencies.desktopSession.origin
      ) {
        throw new LocalAuthenticationError(
          "The desktop launch session is required for local access.",
        );
      }
    }
    if (
      !dependencies?.runtime ||
      !tracksRuntimeOperation(request.method, request.url)
    ) {
      return;
    }
    if (dependencies.runtime.isDraining()) {
      const authorization = requireRuntimeAuthorization(
        request.headers.authorization,
      );
      if (!dependencies.authorizeRuntime) {
        throw new LocalAuthenticationError(
          "Authentication is required to start local work while draining.",
        );
      }
      await dependencies.authorizeRuntime(authorization);
    }
    const operation = dependencies.runtime.beginOperation(
      localOperationClass(request.url),
    );
    registerRuntimeOperation(
      request,
      operation.finish,
      requestRuntimeOperations,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const candidate = error as Error & {
      statusCode?: number;
      code?: string;
      issues?: unknown;
    };
    const statusCode =
      error instanceof ZodError ? 400 : (candidate.statusCode ?? 500);
    const operation = localOperationClass(request.url);
    const operationFailure = LocalOperationFailureSchema.parse({
      operation,
      correlationId: requestCorrelations.get(request) ?? randomUUID(),
      failureClass: localFailureClass(
        error instanceof ZodError ? "invalid_request" : candidate.code,
        statusCode,
      ),
      retryable: statusCode >= 500,
    });
    return reply.status(statusCode).send({
      error: {
        code: localFailureCode(candidate.code, operationFailure.failureClass),
        message: localFailureMessage(operationFailure.failureClass),
        retryable: statusCode >= 500,
      },
      operationFailure,
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

  if (
    dependencies?.runtime &&
    (dependencies.authorizeRuntime || dependencies.desktopSession)
  ) {
    app.post("/api/runtime/drain", async (request) => {
      const authorization = requireRuntimeAuthorization(
        request.headers.authorization,
      );
      if (!dependencies.desktopSession) {
        await dependencies.authorizeRuntime!(authorization);
      }
      return LocalRuntimeDrainResultSchema.parse(
        dependencies.runtime!.beginDrain(),
      );
    });
    app.get("/api/runtime/quiescence", async (request) => {
      const authorization = requireRuntimeAuthorization(
        request.headers.authorization,
      );
      if (!dependencies.desktopSession) {
        await dependencies.authorizeRuntime!(authorization);
      }
      return LocalRuntimeQuiescenceSchema.parse(
        dependencies.runtime!.getQuiescence(),
      );
    });
  }

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

  if (dependencies?.prepareClipLibraryExport) {
    app.post(
      "/api/projects/:projectId/clip-library/export-preflight",
      async (request) => {
        const { projectId } = LocalProjectParamsSchema.parse(request.params);
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to preflight a Clip Library export.",
          );
        }
        return dependencies.prepareClipLibraryExport!({
          projectId,
          authorization,
          request: PrepareClipLibraryExportRequestSchema.parse(request.body),
        });
      },
    );
  }

  if (dependencies?.submitClipLibraryExport) {
    app.post(
      "/api/projects/:projectId/clip-library/exports",
      async (request, reply) => {
        const { projectId } = LocalProjectParamsSchema.parse(request.params);
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to submit a Clip Library export.",
          );
        }
        const submitted = await dependencies.submitClipLibraryExport!({
          projectId,
          authorization,
          request: SubmitClipLibraryExportRequestSchema.parse(request.body),
        });
        return reply.status(201).send(submitted);
      },
    );
  }

  if (dependencies?.prepareAuthoringExport) {
    app.post(
      "/api/authoring/projects/:projectId/export-preflight",
      async (request) => {
        const { projectId } = LocalProjectParamsSchema.parse(request.params);
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to preflight an authoring export.",
          );
        }
        return dependencies.prepareAuthoringExport!({
          projectId,
          authorization,
          request: PrepareClipLibraryExportRequestSchema.parse(request.body),
        });
      },
    );
  }

  if (dependencies?.submitAuthoringExport) {
    app.post(
      "/api/authoring/projects/:projectId/exports",
      async (request, reply) => {
        const { projectId } = LocalProjectParamsSchema.parse(request.params);
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to submit an authoring export.",
          );
        }
        const submitted = await dependencies.submitAuthoringExport!({
          projectId,
          authorization,
          request: SubmitClipLibraryExportRequestSchema.parse(request.body),
        });
        return reply.status(201).send(submitted);
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

  if (dependencies?.resolveArtifact) {
    app.post(
      "/api/projects/:projectId/clips/:clipId/artifact-resolution",
      async (request) => {
        const { projectId, clipId } = LocalClipParamsSchema.parse(
          request.params,
        );
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required to resolve a project artifact.",
          );
        }
        const command = ResolveLocalArtifactRequestSchema.parse(request.body);
        if (command.requirements.clipId !== clipId) {
          throw new LocalArtifactRequestError(
            "Artifact clip identity differs.",
          );
        }
        return dependencies.resolveArtifact!({
          projectId,
          clipId,
          authorization,
          requirements: command.requirements,
        });
      },
    );
  }

  if (dependencies?.createAuthoringArtifactDescriptor) {
    app.post(
      "/api/authoring/projects/:projectId/clips/:clipId/artifact-descriptor",
      async (request) => {
        const { projectId, clipId } = LocalClipParamsSchema.parse(
          request.params,
        );
        const authorization = request.headers.authorization;
        if (!authorization) {
          throw new LocalAuthenticationError(
            "Authentication is required for authoring artifact handoff.",
          );
        }
        const command = AuthoringArtifactDescriptorRequestSchema.parse(
          request.body,
        );
        if (command.requirements.clipId !== clipId) {
          throw new LocalArtifactRequestError(
            "Authoring compatibility evidence differs from the route clip.",
          );
        }
        return LocalAuthoringArtifactDescriptorSchema.parse(
          await dependencies.createAuthoringArtifactDescriptor!({
            projectId,
            clipId,
            authorization,
            request: command,
          }),
        );
      },
    );
  }

  if (dependencies?.actOnArtifactLocator) {
    for (const action of ["verify", "reveal", "open"] as const) {
      app.post(
        `/api/artifact-locators/:locatorId/${action}`,
        async (request) => {
          const authorization = request.headers.authorization;
          if (!authorization) {
            throw new LocalAuthenticationError(
              "Authentication is required to use a project artifact.",
            );
          }
          const command = ArtifactLocatorActionRequestSchema.parse(
            ArtifactLocatorParamsSchema.parse(request.params),
          );
          z.object({})
            .strict()
            .parse(request.body ?? {});
          return dependencies.actOnArtifactLocator!({
            locatorId: command.locatorId,
            authorization,
            action,
          });
        },
      );
    }
  }

  if (dependencies?.relinkArtifactLocator) {
    app.post("/api/artifact-locators/:locatorId/relink", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to relink a project artifact.",
        );
      }
      const params = ArtifactLocatorParamsSchema.parse(request.params);
      const body = z
        .object({ targetRootId: z.uuid() })
        .strict()
        .parse(request.body);
      const command = RelinkArtifactLocatorRequestSchema.parse({
        ...params,
        ...body,
      });
      return dependencies.relinkArtifactLocator!({
        locatorId: command.locatorId,
        targetRootId: command.targetRootId,
        authorization,
      });
    });
  }

  if (dependencies?.listArtifactRoots) {
    app.get("/api/artifact-roots", async (request) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        throw new LocalAuthenticationError(
          "Authentication is required to list artifact roots.",
        );
      }
      return { roots: dependencies.listArtifactRoots!({ authorization }) };
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
        const pendingOperation = dependencies.runtime?.beginOperation(
          "export",
          {
            allowDuringDrain: true,
            exclusiveKey: "logged-export-pending-acceptance",
          },
        );
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
        } finally {
          pendingOperation?.finish();
        }
      }
      if (dependencies.runtime?.isDraining()) {
        if (!dependencies.authorizeRuntime) {
          throw new LocalAuthenticationError(
            "Authentication is required to claim local work while draining.",
          );
        }
        await dependencies.authorizeRuntime(authorization);
      }
      const claimOperation = dependencies.runtime?.beginOperation("export", {
        exclusiveKey: "logged-export-claim",
      });
      try {
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
      } finally {
        claimOperation?.finish();
      }
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
      if (dependencies.runtime?.isDraining()) {
        if (!dependencies.authorizeRuntime) {
          throw new LocalAuthenticationError(
            "Authentication is required to process local work while draining.",
          );
        }
        await dependencies.authorizeRuntime(authorization);
      }
      const processOperation = dependencies.runtime?.beginOperation("export", {
        exclusiveKey: `logged-export-process:${command.requestId}`,
      });
      if (processOperation) {
        registerRuntimeOperation(
          request,
          processOperation.finish,
          requestRuntimeOperations,
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

function requireRuntimeAuthorization(
  authorization: string | undefined,
): string {
  if (!authorization) {
    throw new LocalAuthenticationError(
      "Authentication is required to inspect or drain the local runtime.",
    );
  }
  return authorization;
}

function tracksRuntimeOperation(method: string, url: string): boolean {
  return (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    url.startsWith("/api/") &&
    !url.startsWith("/api/runtime/") &&
    url !== "/api/export-deliveries/claim" &&
    url !== "/api/export-deliveries/process"
  );
}

function registerRuntimeOperation(
  request: FastifyRequest,
  finish: () => void,
  operations: WeakMap<object, () => void>,
): void {
  operations.set(request, finish);
}

function localOperationClass(url: string) {
  if (url.includes("/runtime/")) return "runtime" as const;
  if (url.includes("/authoring/")) return "authoring" as const;
  if (url.includes("artifact")) return "artifact" as const;
  if (url.includes("clip-library")) return "clip_library" as const;
  return "export" as const;
}

function localFailureClass(code: string | undefined, statusCode: number) {
  if (statusCode === 401) return "authentication_required" as const;
  if (statusCode === 403 || code === "not_found")
    return "authorization_denied" as const;
  if (statusCode === 400) return "invalid_request" as const;
  if (code === "runtime_draining") return "runtime_draining" as const;
  if (code?.includes("storage")) return "storage_insufficient" as const;
  if (code?.includes("verification") || code?.includes("artifact"))
    return "verification_failed" as const;
  if (code?.includes("cleanup")) return "cleanup_required" as const;
  if (code?.includes("lease") || code?.includes("execution"))
    return "execution_lost" as const;
  if (statusCode === 409) return "conflict" as const;
  if (statusCode >= 500) return "provider_unavailable" as const;
  return "internal" as const;
}

function localFailureMessage(
  failureClass: ReturnType<typeof localFailureClass>,
): string {
  switch (failureClass) {
    case "authentication_required":
      return "Authentication is required.";
    case "authorization_denied":
      return "This operation is not available.";
    case "invalid_request":
      return "The request is invalid.";
    case "conflict":
      return "The operation conflicts with current durable state.";
    case "runtime_draining":
      return "The local export runtime is draining.";
    case "storage_insufficient":
      return "Local storage is insufficient for this operation.";
    case "verification_failed":
      return "Local artifact verification failed.";
    case "provider_unavailable":
      return "A required local or cloud provider is unavailable.";
    case "execution_lost":
      return "Durable export execution ownership is unavailable.";
    case "cleanup_required":
      return "Local source cleanup requires attention.";
    case "internal":
      return "Internal server error.";
  }
}

const SafeLocalErrorCodes = new Set([
  "artifact_identity_mismatch",
  "artifact_reexport_unavailable",
  "authentication_required",
  "authorization_denied",
  "clip_library_export_clip_ineligible",
  "clip_library_export_duration_invalid",
  "clip_library_export_language_evidence_incomplete",
  "clip_library_export_scope_mismatch",
  "clip_library_export_settings_unsupported",
  "export_delivery_ownership_mismatch",
  "export_settings_stale",
  "export_settings_unsupported",
  "export_source_provider_unconfigured",
  "export_storage_capacity_unavailable",
  "export_storage_estimate_invalid",
  "export_storage_estimate_overflow",
  "export_storage_insufficient",
  "export_storage_insufficient_after_acquisition",
  "export_storage_preflight_stale",
  "export_storage_reserve_unavailable",
  "export_storage_settings_missing",
  "export_storage_unknown_confirmation_required",
  "identity_mismatch",
  "incompatible",
  "invalid_request",
  "launch_failed",
  "logged_export_delivery_not_accepted",
  "logged_export_execution_ownership_mismatch",
  "logged_export_failure_cleanup_incomplete",
  "not_found",
  "runtime_draining",
  "runtime_operation_conflict",
  "unsupported",
  "worker_registration_required",
]);

function localFailureCode(
  candidateCode: string | undefined,
  failureClass: ReturnType<typeof localFailureClass>,
): string {
  if (candidateCode && SafeLocalErrorCodes.has(candidateCode)) {
    return candidateCode;
  }
  return failureClass === "internal" ? "internal_error" : failureClass;
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
