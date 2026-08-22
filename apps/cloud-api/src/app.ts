import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import { AuthenticationError } from "@research-video/auth";
import type { SharedProjectCatalog } from "@research-video/catalog";
import {
  AddProjectMemberRequestSchema,
  AcceptLoggedExportDeliveryRequestSchema,
  CancelLoggedExportRequestSchema,
  AddProjectVideoRequestSchema,
  BatchPreflightRequestSchema,
  BatchPreflightResponseSchema,
  CreateClipCandidateRequestSchema,
  CreateClipExportRequestSchema,
  CreateLoggedExportBatchRequestSchema,
  CreateExportPresetRequestSchema,
  ExportPresetDefaultResponseSchema,
  ExportSettingsPreviewRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  CreateProjectRequestSchema,
  ClaimLoggedExportDeliveryRequestSchema,
  PublishDerivedTranslationRequestSchema,
  RequestDerivedTranslationSchema,
  TranscriptionBatchControlRequestSchema,
  UpdateReviewStatusRequestSchema,
  UpdateClipCandidateRequestSchema,
  ReviseExportPresetRequestSchema,
  SetExportPresetDefaultRequestSchema,
  UpdatePreferredLanguageRequestSchema,
  FinalizeTranscriptRequestSchema,
  HealthResponseSchema,
  WorkerClaimRequestSchema,
  WorkerFailureRequestSchema,
  WorkerCreateTranscriptUploadRequestSchema,
  WorkerFinalizeTranscriptRequestSchema,
  WorkerHeartbeatRequestSchema,
  WorkerSourcePlanRequestSchema,
  ExportWorkerCompatibilityRequestSchema,
  HeartbeatExportWorkerRequestSchema,
  RegisterExportWorkerRequestSchema,
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
} from "@research-video/contracts";
import {
  normalizeYouTubeUrl,
  type VideoMetadataProvider,
} from "@research-video/providers";

export interface CloudApiDependencies {
  catalog: SharedProjectCatalog;
  authenticate(request: FastifyRequest): Promise<AuthenticatedActor>;
  videoMetadataProvider?: VideoMetadataProvider;
}

const IdParamsSchema = z.object({ projectId: z.uuid() });
const ProjectVideoParamsSchema = IdParamsSchema.extend({ videoId: z.uuid() });
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

  app.post("/api/session/register", async (request) => {
    const actor = await authenticate(request);
    const body = z
      .object({ displayName: z.string().trim().min(1).max(160) })
      .parse(request.body);
    return catalog.registerUser(actor, body.displayName);
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
    const video = await catalog.addVideo(
      await authenticate(request),
      projectId,
      {
        youtubeVideoId: body.youtubeVideoId,
        canonicalUrl: body.canonicalUrl,
        title: body.title,
        ...(body.durationMs === undefined
          ? {}
          : { durationMs: body.durationMs }),
        ...(body.channel === undefined ? {} : { channel: body.channel }),
        ...(body.sourceLanguage === undefined
          ? {}
          : { sourceLanguage: body.sourceLanguage }),
      },
    );
    return reply.status(201).send(video);
  });

  app.get("/api/projects/:projectId/videos", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listVideos(await authenticate(request), projectId);
  });

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
            title: metadata.title,
            ...(metadata.channel ? { channel: metadata.channel } : {}),
            ...(metadata.durationMs === undefined
              ? {}
              : { durationMs: metadata.durationMs }),
            ...(metadata.sourceLanguage
              ? { sourceLanguage: metadata.sourceLanguage }
              : {}),
          },
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

  app.post("/api/transcription-jobs/claim", async (request, reply) => {
    const body = WorkerClaimRequestSchema.parse(request.body);
    const claimed = await catalog.claimTranscriptionJob(
      await authenticate(request),
      body.executionLocation,
      body.leaseSeconds,
    );
    return claimed === undefined
      ? reply.status(204).send()
      : reply.status(200).send(claimed);
  });

  app.post("/api/transcription-jobs/:jobId/heartbeat", async (request) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerHeartbeatRequestSchema.parse(request.body);
    return catalog.heartbeatTranscriptionJob(
      await authenticate(request),
      jobId,
      body.attempt,
      body.leaseSeconds,
      body.stage,
    );
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

  app.post("/api/transcription-jobs/:jobId/fail", async (request, reply) => {
    const { jobId } = JobParamsSchema.parse(request.params);
    const body = WorkerFailureRequestSchema.parse(request.body);
    await catalog.failTranscriptionJob(
      await authenticate(request),
      jobId,
      body,
    );
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
    return catalog.finalizeTranscript(
      await authenticate(request),
      {
        uploadId: body.uploadId,
        idempotencyKey: body.idempotencyKey,
        manifest: body.manifest,
      },
      { jobId, attempt: body.attempt },
    );
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
