import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import {
  ExportSettingsPreviewSchema,
  ArtifactVersionSummarySchema,
  ClipLibraryPageSchema,
  ClipLibraryQuerySchema,
  ClaimLoggedExportDeliveryResponseSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureSchema,
  LoggedExportCanceledSchema,
  StartLoggedExportExecutionResponseSchema,
  HeartbeatLoggedExportExecutionResponseSchema,
  LoggedExportSuccessSchema,
  RegisteredExportWorkerSchema,
  type ClipLibraryQuery,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalArtifactLocatorRepository,
  LocalClipLibraryCacheRepository,
  LocalExportWorkerIdentityRepository,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  CachedTranscriptDocumentReader,
  HttpActiveTranscriptCatalogClient,
  HttpArtifactDownloader,
  SharedFirstTranscriptResolver,
  SharedTranscriptWorkspaceService,
  VerifiedTranscriptCache,
} from "@research-video/sync";
import {
  createExportSourceAcquisitionProvider,
  FfmpegCapabilityDiscoveryProvider,
  FfmpegCapabilityRangeRenderer,
  FfmpegJpegThumbnailExtractor,
  FfprobeJpegThumbnailInspector,
  FfprobeMediaInspector,
} from "@research-video/media";

import { createLocalAgent } from "./app.ts";
import { LocalArtifactLocatorService } from "./artifact-locators.ts";
import { LocalClipLibraryService } from "./clip-library.ts";
import { runLocalSourceScratchSweep } from "./export-scratch-sweeper.ts";
import {
  discardCompletedLoggedExportForCancellation,
  runLocalExportOnce,
} from "./export-run-once.ts";
import { LocalLoggedExportSourceGroupCoordinator } from "./shared-source-group.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const managedExportRoot = join(config.dataDir, "exports");
await mkdir(managedExportRoot, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
const artifactLocatorRepository = new LocalArtifactLocatorRepository(database);
const artifactLocators = new LocalArtifactLocatorService(
  artifactLocatorRepository,
);
const clipLibrary = new LocalClipLibraryService(
  new LocalClipLibraryCacheRepository(database),
  artifactLocatorRepository,
);
await artifactLocators.configureRoot({
  label: "Managed exports",
  platform: process.platform === "win32" ? "windows" : "posix",
  absolutePath: managedExportRoot,
});
await runLocalSourceScratchSweep(
  { recoverOrphanedGroups: true },
  { queue: exportQueue, dataRoot: config.dataDir },
);
const workerIdentity = new LocalExportWorkerIdentityRepository(database);
const capabilityProvider = new FfmpegCapabilityDiscoveryProvider();
const sourceProvider = createExportSourceAcquisitionProvider({
  mode: config.exportSourceProvider,
  ytDlpPath: config.ytDlpPath,
});
const sourceInspector = new FfprobeMediaInspector();
const rangeRenderer = new FfmpegCapabilityRangeRenderer();
const thumbnailExtractor = new FfmpegJpegThumbnailExtractor();
const thumbnailInspector = new FfprobeJpegThumbnailInspector();
const sharedSourceCoordinator = sourceProvider
  ? new LocalLoggedExportSourceGroupCoordinator(
      exportQueue,
      sourceProvider,
      sourceInspector,
      config.dataDir,
    )
  : undefined;
const cache = new VerifiedTranscriptCache(
  database,
  new HttpArtifactDownloader(),
  join(config.dataDir, "transcript-cache"),
);
const reader = new CachedTranscriptDocumentReader(
  new LocalTranscriptIndex(database),
);
const cloudApiUrl = `http://${config.cloudApiHost}:${config.cloudApiPort}`;
const app = createLocalAgent({
  resolveClipLibrary: ({ projectId, authorization, query }) =>
    clipLibrary.resolvePage({
      projectId,
      authorization,
      query,
      fetchCloud: () => callCloudClipLibrary(projectId, query, authorization),
    }),
  resolveLatestClipLibrary: ({ projectId, authorization }) =>
    clipLibrary.resolveLatestPage({
      projectId,
      authorization,
      fetchCloud: (query) =>
        callCloudClipLibrary(projectId, query, authorization),
    }),
  updateClipLibrarySelection: ({ projectId, authorization, command }) =>
    clipLibrary.updateSelection({ projectId, authorization, command }),
  resolveArtifactVersion: async ({
    projectId,
    clipId,
    artifactVersionId,
    authorization,
  }) =>
    callCloudArtifactVersion(
      projectId,
      clipId,
      artifactVersionId,
      authorization,
    ),
  verifyArtifactVersion: ({ rootId, artifactVersion }) =>
    artifactLocators.verifyArtifactVersion(rootId, artifactVersion),
  capabilityProvider,
  workerIdentity,
  registerExportWorker: async ({ request, authorization }) =>
    callCloudExportWorker(
      "PUT",
      "/api/export-workers/self",
      request,
      authorization,
    ),
  heartbeatExportWorker: async ({ request, authorization }) =>
    callCloudExportWorker(
      "POST",
      "/api/export-workers/self/heartbeat",
      request,
      authorization,
    ),
  claimLoggedExportDelivery: async ({ request, authorization }) =>
    callCloudLoggedExportDeliveryClaim(request, authorization),
  acceptLoggedExportDelivery: async ({ request, authorization }) =>
    callCloudLoggedExportDeliveryAccept(request, authorization),
  importLoggedDeliveryPending: (delivery) =>
    exportQueue.importLoggedDeliveryPending(delivery),
  activateLoggedDelivery: (delivery) =>
    exportQueue.activateLoggedDelivery(delivery),
  rejectPendingLoggedDelivery: (delivery) =>
    exportQueue.rejectPendingLoggedDelivery(delivery),
  getPendingLoggedDelivery: () => exportQueue.getPendingLoggedDelivery(),
  getAcceptedLoggedDelivery: (requestId) =>
    exportQueue.getAcceptedLoggedDelivery(requestId),
  buildLoggedExportSuccessResult: (requestId) =>
    exportQueue.buildLoggedExportSuccessResult(requestId),
  buildLoggedExportFailureResult: (requestId) =>
    exportQueue.buildLoggedExportFailureResult(requestId),
  buildLoggedExportCanceledResult: (requestId) =>
    exportQueue.buildLoggedExportCanceledResult(requestId),
  getLoggedExecution: (requestId) => exportQueue.getLoggedExecution(requestId),
  getLoggedExportProgress: (requestId) =>
    exportQueue.getLoggedExportProgress(requestId),
  reconcileLoggedExportProgress: (progress) =>
    exportQueue.reconcileLoggedExportProgress(progress),
  startLoggedExportExecution: async ({ request, authorization }) =>
    callCloudLoggedExportExecutionStart(request, authorization),
  heartbeatLoggedExportExecution: async ({ request, authorization }) =>
    callCloudLoggedExportExecutionHeartbeat(request, authorization),
  activateLoggedExecution: (execution) =>
    exportQueue.activateLoggedExecution(execution),
  recordLoggedExecutionHeartbeat: (execution) =>
    exportQueue.recordLoggedExecutionHeartbeat(execution),
  recordLoggedExportNotStartedCancellation: (
    requestId,
    reason,
    cancelRequestedAt,
  ) =>
    exportQueue.recordLoggedExportNotStartedCancellation(
      requestId,
      reason,
      cancelRequestedAt,
    ),
  recordLoggedExportPersistedFailureCancellation: (
    requestId,
    reason,
    cancelRequestedAt,
  ) =>
    exportQueue.recordLoggedExportPersistedFailureCancellation(
      requestId,
      reason,
      cancelRequestedAt,
    ),
  runLoggedExportOnce: (input) =>
    runLocalExportOnce(input, {
      queue: exportQueue,
      ...(sourceProvider ? { sourceProvider } : {}),
      inspector: sourceInspector,
      renderer: rangeRenderer,
      thumbnailExtractor,
      thumbnailInspector,
      capabilityProvider,
      ...(sharedSourceCoordinator ? { sharedSourceCoordinator } : {}),
      dataRoot: config.dataDir,
    }),
  discardCompletedLoggedExportForCancellation: (requestId, reason) =>
    discardCompletedLoggedExportForCancellation(requestId, reason, {
      queue: exportQueue,
      dataRoot: config.dataDir,
    }),
  reconcileLoggedExportSuccess: async ({ request, authorization }) =>
    callCloudLoggedExportSuccessReconcile(request, authorization),
  reconcileLoggedExportFailure: async ({ request, authorization }) =>
    callCloudLoggedExportFailureReconcile(request, authorization),
  reconcileLoggedExportCanceled: async ({ request, authorization }) =>
    callCloudLoggedExportCanceledReconcile(request, authorization),
  createExportOnly: (input, snapshot) =>
    exportQueue.createExportOnly(input, snapshot),
  findExportOnlyByIdempotencyKey: (idempotencyKey) =>
    exportQueue.getByIdempotencyKey(idempotencyKey),
  previewExportSettings: async ({ request, authorization }) => {
    const response = await fetch(`${cloudApiUrl}/api/export-settings/preview`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const remote = payload as
        { error?: { code?: string; message?: string } } | undefined;
      throw Object.assign(
        new Error(
          remote?.error?.message ??
            `Cloud export-settings preview failed with HTTP ${response.status}.`,
        ),
        {
          statusCode: response.status,
          code: remote?.error?.code ?? "export_settings_preview_unavailable",
        },
      );
    }
    return ExportSettingsPreviewSchema.parse(payload);
  },
  listExportRequests: () => exportQueue.list(),
  resolveTranscript: async ({ projectId, catalogVideoId, authorization }) =>
    new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        new HttpActiveTranscriptCatalogClient(cloudApiUrl, authorization),
        cache,
      ),
      reader,
    ).resolve(projectId, catalogVideoId),
});
app.addHook("onClose", () => database.close());

await app.listen({ host: config.localAgentHost, port: config.localAgentPort });
app.log.info(
  `Local agent listening on http://${config.localAgentHost}:${config.localAgentPort}`,
);

async function callCloudExportWorker(
  method: "PUT" | "POST",
  path: string,
  request: unknown,
  authorization: string,
) {
  const response = await fetch(`${cloudApiUrl}${path}`, {
    method,
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(
        remote?.error?.message ??
          `Cloud export-worker request failed with HTTP ${response.status}.`,
      ),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "export_worker_registration_unavailable",
      },
    );
  }
  return RegisteredExportWorkerSchema.parse(payload);
}

async function callCloudArtifactVersion(
  projectId: string,
  clipId: string,
  artifactVersionId: string,
  authorization: string,
) {
  const response = await fetch(
    `${cloudApiUrl}/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}`,
    { headers: { authorization } },
  );
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(
        remote?.error?.message ??
          `Cloud artifact-version lookup failed with HTTP ${response.status}.`,
      ),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "artifact_version_unavailable",
      },
    );
  }
  return ArtifactVersionSummarySchema.parse(payload);
}

async function callCloudClipLibrary(
  projectId: string,
  query: ClipLibraryQuery,
  authorization: string,
) {
  const parsed = ClipLibraryQuerySchema.parse(query);
  const parameters = new URLSearchParams({
    limit: String(parsed.limit),
    completed: parsed.completed,
  });
  if (parsed.cursor) parameters.set("cursor", parsed.cursor);
  if (parsed.query) parameters.set("query", parsed.query);
  if (parsed.tag) parameters.set("tag", parsed.tag);
  if (parsed.researchStatus)
    parameters.set("researchStatus", parsed.researchStatus);
  if (parsed.exportStatus) parameters.set("exportStatus", parsed.exportStatus);
  let response: Response;
  try {
    response = await fetch(
      `${cloudApiUrl}/api/projects/${projectId}/clip-library?${parameters}`,
      { headers: { authorization } },
    );
  } catch {
    throw Object.assign(new Error("Cloud Clip Library is unreachable."), {
      code: "cloud_unreachable",
      statusCode: 503,
    });
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(remote?.error?.message ?? "Cloud Clip Library request failed."),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "clip_library_cloud_failed",
      },
    );
  }
  return ClipLibraryPageSchema.parse(payload);
}

async function callCloudLoggedExportDeliveryClaim(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/claim",
    request,
    authorization,
  );
  return ClaimLoggedExportDeliveryResponseSchema.parse(payload);
}

async function callCloudLoggedExportDeliveryAccept(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/accept",
    request,
    authorization,
  );
  return LoggedExportDeliverySchema.parse(payload);
}

async function callCloudLoggedExportSuccessReconcile(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/reconcile-success",
    request,
    authorization,
  );
  return LoggedExportSuccessSchema.parse(payload);
}

async function callCloudLoggedExportFailureReconcile(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/reconcile-failure",
    request,
    authorization,
  );
  return LoggedExportFailureSchema.parse(payload);
}

async function callCloudLoggedExportExecutionStart(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/execution/start",
    request,
    authorization,
  );
  return StartLoggedExportExecutionResponseSchema.parse(payload);
}

async function callCloudLoggedExportExecutionHeartbeat(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/execution/heartbeat",
    request,
    authorization,
  );
  return HeartbeatLoggedExportExecutionResponseSchema.parse(payload);
}

async function callCloudLoggedExportCanceledReconcile(
  request: unknown,
  authorization: string,
) {
  const payload = await callCloudDelivery(
    "/api/export-deliveries/reconcile-canceled",
    request,
    authorization,
  );
  return LoggedExportCanceledSchema.parse(payload);
}

async function callCloudDelivery(
  path: string,
  request: unknown,
  authorization: string,
) {
  const response = await fetch(`${cloudApiUrl}${path}`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(
        remote?.error?.message ??
          `Cloud export delivery failed with HTTP ${response.status}.`,
      ),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "export_delivery_unavailable",
      },
    );
  }
  return payload;
}
