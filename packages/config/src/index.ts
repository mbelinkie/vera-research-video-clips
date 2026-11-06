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
const MillisecondsSchema = z.coerce.number().int().min(1).max(60_000);

export const AppConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    localAgentHost: LoopbackHostSchema,
    localAgentPort: PortSchema,
    cloudApiHost: z.string().min(1),
    cloudAuthMode: z.enum(["development", "browser"]),
    browserPublicOrigin: z.string().optional(),
    browserCallbackUrl: z.string().optional(),
    browserLogoutUrl: z.string().optional(),
    cognitoIssuer: z.string().optional(),
    cognitoDomain: z.string().optional(),
    cognitoClientId: z.string().trim().min(1).optional(),
    cognitoClientSecret: z.string().min(1).optional(),
    trustedProxyPeers: z.array(LoopbackHostSchema),
    browserSessionIdleMs: z.coerce.number().int().min(60_000).max(3_600_000),
    browserSessionAbsoluteMs: z.coerce
      .number()
      .int()
      .min(300_000)
      .max(86_400_000),
    cloudApiPort: PortSchema,
    webPort: PortSchema,
    dataDir: z.string().min(1),
    objectStoreMode: z.enum(["memory", "s3"]),
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
    const reject = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (config.nodeEnv === "production" && config.cloudAuthMode !== "browser") {
      reject("cloudAuthMode", "Production cloud API requires browser BFF mode");
    }
    if (
      config.cloudAuthMode === "development" &&
      !["localhost", "127.0.0.1", "::1"].includes(config.cloudApiHost)
    ) {
      reject("cloudApiHost", "Development bearer API must bind to loopback");
    }
    if (config.cloudAuthMode === "browser") {
      if (!["localhost", "127.0.0.1", "::1"].includes(config.cloudApiHost)) {
        reject(
          "cloudApiHost",
          "Browser BFF must be behind a local TLS ingress on loopback",
        );
      }
      const origin = config.browserPublicOrigin;
      try {
        const url = new URL(origin ?? "");
        if (
          url.protocol !== "https:" ||
          url.origin !== origin ||
          url.username ||
          url.password ||
          url.hash ||
          url.search
        )
          throw Error();
      } catch {
        reject(
          "browserPublicOrigin",
          "BROWSER_PUBLIC_ORIGIN must be an exact bare HTTPS origin",
        );
      }
      if (
        !origin ||
        config.browserCallbackUrl !== `${origin}/cloud-api/auth/callback`
      ) {
        reject(
          "browserCallbackUrl",
          "BROWSER_CALLBACK_URL must match exact HTTPS /cloud-api/auth/callback",
        );
      }
      if (!origin || config.browserLogoutUrl !== `${origin}/`) {
        reject(
          "browserLogoutUrl",
          "BROWSER_LOGOUT_URL must match exact HTTPS origin root",
        );
      }
      if (
        !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-]+_[A-Za-z0-9]+$/u.test(
          config.cognitoIssuer ?? "",
        )
      ) {
        reject(
          "cognitoIssuer",
          "COGNITO_ISSUER must identify an exact AWS Cognito user pool",
        );
      }
      try {
        const domain = new URL(config.cognitoDomain ?? "");
        if (
          domain.protocol !== "https:" ||
          domain.origin !== config.cognitoDomain ||
          domain.username ||
          domain.password
        )
          throw Error();
      } catch {
        reject(
          "cognitoDomain",
          "COGNITO_DOMAIN must be a bare HTTPS Managed Login origin",
        );
      }
      if (!config.cognitoClientId)
        reject("cognitoClientId", "COGNITO_CLIENT_ID required");
      if (!config.cognitoClientSecret)
        reject(
          "cognitoClientSecret",
          "COGNITO_CLIENT_SECRET required (server only)",
        );
      if (config.browserSessionIdleMs > config.browserSessionAbsoluteMs)
        reject(
          "browserSessionIdleMs",
          "Idle timeout cannot exceed absolute timeout",
        );
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
    cloudAuthMode: env.CLOUD_AUTH_MODE ?? "development",
    browserPublicOrigin: env.BROWSER_PUBLIC_ORIGIN,
    browserCallbackUrl: env.BROWSER_CALLBACK_URL,
    browserLogoutUrl: env.BROWSER_LOGOUT_URL,
    cognitoIssuer: env.COGNITO_ISSUER,
    cognitoDomain: env.COGNITO_DOMAIN,
    cognitoClientId: env.COGNITO_CLIENT_ID,
    cognitoClientSecret: env.COGNITO_CLIENT_SECRET,
    trustedProxyPeers: (env.TRUSTED_PROXY_PEERS ?? "127.0.0.1,::1")
      .split(",")
      .map((value) => value.trim()),
    browserSessionIdleMs: env.BROWSER_SESSION_IDLE_MS ?? 1_800_000,
    browserSessionAbsoluteMs: env.BROWSER_SESSION_ABSOLUTE_MS ?? 28_800_000,
    cloudApiPort: env.CLOUD_API_PORT ?? 43_111,
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
