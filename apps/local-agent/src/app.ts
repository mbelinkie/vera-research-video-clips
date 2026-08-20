import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  CreateExportOnlyRequestSchema,
  ExportSettingsPreviewRequestSchema,
  type CreateExportOnlyRequest,
  type ExportRequest,
  type ExportSettingsPreview,
  type ExportSettingsPreviewRequest,
  type ResolvedExportSettingsSnapshot,
  HealthResponseSchema,
} from "@research-video/contracts";
import {
  validateStoredResolvedSettingsSnapshot,
  withInstalledExportWorkerAvailability,
  type ExportWorkerCapabilityProvider,
} from "@research-video/export-settings";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";

export interface LocalAgentDependencies {
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
}

const TranscriptParamsSchema = z.object({
  projectId: z.uuid(),
  videoId: z.uuid(),
});

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

  if (dependencies?.listExportRequests) {
    app.get("/api/exports", async () => dependencies.listExportRequests!());
  }

  return app;
}
