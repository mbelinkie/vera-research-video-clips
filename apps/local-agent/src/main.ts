import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import {
  ExportSettingsPreviewSchema,
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
import { FfmpegCapabilityDiscoveryProvider } from "@research-video/media";

import { createLocalAgent } from "./app.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
const workerIdentity = new LocalExportWorkerIdentityRepository(database);
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
  capabilityProvider: new FfmpegCapabilityDiscoveryProvider(),
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
