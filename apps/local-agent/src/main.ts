import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import {
  LocalExportQueue,
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

import { createLocalAgent } from "./app.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
runLocalMigrations(database);
const exportQueue = new LocalExportQueue(database);
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
  createExportOnly: (input) => exportQueue.createExportOnly(input),
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
