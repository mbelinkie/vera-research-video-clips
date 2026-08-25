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
  ProcessAcceptedLoggedExportResponseSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureSchema,
  LoggedExportCanceledSchema,
  StartLoggedExportExecutionResponseSchema,
  HeartbeatLoggedExportExecutionResponseSchema,
  LoggedExportSuccessSchema,
  RegisteredExportWorkerSchema,
  DerivedTranslationIdentitySchema,
  ClipCommentSchema,
  ProjectBookmarkMutationResponseSchema,
  ProjectBookmarkPageSchema,
  ProjectBookmarkQuerySchema,
  type ClipLibraryQuery,
  type CreateClipExportRequest,
  type CreateLoggedExportBatchRequest,
  type ExportSourceLanguageClass,
  type ExportSettingsSelection,
  type ProjectBookmarkQuery,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalArtifactLocatorRepository,
  LocalClipLibraryCacheRepository,
  LocalExportWorkerIdentityRepository,
  LocalDesktopSetupRepository,
  LocalProjectBookmarkRepository,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  CachedTranscriptDocumentReader,
  HttpActiveTranscriptCatalogClient,
  HttpArtifactDownloader,
  SharedDerivedTranslationResolver,
  SharedFirstTranscriptResolver,
  SharedTranscriptWorkspaceService,
  VerifiedTranscriptCache,
  OfflineOutbox,
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
import { CloudDerivedTranslationClient } from "./derived-translation-client.ts";
import { LocalExportSupervisor } from "./export-supervisor.ts";
import {
  ClipCommentOutboxService,
  type ClipCommentCloudCommand,
} from "./comment-outbox.ts";
import {
  BookmarkOutboxService,
  type BookmarkOutboxCommand,
} from "./bookmark-outbox.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
const commentOutbox = new ClipCommentOutboxService(
  new OfflineOutbox(database),
  {
    send: callCloudClipComment,
    authorizationRevoked: (projectId, authorization, statusCode) =>
      clipLibrary.purgeRevokedAuthorization({
        projectId,
        authorization,
        statusCode,
      }),
  },
);
const bookmarkOutbox = new BookmarkOutboxService(
  new LocalProjectBookmarkRepository(database),
  {
    list: ({ projectId, query, authorization }) =>
      callCloudProjectBookmarks(projectId, query, authorization),
    send: callCloudProjectBookmarkCommand,
  },
);
let exportSupervisor: LocalExportSupervisor | undefined;
const desktopSetupRepository = new LocalDesktopSetupRepository(database);
const desktopSetup = new LocalDesktopSetupService(desktopSetupRepository, {
  measuredOperationBytes: (target) =>
    target === "output_root" ? measurePendingExportOutputBytes(exportQueue) : 0,
  exportWorkerStatus: () => {
    const snapshot = exportSupervisor?.snapshot();
    const available =
      snapshot?.enabled === true &&
      ["idle", "processing_logged", "processing_export_only"].includes(
        snapshot.state,
      );
    return {
      available,
      ...(snapshot?.issue ? { issue: snapshot.issue } : {}),
    };
  },
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
const transcriptIndex = new LocalTranscriptIndex(database);
const reader = new CachedTranscriptDocumentReader(
  transcriptIndex,
  transcriptCacheRoot,
);
const cloudApiUrl =
  config.publicApiOrigin ??
  `http://${config.cloudApiHost}:${config.cloudApiPort}`;

function derivedTranslationIdentity(input: {
  projectId: string;
  catalogVideoId: string;
  transcriptVersionId: string;
  preferredLanguage: string;
  original: {
    track: {
      id: string;
      contentSha256: string;
      schemaVersion: number;
    };
  };
}) {
  return DerivedTranslationIdentitySchema.parse({
    projectId: input.projectId,
    catalogVideoId: input.catalogVideoId,
    baseTranscriptVersionId: input.transcriptVersionId,
    originalTrackId: input.original.track.id,
    originalContentSha256: input.original.track.contentSha256,
    targetLanguage: input.preferredLanguage,
    provider: "amazon-translate",
    normalizationSchemaVersion: input.original.track.schemaVersion,
  });
}
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
const executeLocalExport = (input: {
  requestId: string;
  authorizationConfirmed: boolean;
  signal?: AbortSignal;
  requireLoggedExecution?: boolean;
}) =>
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
  });

let app!: ReturnType<typeof createLocalAgent>;
const desktopSessionSecret = process.env.DESKTOP_SESSION_SECRET;
if (desktopSessionSecret) {
  exportSupervisor = new LocalExportSupervisor({
    canRun: async () => {
      const snapshot = desktopSetup.getSnapshot();
      if (!snapshot.setup?.workerEnabled) return false;
      const readiness = await desktopSetup.getReadinessReport();
      const health = new Map(
        readiness.components.map((component) => [
          component.component,
          component.state,
        ]),
      );
      return (
        [
          "output_root",
          "export_source_provider",
          "ffmpeg",
          "ffprobe",
          "yt_dlp",
          "output_storage",
        ] as const
      ).every((component) => {
        const state = health.get(component);
        return (
          state === "ready" ||
          (component === "output_storage" && state === "degraded")
        );
      });
    },
    isDraining: () => runtime.isDraining(),
    register: async () => {
      await injectAutomaticExportRoute("/api/export-workers/register");
    },
    heartbeat: async () => {
      await injectAutomaticExportRoute("/api/export-workers/heartbeat");
    },
    nextAcceptedLoggedRequestId: () =>
      exportQueue.getNextRunnableAcceptedLoggedDelivery()?.request.id,
    claimLoggedRequestId: async () => {
      const response = ClaimLoggedExportDeliveryResponseSchema.parse(
        await injectAutomaticExportRoute("/api/export-deliveries/claim"),
      );
      return response.delivery?.request.id;
    },
    processLogged: async (requestId) => {
      const response = ProcessAcceptedLoggedExportResponseSchema.parse(
        await injectAutomaticExportRoute("/api/export-deliveries/process", {
          requestId,
          authorizationConfirmed: true,
        }),
      );
      exportQueue.markLoggedExportReconciled(
        requestId,
        response.execution === "complete" ||
          response.execution === "already_complete"
          ? "success"
          : response.execution === "failed"
            ? "failure"
            : "canceled",
      );
    },
    nextExportOnlyRequestId: () => exportQueue.getNextRunnableExportOnly()?.id,
    processExportOnly: async (requestId) => {
      await executeLocalExport({
        requestId,
        authorizationConfirmed: true,
      });
    },
  });
}

app = createLocalAgent({
  ...(process.env.DESKTOP_SESSION_SECRET
    ? {
        desktopSession: {
          secret: process.env.DESKTOP_SESSION_SECRET,
          origin: "rvc://app",
        },
        desktopNativeActionSecret:
          process.env.DESKTOP_NATIVE_ACTION_SECRET ?? "",
        desktopSetup,
        ...(exportSupervisor ? { exportSupervisor } : {}),
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
  createClipComment: ({ projectId, clipId, authorization, request }) =>
    commentOutbox.create(projectId, clipId, authorization, request),
  updateClipComment: ({
    projectId,
    clipId,
    commentId,
    authorization,
    request,
  }) =>
    commentOutbox.update(projectId, clipId, commentId, authorization, request),
  deleteClipComment: ({
    projectId,
    clipId,
    commentId,
    authorization,
    request,
  }) =>
    commentOutbox.delete(projectId, clipId, commentId, authorization, request),
  replayClipComments: ({ projectId, authorization }) =>
    commentOutbox.replay(projectId, authorization),
  listClipCommentConflicts: ({ projectId }) =>
    commentOutbox.conflicts(projectId),
  listProjectBookmarks: ({ projectId, authorization, query }) =>
    bookmarkOutbox.list(projectId, authorization, query),
  createProjectBookmark: ({ projectId, authorization, request }) =>
    bookmarkOutbox.create(projectId, authorization, request),
  updateProjectBookmark: ({ projectId, bookmarkId, authorization, request }) =>
    bookmarkOutbox.update(projectId, bookmarkId, authorization, request),
  changeProjectBookmarkState: ({
    projectId,
    bookmarkId,
    action,
    authorization,
    request,
  }) =>
    bookmarkOutbox.changeState(
      projectId,
      bookmarkId,
      action,
      authorization,
      request,
    ),
  replayProjectBookmarks: ({ projectId, authorization }) =>
    bookmarkOutbox.replay(projectId, authorization),
  listProjectBookmarkOutbox: ({ projectId, authorization }) =>
    bookmarkOutbox.listOutbox(projectId, authorization),
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
  runLoggedExportOnce: (input) => executeLocalExport(input),
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
  createExportOnly: (input, snapshot, notificationAccountScopeSha256) =>
    exportQueue.createExportOnly(
      input,
      snapshot,
      notificationAccountScopeSha256,
    ),
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
  listLocalNotificationFeed: (accountScopeSha256, query) =>
    exportQueue.listNotificationFeed(accountScopeSha256, query),
  resolveTranscript: async ({
    projectId,
    catalogVideoId,
    authorization,
    preferredLanguage,
    offlineReviewCapability,
  }) =>
    new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        new HttpActiveTranscriptCatalogClient(cloudApiUrl, authorization),
        new VerifiedTranscriptCache(
          database,
          new HttpArtifactDownloader({
            origin: cloudApiUrl,
            authorization,
          }),
          transcriptCacheRoot,
        ),
      ),
      reader,
      {
        findLocal: async (input) =>
          transcriptIndex.findDerivedTranslation(
            derivedTranslationIdentity(input),
          ),
        findShared: async (input) => {
          const identity = derivedTranslationIdentity(input);
          const client = new CloudDerivedTranslationClient(
            cloudApiUrl,
            authorization,
          );
          return (
            await new SharedDerivedTranslationResolver(
              {
                getDerivedTranslation: (candidate) =>
                  client.lookupDerivedTranslation(candidate),
              },
              transcriptIndex,
            ).resolve(identity)
          )?.transcript;
        },
      },
    ).resolveWorkspace(
      projectId,
      catalogVideoId,
      preferredLanguage,
      offlineReviewCapability,
    ),
});
app.addHook("onClose", async () => {
  await exportSupervisor?.stop();
  database.close();
});

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

async function injectAutomaticExportRoute(
  url: string,
  payload?: unknown,
): Promise<unknown> {
  if (!desktopSessionSecret) {
    throw Object.assign(
      new Error("Desktop export scheduling is unavailable."),
      {
        statusCode: 401,
        code: "authentication_required",
      },
    );
  }
  const headers = {
    authorization: `Bearer ${desktopSessionSecret}`,
    origin: "rvc://app",
    "x-research-video-session": desktopSessionSecret,
  };
  const response =
    payload === undefined
      ? await app.inject({ method: "POST", url, headers })
      : await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "content-type": "application/json" },
          payload: JSON.stringify(payload),
        });
  const body = response.json() as { error?: { code?: unknown } } & Record<
    string,
    unknown
  >;
  if (response.statusCode >= 400) {
    const code =
      typeof body.error?.code === "string"
        ? body.error.code
        : "export_worker_unavailable";
    throw Object.assign(
      new Error("Automatic export scheduling could not continue."),
      { statusCode: response.statusCode, code },
    );
  }
  return body;
}

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
  if (parsed.topics?.length) parameters.set("topics", parsed.topics.join(","));
  if (parsed.topicMatch) parameters.set("topicMatch", parsed.topicMatch);
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

async function callCloudClipComment(command: ClipCommentCloudCommand) {
  const suffix =
    command.commandType === "clip_comment.create.v1"
      ? ""
      : `/${command.commentId}`;
  const method =
    command.commandType === "clip_comment.create.v1"
      ? "POST"
      : command.commandType === "clip_comment.update.v1"
        ? "PATCH"
        : "DELETE";
  let response: Response;
  try {
    response = await fetch(
      `${cloudApiUrl}/api/projects/${command.projectId}/clips/${command.clipId}/comments${suffix}`,
      {
        method,
        headers: {
          authorization: command.authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(command.command),
      },
    );
  } catch {
    throw Object.assign(new Error("Cloud comment service is unreachable."), {
      statusCode: 503,
      code: "cloud_unreachable",
    });
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const remote = payload as
      { error?: { code?: string; message?: string } } | undefined;
    throw Object.assign(
      new Error(remote?.error?.message ?? "Cloud comment request failed."),
      {
        statusCode: response.status,
        code: remote?.error?.code ?? "clip_comment_cloud_failed",
      },
    );
  }
  return ClipCommentSchema.parse(payload);
}

async function callCloudProjectBookmarks(
  projectId: string,
  input: ProjectBookmarkQuery,
  authorization: string,
) {
  const query = ProjectBookmarkQuerySchema.parse(input);
  const parameters = new URLSearchParams({
    scope: query.scope,
    state: query.state,
    limit: String(query.limit),
  });
  if (query.videoId) parameters.set("videoId", query.videoId);
  if (query.search) parameters.set("search", query.search);
  if (query.cursor) parameters.set("cursor", query.cursor);
  let response: Response;
  try {
    response = await fetch(
      `${cloudApiUrl}/api/projects/${projectId}/bookmarks?${parameters}`,
      { headers: { authorization } },
    );
  } catch {
    throw Object.assign(new Error("Cloud bookmark service is unreachable."), {
      statusCode: 503,
      code: "cloud_unreachable",
    });
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throwCloudBookmarkError(response.status, payload);
  return ProjectBookmarkPageSchema.parse(payload);
}

async function callCloudProjectBookmarkCommand(
  command: BookmarkOutboxCommand,
  authorization: string,
) {
  const suffix =
    command.commandType === "bookmark.create.v1"
      ? ""
      : command.commandType === "bookmark.update.v1"
        ? `/${command.bookmarkId}`
        : `/${command.bookmarkId}/${command.commandType === "bookmark.archive.v1" ? "archive" : "restore"}`;
  const method =
    command.commandType === "bookmark.update.v1" ? "PATCH" : "POST";
  let response: Response;
  try {
    response = await fetch(
      `${cloudApiUrl}/api/projects/${command.projectId}/bookmarks${suffix}`,
      {
        method,
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify(command.command),
      },
    );
  } catch {
    throw Object.assign(new Error("Cloud bookmark service is unreachable."), {
      statusCode: 503,
      code: "cloud_unreachable",
    });
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throwCloudBookmarkError(response.status, payload);
  return ProjectBookmarkMutationResponseSchema.parse(payload).bookmark;
}

function throwCloudBookmarkError(statusCode: number, payload: unknown): never {
  const remote = payload as
    { error?: { code?: string; message?: string } } | undefined;
  throw Object.assign(
    new Error(remote?.error?.message ?? "Cloud bookmark request failed."),
    {
      statusCode,
      code: remote?.error?.code ?? "project_bookmark_cloud_failed",
    },
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
