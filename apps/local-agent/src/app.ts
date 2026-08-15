import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  CreateExportOnlyRequestSchema,
  type CreateExportOnlyRequest,
  type ExportRequest,
  HealthResponseSchema,
} from "@research-video/contracts";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";

export interface LocalAgentDependencies {
  resolveTranscript?(input: {
    projectId: string;
    catalogVideoId: string;
    authorization: string;
  }): Promise<WorkspaceTranscriptResolution>;
  createExportOnly?(input: CreateExportOnlyRequest): ExportRequest;
  listExportRequests?(): ExportRequest[];
}

const TranscriptParamsSchema = z.object({
  projectId: z.uuid(),
  videoId: z.uuid(),
});

class LocalAuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
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
