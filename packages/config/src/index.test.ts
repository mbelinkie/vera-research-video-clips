import { describe, expect, it } from "vitest";

import { loadConfig } from "./index.ts";

describe("configuration", () => {
  it("uses loopback-only local defaults", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.localAgentHost).toBe("127.0.0.1");
    expect(config.objectStoreMode).toBe("memory");
    expect(config.queueMode).toBe("memory");
    expect(config.cloudDatabaseMode).toBe("pglite");
    expect(config.cloudAuthMode).toBe("development");
    expect(config.captionProvider).toBe("disabled");
    expect(config.mediaProvider).toBe("disabled");
    expect(config.exportSourceProvider).toBe("disabled");
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
      EXPORT_SOURCE_PROVIDER: "yt-dlp",
      YT_DLP_PATH: "/opt/tools/yt-dlp",
      SPEECH_TO_TEXT_PROVIDER: "whisper-cpp",
      WHISPER_CPP_PATH: "/opt/whisper/whisper-cli",
      WHISPER_CPP_MODEL_PATH: "/opt/whisper/models/model.bin",
      WHISPER_CPP_MODEL_NAME: "large-v3-turbo",
    });

    expect(config.mediaProvider).toBe("yt-dlp-audio");
    expect(config.exportSourceProvider).toBe("yt-dlp");
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

  it("requires the protected catalog signing key and key ID together", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        LOCAL_MODEL_CATALOG_SIGNING_KEY_ID: "catalog-key-1",
      }),
    ).toThrow("must be configured together");

    expect(
      loadConfig({
        NODE_ENV: "test",
        LOCAL_MODEL_CATALOG_SIGNING_KEY_ID: "catalog-key-1",
        LOCAL_MODEL_CATALOG_SIGNING_PRIVATE_KEY_BASE64: "cHJpdmF0ZS1rZXk=",
      }),
    ).toMatchObject({ localModelCatalogSigningKeyId: "catalog-key-1" });
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

  it("keeps official YouTube search optional and backend-configured", () => {
    expect(loadConfig({ NODE_ENV: "test" }).youtubeApiKey).toBeUndefined();
    expect(
      loadConfig({ NODE_ENV: "test", YOUTUBE_API_KEY: "fixture-api-key" })
        .youtubeApiKey,
    ).toBe("fixture-api-key");
  });

  it("rejects exposing the local agent", () => {
    expect(() => loadConfig({ LOCAL_AGENT_HOST: "0.0.0.0" })).toThrow(
      "Local services must bind to a loopback address",
    );
  });

  it("allows only the supervised desktop agent to bind an ephemeral port", () => {
    expect(
      loadConfig({
        APP_RUNTIME_ROLE: "desktop-local",
        LOCAL_AGENT_PORT: "0",
      }).localAgentPort,
    ).toBe(0);
    expect(() => loadConfig({ LOCAL_AGENT_PORT: "0" })).toThrow(
      "Only the supervised desktop agent",
    );
  });

  it("requires an explicit bucket for S3 mode", () => {
    expect(() => loadConfig({ OBJECT_STORE_MODE: "s3" })).toThrow(
      "TRANSCRIPT_BUCKET is required",
    );
  });

  it("fails closed unless every production cloud boundary is explicit", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "Production requires PostgreSQL",
    );

    const config = loadConfig({
      NODE_ENV: "production",
      CLOUD_DATABASE_MODE: "postgres",
      DATABASE_URL: "postgresql://runtime@db.internal/research_video_clips",
      DATABASE_SSL_MODE: "verify-full",
      DATABASE_CA_CERT_PATH: "/fixtures/rds-ca.pem",
      CLOUD_AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: "us-east-1_example",
      COGNITO_CLIENT_ID: "public-client-id",
      COGNITO_DOMAIN: "https://auth.example.test",
      COGNITO_REDIRECT_URI: "research-video-clips://oauth/callback",
      COGNITO_LOGOUT_URI: "research-video-clips://oauth/logout",
      OBJECT_STORE_MODE: "s3",
      TRANSCRIPT_BUCKET: "private-production-transcripts",
      QUEUE_MODE: "sqs",
      JOB_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/jobs",
      TRANSLATION_PROVIDER: "aws-translate",
      PUBLIC_API_ORIGIN: "https://api.example.test",
    });

    expect(config).toMatchObject({
      cloudDatabaseMode: "postgres",
      databaseSslMode: "verify-full",
      cloudAuthMode: "cognito",
      objectStoreMode: "s3",
      queueMode: "sqs",
      translationProvider: "aws-translate",
    });
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
});
