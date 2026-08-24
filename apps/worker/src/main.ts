import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import { createMediaAcquisitionProvider } from "@research-video/media";
import { createCaptionProvider } from "@research-video/providers/captions-local";
import { createSpeechToTextProvider } from "@research-video/providers/speech-whisper-cpp";

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
      ...(config.translationProvider === "aws-translate"
        ? {
            claimedTranslation: new HttpClaimedTranslationClient({
              baseUrl,
              authorization: config.workerAuthorization,
            }),
          }
        : {}),
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
}
