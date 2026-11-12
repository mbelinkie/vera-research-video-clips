import type { BrowserAuth } from "./browser-auth/routes.ts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import { AuthenticationError } from "@research-video/auth";
import type { SharedProjectCatalog } from "@research-video/catalog";
import { pilotBackupGateIsActive } from "@research-video/db-cloud";
import {
  LocalStagedUploadUrlIssuer,
  type TranscriptObjectStore,
} from "@research-video/storage";
import { createHash } from "node:crypto";
import {
  AddProjectMemberRequestSchema,
  AddProjectVideoRequestSchema,
  BatchPreflightRequestSchema,
  BatchPreflightResponseSchema,
  CreateClipCandidateRequestSchema,
  CreateClipExportRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  CreateProjectRequestSchema,
  RemoveProjectMemberRequestSchema,
  TranscriptionBatchControlRequestSchema,
  TransferProjectOwnershipRequestSchema,
  UpdateProjectMemberRequestSchema,
  UpdateReviewStatusRequestSchema,
  UpdateClipCandidateRequestSchema,
  FinalizeTranscriptRequestSchema,
  HealthResponseSchema,
  WorkerClaimRequestSchema,
  WorkerFailureRequestSchema,
  WorkerCreateTranscriptUploadRequestSchema,
  WorkerFinalizeTranscriptRequestSchema,
  WorkerHeartbeatRequestSchema,
  WorkerSourcePlanRequestSchema,
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
  browserAuth?: BrowserAuth;
  authenticate(request: FastifyRequest): Promise<AuthenticatedActor>;
  videoMetadataProvider?: VideoMetadataProvider;
  localArtifacts?: {
    store: TranscriptObjectStore;
    issuer: LocalStagedUploadUrlIssuer;
    objectRoot: string;
  };
}

const IdParamsSchema = z.object({ projectId: z.uuid() });
const ProjectMemberParamsSchema = IdParamsSchema.extend({ userId: z.uuid() });
const ProjectVideoParamsSchema = IdParamsSchema.extend({ videoId: z.uuid() });
const ProjectClipParamsSchema = IdParamsSchema.extend({ clipId: z.uuid() });
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
  // Signed local-object capabilities may exceed Fastify's default 100-byte
  // dynamic parameter limit; the verifier still caps and validates the token.
  const app = Fastify({
    logger: false,
    routerOptions: { maxParamLength: 4_096 },
    rewriteUrl: (request) =>
      dependencies?.browserAuth && request.url?.startsWith("/cloud-api/")
        ? request.url.slice("/cloud-api".length)
        : (request.url ?? "/"),
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as Error & { statusCode?: number; code?: string };
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
  const { catalog, authenticate, browserAuth } = dependencies;
  browserAuth?.routes(app);

  if (dependencies.localArtifacts) {
    const { store, issuer, objectRoot } = dependencies.localArtifacts;
    // The operator creates the filesystem gate before a backup. Check once
    // before admitting a write and again after incrementing the in-flight
    // count, so a write racing with gate creation cannot escape the drain.
    let inFlightWrites = 0;
    const registered = new WeakSet<FastifyRequest>();
    const finish = (request: FastifyRequest) => {
      if (registered.delete(request)) inFlightWrites--;
    };
    app.addHook("onRequest", async (request) => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
      if (await pilotBackupGateIsActive(objectRoot)) {
        throw new PilotWritesBlockedError();
      }
      registered.add(request);
      inFlightWrites++;
      if (await pilotBackupGateIsActive(objectRoot)) {
        finish(request);
        throw new PilotWritesBlockedError();
      }
    });
    app.addHook("onResponse", async (request) => {
      finish(request);
    });
    app.addHook("onRequestAbort", async (request) => {
      finish(request);
    });
    app.get("/__maintenance/status", async () => ({
      writesBlocked: await pilotBackupGateIsActive(objectRoot),
      inFlightWrites,
    }));
    // Encapsulated parser: never alter the ordinary JSON catalog API. The
    // capabilities are issued after authorization by the catalog; no caller
    // can choose a filesystem path or unpinned download version.
    app.register(async (local) => {
      local.removeContentTypeParser("application/json");
      local.removeContentTypeParser("text/plain");
      local.addContentTypeParser(
        "*",
        { parseAs: "buffer", bodyLimit: 32 * 1024 * 1024 },
        (_request, body, done) => done(null, body),
      );
      local.put(
        "/__objects/:token",
        { bodyLimit: 32 * 1024 * 1024 },
        async (request, reply) => {
          const token = z
            .object({ token: z.string() })
            .parse(request.params).token;
          const capability = issuer.verify(token, "PUT");
          const data = request.body;
          if (!Buffer.isBuffer(data))
            return reply
              .code(415)
              .send({ error: "Binary request body required" });
          const contentType = request.headers["content-type"];
          if (
            typeof contentType !== "string" ||
            !contentType ||
            contentType.length > 200
          ) {
            return reply.code(415).send({ error: "Content type required" });
          }
          const stored = await store.put({
            key: capability.key,
            bytes: data,
            contentType,
            sha256: createHash("sha256").update(data).digest("hex"),
          });
          return reply
            .header("x-amz-version-id", stored.versionId)
            .code(200)
            .send();
        },
      );
      local.get("/__objects/:token", async (request, reply) => {
        const token = z
          .object({ token: z.string() })
          .parse(request.params).token;
        const capability = issuer.verify(token, "GET");
        const found = await store.get(capability.key, capability.versionId);
        if (!found)
          return reply.code(404).send({ error: "Object version not found" });
        return reply
          .header("x-amz-version-id", found.versionId)
          .type(found.contentType)
          .send(Buffer.from(found.bytes));
      });
    });
  }

  app.post("/api/session/register", async (request) => {
    const body = z
      .strictObject({ displayName: z.string().trim().min(1).max(160) })
      .parse(request.body);
    if (browserAuth) return browserAuth.register(request, body.displayName);
    return catalog.registerUser(await authenticate(request), body.displayName);
  });

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

  app.get("/api/projects/:projectId/members", async (request) => {
    const { projectId } = IdParamsSchema.parse(request.params);
    return catalog.listMembers(await authenticate(request), projectId);
  });

  app.patch(
    "/api/projects/:projectId/members/:userId",
    async (request, reply) => {
      const { projectId, userId } = ProjectMemberParamsSchema.parse(
        request.params,
      );
      const body = UpdateProjectMemberRequestSchema.parse(request.body);
      await catalog.changeMemberRole(
        await authenticate(request),
        projectId,
        userId,
        body.role,
        body.expectedVersion,
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/projects/:projectId/members/:userId",
    async (request, reply) => {
      const { projectId, userId } = ProjectMemberParamsSchema.parse(
        request.params,
      );
      const { expectedVersion } = RemoveProjectMemberRequestSchema.parse(
        request.body,
      );
      await catalog.removeMember(
        await authenticate(request),
        projectId,
        userId,
        expectedVersion,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/projects/:projectId/members/transfer",
    async (request, reply) => {
      const { projectId } = IdParamsSchema.parse(request.params);
      const body = TransferProjectOwnershipRequestSchema.parse(request.body);
      await catalog.transferOwnership(
        await authenticate(request),
        projectId,
        body.targetUserId,
        body.expectedOwnerVersion,
        body.expectedTargetVersion,
      );
      return reply.status(204).send();
    },
  );

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

class PilotWritesBlockedError extends Error {
  readonly statusCode = 503;
  readonly code = "pilot_backup_in_progress";
  constructor() {
    super("Pilot writes are paused for a backup");
  }
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
