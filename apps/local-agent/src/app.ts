import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  CreateExportOnlyRequestSchema,
  type CreateExportOnlyRequest,
  type ExportRequest,
  HealthResponseSchema,
} from "@research-video/contracts";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";

import type { CutClipResult, CutLoggedClipsRequest } from "./clip-cutter.ts";

export interface LocalAgentDependencies {
  resolveTranscript?(input: {
    projectId: string;
    catalogVideoId: string;
    authorization: string;
  }): Promise<WorkspaceTranscriptResolution>;
  createExportOnly?(input: CreateExportOnlyRequest): ExportRequest;
  listExportRequests?(): ExportRequest[];
  cutLoggedClips?(input: CutLoggedClipsRequest): Promise<CutClipResult[]>;
}

const TranscriptParamsSchema = z.object({
  projectId: z.uuid(),
  videoId: z.uuid(),
});
const ClipCutParamsSchema = z.object({ projectId: z.uuid() });
const ClipCutBodySchema = z
  .object({
    clipIds: z.array(z.uuid()).min(1).max(20),
    authorizationConfirmed: z.literal(true),
  })
  .strict()
  .refine((body) => new Set(body.clipIds).size === body.clipIds.length, {
    message: "Duplicate clip IDs are not allowed.",
  });

class LocalAuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
}

class LocalClipCutError extends Error {
  readonly statusCode = 422;
  readonly code = "clip_cut_failed";
}

/** Single-line actionable error without URLs, credentials or arbitrary subprocess output. */
export function safeClipCutMessage(error: unknown): string {
  const raw =
    error instanceof Error && !(error instanceof ZodError)
      ? error.message
      : "The clip cut request could not be processed.";
  const sanitized = raw
    .replaceAll(/https?:\/\/\S+/giu, "[source URL]")
    .replaceAll(/\bBearer\s+\S+/giu, "Bearer [redacted]")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 240)
    .replaceAll(/[.!?]+$/gu, "");
  return `${sanitized || "Clip cutting failed"}.`;
}

export function createLocalAgent(
  dependencies?: LocalAgentDependencies,
): FastifyInstance {
  const app = Fastify({ logger: false });

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
      service: "local-agent",
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );

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

  if (dependencies?.cutLoggedClips) {
    app.post("/api/projects/:projectId/clips/cut", async (request) => {
      const { projectId } = ClipCutParamsSchema.parse(request.params);
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer\s+[^\s]+$/u.test(authorization)) {
        throw new LocalAuthenticationError(
          "A project bearer credential is required to cut logged clips.",
        );
      }
      const body = ClipCutBodySchema.parse(request.body);
      try {
        const clips = await dependencies.cutLoggedClips!({
          projectId,
          clipIds: body.clipIds,
          authorization,
          authorizationConfirmed: true,
        });
        return { clips };
      } catch (error) {
        if (error instanceof Error && "statusCode" in error) throw error;
        throw new LocalClipCutError(safeClipCutMessage(error));
      }
    });
  }

  if (dependencies?.createExportOnly) {
    app.post("/api/exports", async (request, reply) => {
      const created = dependencies.createExportOnly!(
        CreateExportOnlyRequestSchema.parse(request.body),
      );
      return reply.status(201).send(created);
    });
  }

  if (dependencies?.listExportRequests) {
    app.get("/api/exports", async () => dependencies.listExportRequests!());
  }

  return app;
}
