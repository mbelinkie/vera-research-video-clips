import { join } from "node:path";

import { loadConfig } from "@research-video/config";
import { createMediaAcquisitionProvider } from "@research-video/media";
import { createCaptionProvider } from "@research-video/providers/captions-local";
import { createSpeechToTextProvider } from "@research-video/providers/speech-whisper-cpp";

import {
  HttpTranscriptPublicationClient,
  createTranscriptPipelineExecutor,
} from "./pipeline.ts";
import { HttpClaimedTranslationClient } from "./translation-cloud.ts";
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
  if (!media || !speechToText) {
    throw new Error(
      "Configured workers require opt-in MEDIA_PROVIDER and SPEECH_TO_TEXT_PROVIDER fallbacks before claiming jobs.",
    );
  }
  const captions = createCaptionProvider({
    mode: config.captionProvider,
    ytDlpPath: config.ytDlpPath,
  });
  const baseUrl = `http://${config.cloudApiHost}:${config.cloudApiPort}`;
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
    scratchRoot: join(config.dataDir, "jobs", "transcription-scratch"),
  });
  const worker = new ClaimingTranscriptionWorker(
    controlPlane,
    execute,
    undefined,
    {
      heartbeatIntervalMs: Math.max(
        1_000,
        Math.floor((config.workerLeaseSeconds * 1_000) / 3),
      ),
      visibilitySeconds: config.workerLeaseSeconds,
    },
  );
  if (config.workerMode === "once") {
    const result = await worker.runOnce();
    process.stdout.write(`Worker run completed: ${result}.\n`);
  } else {
    const shutdown = new AbortController();
    const stop = () => shutdown.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const service = new TranscriptionWorkerService(worker, {
      concurrency: config.workerConcurrency,
      idlePollMs: config.workerPollIntervalMs,
      errorBackoffMs: config.workerErrorBackoffMs,
      onUnexpectedError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Worker loop error; retrying: ${message}\n`);
      },
    });
    process.stdout.write(
      `Worker service started (${config.workerConcurrency} concurrent ${config.workerExecutionLocation} lane(s)).\n`,
    );
    const summary = await service.run(shutdown.signal);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.stdout.write(
      `Worker service stopped: ${summary.processed} processed, ${summary.failed} failed, ${summary.leaseLost} lease-lost, ${summary.unexpectedErrors} loop errors.\n`,
    );
  }
}
