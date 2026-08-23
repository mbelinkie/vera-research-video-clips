import { resolve } from "node:path";

import { z } from "zod";

const LoopbackHostSchema = z
  .string()
  .refine(
    (host) => host === "127.0.0.1" || host === "localhost" || host === "::1",
    {
      message: "Local services must bind to a loopback address",
    },
  );

const PortSchema = z.coerce.number().int().min(1).max(65_535);
const LocalAgentPortSchema = z.coerce.number().int().min(0).max(65_535);
const MillisecondsSchema = z.coerce.number().int().min(1).max(60_000);

export const AppConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    runtimeRole: z.enum(["cloud-api", "desktop-local", "desktop-worker"]),
    localAgentHost: LoopbackHostSchema,
    localAgentPort: LocalAgentPortSchema,
    cloudApiHost: z.string().min(1),
    cloudApiPort: PortSchema,
    publicApiOrigin: z.url().optional(),
    webPort: PortSchema,
    dataDir: z.string().min(1),
    cloudDatabaseMode: z.enum(["pglite", "postgres"]),
    databaseUrl: z.string().trim().min(1).optional(),
    databaseHost: z.string().trim().min(1).optional(),
    databasePort: PortSchema.optional(),
    databaseName: z.string().trim().min(1).optional(),
    databaseUsername: z.string().trim().min(1).optional(),
    databasePassword: z.string().min(1).optional(),
    databaseSslMode: z.enum(["disable", "require", "verify-full"]),
    databaseCaCertPath: z.string().trim().min(1).optional(),
    cloudAuthMode: z.enum(["development", "cognito"]),
    cognitoUserPoolId: z.string().trim().min(1).optional(),
    cognitoClientId: z.string().trim().min(1).optional(),
    cognitoDomain: z.url().optional(),
    cognitoRedirectUri: z
      .literal("research-video-clips://oauth/callback")
      .optional(),
    cognitoLogoutUri: z
      .literal("research-video-clips://oauth/logout")
      .optional(),
    objectStoreMode: z.enum(["memory", "s3"]),
    queueMode: z.enum(["memory", "sqs"]),
    jobQueueUrl: z.url().optional(),
    captionProvider: z.enum(["disabled", "yt-dlp"]),
    mediaProvider: z.enum(["disabled", "yt-dlp-audio"]),
    exportSourceProvider: z.enum(["disabled", "yt-dlp"]),
    ytDlpPath: z.string().trim().min(1),
    speechToTextProvider: z.enum(["disabled", "whisper-cpp"]),
    whisperCppPath: z.string().trim().min(1),
    whisperCppModelPath: z.string().trim().min(1).optional(),
    whisperCppModelName: z.string().trim().min(1).optional(),
    translationProvider: z.enum(["disabled", "aws-translate"]),
    awsTranslateTerminology: z.string().trim().min(1).optional(),
    awsRegion: z.string().min(1),
    transcriptBucket: z.string().min(3).optional(),
    workerAuthorization: z.string().trim().min(1).optional(),
    workerMode: z.enum(["once", "continuous"]),
    workerExecutionLocation: z.enum(["local", "hosted"]),
    workerConcurrency: z.coerce.number().int().min(1).max(8),
    workerPollIntervalMs: MillisecondsSchema,
    workerErrorBackoffMs: MillisecondsSchema,
    workerLeaseSeconds: z.coerce.number().int().min(30).max(900),
  })
  .superRefine((config, context) => {
    if (config.localAgentPort === 0 && config.runtimeRole !== "desktop-local") {
      context.addIssue({
        code: "custom",
        path: ["localAgentPort"],
        message:
          "Only the supervised desktop agent may request an ephemeral port",
      });
    }
    if (config.objectStoreMode === "s3" && !config.transcriptBucket) {
      context.addIssue({
        code: "custom",
        path: ["transcriptBucket"],
        message: "TRANSCRIPT_BUCKET is required when OBJECT_STORE_MODE=s3",
      });
    }
    const hasDatabaseParts = Boolean(
      config.databaseHost &&
      config.databasePort &&
      config.databaseName &&
      config.databaseUsername &&
      config.databasePassword,
    );
    if (
      config.cloudDatabaseMode === "postgres" &&
      !config.databaseUrl &&
      !hasDatabaseParts
    ) {
      context.addIssue({
        code: "custom",
        path: ["databaseUrl"],
        message:
          "DATABASE_URL or all DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD fields are required when CLOUD_DATABASE_MODE=postgres",
      });
    }
    if (config.queueMode === "sqs" && !config.jobQueueUrl) {
      context.addIssue({
        code: "custom",
        path: ["jobQueueUrl"],
        message: "JOB_QUEUE_URL is required when QUEUE_MODE=sqs",
      });
    }
    if (config.cloudAuthMode === "cognito") {
      for (const [path, value, message] of [
        ["cognitoUserPoolId", config.cognitoUserPoolId, "COGNITO_USER_POOL_ID"],
        ["cognitoClientId", config.cognitoClientId, "COGNITO_CLIENT_ID"],
        ["cognitoDomain", config.cognitoDomain, "COGNITO_DOMAIN"],
        [
          "cognitoRedirectUri",
          config.cognitoRedirectUri,
          "COGNITO_REDIRECT_URI",
        ],
        ["cognitoLogoutUri", config.cognitoLogoutUri, "COGNITO_LOGOUT_URI"],
      ] as const) {
        if (!value) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: `${message} is required when CLOUD_AUTH_MODE=cognito`,
          });
        }
      }
    }
    if (config.nodeEnv === "production" && config.runtimeRole === "cloud-api") {
      const productionRequirements = [
        [
          config.cloudDatabaseMode === "postgres",
          "cloudDatabaseMode",
          "Production requires PostgreSQL.",
        ],
        [
          config.databaseSslMode === "verify-full",
          "databaseSslMode",
          "Production PostgreSQL requires verify-full TLS.",
        ],
        [
          Boolean(config.databaseCaCertPath),
          "databaseCaCertPath",
          "Production PostgreSQL requires an explicit trusted CA bundle.",
        ],
        [
          config.cloudAuthMode === "cognito",
          "cloudAuthMode",
          "Production requires Cognito authentication.",
        ],
        [
          config.objectStoreMode === "s3",
          "objectStoreMode",
          "Production requires private S3 object storage.",
        ],
        [
          config.queueMode === "sqs",
          "queueMode",
          "Production requires SQS delivery.",
        ],
        [
          config.translationProvider === "aws-translate",
          "translationProvider",
          "Production requires server-side Amazon Translate.",
        ],
        [
          Boolean(config.publicApiOrigin?.startsWith("https://")),
          "publicApiOrigin",
          "Production requires an HTTPS public API origin.",
        ],
      ] as const;
      for (const [valid, path, message] of productionRequirements) {
        if (!valid) context.addIssue({ code: "custom", path: [path], message });
      }
    }
    if (config.speechToTextProvider === "whisper-cpp") {
      if (!config.whisperCppModelPath) {
        context.addIssue({
          code: "custom",
          path: ["whisperCppModelPath"],
          message:
            "WHISPER_CPP_MODEL_PATH is required when SPEECH_TO_TEXT_PROVIDER=whisper-cpp",
        });
      }
      if (!config.whisperCppModelName) {
        context.addIssue({
          code: "custom",
          path: ["whisperCppModelName"],
          message:
            "WHISPER_CPP_MODEL_NAME is required when SPEECH_TO_TEXT_PROVIDER=whisper-cpp",
        });
      }
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return AppConfigSchema.parse({
    nodeEnv: env.NODE_ENV ?? "development",
    runtimeRole: env.APP_RUNTIME_ROLE ?? "cloud-api",
    localAgentHost: env.LOCAL_AGENT_HOST ?? "127.0.0.1",
    localAgentPort: env.LOCAL_AGENT_PORT ?? 43_110,
    cloudApiHost: env.CLOUD_API_HOST ?? "127.0.0.1",
    cloudApiPort: env.CLOUD_API_PORT ?? 43_111,
    publicApiOrigin: env.PUBLIC_API_ORIGIN,
    webPort: env.WEB_PORT ?? 43_112,
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    cloudDatabaseMode: env.CLOUD_DATABASE_MODE ?? "pglite",
    databaseUrl: env.DATABASE_URL,
    databaseHost: env.DATABASE_HOST,
    databasePort: env.DATABASE_PORT,
    databaseName: env.DATABASE_NAME,
    databaseUsername: env.DATABASE_USERNAME,
    databasePassword: env.DATABASE_PASSWORD,
    databaseSslMode: env.DATABASE_SSL_MODE ?? "disable",
    databaseCaCertPath: env.DATABASE_CA_CERT_PATH,
    cloudAuthMode: env.CLOUD_AUTH_MODE ?? "development",
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID,
    cognitoClientId: env.COGNITO_CLIENT_ID,
    cognitoDomain: env.COGNITO_DOMAIN,
    cognitoRedirectUri: env.COGNITO_REDIRECT_URI,
    cognitoLogoutUri: env.COGNITO_LOGOUT_URI,
    objectStoreMode: env.OBJECT_STORE_MODE ?? "memory",
    queueMode: env.QUEUE_MODE ?? "memory",
    jobQueueUrl: env.JOB_QUEUE_URL,
    captionProvider: env.CAPTION_PROVIDER ?? "disabled",
    mediaProvider: env.MEDIA_PROVIDER ?? "disabled",
    exportSourceProvider: env.EXPORT_SOURCE_PROVIDER ?? "disabled",
    ytDlpPath: env.YT_DLP_PATH ?? "yt-dlp",
    speechToTextProvider: env.SPEECH_TO_TEXT_PROVIDER ?? "disabled",
    whisperCppPath: env.WHISPER_CPP_PATH ?? "whisper-cli",
    whisperCppModelPath: env.WHISPER_CPP_MODEL_PATH,
    whisperCppModelName: env.WHISPER_CPP_MODEL_NAME,
    translationProvider: env.TRANSLATION_PROVIDER ?? "disabled",
    awsTranslateTerminology: env.AWS_TRANSLATE_TERMINOLOGY,
    awsRegion: env.AWS_REGION ?? "us-east-1",
    transcriptBucket: env.TRANSCRIPT_BUCKET,
    workerAuthorization: env.WORKER_AUTHORIZATION,
    workerMode: env.WORKER_MODE ?? "once",
    workerExecutionLocation: env.WORKER_EXECUTION_LOCATION ?? "local",
    workerConcurrency: env.WORKER_CONCURRENCY ?? 1,
    workerPollIntervalMs: env.WORKER_POLL_INTERVAL_MS ?? 2_000,
    workerErrorBackoffMs: env.WORKER_ERROR_BACKOFF_MS ?? 5_000,
    workerLeaseSeconds: env.WORKER_LEASE_SECONDS ?? 120,
  });
}
