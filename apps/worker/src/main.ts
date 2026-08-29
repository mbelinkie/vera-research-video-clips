import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import { LanguageServiceControlPlane } from "@research-video/catalog/language-services";
import { createPostgresCloudDatabase } from "@research-video/db-cloud";
import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { createMediaAcquisitionProvider } from "@research-video/media";
import { createCaptionProvider } from "@research-video/providers/captions-local";
import { LanguageServiceRegistry } from "@research-video/providers/language-service-registry";
import {
  createAwsTranscribeProviderAdapterFactory,
  DatabaseAwsTranscribeOperationStore,
} from "@research-video/providers/speech-aws-transcribe";
import { createSpeechToTextProvider } from "@research-video/providers/speech-whisper-cpp";
import { createEd25519CatalogVerifier } from "@research-video/providers/cloud-local-model-catalog";
import { LocalArgosModelManager } from "@research-video/providers/local-argos-model-manager";
import { SqliteLocalArgosModelStore } from "@research-video/providers/local-argos-model-store-sqlite";
import { CloudManagedArgosTranslationProvider } from "@research-video/providers/translation-argos-cloud-managed";

import {
  HttpTranscriptPublicationClient,
  createTranscriptPipelineExecutor,
} from "./pipeline.ts";
import {
  ClaimingProjectKeywordScanWorker,
  HttpProjectKeywordScanControlPlane,
  ProjectKeywordScanWorkerService,
} from "./keyword-scan.ts";
import { HttpClaimedTranslationClient } from "./translation-cloud.ts";
import { sweepAbandonedTranscriptionScratch } from "./transcription-scratch-sweeper.ts";
import {
  ClaimingTranscriptionWorker,
  HttpTranscriptionWorkerControlPlane,
  TranscriptionWorkerService,
} from "./worker.ts";

const config = loadConfig();

if (!config.workerAuthorization) {
  process.stdout.write(
    "Worker standby: set WORKER_AUTHORIZATION to claim shared transcription jobs.\n",
  );
} else {
  const baseUrl =
    config.publicApiOrigin ??
    `http://${config.cloudApiHost}:${config.cloudApiPort}`;
  let localArgosDatabase: ReturnType<typeof openLocalDatabase> | undefined;
  let localTranslation: CloudManagedArgosTranslationProvider | undefined;
  if (
    config.argosSidecarPath &&
    Object.keys(config.localModelCatalogTrustRoots).length > 0
  ) {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    localArgosDatabase = openLocalDatabase(
      join(config.dataDir, "local-model-runtime.sqlite"),
    );
    runLocalMigrations(localArgosDatabase);
    const manager = new LocalArgosModelManager({
      rootDirectory: join(config.dataDir, "local-models"),
      store: new SqliteLocalArgosModelStore(localArgosDatabase),
      verifier: createEd25519CatalogVerifier(
        config.localModelCatalogTrustRoots,
      ),
      supportedRuntimeVersions: config.argosRuntimeVersions,
    });
    await manager.sweep(new Date().toISOString());
    localTranslation = new CloudManagedArgosTranslationProvider({
      baseUrl,
      authorizationProvider: {
        authorizationHeader: async () => config.workerAuthorization!,
      },
      manager,
      executable: config.argosSidecarPath,
    });
    await localTranslation.initialize().catch(() => {
      process.stderr.write(
        "Local translation catalog is not currently available; verified cached models will be retried when translation is needed.\n",
      );
    });
  }
  const heartbeatIntervalMs = Math.max(
    1_000,
    Math.floor((config.workerLeaseSeconds * 1_000) / 3),
  );
  const keywordScanWorker = new ClaimingProjectKeywordScanWorker(
    new HttpProjectKeywordScanControlPlane({
      baseUrl,
      authorization: config.workerAuthorization,
      leaseSeconds: config.workerLeaseSeconds,
    }),
    { heartbeatIntervalMs },
  );

  const media = createMediaAcquisitionProvider({
    mode: config.mediaProvider,
    ytDlpPath: config.ytDlpPath,
  });
  const speechToText =
    config.speechToTextProvider === "whisper-cpp"
      ? createSpeechToTextProvider({
          mode: "whisper-cpp",
          executable: config.whisperCppPath,
          modelPath: config.whisperCppModelPath!,
          modelName: config.whisperCppModelName!,
        })
      : undefined;
  const cloudOperationDatabase =
    config.cloudDatabaseMode === "postgres" && config.transcriptBucket
      ? createPostgresCloudDatabase({
          ...(config.databaseUrl
            ? { connectionString: config.databaseUrl }
            : {
                host: config.databaseHost!,
                port: config.databasePort!,
                database: config.databaseName!,
                user: config.databaseUsername!,
                password: config.databasePassword!,
              }),
          ssl:
            config.databaseSslMode === "disable"
              ? false
              : {
                  rejectUnauthorized: config.databaseSslMode === "verify-full",
                  ...(config.databaseCaCertPath
                    ? {
                        ca: readFileSync(config.databaseCaCertPath, "utf8"),
                      }
                    : {}),
                },
        })
      : undefined;
  const transcriptionProviders = new LanguageServiceRegistry(
    cloudOperationDatabase && config.transcriptBucket
      ? [
          createAwsTranscribeProviderAdapterFactory({
            region: config.awsRegion,
            storageBucket: config.transcriptBucket,
            operationStore: new DatabaseAwsTranscribeOperationStore(
              cloudOperationDatabase,
            ),
          }),
        ]
      : [],
  );
  const languageServiceOperations = cloudOperationDatabase
    ? new LanguageServiceControlPlane(cloudOperationDatabase)
    : undefined;
  let transcriptionWorker: ClaimingTranscriptionWorker | undefined;
  if (media && speechToText) {
    const captions = createCaptionProvider({
      mode: config.captionProvider,
      ytDlpPath: config.ytDlpPath,
    });
    const controlPlane = new HttpTranscriptionWorkerControlPlane({
      baseUrl,
      authorization: config.workerAuthorization,
      executionLocation: config.workerExecutionLocation,
      leaseSeconds: config.workerLeaseSeconds,
    });
    const publication = new HttpTranscriptPublicationClient({
      baseUrl,
      authorization: config.workerAuthorization,
    });
    const scratchRoot = join(config.dataDir, "jobs", "transcription-scratch");
    await sweepAbandonedTranscriptionScratch(scratchRoot);
    const execute = createTranscriptPipelineExecutor({
      ...(captions ? { captions } : {}),
      media,
      speechToText,
      resolveCloudSpeechToText: async (providerId, context) => {
        if (!cloudOperationDatabase || !context.grantId) return undefined;
        const state = await cloudOperationDatabase.query<{
          state: string;
          region?: string;
          protected_credential_reference?: string;
          operation_state?: string;
        }>(
          `SELECT provider.state, configuration.region,
                  configuration.protected_credential_reference
           FROM language_service_providers provider
           LEFT JOIN language_service_provider_server_configurations configuration
             ON configuration.provider_id = provider.id
           JOIN cloud_provider_launch_grants launch_grant
             ON launch_grant.provider_id = provider.id
            AND launch_grant.service = provider.service
           JOIN cloud_provider_access_requests access
             ON access.id = launch_grant.access_request_id
           LEFT JOIN cloud_provider_operations operation
             ON operation.id = $3 AND operation.provider_id = provider.id
            AND operation.service = provider.service
           WHERE provider.id = $1 AND provider.service = 'transcription'
             AND launch_grant.id = $2
             AND (
               (provider.state = 'enabled' AND launch_grant.revoked_at IS NULL
                AND launch_grant.expires_at > now() AND access.state = 'approved')
               OR operation.state IN ('staging', 'submitted', 'running')
             )`,
          [providerId, context.grantId, context.operationId],
        );
        if (!state.rows[0]) return undefined;
        await languageServiceOperations!.beginProviderOperation({
          operationId: context.operationId,
          providerId,
          service: "transcription",
          grantId: context.grantId,
          attempt: context.attempt,
          policySnapshot: context.policy,
          inputMode: "direct_upload",
        });
        try {
          return transcriptionProviders.resolveTranscription(providerId, {
            region: state.rows[0]?.region ?? config.awsRegion,
            ...(state.rows[0]?.protected_credential_reference
              ? {
                  protectedCredentialReference:
                    state.rows[0].protected_credential_reference,
                }
              : {}),
          });
        } catch {
          return undefined;
        }
      },
      finishCloudSpeechToText: async (outcome) =>
        languageServiceOperations!.finishProviderOperation({
          ...outcome,
          cleanup: "completed",
        }),
      claimedTranslation: new HttpClaimedTranslationClient({
        baseUrl,
        authorization: config.workerAuthorization,
      }),
      ...(localTranslation ? { translation: localTranslation } : {}),
      publication,
      scratchRoot,
    });
    transcriptionWorker = new ClaimingTranscriptionWorker(
      controlPlane,
      execute,
      undefined,
      {
        heartbeatIntervalMs,
        visibilitySeconds: config.workerLeaseSeconds,
      },
    );
  } else {
    process.stdout.write(
      "Transcription worker standby: configure opt-in media and speech providers; verified keyword scans remain available.\n",
    );
  }

  if (config.workerMode === "once") {
    const [keywordScanResult, transcriptionResult] = await Promise.all([
      keywordScanWorker.runOnce(),
      transcriptionWorker?.runOnce() ?? Promise.resolve("standby"),
    ]);
    process.stdout.write(
      `Worker run completed: transcription ${transcriptionResult}; keyword scan ${keywordScanResult}.\n`,
    );
  } else {
    const shutdown = new AbortController();
    const stop = () => shutdown.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const transcriptionService = transcriptionWorker
      ? new TranscriptionWorkerService(transcriptionWorker, {
          concurrency: config.workerConcurrency,
          idlePollMs: config.workerPollIntervalMs,
          errorBackoffMs: config.workerErrorBackoffMs,
          onUnexpectedError: (error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            process.stderr.write(`Worker loop error; retrying: ${message}\n`);
          },
        })
      : undefined;
    const keywordScanService = new ProjectKeywordScanWorkerService(
      keywordScanWorker,
      {
        idlePollMs: config.workerPollIntervalMs,
        errorBackoffMs: config.workerErrorBackoffMs,
        onUnexpectedError: (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `Keyword scan worker loop error; retrying: ${message}\n`,
          );
        },
      },
    );
    process.stdout.write(
      `Worker service started (one keyword-scan lane${transcriptionService ? ` plus ${config.workerConcurrency} concurrent ${config.workerExecutionLocation} transcription lane(s)` : ""}).\n`,
    );
    const [keywordSummary, summary] = await Promise.all([
      keywordScanService.run(shutdown.signal),
      transcriptionService?.run(shutdown.signal) ?? Promise.resolve(undefined),
    ]);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (summary) {
      process.stdout.write(
        `Worker service stopped: ${summary.processed} processed, ${summary.failed} failed, ${summary.leaseLost} lease-lost, ${summary.unexpectedErrors} loop errors.\n`,
      );
    }
    process.stdout.write(
      `Keyword scan service stopped: ${keywordSummary.processed} processed, ${keywordSummary.failed} failed, ${keywordSummary.leaseLost} lease-lost, ${keywordSummary.unexpectedErrors} loop errors.\n`,
    );
  }
  localArgosDatabase?.close();
  await cloudOperationDatabase?.close();
}
