import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import {
  ExportSettingsPreviewSchema,
  ExportRequestSchema,
  LoggedExportBatchSchema,
  ClipCandidateSchema,
  ArtifactVersionSummarySchema,
  ArtifactVersionHistoryResponseSchema,
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
  type CreateClipExportRequest,
  type CreateLoggedExportBatchRequest,
  type ExportSourceLanguageClass,
  type ExportSettingsSelection,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalArtifactLocatorRepository,
  LocalClipLibraryCacheRepository,
  LocalExportWorkerIdentityRepository,
  LocalDesktopSetupRepository,
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
import { withInstalledExportWorkerAvailability } from "@research-video/export-settings";

import { createLocalAgent } from "./app.ts";
import {
  LocalArtifactActionError,
  LocalArtifactLocatorService,
  resolveArtifactActionEvidence,
  resolveAuthoringArtifactEvidence,
} from "./artifact-locators.ts";
import { PlatformArtifactLauncher } from "./artifact-launcher.ts";
import { LocalClipLibraryService } from "./clip-library.ts";
import {
  ClipLibraryExportOperationService,
  createFileSystemStorageCapacityProvider,
  createPostAcquisitionExportStorageGuard,
  estimateOutputPackageBytes,
} from "./export-storage-preflight.ts";
import { runLocalSourceScratchSweep } from "./export-scratch-sweeper.ts";
import {
  discardCompletedLoggedExportForCancellation,
  runLocalExportOnce,
} from "./export-run-once.ts";
import { LocalLoggedExportSourceGroupCoordinator } from "./shared-source-group.ts";
import { LocalRuntimeCoordinator } from "./local-runtime.ts";
import { LocalDesktopSetupService } from "./desktop-setup.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
const desktopSetupRepository = new LocalDesktopSetupRepository(database);
const desktopSetup = new LocalDesktopSetupService(desktopSetupRepository, {
  measuredOperationBytes: (target) =>
    target === "output_root" ? measurePendingExportOutputBytes(exportQueue) : 0,
});
const startupReadiness = await desktopSetup.getReadinessReport();
const readyComponents = new Set(
  startupReadiness.components
    .filter((component) => component.state === "ready")
    .map((component) => component.component),
);
const storedDesktopConfig = desktopSetup.getTrustedRuntimeConfig();
const trustedDesktopConfig = {
  outputRoot: readyComponents.has("output_root")
    ? storedDesktopConfig.outputRoot
    : undefined,
  cacheRoot: readyComponents.has("cache_root")
    ? storedDesktopConfig.cacheRoot
    : undefined,
  ffmpeg: readyComponents.has("ffmpeg")
    ? storedDesktopConfig.ffmpeg
    : undefined,
  ffprobe: readyComponents.has("ffprobe")
    ? storedDesktopConfig.ffprobe
    : undefined,
  ytDlp: readyComponents.has("yt_dlp") ? storedDesktopConfig.ytDlp : undefined,
  whisperCli: readyComponents.has("whisper_cli")
    ? storedDesktopConfig.whisperCli
    : undefined,
  whisperModel: readyComponents.has("whisper_model")
    ? storedDesktopConfig.whisperModel
    : undefined,
};
const persistedDesktopSetup = desktopSetup.getSnapshot().setup;
const isDesktopRuntime = Boolean(process.env.DESKTOP_SESSION_SECRET);
const unconfiguredTool = (name: string) =>
  join(config.dataDir, ".unconfigured-tools", name);
const ffmpegPath =
  trustedDesktopConfig.ffmpeg ??
  (isDesktopRuntime ? unconfiguredTool("ffmpeg") : "ffmpeg");
const ffprobePath =
  trustedDesktopConfig.ffprobe ??
  (isDesktopRuntime ? unconfiguredTool("ffprobe") : "ffprobe");
const ytDlpPath =
  trustedDesktopConfig.ytDlp ??
  (isDesktopRuntime ? unconfiguredTool("yt-dlp") : config.ytDlpPath);
const managedExportRoot = trustedDesktopConfig.outputRoot
  ? join(trustedDesktopConfig.outputRoot, "Research Video Clips Exports")
  : join(config.dataDir, "exports");
const transcriptCacheRoot = trustedDesktopConfig.cacheRoot
  ? join(trustedDesktopConfig.cacheRoot, "Research Video Clips Cache")
  : join(config.dataDir, "transcript-cache");
await mkdir(managedExportRoot, { recursive: true });
await mkdir(transcriptCacheRoot, { recursive: true });
const runtime = new LocalRuntimeCoordinator(() =>
  exportQueue.getRuntimeQuiescenceEvidence(),
);
const mediaRunner = runtime.createTrackingMediaCommandRunner();
const artifactLocatorRepository = new LocalArtifactLocatorRepository(database);
const artifactLocators = new LocalArtifactLocatorService(
  artifactLocatorRepository,
  new PlatformArtifactLauncher(),
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
  { queue: exportQueue, dataRoot: managedExportRoot },
);
const workerIdentity = new LocalExportWorkerIdentityRepository(database);
const capabilityProvider = new FfmpegCapabilityDiscoveryProvider({
  runner: mediaRunner,
  executable: ffmpegPath,
});
const sourceProvider = createExportSourceAcquisitionProvider(
  {
    mode: persistedDesktopSetup
      ? persistedDesktopSetup.exportSourceProvider === "yt_dlp"
        ? "yt-dlp"
        : "disabled"
      : isDesktopRuntime
        ? "disabled"
        : config.exportSourceProvider,
    ytDlpPath,
  },
  mediaRunner,
);
const sourceInspector = new FfprobeMediaInspector({
  runner: mediaRunner,
  executable: ffprobePath,
});
const rangeRenderer = new FfmpegCapabilityRangeRenderer({
  runner: mediaRunner,
  executable: ffmpegPath,
});
const thumbnailExtractor = new FfmpegJpegThumbnailExtractor({
  runner: mediaRunner,
  executable: ffmpegPath,
});
const thumbnailInspector = new FfprobeJpegThumbnailInspector({
  runner: mediaRunner,
  executable: ffprobePath,
});
const sharedSourceCoordinator = sourceProvider
  ? new LocalLoggedExportSourceGroupCoordinator(
      exportQueue,
      sourceProvider,
      sourceInspector,
      managedExportRoot,
    )
  : undefined;
const cache = new VerifiedTranscriptCache(
  database,
  new HttpArtifactDownloader(),
  transcriptCacheRoot,
);
const reader = new CachedTranscriptDocumentReader(
  new LocalTranscriptIndex(database),
);
const cloudApiUrl =
  config.publicApiOrigin ??
  `http://${config.cloudApiHost}:${config.cloudApiPort}`;
const exportStorageCapacity =
  createFileSystemStorageCapacityProvider(managedExportRoot);
const exportStorageGuard = createPostAcquisitionExportStorageGuard(
  exportStorageCapacity,
);
const clipLibraryExports = new ClipLibraryExportOperationService({
  getClip: ({ projectId, clipId, authorization }) =>
    callCloudClipCandidate(projectId, clipId, authorization),
  previewSettings: async ({
    projectId,
    authorization,
    sourceLanguageClass,
    selection,
  }) =>
    withInstalledExportWorkerAvailability(
      await callCloudProjectExportSettings(
        projectId,
        sourceLanguageClass,
        selection,
        authorization,
      ),
      await capabilityProvider.discover(),
    ),
  createIndividual: ({ projectId, clipId, authorization, command }) =>
    callCloudClipExport(projectId, clipId, command, authorization),
  createReexport: ({
    projectId,
    clipId,
    artifactVersionId,
    authorization,
    command,
  }) =>
    callCloudArtifactReexport(
      projectId,
      clipId,
      artifactVersionId,
      command,
      authorization,
    ),
  createBatch: ({ projectId, authorization, command }) =>
    callCloudExportBatch(projectId, command, authorization),
  capacity: exportStorageCapacity,
});
const app = createLocalAgent({
  ...(process.env.DESKTOP_SESSION_SECRET
    ? {
        desktopSession: {
          secret: process.env.DESKTOP_SESSION_SECRET,
          origin: "rvc://app",
        },
        desktopNativeActionSecret:
          process.env.DESKTOP_NATIVE_ACTION_SECRET ?? "",
        desktopSetup,
      }
    : {}),
  runtime,
  authorizeRuntime: (authorization) =>
    callCloudRuntimeAuthorization(authorization),
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
  prepareClipLibraryExport: async (input) => {
    try {
      return await clipLibraryExports.prepare(input);
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId: input.projectId,
        authorization: input.authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      throw error;
    }
  },
  submitClipLibraryExport: async (input) => {
    try {
      return await clipLibraryExports.submit(input);
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId: input.projectId,
        authorization: input.authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      throw error;
    }
  },
  prepareAuthoringExport: async (input) => {
    try {
      return await clipLibraryExports.prepare({
        ...input,
        requestOrigin: "authoring_build",
      });
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId: input.projectId,
        authorization: input.authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      throw error;
    }
  },
  submitAuthoringExport: async (input) => {
    try {
      return await clipLibraryExports.submit({
        ...input,
        requestOrigin: "authoring_build",
      });
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId: input.projectId,
        authorization: input.authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      throw error;
    }
  },
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
  resolveArtifact: async ({
    projectId,
    clipId,
    authorization,
    requirements,
  }) => {
    try {
      return await artifactLocators.resolveArtifactHistory({
        summaries: await callCloudArtifactHistory(
          projectId,
          clipId,
          authorization,
        ),
        requirements,
        freshness: "fresh",
      });
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId,
        authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      throw error;
    }
  },
  createAuthoringArtifactDescriptor: async ({
    projectId,
    clipId,
    authorization,
    request,
  }) => {
    const identity = artifactLocators.getLocatorCloudIdentity(
      request.locatorId,
    );
    if (
      identity.projectId !== projectId ||
      identity.clipId !== clipId ||
      identity.artifactVersionId !== request.artifactVersionId
    ) {
      throw new LocalArtifactActionError("not_found", 404);
    }
    const summary = await resolveAuthoringArtifactEvidence({
      fetchCloud: () =>
        callCloudArtifactVersion(
          projectId,
          clipId,
          request.artifactVersionId,
          authorization,
        ),
      onAuthorizationDenied: (statusCode) =>
        clipLibrary.purgeRevokedAuthorization({
          projectId,
          authorization,
          statusCode,
        }),
    });
    return artifactLocators.createAuthoringDescriptor(
      request.locatorId,
      summary,
      request.requirements,
    );
  },
  actOnArtifactLocator: async ({ locatorId, authorization, action }) => {
    const identity = artifactLocators.getLocatorCloudIdentity(locatorId);
    const { summary, freshness } = await resolveArtifactActionEvidence({
      fetchCloud: () =>
        callCloudArtifactVersion(
          identity.projectId,
          identity.clipId,
          identity.artifactVersionId,
          authorization,
        ),
      findCached: () =>
        clipLibrary.findCachedArtifactVersion({ ...identity, authorization }),
      onAuthorizationDenied: (statusCode) =>
        clipLibrary.purgeRevokedAuthorization({
          projectId: identity.projectId,
          authorization,
          statusCode,
        }),
    });
    if (action === "verify") {
      return {
        locator: await artifactLocators.verifyLocator(locatorId, summary),
        freshness,
      };
    }
    return action === "reveal"
      ? artifactLocators.revealLocator(locatorId, summary, freshness)
      : artifactLocators.openLocator(locatorId, summary, freshness);
  },
  relinkArtifactLocator: async ({ locatorId, targetRootId, authorization }) => {
    const identity = artifactLocators.getLocatorCloudIdentity(locatorId);
    try {
      const summary = await callCloudArtifactVersion(
        identity.projectId,
        identity.clipId,
        identity.artifactVersionId,
        authorization,
      );
      return artifactLocators.relinkLocator(locatorId, targetRootId, summary);
    } catch (error) {
      clipLibrary.purgeRevokedAuthorization({
        projectId: identity.projectId,
        authorization,
        statusCode: (error as { statusCode?: number }).statusCode,
      });
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 401 || statusCode === 403) {
        throw new LocalArtifactActionError("not_found", 404);
      }
      throw error;
    }
  },
  listArtifactRoots: ({ authorization }) =>
    clipLibrary.hasCachedAuthorization(authorization)
      ? artifactLocators.listRoots()
      : [],
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
      storageGuard: exportStorageGuard,
      dataRoot: managedExportRoot,
      exportRoot: managedExportRoot,
    }),
  discardCompletedLoggedExportForCancellation: (requestId, reason) =>
    discardCompletedLoggedExportForCancellation(requestId, reason, {
      queue: exportQueue,
      dataRoot: managedExportRoot,
      exportRoot: managedExportRoot,
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
const localAddress = app.server.address();
if (!localAddress || typeof localAddress === "string") {
  throw new Error("Local agent did not bind a TCP loopback port.");
}
process.parentPort?.postMessage({
  type: "local-agent-ready",
  port: localAddress.port,
});
app.log.info(
  `Local agent listening on http://${config.localAgentHost}:${localAddress.port}`,
);

async function callCloudRuntimeAuthorization(
  authorization: string,
): Promise<void> {
  const response = await fetch(`${cloudApiUrl}/api/session`, {
    headers: { authorization },
  });
  if (response.ok) return;
  throw Object.assign(
    new Error("Runtime authorization could not be validated."),
    {
      statusCode: response.status,
      code:
        response.status === 401
          ? "authentication_required"
          : response.status === 403
            ? "authorization_denied"
            : "runtime_authorization_unavailable",
    },
  );
}

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
  ).catch(() => {
    throw Object.assign(new Error("Cloud artifact lookup is unreachable."), {
      statusCode: 503,
      code: "cloud_unreachable",
    });
  });
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

async function callCloudArtifactHistory(
  projectId: string,
  clipId: string,
  authorization: string,
) {
  const response = await fetch(
    `${cloudApiUrl}/api/projects/${projectId}/clips/${clipId}/artifact-versions?limit=100`,
    { headers: { authorization } },
  ).catch(() => {
    throw Object.assign(new Error("Cloud artifact history is unreachable."), {
      statusCode: 503,
      code: "cloud_unreachable",
    });
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(remote?.error?.message ?? "Cloud artifact history failed."),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "artifact_history_unavailable",
      },
    );
  }
  return ArtifactVersionHistoryResponseSchema.parse(payload).versions;
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

async function callCloudClipCandidate(
  projectId: string,
  clipId: string,
  authorization: string,
) {
  return ClipCandidateSchema.parse(
    await callCloudProjectExport(
      "GET",
      `/api/projects/${projectId}/clips/${clipId}`,
      undefined,
      authorization,
    ),
  );
}

async function callCloudProjectExportSettings(
  projectId: string,
  sourceLanguageClass: ExportSourceLanguageClass,
  selection: ExportSettingsSelection,
  authorization: string,
) {
  return ExportSettingsPreviewSchema.parse(
    await callCloudProjectExport(
      "POST",
      `/api/projects/${projectId}/export-settings/preview`,
      { sourceLanguageClass, selection },
      authorization,
    ),
  );
}

async function callCloudClipExport(
  projectId: string,
  clipId: string,
  command: CreateClipExportRequest,
  authorization: string,
) {
  return ExportRequestSchema.parse(
    await callCloudProjectExport(
      "POST",
      `/api/projects/${projectId}/clips/${clipId}/exports`,
      command,
      authorization,
    ),
  );
}

async function callCloudArtifactReexport(
  projectId: string,
  clipId: string,
  artifactVersionId: string,
  command: CreateClipExportRequest,
  authorization: string,
) {
  return ExportRequestSchema.parse(
    await callCloudProjectExport(
      "POST",
      `/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}/reexport`,
      command,
      authorization,
    ),
  );
}

async function callCloudExportBatch(
  projectId: string,
  command: CreateLoggedExportBatchRequest,
  authorization: string,
) {
  return LoggedExportBatchSchema.parse(
    await callCloudProjectExport(
      "POST",
      `/api/projects/${projectId}/export-batches`,
      command,
      authorization,
    ),
  );
}

async function callCloudProjectExport(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  authorization: string,
) {
  let response: Response;
  try {
    response = await fetch(`${cloudApiUrl}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Object.assign(new Error("Cloud export service is unreachable."), {
      code: "cloud_unreachable",
      statusCode: 503,
    });
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(remote?.error?.message ?? "Cloud export request failed."),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "clip_library_export_cloud_failed",
      },
    );
  }
  return payload;
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

function measurePendingExportOutputBytes(queue: LocalExportQueue): number {
  let measured = 0;
  for (const request of queue.list()) {
    if (
      !["queued", "processing", "needs_user_action"].includes(request.state) ||
      !request.resolvedSettingsSnapshot
    ) {
      continue;
    }
    const output = estimateOutputPackageBytes(
      request.selection.exportEndMs - request.selection.exportStartMs,
      request.resolvedSettingsSnapshot.settings,
    );
    measured += output * 2;
    if (!Number.isSafeInteger(measured)) {
      throw new Error(
        "Pending export storage measurement exceeds safe bounds.",
      );
    }
  }
  return measured;
}
