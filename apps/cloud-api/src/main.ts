import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPrivateKey,
  randomUUID,
  sign as signBytes,
  type KeyObject,
} from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyRequest } from "fastify";
import { SharedProjectCatalog } from "@research-video/catalog";
import {
  CloudDatabaseLocalModelOperationStore,
  ContentAddressedImmutableArtifactStore,
  DurableLocalModelOperationRunner,
  HttpArgosSourceAdapter,
  TranscriptImmutableByteObjectStore,
} from "@research-video/catalog/local-model-operation-runner";
import { LanguageServiceControlPlane } from "@research-video/catalog/language-services";
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
import { LanguageServiceRegistry } from "@research-video/providers/language-service-registry";
import { ArgosLocalModelCatalog } from "@research-video/providers/local-model-argos-catalog";
import {
  createAwsTranslationProviderAdapterFactory,
  createTranslationProvider,
} from "@research-video/providers/translation-aws";
import {
  createAwsTranscribeProviderAdapterFactory,
  DatabaseAwsTranscribeOperationStore,
} from "@research-video/providers/speech-aws-transcribe";
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

const deployedLanguageServiceRegistry = new LanguageServiceRegistry([
  createAwsTranslationProviderAdapterFactory({
    region: config.awsRegion,
    ...(config.awsTranslateTerminology
      ? { terminologyName: config.awsTranslateTerminology }
      : {}),
  }),
  ...(config.transcriptBucket
    ? [
        createAwsTranscribeProviderAdapterFactory({
          region: config.awsRegion,
          storageBucket: config.transcriptBucket,
          operationStore: new DatabaseAwsTranscribeOperationStore(database),
        }),
      ]
    : []),
]);
const catalogSigningKey = config.localModelCatalogSigningPrivateKeyBase64
  ? loadEd25519PrivateKey(config.localModelCatalogSigningPrivateKeyBase64)
  : undefined;
const catalogSigner =
  catalogSigningKey && config.localModelCatalogSigningKeyId
    ? {
        keyId: config.localModelCatalogSigningKeyId,
        sign: async (payload: Uint8Array) =>
          signBytes(null, Buffer.from(payload), catalogSigningKey).toString(
            "base64",
          ),
      }
    : undefined;
const languageServices = new LanguageServiceControlPlane(
  database,
  () => new Date(),
  catalogSigner,
);
await languageServices.synchronizeDeployedProviders(
  deployedLanguageServiceRegistry.list(),
);
await languageServices.synchronizeLocalModelSources([
  {
    id: "argos-package-index",
    adapter: "argos-package-index",
    sourceUrl:
      "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json",
    state: "disabled",
    refreshIntervalHours: 24,
    version: 1,
  },
]);

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
const localModelOperationStore = new CloudDatabaseLocalModelOperationStore(
  database,
);
const localModelRunner = new DurableLocalModelOperationRunner(
  localModelOperationStore,
  new ContentAddressedImmutableArtifactStore(
    new TranscriptImmutableByteObjectStore(objectStore),
  ),
  new HttpArgosSourceAdapter(),
  new ArgosLocalModelCatalog({
    sourceUrl:
      "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json",
    runtimeFamily: "argos-translate",
    signer: catalogSigner ?? {
      keyId: "catalog-signing-unconfigured",
      sign: async () => {
        throw new Error("catalog_signing_unconfigured");
      },
    },
  }),
);
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
  languageServices,
  localModelArtifactDownloads: {
    issue: async (input) => {
      const stored = objectStore.head
        ? await objectStore.head(input.mirroredArtifactId)
        : await objectStore.get(input.mirroredArtifactId);
      if (
        !stored ||
        stored.sha256 !== input.artifactSha256 ||
        ("byteSize" in stored ? stored.byteSize : stored.bytes.byteLength) !==
          input.artifactByteSize
      ) {
        throw new Error("local_model_artifact_integrity_mismatch");
      }
      const expiresInSeconds = 300;
      const expiresAt = new Date(
        Date.now() + expiresInSeconds * 1_000,
      ).toISOString();
      const issued = await uploadUrlIssuer.issueGetUrl({
        objectKey: stored.key,
        objectVersionId: stored.versionId,
        expiresInSeconds,
      });
      const apiOrigin = (
        config.publicApiOrigin ??
        `http://${config.cloudApiHost}:${config.cloudApiPort}`
      ).replace(/\/$/u, "");
      return {
        downloadUrl: issued.startsWith("memory-download:")
          ? `${apiOrigin}/api/local-model-catalog/${encodeURIComponent(input.catalogReleaseId)}/versions/${encodeURIComponent(input.versionId)}/artifact?expiresAt=${encodeURIComponent(expiresAt)}`
          : issued,
        expiresAt,
      };
    },
    read: async (input) => {
      const metadata = objectStore.head
        ? await objectStore.head(input.mirroredArtifactId)
        : undefined;
      if (
        !metadata ||
        metadata.sha256 !== input.artifactSha256 ||
        metadata.byteSize !== input.artifactByteSize
      ) {
        throw new Error("local_model_artifact_integrity_mismatch");
      }
      const stored = await objectStore.getBounded(
        input.mirroredArtifactId,
        metadata.versionId,
        input.artifactByteSize,
      );
      if (
        !stored ||
        stored.sha256 !== input.artifactSha256 ||
        stored.bytes.byteLength !== input.artifactByteSize
      ) {
        throw new Error("local_model_artifact_integrity_mismatch");
      }
      return { bytes: stored.bytes, contentType: stored.contentType };
    },
  },
  languageServiceRegistry: deployedLanguageServiceRegistry,
  verifyActiveTranscriptArtifacts: config.objectStoreMode === "memory",
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
      mode:
        config.translationProvider === "aws-translate"
          ? "aws-translate"
          : "disabled",
      region: config.awsRegion,
      ...(config.awsTranslateTerminology
        ? { terminologyName: config.awsTranslateTerminology }
        : {}),
    });
    return translationProvider ? { translationProvider } : {};
  })(),
});

const localModelWorkerId = randomUUID();
let localModelPumpActive = false;
const pumpLocalModelOperations = async () => {
  if (localModelPumpActive) return;
  localModelPumpActive = true;
  try {
    const now = new Date();
    await localModelOperationStore.recoverExpiredLeases(now.toISOString(), 25);
    for (const source of await localModelRunner.discoverDueSources(10)) {
      const active = await database.query(
        `SELECT 1 FROM local_model_operations
         WHERE source_id = $1 AND kind = 'refresh_source'
           AND state IN ('queued', 'running') LIMIT 1`,
        [source.id],
      );
      if (active.rows[0]) continue;
      const enablingActor = await database.query<{ actor_id: string }>(
        `SELECT actor_id FROM language_service_command_receipts
         WHERE command_type = 'update_local_model_source'
           AND response_json->>'id' = $1
         ORDER BY created_at DESC LIMIT 1`,
        [source.id],
      );
      const actorId = enablingActor.rows[0]?.actor_id;
      if (!actorId) continue;
      await localModelOperationStore.enqueue({
        id: randomUUID(),
        kind: "refresh_source",
        idempotencyKey: `scheduled:${source.id}:${now.toISOString().slice(0, 13)}`,
        createdBy: actorId,
        createdAt: now.toISOString(),
        sourceId: source.id,
      });
    }
    const queued = await database.query<{ id: string }>(
      `SELECT id FROM local_model_operations
       WHERE state = 'queued' ORDER BY created_at, id LIMIT 1`,
    );
    if (queued.rows[0]) {
      await localModelRunner.run(queued.rows[0].id, localModelWorkerId);
    }
  } catch (error) {
    app.log.error(
      { error: error instanceof Error ? error.message : "unknown error" },
      "Local-model operation pump failed; durable work remains recoverable.",
    );
  } finally {
    localModelPumpActive = false;
  }
};
const localModelPumpTimer = setInterval(
  () => void pumpLocalModelOperations(),
  2_000,
);
void pumpLocalModelOperations();

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
  clearInterval(localModelPumpTimer);
  if (queuePumpTimer) clearInterval(queuePumpTimer);
  jobQueue?.destroy();
  await database.close();
  s3?.destroy();
});

await app.listen({ host: config.cloudApiHost, port: config.cloudApiPort });
app.log.info(
  `Cloud API listening on ${config.publicApiOrigin ?? `http://${config.cloudApiHost}:${config.cloudApiPort}`}`,
);

function loadEd25519PrivateKey(value: string): KeyObject {
  const key = createPrivateKey(Buffer.from(value, "base64").toString("utf8"));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Local-model catalog signing requires an Ed25519 key.");
  }
  return key;
}
