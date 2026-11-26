import { isAbsolute, join, resolve } from "node:path";

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
    cloudAuthMode: z.enum(["development", "browser", "cognito"]),
    cognitoUserPoolId: z.string().trim().min(1).optional(),
    browserPublicOrigin: z.string().optional(),
    browserCallbackUrl: z.string().optional(),
    browserLogoutUrl: z.string().optional(),
    cognitoRedirectUri: z
      .literal("research-video-clips://oauth/callback")
      .optional(),
    cognitoLogoutUri: z
      .literal("research-video-clips://oauth/logout")
      .optional(),
    cognitoIssuer: z.string().optional(),
    cognitoDomain: z.url().optional(),
    cognitoClientId: z.string().trim().min(1).optional(),
    cognitoClientSecret: z.string().min(1).optional(),
    trustedProxyPeers: z.array(LoopbackHostSchema),
    cloudflareAccessTeamDomain: z.string().optional(),
    cloudflareAccessAud: z.string().optional(),
    operatorPort: PortSchema,
    diskPauseBelowMb: z.coerce.number().int().min(256).max(1_048_576),
    browserSessionIdleMs: z.coerce.number().int().min(60_000).max(3_600_000),
    browserSessionAbsoluteMs: z.coerce
      .number()
      .int()
      .min(300_000)
      .max(86_400_000),
    cloudApiPort: PortSchema,
    publicApiOrigin: z.url().optional(),
    cloudDatabaseMode: z.enum(["pglite", "postgres"]),
    databaseUrl: z.string().trim().min(1).optional(),
    databaseHost: z.string().trim().min(1).optional(),
    databasePort: PortSchema.optional(),
    databaseName: z.string().trim().min(1).optional(),
    databaseUsername: z.string().trim().min(1).optional(),
    databasePassword: z.string().min(1).optional(),
    databaseSslMode: z.enum(["disable", "require", "verify-full"]),
    databaseCaCertPath: z.string().trim().min(1).optional(),
    runtimeMode: z.enum(["development", "mac-pilot", "managed-local"]),
    databaseMode: z.enum(["pglite", "postgres"]),
    pilotPgUrl: z.string().optional(),
    pilotObjectRoot: z.string().optional(),
    localSigningSecret: z.string().optional(),
    webPort: PortSchema,
    dataDir: z.string().min(1),
    clipExportDir: z
      .string()
      .refine((path) => isAbsolute(path) && !path.includes("\0"), {
        message: "CLIP_EXPORT_DIR must be an absolute local directory",
      }),
    objectStoreMode: z.enum(["memory", "s3", "local"]),
    queueMode: z.enum(["memory", "sqs"]),
    awsDevDurability: z.enum(["disabled", "enabled"]),
    jobQueueUrl: z.url().optional(),
    captionProvider: z.enum(["disabled", "yt-dlp"]),
    mediaProvider: z.enum(["disabled", "yt-dlp-audio"]),
    exportSourceProvider: z.enum(["disabled", "yt-dlp"]),
    ytDlpPath: z.string().trim().min(1),
    youtubeApiKey: z.string().trim().min(1).optional(),
    ffmpegPath: z.string().trim().min(1),
    wordTimingPython: z.string().trim().min(1).optional(),
    ffprobePath: z.string().trim().min(1),
    speechToTextProvider: z.enum(["disabled", "whisper-cpp"]),
    whisperCppPath: z.string().trim().min(1),
    whisperCppModelPath: z.string().trim().min(1).optional(),
    whisperCppModelName: z.string().trim().min(1).optional(),
    translationProvider: z
      .string()
      .regex(/^(disabled|[a-z0-9][a-z0-9.-]{1,158}[a-z0-9])$/u),
    awsTranslateTerminology: z.string().trim().min(1).optional(),
    localModelCatalogSigningKeyId: z.string().trim().min(1).max(160).optional(),
    localModelCatalogSigningPrivateKeyBase64: z
      .string()
      .trim()
      .min(1)
      .optional(),
    localModelCatalogTrustRoots: z.record(
      z.string().trim().min(1).max(160),
      z.string().trim().min(1).max(32_768),
    ),
    argosSidecarPath: z.string().trim().min(1).optional(),
    argosRuntimeVersions: z.array(z.string().trim().min(1).max(160)).max(32),
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
    if (
      config.nodeEnv === "production" &&
      config.cloudAuthMode === "development"
    ) {
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
    if (config.operatorPort === config.cloudApiPort)
      reject("operatorPort", "OPERATOR_PORT must differ from CLOUD_API_PORT");
    const accessConfigured =
      config.cloudflareAccessTeamDomain !== undefined ||
      config.cloudflareAccessAud !== undefined;
    if (accessConfigured) {
      let teamOk = false;
      try {
        const team = new URL(config.cloudflareAccessTeamDomain ?? "");
        teamOk =
          team.protocol === "https:" &&
          team.origin === config.cloudflareAccessTeamDomain &&
          /^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(team.hostname);
      } catch {
        // Rejected below.
      }
      if (!teamOk)
        reject(
          "cloudflareAccessTeamDomain",
          "CF_ACCESS_TEAM_DOMAIN must be a bare https://<team>.cloudflareaccess.com origin",
        );
      if (!/^[0-9a-f]{64}$/u.test(config.cloudflareAccessAud ?? ""))
        reject(
          "cloudflareAccessAud",
          "CF_ACCESS_AUD must be the Access application's 64-character audience tag",
        );
      if (config.cloudAuthMode !== "browser")
        reject(
          "cloudflareAccessAud",
          "Cloudflare Access verification requires browser BFF mode",
        );
    }
    if (
      config.nodeEnv === "production" &&
      config.runtimeMode === "mac-pilot" &&
      !accessConfigured
    )
      reject(
        "cloudflareAccessAud",
        "A friend-facing Mac pilot requires CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD",
      );
    if (
      config.nodeEnv === "production" &&
      config.runtimeMode !== "mac-pilot" &&
      !(
        config.runtimeRole === "cloud-api" &&
        config.cloudDatabaseMode === "postgres"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["runtimeMode"],
        message:
          "Production configuration must explicitly select a durable runtime",
      });
    }
    if (config.runtimeMode === "managed-local") {
      if (
        config.nodeEnv === "production" ||
        config.cloudAuthMode !== "development"
      )
        reject(
          "runtimeMode",
          "Managed Research is development-only and cannot enable browser BFF mode",
        );
      if (!["127.0.0.1", "localhost", "::1"].includes(config.cloudApiHost))
        reject(
          "cloudApiHost",
          "Managed Research cloud API must bind to loopback",
        );
      if (
        config.databaseMode !== "pglite" ||
        config.objectStoreMode !== "local" ||
        config.queueMode !== "memory"
      )
        reject(
          "runtimeMode",
          "Managed Research requires isolated PGlite, signed local objects and memory queue",
        );
      if (
        !config.pilotObjectRoot ||
        !isAbsolute(config.pilotObjectRoot) ||
        config.pilotObjectRoot.includes("\0") ||
        resolve(config.pilotObjectRoot) !==
          join(config.dataDir, "transcript-objects")
      )
        reject(
          "pilotObjectRoot",
          "Managed Research requires objects under its private data root",
        );
      if (
        !config.localSigningSecret ||
        Buffer.byteLength(config.localSigningSecret) < 32
      )
        reject(
          "localSigningSecret",
          "Managed Research requires a private signing secret of at least 32 bytes",
        );
      if (
        config.workerMode !== "continuous" ||
        config.workerExecutionLocation !== "local" ||
        !config.workerAuthorization
      )
        reject(
          "workerMode",
          "Managed Research requires a continuously running authorized local worker",
        );
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
      config.runtimeMode !== "managed-local" &&
      (config.databaseMode !== "pglite" || config.objectStoreMode === "local")
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
    if (config.wordTimingPython && config.mediaProvider !== "yt-dlp-audio") {
      context.addIssue({
        code: "custom",
        path: ["wordTimingPython"],
        message: "VERA_WORD_TIMING_PYTHON requires MEDIA_PROVIDER=yt-dlp-audio",
      });
    }
    if (config.wordTimingPython && config.workerExecutionLocation !== "local") {
      context.addIssue({
        code: "custom",
        path: ["wordTimingPython"],
        message: "VERA_WORD_TIMING_PYTHON is only supported by local workers",
      });
    }
    if (config.localAgentPort === 0 && config.runtimeRole !== "desktop-local") {
      context.addIssue({
        code: "custom",
        path: ["localAgentPort"],
        message:
          "Only the supervised desktop agent may request an ephemeral port",
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
    if (config.awsDevDurability === "enabled") {
      if (
        config.nodeEnv === "production" ||
        config.runtimeRole !== "cloud-api" ||
        config.runtimeMode !== "development" ||
        config.cloudDatabaseMode !== "pglite" ||
        config.cloudAuthMode !== "cognito" ||
        !config.publicApiOrigin?.startsWith("https://") ||
        config.objectStoreMode !== "s3" ||
        config.queueMode !== "sqs"
      ) {
        reject(
          "awsDevDurability",
          "AWS_DEV_DURABILITY=enabled requires the HTTPS Cognito development cloud API with PGlite, S3 and SQS",
        );
      }
      const queue = config.jobQueueUrl && URL.parse(config.jobQueueUrl);
      if (
        !queue ||
        queue.host !== `sqs.${config.awsRegion}.amazonaws.com` ||
        queue.protocol !== "https:" ||
        queue.username ||
        queue.password ||
        queue.search ||
        queue.hash ||
        !/^\/[0-9]{12}\/[a-zA-Z0-9_-]{1,80}$/u.test(queue.pathname)
      ) {
        reject("jobQueueUrl", "Use the regional HTTPS SQS Standard queue URL");
      }
      if (
        !config.transcriptBucket ||
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.transcriptBucket)
      ) {
        reject("transcriptBucket", "Use the S3 transcript bucket name");
      }
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
    if (
      Boolean(config.localModelCatalogSigningKeyId) !==
      Boolean(config.localModelCatalogSigningPrivateKeyBase64)
    ) {
      context.addIssue({
        code: "custom",
        path: ["localModelCatalogSigningPrivateKeyBase64"],
        message:
          "LOCAL_MODEL_CATALOG_SIGNING_KEY_ID and LOCAL_MODEL_CATALOG_SIGNING_PRIVATE_KEY_BASE64 must be configured together",
      });
    }
    if (
      config.nodeEnv === "production" &&
      config.runtimeRole === "cloud-api" &&
      config.runtimeMode !== "mac-pilot"
    ) {
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
          config.cloudAuthMode === "browser" ||
            config.cloudAuthMode === "cognito",
          "cloudAuthMode",
          "Production requires authenticated cloud mode.",
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
    cloudAuthMode: env.CLOUD_AUTH_MODE ?? "development",
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID,
    browserPublicOrigin: env.BROWSER_PUBLIC_ORIGIN,
    browserCallbackUrl: env.BROWSER_CALLBACK_URL,
    browserLogoutUrl: env.BROWSER_LOGOUT_URL,
    cognitoRedirectUri: env.COGNITO_REDIRECT_URI,
    cognitoLogoutUri: env.COGNITO_LOGOUT_URI,
    cognitoIssuer: env.COGNITO_ISSUER,
    cognitoDomain: env.COGNITO_DOMAIN,
    cognitoClientId: env.COGNITO_CLIENT_ID,
    cognitoClientSecret: env.COGNITO_CLIENT_SECRET,
    trustedProxyPeers: (env.TRUSTED_PROXY_PEERS ?? "127.0.0.1,::1")
      .split(",")
      .map((value) => value.trim()),
    cloudflareAccessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    cloudflareAccessAud: env.CF_ACCESS_AUD,
    operatorPort: env.OPERATOR_PORT ?? 43_114,
    diskPauseBelowMb: env.PILOT_DISK_PAUSE_BELOW_MB ?? 2_048,
    browserSessionIdleMs: env.BROWSER_SESSION_IDLE_MS ?? 1_800_000,
    browserSessionAbsoluteMs: env.BROWSER_SESSION_ABSOLUTE_MS ?? 28_800_000,
    cloudApiPort: env.CLOUD_API_PORT ?? 43_111,
    publicApiOrigin: env.PUBLIC_API_ORIGIN,
    cloudDatabaseMode: env.CLOUD_DATABASE_MODE ?? "pglite",
    databaseUrl: env.DATABASE_URL,
    databaseHost: env.DATABASE_HOST,
    databasePort: env.DATABASE_PORT,
    databaseName: env.DATABASE_NAME,
    databaseUsername: env.DATABASE_USERNAME,
    databasePassword: env.DATABASE_PASSWORD,
    databaseSslMode: env.DATABASE_SSL_MODE ?? "disable",
    databaseCaCertPath: env.DATABASE_CA_CERT_PATH,
    runtimeMode: env.VERA_RUNTIME_MODE ?? "development",
    databaseMode: env.DATABASE_MODE ?? "pglite",
    pilotPgUrl: env.PILOT_PG_URL,
    pilotObjectRoot: env.PILOT_OBJECT_ROOT,
    localSigningSecret: env.LOCAL_UPLOAD_SIGNING_SECRET,
    webPort: env.WEB_PORT ?? 43_112,
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    clipExportDir:
      env.CLIP_EXPORT_DIR ?? join(resolve(env.DATA_DIR ?? "./data"), "exports"),
    objectStoreMode: env.OBJECT_STORE_MODE ?? "memory",
    queueMode: env.QUEUE_MODE ?? "memory",
    awsDevDurability: env.AWS_DEV_DURABILITY ?? "disabled",
    jobQueueUrl: env.JOB_QUEUE_URL,
    captionProvider: env.CAPTION_PROVIDER ?? "disabled",
    mediaProvider: env.MEDIA_PROVIDER ?? "disabled",
    exportSourceProvider: env.EXPORT_SOURCE_PROVIDER ?? "disabled",
    ytDlpPath: env.YT_DLP_PATH ?? "yt-dlp",
    youtubeApiKey: env.YOUTUBE_API_KEY,
    ffmpegPath: env.FFMPEG_PATH ?? "ffmpeg",
    wordTimingPython: env.VERA_WORD_TIMING_PYTHON,
    ffprobePath: env.FFPROBE_PATH ?? "ffprobe",
    speechToTextProvider: env.SPEECH_TO_TEXT_PROVIDER ?? "disabled",
    whisperCppPath: env.WHISPER_CPP_PATH ?? "whisper-cli",
    whisperCppModelPath: env.WHISPER_CPP_MODEL_PATH,
    whisperCppModelName: env.WHISPER_CPP_MODEL_NAME,
    translationProvider: env.TRANSLATION_PROVIDER ?? "disabled",
    awsTranslateTerminology: env.AWS_TRANSLATE_TERMINOLOGY,
    localModelCatalogSigningKeyId: env.LOCAL_MODEL_CATALOG_SIGNING_KEY_ID,
    localModelCatalogSigningPrivateKeyBase64:
      env.LOCAL_MODEL_CATALOG_SIGNING_PRIVATE_KEY_BASE64,
    localModelCatalogTrustRoots: parseStringRecord(
      env.LOCAL_MODEL_CATALOG_TRUST_ROOTS_JSON,
    ),
    argosSidecarPath: env.ARGOS_SIDECAR_PATH,
    argosRuntimeVersions: (env.ARGOS_RUNTIME_VERSIONS ?? "1.9")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
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

function parseStringRecord(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
