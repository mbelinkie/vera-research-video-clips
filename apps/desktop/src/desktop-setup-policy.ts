import {
  SetupSnapshotSchema,
  deriveReadinessReport,
  type ComponentHealth,
  type ReadinessReport,
  type SetupAction,
  type SetupSnapshot,
} from "@research-video/contracts";

export type TrustedRuntimePaths = Readonly<{
  outputRoot?: string;
  cacheRoot?: string;
  ffmpeg?: string;
  ffprobe?: string;
  ytDlp?: string;
  whisperCli?: string;
  whisperModel?: string;
}>;

export function setupActionRequiresRuntimeRestart(
  action: SetupAction,
): boolean {
  return (
    action.action === "set_translation_consent" ||
    action.action === "set_caption_provider" ||
    action.action === "set_media_provider" ||
    action.action === "set_export_source_provider" ||
    action.action === "set_speech_to_text_provider" ||
    action.action === "set_translation_provider"
  );
}

export function modelDownloadCanCancel(
  state:
    | "preparing"
    | "downloading"
    | "verifying"
    | "promoting"
    | "completed"
    | "canceled"
    | "failed",
): boolean {
  return (
    state === "preparing" || state === "downloading" || state === "verifying"
  );
}

export function shouldRunTranscriptionWorker(input: {
  signedIn: boolean;
  snapshot: SetupSnapshot;
  localReadiness: ReadinessReport;
}): boolean {
  const health = new Map(
    input.localReadiness.components.map((component) => [
      component.component,
      component.state,
    ]),
  );
  return (
    input.signedIn &&
    input.snapshot.setup?.workerEnabled === true &&
    (
      [
        "cache_root",
        "media_provider",
        "speech_to_text_provider",
        "yt_dlp",
        "whisper_cli",
        "whisper_model",
        "cache_storage",
      ] as const
    ).every((component) => {
      const state = health.get(component);
      return (
        state === "ready" ||
        (component === "cache_storage" && state === "degraded")
      );
    })
  );
}

export function shouldRunExportSupervisor(input: {
  signedIn: boolean;
  snapshot: SetupSnapshot;
  localReadiness: ReadinessReport;
}): boolean {
  const health = new Map(
    input.localReadiness.components.map((component) => [
      component.component,
      component.state,
    ]),
  );
  return (
    input.signedIn &&
    input.snapshot.setup?.workerEnabled === true &&
    (
      [
        "output_root",
        "export_source_provider",
        "ffmpeg",
        "ffprobe",
        "yt_dlp",
        "output_storage",
      ] as const
    ).every((component) => {
      const state = health.get(component);
      return (
        state === "ready" ||
        (component === "output_storage" && state === "degraded")
      );
    })
  );
}

export function applyModelPinAvailability(
  report: ReadinessReport,
  pinConfigured: boolean,
  checkedAt: string,
): ReadinessReport {
  if (pinConfigured) return report;
  return {
    ...report,
    components: report.components.map((component) =>
      component.component === "whisper_model"
        ? {
            component: "whisper_model" as const,
            state: "needs_action" as const,
            reason: "model_pin_required" as const,
            remediation: "configure_model_pin" as const,
            checkedAt,
          }
        : component,
    ),
  };
}

export function mergeDesktopReadiness(input: {
  checkedAt: string;
  local: ReadinessReport;
  external: readonly ComponentHealth[];
}): ReadinessReport {
  return deriveReadinessReport({
    checkedAt: input.checkedAt,
    components: [...input.local.components, ...input.external],
    requirements: {
      project_browsing: ["desktop", "authentication", "cloud_api", "network"],
      verified_cached_review: [
        "desktop",
        "authentication",
        "local_database",
        "cache_root",
      ],
      project_logging: ["desktop", "authentication", "cloud_api", "network"],
      transcript_processing: [
        "desktop",
        "authentication",
        "cloud_api",
        "network",
        "local_database",
        "cache_root",
        "media_provider",
        "speech_to_text_provider",
        "yt_dlp",
        "whisper_cli",
        "whisper_model",
        "cache_storage",
        "transcription_worker",
      ],
      export_processing: [
        "desktop",
        "authentication",
        "cloud_api",
        "network",
        "local_database",
        "output_root",
        "export_source_provider",
        "export_worker",
        "ffmpeg",
        "ffprobe",
        "yt_dlp",
        "output_storage",
      ],
    },
  });
}

export function parseTrustedRuntimePaths(value: unknown): TrustedRuntimePaths {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local setup is unavailable.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "outputRoot",
    "cacheRoot",
    "ffmpeg",
    "ffprobe",
    "ytDlp",
    "whisperCli",
    "whisperModel",
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    Object.values(record).some(
      (candidate) => candidate !== undefined && typeof candidate !== "string",
    )
  ) {
    throw new Error("Local setup is unavailable.");
  }
  return Object.freeze({
    ...(typeof record.outputRoot === "string"
      ? { outputRoot: record.outputRoot }
      : {}),
    ...(typeof record.cacheRoot === "string"
      ? { cacheRoot: record.cacheRoot }
      : {}),
    ...(typeof record.ffmpeg === "string" ? { ffmpeg: record.ffmpeg } : {}),
    ...(typeof record.ffprobe === "string" ? { ffprobe: record.ffprobe } : {}),
    ...(typeof record.ytDlp === "string" ? { ytDlp: record.ytDlp } : {}),
    ...(typeof record.whisperCli === "string"
      ? { whisperCli: record.whisperCli }
      : {}),
    ...(typeof record.whisperModel === "string"
      ? { whisperModel: record.whisperModel }
      : {}),
  });
}

export function resolveWorkerConfiguration(
  rawSnapshot: unknown,
  paths: TrustedRuntimePaths,
) {
  const snapshot = SetupSnapshotSchema.parse(rawSnapshot);
  const setup = snapshot.setup;
  const model = snapshot.activeComponents.find(
    (component) => component.target === "whisper_model",
  );
  if (
    !setup?.workerEnabled ||
    setup.mediaProvider !== "yt_dlp_audio" ||
    setup.speechToTextProvider !== "whisper_cpp" ||
    !paths.ffmpeg ||
    !paths.ffprobe ||
    !paths.ytDlp ||
    !paths.whisperCli ||
    !paths.whisperModel ||
    !paths.cacheRoot ||
    !model
  ) {
    throw new Error("The local transcription worker is not ready.");
  }
  return Object.freeze({
    captionProvider: setup.captionProvider === "yt_dlp" ? "yt-dlp" : "disabled",
    mediaProvider: "yt-dlp-audio" as const,
    translationProvider:
      setup.translationProvider === "aws_translate" && setup.translationConsent
        ? ("aws-translate" as const)
        : ("disabled" as const),
    ffmpeg: paths.ffmpeg,
    ffprobe: paths.ffprobe,
    ytDlp: paths.ytDlp,
    whisperCli: paths.whisperCli,
    whisperModel: paths.whisperModel,
    whisperModelName: model.version ?? model.displayName,
    cacheRoot: paths.cacheRoot,
  });
}
