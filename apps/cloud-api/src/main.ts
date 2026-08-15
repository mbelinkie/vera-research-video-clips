import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import { SharedProjectCatalog } from "@research-video/catalog";
import { loadConfig } from "@research-video/config";
import { runCloudMigrations } from "@research-video/db-cloud";
import { YouTubeOEmbedMetadataProvider } from "@research-video/providers";
import {
  MemoryStagedUploadUrlIssuer,
  MemoryTranscriptObjectStore,
  S3StagedUploadUrlIssuer,
  S3TranscriptObjectStore,
} from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = new PGlite(join(config.dataDir, "cloud-catalog"));
await runCloudMigrations(database);

const s3 =
  config.objectStoreMode === "s3"
    ? new S3Client({ region: config.awsRegion })
    : undefined;
const transcriptBucket = config.transcriptBucket;
const objectStore =
  s3 && transcriptBucket
    ? new S3TranscriptObjectStore(s3, transcriptBucket)
    : new MemoryTranscriptObjectStore();
const uploadUrlIssuer =
  s3 && transcriptBucket
    ? new S3StagedUploadUrlIssuer(s3, transcriptBucket)
    : new MemoryStagedUploadUrlIssuer();
const catalog = new SharedProjectCatalog(
  database,
  objectStore,
  () => new Date(),
  uploadUrlIssuer,
);
const app = createCloudApi({
  catalog,
  authenticate: authenticateDevBearer,
  videoMetadataProvider: new YouTubeOEmbedMetadataProvider(),
});

await app.listen({ host: config.cloudApiHost, port: config.cloudApiPort });
app.log.info(
  `Cloud API listening on http://${config.cloudApiHost}:${config.cloudApiPort}`,
);
