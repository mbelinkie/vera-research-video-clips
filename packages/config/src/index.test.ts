import { describe, expect, it } from "vitest";

import { loadConfig } from "./index.ts";

describe("configuration", () => {
  it("uses loopback-only local defaults", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.localAgentHost).toBe("127.0.0.1");
    expect(config.objectStoreMode).toBe("memory");
    expect(config.queueMode).toBe("memory");
    expect(config.captionProvider).toBe("disabled");
    expect(config.mediaProvider).toBe("disabled");
    expect(config.ytDlpPath).toBe("yt-dlp");
    expect(config.speechToTextProvider).toBe("disabled");
    expect(config.whisperCppPath).toBe("whisper-cli");
    expect(config.translationProvider).toBe("disabled");
    expect(config.awsRegion).toBe("us-east-1");
    expect(config.workerMode).toBe("once");
    expect(config.workerExecutionLocation).toBe("local");
    expect(config.workerConcurrency).toBe(1);
    expect(config.workerPollIntervalMs).toBe(2_000);
    expect(config.workerErrorBackoffMs).toBe(5_000);
    expect(config.workerLeaseSeconds).toBe(120);
  });

  it("accepts configured local media and speech providers", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      MEDIA_PROVIDER: "yt-dlp-audio",
      YT_DLP_PATH: "/opt/tools/yt-dlp",
      SPEECH_TO_TEXT_PROVIDER: "whisper-cpp",
      WHISPER_CPP_PATH: "/opt/whisper/whisper-cli",
      WHISPER_CPP_MODEL_PATH: "/opt/whisper/models/model.bin",
      WHISPER_CPP_MODEL_NAME: "large-v3-turbo",
    });

    expect(config.mediaProvider).toBe("yt-dlp-audio");
    expect(config.speechToTextProvider).toBe("whisper-cpp");
    expect(config.whisperCppModelName).toBe("large-v3-turbo");
  });

  it("requires explicit model provenance for whisper.cpp", () => {
    expect(() =>
      loadConfig({ SPEECH_TO_TEXT_PROVIDER: "whisper-cpp" }),
    ).toThrow("WHISPER_CPP_MODEL_PATH is required");
  });

  it("accepts an explicitly configured AWS translation provider", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      TRANSLATION_PROVIDER: "aws-translate",
      AWS_TRANSLATE_TERMINOLOGY: "research-project-terms",
      AWS_REGION: "us-west-2",
    });

    expect(config.translationProvider).toBe("aws-translate");
    expect(config.awsTranslateTerminology).toBe("research-project-terms");
    expect(config.awsRegion).toBe("us-west-2");
  });

  it("accepts an explicitly configured yt-dlp caption provider", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      CAPTION_PROVIDER: "yt-dlp",
      YT_DLP_PATH: "/opt/tools/yt-dlp",
    });

    expect(config.captionProvider).toBe("yt-dlp");
    expect(config.ytDlpPath).toBe("/opt/tools/yt-dlp");
  });

  it("rejects exposing the local agent", () => {
    expect(() => loadConfig({ LOCAL_AGENT_HOST: "0.0.0.0" })).toThrow(
      "Local services must bind to a loopback address",
    );
  });

  it("requires an explicit bucket for S3 mode", () => {
    expect(() => loadConfig({ OBJECT_STORE_MODE: "s3" })).toThrow(
      "TRANSCRIPT_BUCKET is required",
    );
  });

  it("accepts bounded continuous hosted worker settings", () => {
    const config = loadConfig({
      WORKER_MODE: "continuous",
      WORKER_EXECUTION_LOCATION: "hosted",
      WORKER_CONCURRENCY: "4",
      WORKER_POLL_INTERVAL_MS: "750",
      WORKER_ERROR_BACKOFF_MS: "3000",
      WORKER_LEASE_SECONDS: "180",
    });

    expect(config.workerMode).toBe("continuous");
    expect(config.workerExecutionLocation).toBe("hosted");
    expect(config.workerConcurrency).toBe(4);
    expect(config.workerPollIntervalMs).toBe(750);
    expect(config.workerErrorBackoffMs).toBe(3_000);
    expect(config.workerLeaseSeconds).toBe(180);
  });

  it("rejects unsafe worker concurrency and lease settings", () => {
    expect(() => loadConfig({ WORKER_CONCURRENCY: "9" })).toThrow();
    expect(() => loadConfig({ WORKER_LEASE_SECONDS: "10" })).toThrow();
  });

  it("rejects every incomplete or exposed Mac pilot mode", () => {
    const valid = {
      VERA_RUNTIME_MODE: "mac-pilot",
      DATABASE_MODE: "postgres",
      OBJECT_STORE_MODE: "local",
      PILOT_PG_URL:
        "postgresql://test:somepassword@127.0.0.1:5432/vera50_test_config",
      PILOT_OBJECT_ROOT: "/tmp/vera50-test-objects",
      LOCAL_UPLOAD_SIGNING_SECRET: "not-a-real-secret-32-characters-long",
    };
    expect(loadConfig(valid).runtimeMode).toBe("mac-pilot");
    for (const [key, value] of Object.entries({
      CLOUD_API_HOST: "0.0.0.0",
      OBJECT_STORE_MODE: "memory",
      DATABASE_MODE: "pglite",
      PILOT_PG_URL: "postgresql://test:pass@remote.example/vera",
      PILOT_OBJECT_ROOT: "relative-root",
      LOCAL_UPLOAD_SIGNING_SECRET: "weak",
    })) {
      expect(() => loadConfig({ ...valid, [key]: value })).toThrow();
    }
    expect(() => loadConfig({ ...valid, PILOT_PG_URL: undefined })).toThrow();
    expect(() =>
      loadConfig({ ...valid, LOCAL_UPLOAD_SIGNING_SECRET: undefined }),
    ).toThrow();
    expect(loadConfig({ NODE_ENV: "test" }).databaseMode).toBe("pglite");
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "Production configuration must explicitly select a durable runtime",
    );
  });
});
