import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { createBrowserAuth } from "./browser-auth/routes.ts";
import { createCognitoProvider } from "./browser-auth/provider.ts";

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
import { bootstrapManagedResearch } from "./managed-bootstrap.ts";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
if (config.runtimeMode === "managed-local") {
  const rootInfo = await lstat(config.dataDir);
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (rootInfo.mode & 0o077) !== 0
  )
    throw new Error(
      "Managed Research requires a private non-symlink data directory (0700)",
    );
}
const pilot = config.runtimeMode === "mac-pilot";
const localObjects = pilot || config.runtimeMode === "managed-local";
if (pilot && (await pilotBackupGateIsActive(config.pilotObjectRoot!))) {
  throw new Error(
    "Mac pilot cannot start while the backup write gate is active",
  );
}
if (localObjects) {
  await mkdir(config.pilotObjectRoot!, { recursive: true, mode: 0o700 });
  const objectRootInfo = await lstat(config.pilotObjectRoot!);
  if (
    !objectRootInfo.isDirectory() ||
    objectRootInfo.isSymbolicLink() ||
    (objectRootInfo.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Local transcript root must be a private non-symlink directory (0700)",
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
const objectStore = localObjects
  ? new LocalTranscriptObjectStore(config.pilotObjectRoot!)
  : s3 && transcriptBucket
    ? new S3TranscriptObjectStore(s3, transcriptBucket)
    : new MemoryTranscriptObjectStore();
const uploadUrlIssuer = localObjects
  ? new LocalStagedUploadUrlIssuer(
      config.cloudAuthMode === "browser"
        ? `${config.browserPublicOrigin!}/cloud-api/`
        : `http://${config.cloudApiHost}:${config.cloudApiPort}/`,
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
if (config.runtimeMode === "managed-local") {
  const authorization = process.env.MANAGED_RESEARCH_AUTHORIZATION;
  if (!authorization || authorization !== config.workerAuthorization) {
    await database.close();
    throw new Error(
      "Managed Research requires matching private proxy and worker identities.",
    );
  }
  await bootstrapManagedResearch(catalog, authorization);
}
const browserAuth =
  config.cloudAuthMode === "browser"
    ? createBrowserAuth({
        publicOrigin: config.browserPublicOrigin!,
        trustedProxyPeers: config.trustedProxyPeers,
        provider: createCognitoProvider({
          issuer: config.cognitoIssuer!,
          domain: config.cognitoDomain!,
          clientId: config.cognitoClientId!,
          clientSecret: config.cognitoClientSecret!,
          callbackUrl: config.browserCallbackUrl!,
          logoutUrl: config.browserLogoutUrl!,
        }),
        catalog,
        sessionIdleMs: config.browserSessionIdleMs,
        sessionAbsoluteMs: config.browserSessionAbsoluteMs,
      })
    : undefined;
const app = createCloudApi({
  ...(browserAuth ? { browserAuth } : {}),
  catalog,
  authenticate: browserAuth
    ? (request) => browserAuth.authenticate(request)
    : authenticateDevBearer,
  videoMetadataProvider: new YouTubeOEmbedMetadataProvider(),
  ...(localObjects && uploadUrlIssuer instanceof LocalStagedUploadUrlIssuer
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
  if (browserAuth) {
    // In browser mode, serve the built frontend from the SAME BFF origin. Never
    // mount /local-agent; the local export service remains loopback-only.
    await app.register(fastifyStatic, {
      root: resolve("dist/web"),
      prefix: "/",
    });
  }
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
