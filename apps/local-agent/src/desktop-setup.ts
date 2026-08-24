import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rm,
  statfs as nodeStatfs,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import {
  deriveReadinessReport,
  type ComponentHealth,
  type ComponentKind,
  type ReadinessReport,
  type SetupAction,
  type SetupSelectionTarget,
  type SetupSnapshot,
} from "@research-video/contracts";
import {
  LocalDesktopSetupRepository,
  type TrustedLocalComponentReference,
} from "@research-video/db-local";
import {
  SpawnMediaCommandRunner,
  type MediaCommandRunner,
} from "@research-video/media";

const ProbeTimeoutMs = 5_000;
const MaximumProbeOutputCharacters = 64 * 1_024;
const MaximumPathLength = 4_096;
const MaximumModelBytes = 100 * 1024 * 1024 * 1024;
const MaximumToolBytes = 2 * 1024 * 1024 * 1024;
const Gibibyte = 1024 * 1024 * 1024;
const StorageRecommendationBytes = 10 * Gibibyte;
const StorageReserveBytes = 2 * Gibibyte;

const componentForTarget: Record<SetupSelectionTarget, ComponentKind> = {
  output_root: "output_root",
  cache_root: "cache_root",
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  yt_dlp: "yt_dlp",
  whisper_cli: "whisper_cli",
  whisper_model: "whisper_model",
};

const remediationForTarget: Record<
  SetupSelectionTarget,
  ComponentHealth["remediation"]
> = {
  output_root: "select_output_root",
  cache_root: "select_cache_root",
  ffmpeg: "select_ffmpeg",
  ffprobe: "select_ffprobe",
  yt_dlp: "select_yt_dlp",
  whisper_cli: "select_whisper_cli",
  whisper_model: "select_whisper_model",
};

const toolProbes: Record<
  Exclude<SetupSelectionTarget, "output_root" | "cache_root" | "whisper_model">,
  readonly (readonly string[])[]
> = {
  ffmpeg: [
    ["-hide_banner", "-version"],
    ["-hide_banner", "-encoders"],
    ["-hide_banner", "-muxers"],
    ["-hide_banner", "-filters"],
  ],
  ffprobe: [
    [
      "-v",
      "error",
      "-show_program_version",
      "-show_library_versions",
      "-of",
      "json",
    ],
  ],
  yt_dlp: [
    ["--ignore-config", "--version"],
    ["--ignore-config", "--help"],
  ],
  whisper_cli: [["--help"]],
};

export type WhisperModelPin = {
  displayName: string;
  expectedBytes: number;
  expectedSha256: string;
  version: string;
};

export type DesktopSetupStatfs = (path: string) => Promise<{
  bavail: bigint | number;
  bsize: bigint | number;
}>;

export type TrustedDesktopRuntimeConfig = Readonly<{
  outputRoot: string | undefined;
  cacheRoot: string | undefined;
  ffmpeg: string | undefined;
  ffprobe: string | undefined;
  ytDlp: string | undefined;
  whisperCli: string | undefined;
  whisperModel: string | undefined;
}>;

export class DesktopSetupValidationError extends Error {
  readonly statusCode = 400;

  constructor(
    readonly code:
      | "invalid_path"
      | "invalid_root"
      | "invalid_tool"
      | "invalid_model"
      | "tool_probe_failed"
      | "model_pin_invalid",
  ) {
    super("The selected local component could not be validated.");
  }
}

/**
 * The service is owned by the local agent. Its snapshot/readiness methods are
 * path-free; only `getTrustedRuntimeConfig` may expose validated paths and is
 * for main-process runtime construction, never IPC or renderer use.
 */
export class LocalDesktopSetupService {
  constructor(
    private readonly repository: LocalDesktopSetupRepository,
    private readonly dependencies: {
      commandRunner?: MediaCommandRunner;
      statfs?: DesktopSetupStatfs;
      now?: () => Date;
      measuredOperationBytes?: (target: "output_root" | "cache_root") => number;
      exportWorkerStatus?: () => {
        available: boolean;
        issue?:
          | "authentication_required"
          | "cloud_unavailable"
          | "configuration_required"
          | "worker_unavailable";
      };
    } = {},
  ) {}

  async selectRoot(input: {
    target: "output_root" | "cache_root";
    absolutePath: string;
    displayName?: string;
  }): Promise<SetupSnapshot> {
    const identity = await validateDirectoryForWrite(input.absolutePath);
    const candidate = this.repository.recordValidatedCandidate({
      target: input.target,
      displayName: input.displayName ?? safeDisplayName(input.absolutePath),
      absolutePath: input.absolutePath,
      filesystemIdentity: identity,
      validationEvidence: { kind: "directory", identity },
    });
    this.repository.activateValidatedCandidate(candidate.id);
    return this.repository.getSetupSnapshot();
  }

  async selectTool(input: {
    target: "ffmpeg" | "ffprobe" | "yt_dlp" | "whisper_cli";
    absolutePath: string;
    displayName?: string;
  }): Promise<SetupSnapshot> {
    const probes = toolProbes[input.target];
    const inspected = await validateExecutable(input.absolutePath);
    const runner =
      this.dependencies.commandRunner ?? new SpawnMediaCommandRunner();
    let results: { stdout: string; stderr: string }[];
    try {
      results = await Promise.all(
        probes.map((probe) =>
          runner.run(input.absolutePath, probe, { timeoutMs: ProbeTimeoutMs }),
        ),
      );
    } catch {
      throw new DesktopSetupValidationError("tool_probe_failed");
    }
    if (!hasRequiredToolCapabilities(input.target, results)) {
      throw new DesktopSetupValidationError("tool_probe_failed");
    }
    const after = await validateExecutable(input.absolutePath);
    if (
      inspected.identity !== after.identity ||
      inspected.contentSha256 !== after.contentSha256
    ) {
      throw new DesktopSetupValidationError("invalid_tool");
    }
    const version = probeVersion(input.target, results[0]!);
    const candidate = this.repository.recordValidatedCandidate({
      target: input.target,
      displayName: input.displayName ?? safeDisplayName(input.absolutePath),
      absolutePath: input.absolutePath,
      filesystemIdentity: inspected.identity,
      ...(version ? { version } : {}),
      byteSize: inspected.byteSize,
      contentSha256: inspected.contentSha256,
      validationEvidence: {
        kind: "tool",
        identity: inspected.identity,
        probes: probes.map((probe) => [...probe]),
        outputFingerprint: hashProbeOutput(results),
        contentSha256: inspected.contentSha256,
      },
    });
    this.repository.activateValidatedCandidate(candidate.id);
    return this.repository.getSetupSnapshot();
  }

  async activateWhisperModel(input: {
    absolutePath: string;
    pin: WhisperModelPin;
  }): Promise<SetupSnapshot> {
    const pin = validateModelPin(input.pin);
    const inspected = await validateModelFile(input.absolutePath, pin);
    const candidate = this.repository.recordValidatedCandidate({
      target: "whisper_model",
      displayName: pin.displayName,
      absolutePath: input.absolutePath,
      filesystemIdentity: inspected.identity,
      version: pin.version,
      byteSize: pin.expectedBytes,
      contentSha256: pin.expectedSha256,
      validationEvidence: {
        kind: "whisper_model",
        identity: inspected.identity,
        byteSize: pin.expectedBytes,
        contentSha256: pin.expectedSha256,
      },
    });
    this.repository.activateValidatedCandidate(candidate.id);
    return this.repository.getSetupSnapshot();
  }

  getSnapshot(): SetupSnapshot {
    return this.repository.getSetupSnapshot();
  }

  updateSetup(action: SetupAction): SetupSnapshot {
    const current = this.repository.getSetup() ?? defaultDesktopSetup();
    switch (action.action) {
      case "set_rights_acknowledgement":
        this.repository.saveSetup({
          ...current,
          rightsAcknowledged: action.acknowledged,
        });
        break;
      case "set_privacy_acknowledgement":
        this.repository.saveSetup({
          ...current,
          privacyAcknowledged: action.acknowledged,
        });
        break;
      case "set_worker_enabled":
        this.repository.saveSetup({
          ...current,
          workerEnabled: action.enabled,
        });
        break;
      case "set_translation_consent":
        this.repository.saveSetup({
          ...current,
          translationConsent: action.consented,
        });
        break;
      case "set_caption_provider":
        this.repository.saveSetup({
          ...current,
          captionProvider: action.provider,
        });
        break;
      case "set_media_provider":
        this.repository.saveSetup({
          ...current,
          mediaProvider: action.provider,
        });
        break;
      case "set_export_source_provider":
        this.repository.saveSetup({
          ...current,
          exportSourceProvider: action.provider,
        });
        break;
      case "set_speech_to_text_provider":
        this.repository.saveSetup({
          ...current,
          speechToTextProvider: action.provider,
        });
        break;
      case "set_translation_provider":
        this.repository.saveSetup({
          ...current,
          translationProvider: action.provider,
        });
        break;
    }
    return this.repository.getSetupSnapshot();
  }

  async getReadinessReport(): Promise<ReadinessReport> {
    const checkedAt = (
      this.dependencies.now ?? (() => new Date())
    )().toISOString();
    const localComponents = await Promise.all([
      this.componentHealth("output_root", checkedAt),
      this.componentHealth("cache_root", checkedAt),
      this.componentHealth("ffmpeg", checkedAt),
      this.componentHealth("ffprobe", checkedAt),
      this.componentHealth("yt_dlp", checkedAt),
      this.componentHealth("whisper_cli", checkedAt),
      this.componentHealth("whisper_model", checkedAt),
      this.storageHealth("output_root", checkedAt),
      this.storageHealth("cache_root", checkedAt),
    ]);
    const byComponent = new Map(
      localComponents.map((component) => [component.component, component]),
    );
    const setup = this.repository.getSetup();
    const exportWorkerStatus = this.dependencies.exportWorkerStatus?.() ?? {
      available: false,
    };
    const components = [
      {
        component: "local_database" as const,
        state: "ready" as const,
        reason: "ready" as const,
        remediation: "none" as const,
        checkedAt,
      },
      ...localComponents,
      providerHealth({
        component: "caption_provider",
        configured: setup?.captionProvider,
        enabled: "yt_dlp",
        dependencies: ["yt_dlp"],
        checkedAt,
        byComponent,
      }),
      providerHealth({
        component: "media_provider",
        configured: setup?.mediaProvider,
        enabled: "yt_dlp_audio",
        dependencies: ["yt_dlp"],
        checkedAt,
        byComponent,
        ...(setup
          ? {
              rightsAcknowledged: setup.rightsAcknowledged,
              privacyAcknowledged: setup.privacyAcknowledged,
            }
          : {}),
      }),
      providerHealth({
        component: "export_source_provider",
        configured: setup?.exportSourceProvider,
        enabled: "yt_dlp",
        dependencies: ["yt_dlp"],
        checkedAt,
        byComponent,
        ...(setup
          ? {
              rightsAcknowledged: setup.rightsAcknowledged,
              privacyAcknowledged: setup.privacyAcknowledged,
            }
          : {}),
      }),
      providerHealth({
        component: "speech_to_text_provider",
        configured: setup?.speechToTextProvider,
        enabled: "whisper_cpp",
        dependencies: ["whisper_cli", "whisper_model"],
        checkedAt,
        byComponent,
      }),
      translationProviderHealth({
        configured: setup?.translationProvider,
        consented: setup?.translationConsent ?? false,
        checkedAt,
      }),
      exportWorkerHealth(setup?.workerEnabled, exportWorkerStatus, checkedAt),
    ];
    return deriveReadinessReport({
      checkedAt,
      components,
      requirements: {
        // Authentication/cloud evidence is deliberately absent here; Electron
        // merges it before presenting a global readiness decision.
        project_browsing: ["authentication", "cloud_api", "local_database"],
        verified_cached_review: [
          "authentication",
          "local_database",
          "cache_root",
        ],
        project_logging: ["authentication", "cloud_api", "local_database"],
        transcript_processing: [
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
        ],
        export_processing: [
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

  /** Main-process-only: do not pass this object over IPC or serialize it. */
  getTrustedRuntimeConfig(): TrustedDesktopRuntimeConfig {
    const pathFor = (target: SetupSelectionTarget) =>
      this.repository.getTrustedActiveComponentReference(target)?.absolutePath;
    const outputRoot = pathFor("output_root");
    const cacheRoot = pathFor("cache_root");
    const ffmpeg = pathFor("ffmpeg");
    const ffprobe = pathFor("ffprobe");
    const ytDlp = pathFor("yt_dlp");
    const whisperCli = pathFor("whisper_cli");
    const whisperModel = pathFor("whisper_model");
    return Object.freeze({
      outputRoot,
      cacheRoot,
      ffmpeg,
      ffprobe,
      ytDlp,
      whisperCli,
      whisperModel,
    });
  }

  private async componentHealth(
    target: SetupSelectionTarget,
    checkedAt: string,
  ): Promise<ComponentHealth> {
    const reference =
      this.repository.getTrustedActiveComponentReference(target);
    if (!reference) return missingHealth(target, checkedAt);
    try {
      const version = await revalidateReference(reference);
      return {
        component: componentForTarget[target],
        state: "ready",
        reason: "ready",
        remediation: "none",
        referenceId: reference.id,
        ...(version ? { version } : {}),
        checkedAt,
      };
    } catch (error) {
      return {
        component: componentForTarget[target],
        state: "needs_action",
        reason:
          error instanceof DesktopSetupValidationError &&
          error.code === "invalid_path"
            ? target === "output_root" || target === "cache_root"
              ? "root_unavailable"
              : "tool_missing"
            : target === "output_root" || target === "cache_root"
              ? "root_changed"
              : target === "whisper_model"
                ? "model_changed"
                : "tool_changed",
        remediation: remediationForTarget[target],
        referenceId: reference.id,
        checkedAt,
      };
    }
  }

  private async storageHealth(
    target: "output_root" | "cache_root",
    checkedAt: string,
  ): Promise<ComponentHealth> {
    const reference =
      this.repository.getTrustedActiveComponentReference(target);
    const component =
      target === "output_root" ? "output_storage" : "cache_storage";
    if (!reference) {
      return {
        component,
        state: "needs_action",
        reason: "storage_unavailable",
        remediation:
          target === "output_root" ? "select_output_root" : "select_cache_root",
        checkedAt,
      };
    }
    try {
      const available = await this.availableBytes(reference.absolutePath);
      const measured = this.dependencies.measuredOperationBytes?.(target) ?? 0;
      if (!Number.isSafeInteger(measured) || measured < 0) {
        throw new DesktopSetupValidationError("invalid_root");
      }
      const minimum = measured + StorageReserveBytes;
      const recommended = Math.max(StorageRecommendationBytes, minimum);
      if (available < minimum) {
        return {
          component,
          state: "blocked",
          reason: "storage_insufficient",
          remediation: "free_storage",
          checkedAt,
        };
      }
      if (available < recommended) {
        return {
          component,
          state: "degraded",
          reason: "storage_recommended",
          remediation: "free_storage",
          checkedAt,
        };
      }
      return {
        component,
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt,
      };
    } catch {
      return {
        component,
        state: "needs_action",
        reason: "storage_unavailable",
        remediation: "free_storage",
        checkedAt,
      };
    }
  }

  private async availableBytes(path: string): Promise<number> {
    const stat = await (this.dependencies.statfs ?? defaultStatfs)(path);
    const available = BigInt(stat.bavail) * BigInt(stat.bsize);
    if (available < 0n || available > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DesktopSetupValidationError("invalid_root");
    }
    return Number(available);
  }
}

async function revalidateReference(
  reference: TrustedLocalComponentReference,
): Promise<string | undefined> {
  if (reference.target === "output_root" || reference.target === "cache_root") {
    const identity = await validateDirectoryForWrite(reference.absolutePath);
    if (identity !== reference.filesystemIdentity) {
      throw new DesktopSetupValidationError("invalid_root");
    }
    return undefined;
  }
  if (reference.target === "whisper_model") {
    if (!reference.byteSize || !reference.contentSha256 || !reference.version) {
      throw new DesktopSetupValidationError("invalid_model");
    }
    const inspected = await validateModelFile(reference.absolutePath, {
      displayName: reference.displayName,
      expectedBytes: reference.byteSize,
      expectedSha256: reference.contentSha256,
      version: reference.version,
    });
    if (inspected.identity !== reference.filesystemIdentity) {
      throw new DesktopSetupValidationError("invalid_model");
    }
    return reference.version;
  }
  const inspected = await validateExecutable(reference.absolutePath);
  if (
    !reference.contentSha256 ||
    inspected.identity !== reference.filesystemIdentity ||
    inspected.contentSha256 !== reference.contentSha256
  ) {
    throw new DesktopSetupValidationError("invalid_tool");
  }
  return reference.version;
}

function missingHealth(
  target: SetupSelectionTarget,
  checkedAt: string,
): ComponentHealth {
  const isRoot = target === "output_root" || target === "cache_root";
  return {
    component: componentForTarget[target],
    state: "needs_action",
    reason: isRoot
      ? "root_unavailable"
      : target === "whisper_model"
        ? "model_missing"
        : "tool_missing",
    remediation: remediationForTarget[target],
    checkedAt,
  };
}

function defaultDesktopSetup() {
  return {
    schemaVersion: 1 as const,
    rightsAcknowledged: false,
    privacyAcknowledged: false,
    workerEnabled: false,
    translationConsent: false,
    captionProvider: "disabled" as const,
    mediaProvider: "disabled" as const,
    exportSourceProvider: "disabled" as const,
    speechToTextProvider: "disabled" as const,
    translationProvider: "disabled" as const,
  };
}

function providerHealth(input: {
  component:
    | "caption_provider"
    | "media_provider"
    | "export_source_provider"
    | "speech_to_text_provider";
  configured: string | undefined;
  enabled: string;
  dependencies: readonly ComponentKind[];
  checkedAt: string;
  byComponent: ReadonlyMap<ComponentKind, ComponentHealth>;
  rightsAcknowledged?: boolean;
  privacyAcknowledged?: boolean;
}): ComponentHealth {
  if (input.configured === undefined) {
    return {
      component: input.component,
      state: "needs_action",
      reason: "configuration_required",
      remediation: providerRemediation(input.component),
      checkedAt: input.checkedAt,
    };
  }
  if (input.configured !== input.enabled) {
    return {
      component: input.component,
      state: "degraded",
      reason: "provider_disabled",
      remediation: providerRemediation(input.component),
      checkedAt: input.checkedAt,
    };
  }
  if (input.rightsAcknowledged === false) {
    return {
      component: input.component,
      state: "needs_action",
      reason: "rights_acknowledgement_required",
      remediation: "acknowledge_rights",
      checkedAt: input.checkedAt,
    };
  }
  if (input.privacyAcknowledged === false) {
    return {
      component: input.component,
      state: "needs_action",
      reason: "privacy_acknowledgement_required",
      remediation: "acknowledge_privacy",
      checkedAt: input.checkedAt,
    };
  }
  if (
    input.dependencies.some(
      (component) => input.byComponent.get(component)?.state !== "ready",
    )
  ) {
    return {
      component: input.component,
      state: "needs_action",
      reason: "tool_missing",
      remediation:
        input.component === "speech_to_text_provider"
          ? "select_whisper_cli"
          : "select_yt_dlp",
      checkedAt: input.checkedAt,
    };
  }
  return {
    component: input.component,
    state: "ready",
    reason: "ready",
    remediation: "none",
    checkedAt: input.checkedAt,
  };
}

function exportWorkerHealth(
  workerEnabled: boolean | undefined,
  status: {
    available: boolean;
    issue?:
      | "authentication_required"
      | "cloud_unavailable"
      | "configuration_required"
      | "worker_unavailable";
  },
  checkedAt: string,
): ComponentHealth {
  if (workerEnabled !== true) {
    return {
      component: "export_worker",
      state: "needs_action",
      reason: "worker_disabled",
      remediation: "enable_worker",
      checkedAt,
    };
  }
  if (status.available) {
    return {
      component: "export_worker",
      state: "ready",
      reason: "ready",
      remediation: "none",
      checkedAt,
    };
  }
  if (status.issue === "authentication_required") {
    return {
      component: "export_worker",
      state: "needs_action",
      reason: "authentication_required",
      remediation: "sign_in",
      checkedAt,
    };
  }
  if (status.issue === "cloud_unavailable") {
    return {
      component: "export_worker",
      state: "blocked",
      reason: "cloud_unavailable",
      remediation: "retry",
      checkedAt,
    };
  }
  return {
    component: "export_worker",
    state: "needs_action",
    reason:
      status.issue === "configuration_required"
        ? "configuration_required"
        : "worker_unavailable",
    remediation: "retry",
    checkedAt,
  };
}

function providerRemediation(
  component:
    | "caption_provider"
    | "media_provider"
    | "export_source_provider"
    | "speech_to_text_provider",
): ComponentHealth["remediation"] {
  if (component === "caption_provider") return "choose_caption_provider";
  if (component === "media_provider") return "choose_media_provider";
  if (component === "export_source_provider") {
    return "choose_export_source_provider";
  }
  return "choose_speech_to_text_provider";
}

function translationProviderHealth(input: {
  configured: string | undefined;
  consented: boolean;
  checkedAt: string;
}): ComponentHealth {
  if (input.configured === undefined) {
    return {
      component: "translation_provider",
      state: "needs_action",
      reason: "configuration_required",
      remediation: "choose_translation_provider",
      checkedAt: input.checkedAt,
    };
  }
  if (input.configured === "disabled") {
    return {
      component: "translation_provider",
      state: "degraded",
      reason: "provider_disabled",
      remediation: "choose_translation_provider",
      checkedAt: input.checkedAt,
    };
  }
  if (!input.consented) {
    return {
      component: "translation_provider",
      state: "needs_action",
      reason: "translation_consent_required",
      remediation: "grant_translation_consent",
      checkedAt: input.checkedAt,
    };
  }
  return {
    component: "translation_provider",
    state: "ready",
    reason: "ready",
    remediation: "none",
    checkedAt: input.checkedAt,
  };
}

async function validateDirectoryForWrite(path: string): Promise<string> {
  await assertExactAbsolutePath(path);
  const before = await exactDirectory(path);
  const probeName = `.research-video-clips-write-probe-${randomUUID()}`;
  const probePath = join(path, probeName);
  try {
    const handle = await open(probePath, "wx", 0o600);
    try {
      await handle.writeFile("probe", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const probe = await lstat(probePath);
    if (!probe.isFile() || probe.isSymbolicLink() || probe.nlink !== 1) {
      throw new DesktopSetupValidationError("invalid_root");
    }
  } catch (error) {
    if (error instanceof DesktopSetupValidationError) throw error;
    throw new DesktopSetupValidationError("invalid_root");
  } finally {
    await rm(probePath, { force: true }).catch(() => undefined);
  }
  const after = await exactDirectory(path);
  if (before !== after) throw new DesktopSetupValidationError("invalid_root");
  return before;
}

async function validateExecutable(path: string): Promise<{
  identity: string;
  byteSize: number;
  contentSha256: string;
}> {
  await assertExactAbsolutePath(path);
  const stats = await exactRegularFile(path, "invalid_tool", true);
  if (stats.size > MaximumToolBytes) {
    throw new DesktopSetupValidationError("invalid_tool");
  }
  const contentSha256 = await hashExactRegularFile(path, stats, "invalid_tool");
  return {
    identity: fileIdentity(stats),
    byteSize: stats.size,
    contentSha256,
  };
}

async function hashExactRegularFile(
  path: string,
  before: Awaited<ReturnType<typeof lstat>>,
  errorCode: "invalid_tool" | "invalid_model",
): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => {
    throw new DesktopSetupValidationError(errorCode);
  });
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new DesktopSetupValidationError(errorCode);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const length = Math.min(buffer.length, opened.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead === 0) throw new DesktopSetupValidationError(errorCode);
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await exactRegularFile(
      path,
      errorCode,
      errorCode === "invalid_tool",
    );
    if (!sameFile(opened, after))
      throw new DesktopSetupValidationError(errorCode);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function validateModelFile(
  path: string,
  pin: WhisperModelPin,
): Promise<{ identity: string }> {
  await assertExactAbsolutePath(path);
  const before = await exactRegularFile(path, "invalid_model", false);
  if (before.size !== pin.expectedBytes) {
    throw new DesktopSetupValidationError("invalid_model");
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => {
    throw new DesktopSetupValidationError("invalid_model");
  });
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened) || !opened.isFile()) {
      throw new DesktopSetupValidationError("invalid_model");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < pin.expectedBytes) {
      const length = Math.min(buffer.length, pin.expectedBytes - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead === 0)
        throw new DesktopSetupValidationError("invalid_model");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (hash.digest("hex") !== pin.expectedSha256) {
      throw new DesktopSetupValidationError("invalid_model");
    }
    const after = await exactRegularFile(path, "invalid_model", false);
    if (!sameFile(opened, after))
      throw new DesktopSetupValidationError("invalid_model");
    return { identity: fileIdentity(opened) };
  } finally {
    await handle.close();
  }
}

async function assertExactAbsolutePath(path: string): Promise<void> {
  if (
    !isAbsolute(path) ||
    path.length === 0 ||
    path.length > MaximumPathLength ||
    path.includes("\0") ||
    path !== path.normalize("NFC") ||
    (await realpath(path).catch(() => undefined)) !== path
  ) {
    throw new DesktopSetupValidationError("invalid_path");
  }
}

async function exactDirectory(path: string): Promise<string> {
  const stats = await lstat(path).catch(() => {
    throw new DesktopSetupValidationError("invalid_path");
  });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new DesktopSetupValidationError("invalid_root");
  }
  return `${stats.dev}:${stats.ino}`;
}

async function exactRegularFile(
  path: string,
  errorCode: "invalid_tool" | "invalid_model",
  requireExecutable: boolean,
) {
  const stats = await lstat(path).catch(() => {
    throw new DesktopSetupValidationError(errorCode);
  });
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1 ||
    stats.size < 0 ||
    stats.size > MaximumModelBytes ||
    (requireExecutable && (stats.mode & 0o111) === 0)
  ) {
    throw new DesktopSetupValidationError(errorCode);
  }
  return stats;
}

function fileIdentity(stats: Awaited<ReturnType<typeof lstat>>): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
}

function sameFile(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return fileIdentity(left) === fileIdentity(right);
}

function safeDisplayName(path: string): string {
  const name = basename(path).trim();
  if (!name || name.length > 160)
    throw new DesktopSetupValidationError("invalid_path");
  return name;
}

function hasRequiredToolCapabilities(
  target: "ffmpeg" | "ffprobe" | "yt_dlp" | "whisper_cli",
  results: readonly { stdout: string; stderr: string }[],
): boolean {
  if (
    results.some(
      (result) =>
        result.stdout.length > MaximumProbeOutputCharacters ||
        result.stderr.length > MaximumProbeOutputCharacters,
    )
  ) {
    return false;
  }
  if (target === "ffmpeg") {
    const [version, encoders, muxers, filters] = results;
    return (
      /^ffmpeg version\s+\S+/mu.test(version?.stdout ?? "") &&
      hasAllIdentifiers(encoders?.stdout ?? "", [
        "libx264",
        "libx265",
        "prores_ks",
        "aac",
        "pcm_s16le",
        "mov_text",
        "srt",
      ]) &&
      hasAllIdentifiers(muxers?.stdout ?? "", ["mp4", "matroska", "mov"]) &&
      hasAllIdentifiers(filters?.stdout ?? "", ["scale", "fps"])
    );
  }
  if (target === "ffprobe") {
    try {
      const parsed = JSON.parse(results[0]?.stdout ?? "") as {
        program_version?: unknown;
      };
      return Boolean(
        parsed.program_version &&
        typeof parsed.program_version === "object" &&
        safeVersion((parsed.program_version as { version?: unknown }).version),
      );
    } catch {
      return false;
    }
  }
  if (target === "yt_dlp") {
    return (
      /^\d{4}(?:\.\d{1,2}){2}(?:\.\d+)?$/mu.test(
        results[0]?.stdout.trim() ?? "",
      ) &&
      /--simulate\b/u.test(results[1]?.stdout ?? "") &&
      /--dump-single-json\b/u.test(results[1]?.stdout ?? "")
    );
  }
  const help = results[0]?.stdout ?? "";
  return (
    /(?:-m\s+FNAME|--model\s+FNAME)/u.test(help) &&
    /(?:-f\s+FNAME|--file\s+FNAME)/u.test(help)
  );
}

function hasAllIdentifiers(
  output: string,
  identifiers: readonly string[],
): boolean {
  return identifiers.every((identifier) =>
    new RegExp(`(?:^|\\s)${escapeRegex(identifier)}(?:\\s|$)`, "mu").test(
      output,
    ),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function probeVersion(
  target: "ffmpeg" | "ffprobe" | "yt_dlp" | "whisper_cli",
  result: { stdout: string; stderr: string },
): string | undefined {
  if (target === "whisper_cli") return undefined;
  if (target === "ffmpeg") {
    return safeVersion(/^ffmpeg version\s+(\S+)/mu.exec(result.stdout)?.[1]);
  }
  if (target === "yt_dlp") return safeVersion(result.stdout.trim());
  try {
    const parsed = JSON.parse(result.stdout) as {
      program_version?: { version?: unknown };
    };
    return safeVersion(parsed.program_version?.version);
  } catch {
    return undefined;
  }
}

function safeVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._+-]{1,160}$/u.test(normalized) ? normalized : undefined;
}

function hashProbeOutput(
  results: readonly { stdout: string; stderr: string }[],
): string {
  const hash = createHash("sha256");
  for (const result of results) {
    hash.update(result.stdout.slice(0, MaximumProbeOutputCharacters));
    hash.update("\n");
    hash.update(result.stderr.slice(0, MaximumProbeOutputCharacters));
    hash.update("\n---\n");
  }
  return hash.digest("hex");
}

function validateModelPin(pin: WhisperModelPin): WhisperModelPin {
  if (
    !pin.displayName.trim() ||
    pin.displayName.length > 160 ||
    !pin.version.trim() ||
    pin.version.length > 160 ||
    !Number.isSafeInteger(pin.expectedBytes) ||
    pin.expectedBytes <= 0 ||
    pin.expectedBytes > MaximumModelBytes ||
    !/^[a-f0-9]{64}$/u.test(pin.expectedSha256)
  ) {
    throw new DesktopSetupValidationError("model_pin_invalid");
  }
  return pin;
}

async function defaultStatfs(path: string) {
  return nodeStatfs(path, { bigint: true });
}
