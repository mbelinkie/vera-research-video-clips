import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import { SharedProjectCatalog } from "@research-video/catalog";
import { loadConfig } from "@research-video/config";
import {
  createPostgresDatabase,
  pilotBackupGateIsActive,
  runCloudMigrations,
} from "@research-video/db-cloud";
import { YouTubeOEmbedMetadataProvider } from "@research-video/providers";
import {
  MemoryStagedUploadUrlIssuer,
  MemoryTranscriptObjectStore,
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
  S3StagedUploadUrlIssuer,
  S3TranscriptObjectStore,
} from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const pilot = config.runtimeMode === "mac-pilot";
if (pilot && (await pilotBackupGateIsActive(config.pilotObjectRoot!))) {
  throw new Error(
    "Mac pilot cannot start while the backup write gate is active",
  );
}
if (pilot) {
  await mkdir(config.pilotObjectRoot!, { recursive: true, mode: 0o700 });
  const objectRootInfo = await lstat(config.pilotObjectRoot!);
  if (
    !objectRootInfo.isDirectory() ||
    objectRootInfo.isSymbolicLink() ||
    (objectRootInfo.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Mac pilot transcript root must be a private non-symlink directory (0700)",
    );
  }
}
const database = pilot
  ? createPostgresDatabase(config.pilotPgUrl!)
  : new PGlite(join(config.dataDir, "cloud-catalog"));
await runCloudMigrations(database);

const s3 =
  config.objectStoreMode === "s3"
    ? new S3Client({ region: config.awsRegion })
    : undefined;
const transcriptBucket = config.transcriptBucket;
const objectStore = pilot
  ? new LocalTranscriptObjectStore(config.pilotObjectRoot!)
  : s3 && transcriptBucket
    ? new S3TranscriptObjectStore(s3, transcriptBucket)
    : new MemoryTranscriptObjectStore();
const uploadUrlIssuer = pilot
  ? new LocalStagedUploadUrlIssuer(
      "http://" + config.cloudApiHost + ":" + config.cloudApiPort + "/",
      config.localSigningSecret!,
    )
  : s3 && transcriptBucket
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
  ...(pilot && uploadUrlIssuer instanceof LocalStagedUploadUrlIssuer
    ? {
        localArtifacts: {
          store: objectStore,
          issuer: uploadUrlIssuer,
          objectRoot: config.pilotObjectRoot!,
        },
      }
    : {}),
});

try {
  await app.listen({ host: config.cloudApiHost, port: config.cloudApiPort });
} catch (error) {
  await database.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      await app.close();
      await database.close();
      process.exitCode = 0;
    })();
  });
}
app.log.info(
  `Cloud API listening on http://${config.cloudApiHost}:${config.cloudApiPort}`,
);
