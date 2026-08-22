import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import {
  ExportSettingsPreviewSchema,
  ClaimLoggedExportDeliveryResponseSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureSchema,
  LoggedExportCanceledSchema,
  StartLoggedExportExecutionResponseSchema,
  HeartbeatLoggedExportExecutionResponseSchema,
  LoggedExportSuccessSchema,
  RegisteredExportWorkerSchema,
} from "@research-video/contracts";
import {
  LocalExportQueue,
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
import {
  discardCompletedLoggedExportForCancellation,
  runLocalExportOnce,
} from "./export-run-once.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
const workerIdentity = new LocalExportWorkerIdentityRepository(database);
const capabilityProvider = new FfmpegCapabilityDiscoveryProvider();
const sourceProvider = createExportSourceAcquisitionProvider({
  mode: config.exportSourceProvider,
  ytDlpPath: config.ytDlpPath,
});
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
      inspector: new FfprobeMediaInspector(),
      renderer: new FfmpegCapabilityRangeRenderer(),
      thumbnailExtractor: new FfmpegJpegThumbnailExtractor(),
      thumbnailInspector: new FfprobeJpegThumbnailInspector(),
      capabilityProvider,
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
