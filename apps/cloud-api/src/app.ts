import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import { AuthenticationError } from "@research-video/auth";
import {
  CatalogConflictError,
  CatalogInvalidRequestError,
  type SharedProjectCatalog,
} from "@research-video/catalog";
import {
  AddProjectMemberRequestSchema,
  AcceptLoggedExportDeliveryRequestSchema,
  ArtifactVersionHistoryQuerySchema,
  ResolveArtifactCompatibilityRequestSchema,
  CancelLoggedExportRequestSchema,
  AddProjectVideoRequestSchema,
  BatchPreflightRequestSchema,
  BatchPreflightResponseSchema,
  CreateClipCandidateRequestSchema,
  CreateClipExportRequestSchema,
  ReexportArtifactVersionRequestSchema,
  CreateLoggedExportBatchRequestSchema,
  CreateExportPresetRequestSchema,
  ExportPresetDefaultResponseSchema,
  ExportSettingsPreviewRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  CreateProjectRequestSchema,
  CreateProjectVideoLanguageDecisionRequestSchema,
  ClaimLoggedExportDeliveryRequestSchema,
  ClipLibraryQuerySchema,
  PublishDerivedTranslationRequestSchema,
  ProjectVideoWorklistQuerySchema,
  UpdateProjectLocalProcessingRequestSchema,
  SuggestProjectKeywordRequestSchema,
  ReviewProjectKeywordSuggestionRequestSchema,
  ClaimProjectKeywordScanRequestSchema,
  HeartbeatProjectKeywordScanRequestSchema,
  GetProjectKeywordScanInputRequestSchema,
  FinalizeProjectKeywordScanRequestSchema,
  FailProjectKeywordScanRequestSchema,
  CreateProjectKeywordScanArtifactUploadRequestSchema,
  LookupDerivedTranslationSchema,
  RequestDerivedTranslationSchema,
  TranscriptionBatchControlRequestSchema,
  UpdateHostedTranscriptionApprovalRequestSchema,
  UpdateReviewStatusRequestSchema,
  UpdateOwnProjectVideoFlagRequestSchema,
  UpdateProjectVideoClaimRequestSchema,
  UpdateProjectVideoGovernanceRequestSchema,
  BulkUpdateProjectVideoPriorityRequestSchema,
  UpdateProjectVideoReviewRequestSchema,
  UpdateProjectVideoTriageRequestSchema,
  ProjectVideoActivityQuerySchema,
  MarkProjectVideoActivitySeenRequestSchema,
  UpdateClipCandidateRequestSchema,
  ReviseExportPresetRequestSchema,
  SetExportPresetDefaultRequestSchema,
  SourceProviderCapabilitiesResponseSchema,
  SourceSearchRequestSchema,
  SourceSearchResponseSchema,
  UpdatePreferredLanguageRequestSchema,
  FinalizeTranscriptRequestSchema,
  CreateManualTimedTranscriptImportRequestSchema,
  FinalizeManualTimedTranscriptImportRequestSchema,
  ManualTimedTranscriptImportStatusQuerySchema,
  ActivateManualTimedTranscriptCandidateRequestSchema,
  ManualTimedTranscriptCandidateReviewQuerySchema,
  HealthResponseSchema,
  WorkerClaimRequestSchema,
  WorkerFailureRequestSchema,
  WorkerCreateTranscriptUploadRequestSchema,
  WorkerFinalizeTranscriptRequestSchema,
  WorkerHeartbeatRequestSchema,
  WorkerSourcePlanRequestSchema,
  WorkerObserveLanguageEvidenceRequestSchema,
  WorkerTranslateTranscriptRequestSchema,
  WorkerTranslateTranscriptResponseSchema,
  ExportWorkerCompatibilityRequestSchema,
  HeartbeatExportWorkerRequestSchema,
  RegisterExportWorkerRequestSchema,
  RegisterUserRequestSchema,
  ReconcileLoggedExportFailureRequestSchema,
  ReconcileLoggedExportCanceledRequestSchema,
  ReconcileLoggedExportSuccessRequestSchema,
  RetryLoggedExportRequestSchema,
  StartLoggedExportExecutionRequestSchema,
  HeartbeatLoggedExportExecutionRequestSchema,
  RevokeExportWorkerRequestSchema,
  type AuthenticatedActor,
  type BatchOptions,
  type BatchPreflightItem,
  type BatchPreflightResponse,
  type SourceOperationCapability,
  type SourceProvider,
  type SourceSearchProviderOutcome,
} from "@research-video/contracts";
import {
  normalizeYouTubeUrl,
  SourceSearchProviderError,
  translateCanonicalTranscript,
  youtubeSourceIdentity,
  type SourceSearchProvider,
  type TranslationProvider,
  type VideoMetadataProvider,
} from "@research-video/providers";
import { transcriptToSrt } from "@research-video/transcript";

export interface CloudApiDependencies {
  catalog: SharedProjectCatalog;
  authenticate(request: FastifyRequest): Promise<AuthenticatedActor>;
  videoMetadataProvider?: VideoMetadataProvider;
  sourceSearchProviders?: Partial<Record<SourceProvider, SourceSearchProvider>>;
  translationProvider?: TranslationProvider;
  queueDeliveryRequired?: boolean;
}

const IdParamsSchema = z.object({ projectId: z.uuid() });
const ProjectVideoParamsSchema = IdParamsSchema.extend({ videoId: z.uuid() });
const ProjectVideoImportParamsSchema = ProjectVideoParamsSchema.extend({
  importId: z.uuid(),
});
const ProjectVideoCandidateParamsSchema = ProjectVideoParamsSchema.extend({
  candidateId: z.uuid(),
});
const ProjectClipParamsSchema = IdParamsSchema.extend({ clipId: z.uuid() });
const ProjectExportRequestParamsSchema = IdParamsSchema.extend({
  requestId: z.uuid(),
});
const ProjectExportBatchParamsSchema = IdParamsSchema.extend({
  batchId: z.uuid(),
});
const ProjectBatchParamsSchema = IdParamsSchema.extend({ batchId: z.uuid() });
const ProjectReviewItemParamsSchema = IdParamsSchema.extend({
  itemId: z.uuid(),
});
const ProjectKeywordSuggestionParamsSchema = IdParamsSchema.extend({
  suggestionId: z.uuid(),
});
const ProjectKeywordScanParamsSchema = IdParamsSchema.extend({
  scanId: z.uuid(),
});
const JobParamsSchema = z.object({ jobId: z.uuid() });
const CreateUploadSchema = z.object({
  lineageId: z.uuid(),
  version: z.number().int().positive(),
  artifactTypes: z
    .array(
      z.enum([
        "provider-response",
        "original-normalized",
        "english-normalized",
        "original-srt",
        "english-srt",
      ]),
    )
    .min(1),
});

export async function authenticateDevBearer(
  request: FastifyRequest,
): Promise<AuthenticatedActor> {
  const authorization = request.headers.authorization;
  const match = /^Bearer ([0-9a-f-]{36})\|(.+)$/i.exec(authorization ?? "");
  if (!match?.[1] || !match[2]) {
    throw new AuthenticationError(
      "Use a development bearer token: <user UUID>|<external subject>.",
    );
  }
  return { userId: match[1], externalSubject: match[2] };
}

export function createCloudApi(
  dependencies?: CloudApiDependencies,
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
      service: "cloud-api",
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );

  if (!dependencies) return app;
  const { catalog, authenticate } = dependencies;

  app.get("/api/session", async (request, reply) => {
    await authenticate(request);
    return reply.status(204).send();
  });

  app.post("/api/session/register", async (request) => {
    const actor = await authenticate(request);
    const body = RegisterUserRequestSchema.parse(request.body);
    return catalog.registerUser(actor, body.displayName, body.handle);
  });

  app.put("/api/export-workers/self", async (request) =>
    catalog.registerExportWorker(
      await authenticate(request),
      RegisterExportWorkerRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-workers/self/heartbeat", async (request) =>
    catalog.heartbeatExportWorker(
      await authenticate(request),
      HeartbeatExportWorkerRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-workers/self/revoke", async (request, reply) => {
    await catalog.revokeExportWorker(
      await authenticate(request),
      RevokeExportWorkerRequestSchema.parse(request.body),
    );
    return reply.status(204).send();
  });

  app.post("/api/export-deliveries/claim", async (request) =>
    catalog.claimLoggedExportDelivery(
      await authenticate(request),
      ClaimLoggedExportDeliveryRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-deliveries/accept", async (request) =>
    catalog.acceptLoggedExportDelivery(
      await authenticate(request),
      AcceptLoggedExportDeliveryRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-deliveries/execution/start", async (request) =>
    catalog.startLoggedExportExecution(
      await authenticate(request),
      StartLoggedExportExecutionRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-deliveries/execution/heartbeat", async (request) =>
    catalog.heartbeatLoggedExportExecution(
      await authenticate(request),
      HeartbeatLoggedExportExecutionRequestSchema.parse(request.body),
    ),
  );

  app.get(
    "/api/projects/:projectId/export-requests/:requestId/progress",
    async (request) => {
      const { projectId, requestId } = ProjectExportRequestParamsSchema.parse(
        request.params,
      );
      return catalog.getLoggedExportProgress(
        await authenticate(request),
        projectId,
        requestId,
      );
    },
  );

  app.post(
    "/api/projects/:projectId/clips/:clipId/artifact-versions/:artifactVersionId/compatibility",
    async (request) => {
      const { projectId, clipId, artifactVersionId } = z
        .object({
          projectId: z.uuid(),
          clipId: z.uuid(),
          artifactVersionId: z.uuid(),
        })
        .parse(request.params);
      const command = ResolveArtifactCompatibilityRequestSchema.parse(
        request.body,
      );
      if (command.requirements.clipId !== clipId) {
        throw Object.assign(
          new Error("Compatibility requirements must target the route clip."),
          { statusCode: 400, code: "invalid_request" },
        );
      }
      return catalog.resolveArtifactVersionCompatibility(
        await authenticate(request),
        projectId,
        clipId,
        artifactVersionId,
        command.requirements,
      );
    },
  );

  app.patch("/api/projects/:projectId/worklist/triage", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.updateProjectVideoTriage(
      await authenticate(request),
      projectId,
      UpdateProjectVideoTriageRequestSchema.parse(request.body),
    );
  });

  app.get("/api/projects/:projectId/activity", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listProjectVideoActivity(
      await authenticate(request),
      projectId,
      ProjectVideoActivityQuerySchema.parse(request.query),
    );
  });

  app.patch("/api/projects/:projectId/activity/seen", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.markProjectVideoActivitySeen(
      await authenticate(request),
      projectId,
      MarkProjectVideoActivitySeenRequestSchema.parse(request.body),
    );
  });

  app.post("/api/export-deliveries/reconcile-success", async (request) =>
    catalog.reconcileLoggedExportSuccess(
      await authenticate(request),
      ReconcileLoggedExportSuccessRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-deliveries/reconcile-failure", async (request) =>
    catalog.reconcileLoggedExportFailure(
      await authenticate(request),
      ReconcileLoggedExportFailureRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-deliveries/reconcile-canceled", async (request) =>
    catalog.reconcileLoggedExportCanceled(
      await authenticate(request),
      ReconcileLoggedExportCanceledRequestSchema.parse(request.body),
    ),
  );

  app.post(
    "/api/projects/:projectId/export-requests/:requestId/cancel",
    async (request) => {
      const { projectId, requestId } = ProjectExportRequestParamsSchema.parse(
        request.params,
      );
      return catalog.cancelLoggedExport(
        await authenticate(request),
        projectId,
        requestId,
        CancelLoggedExportRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/export-requests/:requestId/retry",
    async (request) => {
      const { projectId, requestId } = ProjectExportRequestParamsSchema.parse(
        request.params,
      );
      return catalog.retryLoggedExport(
        await authenticate(request),
        projectId,
        requestId,
        RetryLoggedExportRequestSchema.parse(request.body),
      );
    },
  );

  app.get("/api/session/profile", async (request) =>
    catalog.getCurrentUser(await authenticate(request)),
  );

  app.patch("/api/session/profile", async (request) =>
    catalog.updatePreferredLanguage(
      await authenticate(request),
      UpdatePreferredLanguageRequestSchema.parse(request.body),
    ),
  );

  app.get("/api/export-presets", async (request) =>
    catalog.listPersonalExportPresets(await authenticate(request)),
  );

  app.post("/api/export-settings/preview", async (request) =>
    catalog.previewPersonalExportSettings(
      await authenticate(request),
      ExportSettingsPreviewRequestSchema.parse(request.body),
    ),
  );

  app.post("/api/export-presets", async (request, reply) => {
    const preset = await catalog.createPersonalExportPreset(
      await authenticate(request),
      CreateExportPresetRequestSchema.parse(request.body),
    );
    return reply.status(201).send(preset);
  });

  app.patch("/api/export-presets", async (request) =>
    catalog.revisePersonalExportPreset(
      await authenticate(request),
      ReviseExportPresetRequestSchema.parse(request.body),
    ),
  );

  app.get("/api/export-presets/default", async (request) => {
    const presetDefault = await catalog.getPersonalExportPresetDefault(
      await authenticate(request),
    );
    return ExportPresetDefaultResponseSchema.parse(
      presetDefault ? { default: presetDefault } : {},
    );
  });

  app.put("/api/export-presets/default", async (request) =>
    ExportPresetDefaultResponseSchema.parse({
      default: await catalog.setPersonalExportPresetDefault(
        await authenticate(request),
        SetExportPresetDefaultRequestSchema.parse(request.body),
      ),
    }),
  );

  app.get("/api/projects", async (request) =>
    catalog.listProjects(await authenticate(request)),
  );

  app.post("/api/projects", async (request, reply) => {
    const project = await catalog.createProject(
      await authenticate(request),
      CreateProjectRequestSchema.parse(request.body),
    );
    return reply.status(201).send(project);
  });

  app.get("/api/projects/:projectId/export-presets", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listProjectExportPresets(
      await authenticate(request),
      projectId,
    );
  });

  app.post(
    "/api/projects/:projectId/export-settings/preview",
    async (request) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      return catalog.previewProjectExportSettings(
        await authenticate(request),
        projectId,
        ExportSettingsPreviewRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/export-workers/availability",
    async (request) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      return catalog.compatibleExportWorkerAvailability(
        await authenticate(request),
        projectId,
        ExportWorkerCompatibilityRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/export-presets",
    async (request, reply) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const preset = await catalog.createProjectExportPreset(
        await authenticate(request),
        projectId,
        CreateExportPresetRequestSchema.parse(request.body),
      );
      return reply.status(201).send(preset);
    },
  );

  app.patch("/api/projects/:projectId/export-presets", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.reviseProjectExportPreset(
      await authenticate(request),
      projectId,
      ReviseExportPresetRequestSchema.parse(request.body),
    );
  });

  app.get(
    "/api/projects/:projectId/export-presets/default",
    async (request) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const presetDefault = await catalog.getProjectExportPresetDefault(
        await authenticate(request),
        projectId,
      );
      return ExportPresetDefaultResponseSchema.parse(
        presetDefault ? { default: presetDefault } : {},
      );
    },
  );

  app.put(
    "/api/projects/:projectId/export-presets/default",
    async (request) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      return ExportPresetDefaultResponseSchema.parse({
        default: await catalog.setProjectExportPresetDefault(
          await authenticate(request),
          projectId,
          SetExportPresetDefaultRequestSchema.parse(request.body),
        ),
      });
    },
  );

  app.post("/api/projects/:projectId/members", async (request, reply) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    const body = AddProjectMemberRequestSchema.parse(request.body);
    await catalog.addMember(
      await authenticate(request),
      projectId,
      body.userId,
      body.role,
    );
    return reply.status(204).send();
  });

  app.post("/api/projects/:projectId/videos", async (request, reply) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    const body = AddProjectVideoRequestSchema.parse(request.body);
    if (
      body.sourceIdentity?.provider &&
      body.sourceIdentity.provider !== "youtube"
    ) {
      throw new CatalogInvalidRequestError(
        "Only YouTube sources are product-qualified for project ingest in this release.",
      );
    }
    const video = await catalog.addVideo(
      await authenticate(request),
      projectId,
      {
        youtubeVideoId: body.youtubeVideoId,
        canonicalUrl: body.canonicalUrl,
        ...(body.sourceIdentity ? { sourceIdentity: body.sourceIdentity } : {}),
        ...(body.sourceFingerprint
          ? { sourceFingerprint: body.sourceFingerprint }
          : {}),
        title: body.title,
        ...(body.durationMs === undefined
          ? {}
          : { durationMs: body.durationMs }),
        ...(body.channel === undefined ? {} : { channel: body.channel }),
        ...(body.sourceLanguage === undefined
          ? {}
          : { sourceLanguage: body.sourceLanguage }),
      },
      { automaticLocalProcessing: true },
    );
    return reply.status(201).send(video);
  });

  app.get("/api/projects/:projectId/videos", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listVideos(await authenticate(request), projectId);
  });

  app.get("/api/projects/:projectId/source-capabilities", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    await catalog.getProject(await authenticate(request), projectId);
    return SourceProviderCapabilitiesResponseSchema.parse(
      buildSourceProviderCapabilities(
        dependencies.sourceSearchProviders,
        Boolean(dependencies.videoMetadataProvider),
      ),
    );
  });

  app.post("/api/projects/:projectId/source-search", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    const actor = await authenticate(request);
    await catalog.getProject(actor, projectId);
    const body = SourceSearchRequestSchema.parse(request.body);
    const outcomes = await Promise.all(
      body.providers.map(
        async (provider): Promise<SourceSearchProviderOutcome> => {
          const adapter = dependencies.sourceSearchProviders?.[provider];
          if (!adapter) {
            return {
              provider,
              state: provider === "youtube" ? "unavailable" : "unsupported",
              candidates: [],
              explanation:
                provider === "youtube"
                  ? "YouTube search is not configured for this deployment."
                  : `${providerDisplayName(provider)} official search is not available for this deployment.`,
            };
          }
          try {
            const page = await adapter.search({
              query: body.query,
              pageSize: body.pageSize,
              ...(body.cursors?.[provider]
                ? { cursor: body.cursors[provider] }
                : {}),
            });
            return {
              provider,
              state: "success",
              candidates: page.candidates,
              ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
            };
          } catch (error) {
            if (error instanceof SourceSearchProviderError) {
              return {
                provider,
                state: error.state,
                candidates: [],
                explanation: error.message,
              };
            }
            return {
              provider,
              state: "failed",
              candidates: [],
              explanation: `${providerDisplayName(provider)} search failed. Try again.`,
            };
          }
        },
      ),
    );
    return SourceSearchResponseSchema.parse({ outcomes });
  });

  app.get("/api/projects/:projectId/worklist", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listProjectVideoWorklist(
      await authenticate(request),
      projectId,
      ProjectVideoWorklistQuerySchema.parse(request.query),
    );
  });

  app.get("/api/projects/:projectId/local-processing", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.getProjectLocalProcessingStatus(
      await authenticate(request),
      projectId,
    );
  });

  app.patch("/api/projects/:projectId/local-processing", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.updateProjectLocalProcessing(
      await authenticate(request),
      projectId,
      UpdateProjectLocalProcessingRequestSchema.parse(request.body),
    );
  });

  app.get("/api/projects/:projectId/keywords", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listProjectKeywords(await authenticate(request), projectId);
  });

  app.post("/api/projects/:projectId/keyword-suggestions", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.suggestProjectKeyword(
      await authenticate(request),
      projectId,
      SuggestProjectKeywordRequestSchema.parse(request.body),
    );
  });

  app.post(
    "/api/projects/:projectId/keyword-suggestions/:suggestionId/review",
    async (request) => {
      const { projectId, suggestionId } =
        ProjectKeywordSuggestionParamsSchema.parse(request.params);
      return catalog.reviewProjectKeywordSuggestion(
        await authenticate(request),
        projectId,
        suggestionId,
        ReviewProjectKeywordSuggestionRequestSchema.parse(request.body),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/worklist/:videoId/keyword-scan",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.getProjectKeywordScanSummary(
        await authenticate(request),
        projectId,
        videoId,
      );
    },
  );

  app.post(
    "/api/projects/:projectId/worklist/:videoId/keyword-scan",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.scheduleProjectKeywordScan(
        await authenticate(request),
        projectId,
        videoId,
      );
    },
  );

  app.post(
    "/api/projects/:projectId/keyword-scans/claim",
    async (request, reply) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const claim = await catalog.claimProjectKeywordScan(
        await authenticate(request),
        projectId,
        ClaimProjectKeywordScanRequestSchema.parse(request.body),
      );
      return claim === undefined ? reply.status(204).send() : claim;
    },
  );

  app.post("/api/keyword-scans/claim", async (request, reply) => {
    const claim = await catalog.claimProjectKeywordScan(
      await authenticate(request),
      undefined,
      ClaimProjectKeywordScanRequestSchema.parse(request.body),
    );
    return claim === undefined ? reply.status(204).send() : claim;
  });

  app.post(
    "/api/projects/:projectId/keyword-scans/:scanId/input",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.getProjectKeywordScanInput(
        await authenticate(request),
        projectId,
        scanId,
        GetProjectKeywordScanInputRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/keyword-scans/:scanId/heartbeat",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.heartbeatProjectKeywordScan(
        await authenticate(request),
        projectId,
        scanId,
        HeartbeatProjectKeywordScanRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/keyword-scans/:scanId/finalize",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.finalizeProjectKeywordScan(
        await authenticate(request),
        projectId,
        scanId,
        FinalizeProjectKeywordScanRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/keyword-scans/:scanId/artifact-upload",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.createProjectKeywordScanArtifactUpload(
        await authenticate(request),
        projectId,
        scanId,
        CreateProjectKeywordScanArtifactUploadRequestSchema.parse(request.body),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/keyword-scans/:scanId/artifact-download",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.getProjectKeywordScanArtifactDownload(
        await authenticate(request),
        projectId,
        scanId,
      );
    },
  );

  app.post(
    "/api/projects/:projectId/keyword-scans/:scanId/fail",
    async (request) => {
      const { projectId, scanId } = ProjectKeywordScanParamsSchema.parse(
        request.params,
      );
      return catalog.failProjectKeywordScan(
        await authenticate(request),
        projectId,
        scanId,
        FailProjectKeywordScanRequestSchema.parse(request.body),
      );
    },
  );

  app.patch(
    "/api/projects/:projectId/worklist/:videoId/flag",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.updateOwnProjectVideoFlag(
        await authenticate(request),
        projectId,
        videoId,
        UpdateOwnProjectVideoFlagRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/worklist/:videoId/claim",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.updateProjectVideoClaim(
        await authenticate(request),
        projectId,
        videoId,
        UpdateProjectVideoClaimRequestSchema.parse(request.body),
      );
    },
  );

  app.patch("/api/projects/:projectId/worklist/priority", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.bulkUpdateProjectVideoPriority(
      await authenticate(request),
      projectId,
      BulkUpdateProjectVideoPriorityRequestSchema.parse(request.body),
    );
  });

  app.patch(
    "/api/projects/:projectId/worklist/:videoId/governance",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.updateProjectVideoGovernance(
        await authenticate(request),
        projectId,
        videoId,
        UpdateProjectVideoGovernanceRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/worklist/:videoId/review",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.updateProjectVideoReview(
        await authenticate(request),
        projectId,
        videoId,
        UpdateProjectVideoReviewRequestSchema.parse(request.body),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/videos/:videoId/language-gate",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.getProjectVideoLanguageGate(
        await authenticate(request),
        projectId,
        videoId,
      );
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/language-decisions",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.confirmProjectVideoLanguageDecision(
        await authenticate(request),
        projectId,
        videoId,
        CreateProjectVideoLanguageDecisionRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/derived-translations/lookup",
    async (request, reply) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const actor = await authenticate(request);
      const body = LookupDerivedTranslationSchema.parse(request.body);
      if (body.identity.catalogVideoId !== videoId) {
        return reply.status(400).send({
          error: {
            code: "invalid_request",
            message: "Translation video identity does not match the route.",
            retryable: false,
          },
        });
      }
      const ready = await catalog.getDerivedTranslation(
        actor,
        projectId,
        body.identity,
      );
      return ready === undefined
        ? reply.status(204).send()
        : reply.status(200).send(ready);
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/derived-translations/resolve",
    async (request, reply) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const actor = await authenticate(request);
      const body = RequestDerivedTranslationSchema.parse(request.body);
      if (body.identity.catalogVideoId !== videoId) {
        return reply.status(400).send({
          error: {
            code: "invalid_request",
            message: "Translation video identity does not match the route.",
            retryable: false,
          },
        });
      }
      const ready = await catalog.getDerivedTranslation(
        actor,
        projectId,
        body.identity,
      );
      if (ready) return ready;
      const job = await catalog.requestDerivedTranslation(
        actor,
        projectId,
        body,
      );
      return reply.status(202).send({ job });
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/derived-translations/publish",
    async (request, reply) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const body = PublishDerivedTranslationRequestSchema.parse(request.body);
      if (body.identity.catalogVideoId !== videoId) {
        return reply.status(400).send({
          error: {
            code: "invalid_request",
            message: "Translation video identity does not match the route.",
            retryable: false,
          },
        });
      }
      const translation = await catalog.publishDerivedTranslation(
        await authenticate(request),
        projectId,
        body,
      );
      return reply.status(201).send(translation);
    },
  );

  app.post("/api/projects/:projectId/clips", async (request, reply) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    const clip = await catalog.createClipCandidate(
      await authenticate(request),
      projectId,
      CreateClipCandidateRequestSchema.parse(request.body),
    );
    return reply.status(201).send(clip);
  });

  app.get("/api/projects/:projectId/clips", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listClipCandidates(await authenticate(request), projectId);
  });

  app.get("/api/projects/:projectId/clip-library", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listClipLibrary(
      await authenticate(request),
      projectId,
      ClipLibraryQuerySchema.parse(request.query),
    );
  });

  app.get("/api/projects/:projectId/clips.csv", async (request, reply) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    const csv = await catalog.exportClipCandidatesCsv(
      await authenticate(request),
      projectId,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="project-clips-${projectId}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/projects/:projectId/clip-tags", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listProjectClipTags(await authenticate(request), projectId);
  });

  app.get("/api/projects/:projectId/clips/:clipId", async (request) => {
    const { projectId, clipId } = ProjectClipParamsSchema.parse(request.params);
    return catalog.getClipCandidate(
      await authenticate(request),
      projectId,
      clipId,
    );
  });

  app.get(
    "/api/projects/:projectId/clips/:clipId/artifact-versions",
    async (request) => {
      const { projectId, clipId } = ProjectClipParamsSchema.parse(
        request.params,
      );
      return catalog.listArtifactVersionHistory(
        await authenticate(request),
        projectId,
        clipId,
        ArtifactVersionHistoryQuerySchema.parse(request.query),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/clips/:clipId/artifact-versions/:artifactVersionId",
    async (request) => {
      const { projectId, clipId, artifactVersionId } = z
        .object({
          projectId: z.uuid(),
          clipId: z.uuid(),
          artifactVersionId: z.uuid(),
        })
        .parse(request.params);
      return catalog.getArtifactVersion(
        await authenticate(request),
        projectId,
        clipId,
        artifactVersionId,
      );
    },
  );

  app.patch("/api/projects/:projectId/clips/:clipId", async (request) => {
    const { projectId, clipId } = ProjectClipParamsSchema.parse(request.params);
    return catalog.updateClipCandidate(
      await authenticate(request),
      projectId,
      clipId,
      UpdateClipCandidateRequestSchema.parse(request.body),
    );
  });

  app.post(
    "/api/projects/:projectId/clips/:clipId/exports",
    async (request, reply) => {
      const { projectId, clipId } = ProjectClipParamsSchema.parse(
        request.params,
      );
      const created = await catalog.createClipExport(
        await authenticate(request),
        projectId,
        clipId,
        CreateClipExportRequestSchema.parse(request.body),
      );
      return reply.status(201).send(created);
    },
  );

  app.post(
    "/api/projects/:projectId/clips/:clipId/artifact-versions/:artifactVersionId/reexport",
    async (request, reply) => {
      const { projectId, clipId, artifactVersionId } = z
        .object({
          projectId: z.uuid(),
          clipId: z.uuid(),
          artifactVersionId: z.uuid(),
        })
        .parse(request.params);
      const created = await catalog.reexportArtifactVersion(
        await authenticate(request),
        projectId,
        clipId,
        artifactVersionId,
        ReexportArtifactVersionRequestSchema.parse(request.body),
      );
      return reply.status(201).send(created);
    },
  );

  app.post(
    "/api/projects/:projectId/export-batches",
    async (request, reply) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const batch = await catalog.createLoggedExportBatch(
        await authenticate(request),
        projectId,
        CreateLoggedExportBatchRequestSchema.parse(request.body),
      );
      return reply.status(201).send(batch);
    },
  );

  app.get("/api/projects/:projectId/export-batches", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listLoggedExportBatches(
      await authenticate(request),
      projectId,
    );
  });

  app.get(
    "/api/projects/:projectId/export-batches/:batchId",
    async (request) => {
      const { projectId, batchId } = ProjectExportBatchParamsSchema.parse(
        request.params,
      );
      return catalog.getLoggedExportBatch(
        await authenticate(request),
        projectId,
        batchId,
      );
    },
  );

  if (dependencies.videoMetadataProvider) {
    app.post(
      "/api/projects/:projectId/videos/resolve",
      async (request, reply) => {
        const { projectId } = IdParamsSchema.parse(request.params);
        const { url } = z
          .object({ url: z.string().trim().min(1) })
          .parse(request.body);
        const normalized = normalizeYouTubeUrl(url);
        const metadata = await dependencies.videoMetadataProvider!.resolve(
          normalized.videoId,
        );
        const video = await catalog.addVideo(
          await authenticate(request),
          projectId,
          {
            youtubeVideoId: normalized.videoId,
            canonicalUrl: normalized.canonicalUrl,
            sourceIdentity: youtubeSourceIdentity(normalized.videoId),
            title: metadata.title,
            ...(metadata.channel ? { channel: metadata.channel } : {}),
            ...(metadata.durationMs === undefined
              ? {}
              : { durationMs: metadata.durationMs }),
            ...(metadata.sourceLanguage
              ? { sourceLanguage: metadata.sourceLanguage }
              : {}),
          },
          { automaticLocalProcessing: true },
        );
        return reply.status(201).send(video);
      },
    );

    app.post("/api/projects/:projectId/videos/preflight", async (request) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const actor = await authenticate(request);
      const body = BatchPreflightRequestSchema.parse(request.body);
      return preflightTranscriptionBatch(
        catalog,
        dependencies.videoMetadataProvider!,
        actor,
        projectId,
        body.inputs,
        body,
      );
    });

    app.post(
      "/api/projects/:projectId/transcription-batches",
      async (request, reply) => {
        const { projectId } = IdParamsSchema.parse(request.params);
        const actor = await authenticate(request);
        const body = CreateTranscriptionBatchRequestSchema.parse(request.body);
        const preflight = await preflightTranscriptionBatch(
          catalog,
          dependencies.videoMetadataProvider!,
          actor,
          projectId,
          body.inputs,
          body,
        );
        const created = await catalog.createTranscriptionBatch(actor, {
          projectId,
          name: body.name,
          options: preflight.options,
          items: preflight.items,
        });
        return reply.status(201).send(created);
      },
    );
  }

  app.get("/api/projects/:projectId/transcription-batches", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listTranscriptionBatches(
      await authenticate(request),
      projectId,
    );
  });

  app.get(
    "/api/projects/:projectId/transcription-batches/:batchId",
    async (request) => {
      const { projectId, batchId } = ProjectBatchParamsSchema.parse(
        request.params,
      );
      return catalog.getTranscriptionBatch(
        await authenticate(request),
        projectId,
        batchId,
      );
    },
  );

  app.get("/api/projects/:projectId/review-inbox", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listReviewInbox(await authenticate(request), projectId);
  });

  app.patch(
    "/api/projects/:projectId/review-inbox/:itemId",
    async (request) => {
      const { projectId, itemId } = ProjectReviewItemParamsSchema.parse(
        request.params,
      );
      return catalog.updateReviewStatus(
        await authenticate(request),
        projectId,
        itemId,
        UpdateReviewStatusRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/transcription-batches/:batchId/control",
    async (request) => {
      const { projectId, batchId } = ProjectBatchParamsSchema.parse(
        request.params,
      );
      return catalog.controlTranscriptionBatch(
        await authenticate(request),
        projectId,
        batchId,
        TranscriptionBatchControlRequestSchema.parse(request.body),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/transcription-batches/:batchId/hosted-approval",
    async (request) => {
      const { projectId, batchId } = ProjectBatchParamsSchema.parse(
        request.params,
      );
      return catalog.updateHostedTranscriptionApproval(
        await authenticate(request),
        projectId,
        batchId,
        UpdateHostedTranscriptionApprovalRequestSchema.parse(request.body),
      );
    },
  );

  app.post("/api/transcription-jobs/claim", async (request, reply) => {
    const body = WorkerClaimRequestSchema.parse(request.body);
    const actor = await authenticate(request);
    const claimed = await catalog.claimTranscriptionJob(
      actor,
      body.executionLocation,
      body.leaseSeconds,
      dependencies.queueDeliveryRequired ?? false,
    );
    return claimed === undefined
      ? reply.status(204).send()
      : reply.status(200).send(claimed);
  });

  app.post("/api/transcription-jobs/:jobId/heartbeat", async (request) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerHeartbeatRequestSchema.parse(request.body);
    const actor = await authenticate(request);
    const heartbeat = await catalog.heartbeatTranscriptionJob(
      actor,
      jobId,
      body.attempt,
      body.leaseSeconds,
      body.stage,
    );
    return heartbeat;
  });

  app.post(
    "/api/transcription-jobs/:jobId/source-plan",
    async (request, reply) => {
      const { jobId } = JobParamsSchema.parse(request.params);
      const body = WorkerSourcePlanRequestSchema.parse(request.body);
      await catalog.recordTranscriptSourcePlan(
        await authenticate(request),
        jobId,
        body.attempt,
        body.plan,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/transcription-jobs/:jobId/language-evidence",
    async (request) => {
      const { jobId } = JobParamsSchema.parse(request.params);
      return catalog.observeWorkerLanguageEvidence(
        await authenticate(request),
        jobId,
        WorkerObserveLanguageEvidenceRequestSchema.parse(request.body),
      );
    },
  );

  app.post("/api/transcription-jobs/:jobId/translate", async (request) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerTranslateTranscriptRequestSchema.parse(request.body);
    const actor = await authenticate(request);
    const source = await catalog.loadClaimedTranscriptTranslationSource(
      actor,
      jobId,
      {
        attempt: body.attempt,
        consent: body.consent,
        uploadId: body.uploadId,
        sourceArtifact: body.sourceArtifact,
        targetLanguage: body.targetLanguage,
      },
    );
    const cached = await catalog.getClaimedTranscriptTranslationPublication(
      actor,
      jobId,
      {
        attempt: body.attempt,
        uploadId: body.uploadId,
        sourceArtifact: body.sourceArtifact,
        targetLanguage: body.targetLanguage,
      },
    );
    if (cached) return WorkerTranslateTranscriptResponseSchema.parse(cached);
    if (!dependencies.translationProvider) {
      throw new CloudTranslationUnavailableError();
    }
    const transcript = await translateCanonicalTranscript(
      dependencies.translationProvider,
      source,
      body.targetLanguage,
    );
    return catalog.publishClaimedTranscriptTranslation(actor, jobId, {
      attempt: body.attempt,
      consent: body.consent,
      uploadId: body.uploadId,
      sourceArtifact: body.sourceArtifact,
      targetLanguage: body.targetLanguage,
      transcript,
      subtitleBytes: new TextEncoder().encode(transcriptToSrt(transcript)),
    });
  });

  app.post("/api/transcription-jobs/:jobId/fail", async (request, reply) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerFailureRequestSchema.parse(request.body);
    const actor = await authenticate(request);
    await catalog.failTranscriptionJob(actor, jobId, body);
    return reply.status(204).send();
  });

  app.post(
    "/api/transcription-jobs/:jobId/transcript-uploads",
    async (request, reply) => {
      const { jobId } = JobParamsSchema.parse(request.params);
      const body = WorkerCreateTranscriptUploadRequestSchema.parse(
        request.body,
      );
      const grant = await catalog.createClaimedTranscriptUpload(
        await authenticate(request),
        jobId,
        body.attempt,
        {
          lineageId: body.lineageId,
          version: body.version,
          artifactTypes: body.artifactTypes,
        },
      );
      return reply.status(201).send(grant);
    },
  );

  app.post("/api/transcription-jobs/:jobId/finalize", async (request) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerFinalizeTranscriptRequestSchema.parse(request.body);
    const actor = await authenticate(request);
    const finalized = await catalog.finalizeTranscript(
      actor,
      {
        uploadId: body.uploadId,
        idempotencyKey: body.idempotencyKey,
        manifest: body.manifest,
      },
      { jobId, attempt: body.attempt },
    );
    return finalized;
  });

  app.post(
    "/api/projects/:projectId/videos/:videoId/transcript-uploads",
    async (request, reply) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const body = CreateUploadSchema.parse(request.body);
      const grant = await catalog.createTranscriptUpload(
        await authenticate(request),
        {
          projectId,
          catalogVideoId: videoId,
          lineageId: body.lineageId,
          version: body.version,
          artifactTypes: body.artifactTypes,
        },
      );
      return reply.status(201).send(grant);
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/timed-transcript-imports",
    async (request, reply) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const grant = await catalog.createManualTimedTranscriptImport(
        await authenticate(request),
        projectId,
        videoId,
        CreateManualTimedTranscriptImportRequestSchema.parse(request.body),
      );
      return reply.status(201).send(grant);
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/timed-transcript-imports/:importId/finalize",
    async (request) => {
      const { projectId, videoId, importId } =
        ProjectVideoImportParamsSchema.parse(request.params);
      return catalog.finalizeManualTimedTranscriptImport(
        await authenticate(request),
        projectId,
        videoId,
        importId,
        FinalizeManualTimedTranscriptImportRequestSchema.parse(request.body),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/videos/:videoId/timed-transcript-imports",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      const { batchItemId } =
        ManualTimedTranscriptImportStatusQuerySchema.parse(request.query);
      return catalog.getManualTimedTranscriptImportForBatchItem(
        await authenticate(request),
        projectId,
        videoId,
        batchItemId,
      );
    },
  );

  app.get(
    "/api/projects/:projectId/videos/:videoId/timed-transcript-candidates/:candidateId/review",
    async (request) => {
      const { projectId, videoId, candidateId } =
        ProjectVideoCandidateParamsSchema.parse(request.params);
      return catalog.reviewManualTimedTranscriptCandidate(
        await authenticate(request),
        projectId,
        videoId,
        candidateId,
        ManualTimedTranscriptCandidateReviewQuerySchema.parse(request.query),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/videos/:videoId/timed-transcript-candidates/:candidateId/activate",
    async (request) => {
      const { projectId, videoId, candidateId } =
        ProjectVideoCandidateParamsSchema.parse(request.params);
      const body = ActivateManualTimedTranscriptCandidateRequestSchema.parse(
        request.body,
      );
      if (body.candidateId !== candidateId) {
        throw new CatalogConflictError(
          "Corrected transcript candidate identity does not match the route.",
        );
      }
      return catalog.activateManualTimedTranscriptCandidate(
        await authenticate(request),
        projectId,
        videoId,
        body,
      );
    },
  );

  app.post("/api/transcripts/finalize", async (request) =>
    catalog.finalizeTranscript(
      await authenticate(request),
      FinalizeTranscriptRequestSchema.parse(request.body),
    ),
  );

  app.get(
    "/api/projects/:projectId/videos/:videoId/transcripts/active",
    async (request) => {
      const { projectId, videoId } = ProjectVideoParamsSchema.parse(
        request.params,
      );
      return catalog.getActiveTranscript(
        await authenticate(request),
        projectId,
        videoId,
      );
    },
  );

  return app;
}

class CloudTranslationUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "cloud_translation_unavailable";
  constructor() {
    super("Cloud translation is currently unavailable.");
  }
}

const sourceOperations = [
  "search",
  "metadata",
  "embed-preview",
  "precise-navigation",
  "captions",
  "audio-acquisition",
  "full-media-acquisition",
  "availability",
] as const;

function buildSourceProviderCapabilities(
  searchProviders:
    Partial<Record<SourceProvider, SourceSearchProvider>> | undefined,
  youtubeMetadataConfigured: boolean,
) {
  const providers: SourceProvider[] = [
    "youtube",
    "tiktok",
    "instagram",
    "facebook",
  ];
  return {
    providers: providers.map((provider) => ({
      provider,
      operations: sourceOperations.map(
        (operation): SourceOperationCapability => {
          if (operation === "search") {
            const configured = Boolean(searchProviders?.[provider]);
            return {
              operation,
              state: configured
                ? "available"
                : provider === "youtube"
                  ? "unavailable"
                  : "unsupported",
              configured,
              ...(!configured
                ? {
                    explanation: providerSearchUnavailableExplanation(provider),
                  }
                : {}),
            };
          }
          if (provider !== "youtube") {
            return {
              operation,
              state: "unsupported",
              configured: false,
              explanation: `${providerDisplayName(provider)} is not product-qualified in this release.`,
            };
          }
          if (operation === "metadata" && !youtubeMetadataConfigured) {
            return {
              operation,
              state: "unavailable",
              configured: false,
              explanation: "YouTube metadata lookup is not configured.",
            };
          }
          return { operation, state: "available", configured: true };
        },
      ),
    })),
  };
}

function providerDisplayName(provider: SourceProvider) {
  if (provider === "youtube") return "YouTube";
  if (provider === "tiktok") return "TikTok";
  if (provider === "instagram") return "Instagram";
  return "Facebook";
}

function providerSearchUnavailableExplanation(provider: SourceProvider) {
  if (provider === "youtube") {
    return "YouTube search requires a configured official Data API key.";
  }
  if (provider === "facebook") {
    return "Facebook official search is limited to authorized Pages and assets and is not enabled.";
  }
  return `${providerDisplayName(provider)} search requires qualifying official API access and is not enabled.`;
}

export async function preflightTranscriptionBatch(
  catalog: SharedProjectCatalog,
  metadataProvider: VideoMetadataProvider,
  actor: AuthenticatedActor,
  projectId: string,
  inputs: readonly string[],
  options: BatchOptions,
): Promise<BatchPreflightResponse> {
  const normalized = inputs.map((input, inputIndex) => {
    try {
      return {
        input: input.trim(),
        inputIndex,
        normalized: normalizeYouTubeUrl(input),
      };
    } catch {
      return { input: input.trim(), inputIndex };
    }
  });
  const firstIndexByVideo = new Map<string, number>();
  const uniqueVideoIds: string[] = [];
  for (const entry of normalized) {
    if (!entry.normalized) continue;
    if (!firstIndexByVideo.has(entry.normalized.videoId)) {
      firstIndexByVideo.set(entry.normalized.videoId, entry.inputIndex);
      uniqueVideoIds.push(entry.normalized.videoId);
    }
  }
  const projectStates = await catalog.findProjectVideoTranscriptStates(
    actor,
    projectId,
    uniqueVideoIds,
  );
  const items: BatchPreflightItem[] = [];
  for (const entry of normalized) {
    if (!entry.normalized) {
      items.push({
        inputIndex: entry.inputIndex,
        input: entry.input,
        status: "unsupported",
        processingNeed: "none",
        error: {
          code: "unsupported_video_url",
          message: "Enter a supported YouTube URL or video ID.",
        },
      });
      continue;
    }
    const firstIndex = firstIndexByVideo.get(entry.normalized.videoId)!;
    if (firstIndex !== entry.inputIndex) {
      items.push({
        inputIndex: entry.inputIndex,
        input: entry.input,
        status: "duplicate",
        processingNeed: "none",
        youtubeVideoId: entry.normalized.videoId,
        canonicalUrl: entry.normalized.canonicalUrl,
        sourceIdentity: youtubeSourceIdentity(entry.normalized.videoId),
        duplicateOfInputIndex: firstIndex,
      });
      continue;
    }
    const projectState = projectStates.get(entry.normalized.videoId);
    if (
      projectState?.activeTranscriptVersionId &&
      options.sourcePolicy !== "force-generate"
    ) {
      items.push({
        inputIndex: entry.inputIndex,
        input: entry.input,
        status: "existing-transcript",
        processingNeed: "reuse-shared",
        youtubeVideoId: entry.normalized.videoId,
        canonicalUrl: projectState.canonicalUrl,
        sourceIdentity: youtubeSourceIdentity(entry.normalized.videoId),
        title: projectState.title,
        ...(projectState.channel ? { channel: projectState.channel } : {}),
        ...(projectState.durationMs === undefined
          ? {}
          : { durationMs: projectState.durationMs }),
        ...(projectState.sourceLanguage
          ? { sourceLanguage: projectState.sourceLanguage }
          : {}),
        catalogVideoId: projectState.catalogVideoId,
        activeTranscriptVersionId: projectState.activeTranscriptVersionId,
      });
      continue;
    }
    try {
      const metadata = await metadataProvider.resolve(entry.normalized.videoId);
      items.push({
        inputIndex: entry.inputIndex,
        input: entry.input,
        status: "ready",
        processingNeed: "transcription",
        youtubeVideoId: entry.normalized.videoId,
        canonicalUrl: entry.normalized.canonicalUrl,
        sourceIdentity: youtubeSourceIdentity(entry.normalized.videoId),
        title: metadata.title,
        ...(metadata.channel ? { channel: metadata.channel } : {}),
        ...(metadata.durationMs === undefined
          ? {}
          : { durationMs: metadata.durationMs }),
        ...(metadata.sourceLanguage
          ? { sourceLanguage: metadata.sourceLanguage }
          : {}),
        ...(projectState
          ? { catalogVideoId: projectState.catalogVideoId }
          : {}),
      });
    } catch {
      items.push({
        inputIndex: entry.inputIndex,
        input: entry.input,
        status: "metadata-failed",
        processingNeed: "none",
        youtubeVideoId: entry.normalized.videoId,
        canonicalUrl: entry.normalized.canonicalUrl,
        error: {
          code: "metadata_lookup_failed",
          message: "Video metadata could not be resolved.",
        },
      });
    }
  }
  return BatchPreflightResponseSchema.parse({
    projectId,
    options,
    items,
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      existingTranscripts: items.filter(
        (item) => item.status === "existing-transcript",
      ).length,
      duplicates: items.filter((item) => item.status === "duplicate").length,
      unsupported: items.filter((item) => item.status === "unsupported").length,
      metadataFailed: items.filter((item) => item.status === "metadata-failed")
        .length,
    },
  });
}
