import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyRequest } from "fastify";
import { SharedProjectCatalog } from "@research-video/catalog";
import { createCognitoSessionProvider } from "@research-video/auth";
import { loadConfig } from "@research-video/config";
import {
  asCloudDatabase,
  createPostgresCloudDatabase,
  runCloudMigrations,
  type CloudDatabase,
} from "@research-video/db-cloud";
import {
  YouTubeDataApiSearchProvider,
  YouTubeOEmbedMetadataProvider,
} from "@research-video/providers";
import { createTranslationProvider } from "@research-video/providers/translation-aws";
import {
  MemoryStagedUploadUrlIssuer,
  MemoryTranscriptObjectStore,
  S3StagedUploadUrlIssuer,
  S3TranscriptObjectStore,
} from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";
import { pumpJobQueueOnce, SqsJobQueue } from "./job-queue.ts";

const config = loadConfig();
let database: CloudDatabase;
if (config.cloudDatabaseMode === "postgres") {
  const ssl =
    config.databaseSslMode === "disable"
      ? false
      : {
          rejectUnauthorized: config.databaseSslMode === "verify-full",
          ...(config.databaseCaCertPath
            ? { ca: readFileSync(config.databaseCaCertPath, "utf8") }
            : {}),
        };
  database = createPostgresCloudDatabase({
    ...(config.databaseUrl
      ? { connectionString: config.databaseUrl }
      : {
          host: config.databaseHost!,
          port: config.databasePort!,
          database: config.databaseName!,
          user: config.databaseUsername!,
          password: config.databasePassword!,
        }),
    ssl,
  });
} else {
  await mkdir(config.dataDir, { recursive: true });
  database = asCloudDatabase(new PGlite(join(config.dataDir, "cloud-catalog")));
}
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
const jobQueue =
  config.queueMode === "sqs"
    ? new SqsJobQueue({
        queueUrl: config.jobQueueUrl!,
        region: config.awsRegion,
      })
    : undefined;
const app = createCloudApi({
  catalog,
  ...(config.publicApiOrigin
    ? { publicApiOrigin: config.publicApiOrigin }
    : {}),
  authenticate:
    config.cloudAuthMode === "cognito"
      ? createCognitoSessionProvider<FastifyRequest>({
          configuration: {
            userPoolId: config.cognitoUserPoolId!,
            clientId: config.cognitoClientId!,
            issuer: `https://cognito-idp.${config.awsRegion}.amazonaws.com/${config.cognitoUserPoolId!}`,
          },
          getAuthorizationHeader: (request) => request.headers.authorization,
        }).authenticate
      : authenticateDevBearer,
  videoMetadataProvider: new YouTubeOEmbedMetadataProvider(),
  ...(config.youtubeApiKey
    ? {
        sourceSearchProviders: {
          youtube: new YouTubeDataApiSearchProvider(config.youtubeApiKey),
        },
      }
    : {}),
  queueDeliveryRequired: Boolean(jobQueue),
  ...(() => {
    const translationProvider = createTranslationProvider({
      mode: config.translationProvider,
      region: config.awsRegion,
      ...(config.awsTranslateTerminology
        ? { terminologyName: config.awsTranslateTerminology }
        : {}),
    });
    return translationProvider ? { translationProvider } : {};
  })(),
});

let queuePumpActive = false;
const pumpJobQueue = async () => {
  if (!jobQueue || queuePumpActive) return;
  queuePumpActive = true;
  try {
    await pumpJobQueueOnce(jobQueue, catalog);
  } catch (error) {
    app.log.error(
      { error: error instanceof Error ? error.message : "unknown error" },
      "Job queue dispatch failed; the database-backed job remains pending.",
    );
  } finally {
    queuePumpActive = false;
  }
};
const queuePumpTimer = jobQueue
  ? setInterval(() => void pumpJobQueue(), 2_000)
  : undefined;
void pumpJobQueue();

app.addHook("onClose", async () => {
  if (queuePumpTimer) clearInterval(queuePumpTimer);
  jobQueue?.destroy();
  await database.close();
  s3?.destroy();
});

await app.listen({ host: config.cloudApiHost, port: config.cloudApiPort });
app.log.info(
  `Cloud API listening on ${config.publicApiOrigin ?? `http://${config.cloudApiHost}:${config.cloudApiPort}`}`,
);
