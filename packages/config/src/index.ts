import { isAbsolute, resolve } from "node:path";

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
const MillisecondsSchema = z.coerce.number().int().min(1).max(60_000);

export const AppConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    localAgentHost: LoopbackHostSchema,
    localAgentPort: PortSchema,
    cloudApiHost: z.string().min(1),
    cloudApiPort: PortSchema,
    runtimeMode: z.enum(["development", "mac-pilot"]),
    databaseMode: z.enum(["pglite", "postgres"]),
    pilotPgUrl: z.string().optional(),
    pilotObjectRoot: z.string().optional(),
    localSigningSecret: z.string().optional(),
    webPort: PortSchema,
    dataDir: z.string().min(1),
    objectStoreMode: z.enum(["memory", "s3", "local"]),
    queueMode: z.enum(["memory", "sqs"]),
    captionProvider: z.enum(["disabled", "yt-dlp"]),
    mediaProvider: z.enum(["disabled", "yt-dlp-audio"]),
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
    if (config.nodeEnv === "production" && config.runtimeMode !== "mac-pilot") {
      context.addIssue({
        code: "custom",
        path: ["runtimeMode"],
        message:
          "Production configuration must explicitly select a durable runtime",
      });
    }
    if (config.runtimeMode === "mac-pilot") {
      if (
        config.databaseMode !== "postgres" ||
        config.objectStoreMode !== "local"
      ) {
        context.addIssue({
          code: "custom",
          path: ["runtimeMode"],
          message: "Mac pilot requires PostgreSQL and local durable objects",
        });
      }
      if (!["127.0.0.1", "localhost", "::1"].includes(config.cloudApiHost)) {
        context.addIssue({
          code: "custom",
          path: ["cloudApiHost"],
          message: "Mac pilot cloud API must bind to loopback",
        });
      }
      if (!config.pilotObjectRoot || !isAbsolute(config.pilotObjectRoot)) {
        context.addIssue({
          code: "custom",
          path: ["pilotObjectRoot"],
          message: "Mac pilot requires an absolute local object root",
        });
      }
      if (
        !config.localSigningSecret ||
        Buffer.byteLength(config.localSigningSecret) < 32
      ) {
        context.addIssue({
          code: "custom",
          path: ["localSigningSecret"],
          message:
            "Mac pilot requires a private signing secret of at least 32 bytes",
        });
      }
      let safePgUrl = false;
      try {
        const pg = new URL(config.pilotPgUrl ?? "");
        safePgUrl =
          ["postgres:", "postgresql:"].includes(pg.protocol) &&
          ["127.0.0.1", "localhost", "[::1]"].includes(pg.hostname) &&
          Boolean(pg.username && pg.password) &&
          !pg.hash;
      } catch {
        // Refuse absent or malformed local PostgreSQL URLs.
      }
      if (!safePgUrl) {
        context.addIssue({
          code: "custom",
          path: ["pilotPgUrl"],
          message: "Mac pilot requires a credentialed loopback PostgreSQL URL",
        });
      }
      if (config.queueMode !== "memory") {
        context.addIssue({
          code: "custom",
          path: ["queueMode"],
          message: "Mac pilot cannot enable a hosted queue",
        });
      }
    } else if (
      config.databaseMode !== "pglite" ||
      config.objectStoreMode === "local"
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeMode"],
        message: "PostgreSQL/local objects require explicit Mac pilot mode",
      });
    }
    if (config.objectStoreMode === "s3" && !config.transcriptBucket) {
      context.addIssue({
        code: "custom",
        path: ["transcriptBucket"],
        message: "TRANSCRIPT_BUCKET is required when OBJECT_STORE_MODE=s3",
      });
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
    localAgentHost: env.LOCAL_AGENT_HOST ?? "127.0.0.1",
    localAgentPort: env.LOCAL_AGENT_PORT ?? 43_110,
    cloudApiHost: env.CLOUD_API_HOST ?? "127.0.0.1",
    cloudApiPort: env.CLOUD_API_PORT ?? 43_111,
    runtimeMode: env.VERA_RUNTIME_MODE ?? "development",
    databaseMode: env.DATABASE_MODE ?? "pglite",
    pilotPgUrl: env.PILOT_PG_URL,
    pilotObjectRoot: env.PILOT_OBJECT_ROOT,
    localSigningSecret: env.LOCAL_UPLOAD_SIGNING_SECRET,
    webPort: env.WEB_PORT ?? 43_112,
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    objectStoreMode: env.OBJECT_STORE_MODE ?? "memory",
    queueMode: env.QUEUE_MODE ?? "memory",
    captionProvider: env.CAPTION_PROVIDER ?? "disabled",
    mediaProvider: env.MEDIA_PROVIDER ?? "disabled",
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
