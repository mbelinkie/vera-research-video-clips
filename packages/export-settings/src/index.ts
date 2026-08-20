import { createHash } from "node:crypto";

import {
  ExportSettingsPreviewSchema,
  ExportSettingsSchema,
  ResolvedExportSettingsSnapshotSchema,
  type ExportCapabilityIssue,
  type ExportPresetScope,
  type ExportPresetSnapshot,
  type ExportResolvedSubtitlePolicy,
  type ExportSettings,
  type ExportSettingsOverride,
  type ExportSettingsPreview,
  type ExportSourceLanguageClass,
  type ResolvedExportSettingsSnapshot,
} from "@research-video/contracts";

export const APPLICATION_EXPORT_SETTINGS_VERSION = 1 as const;
export const APPLICATION_EDITING_EXPORT_SETTINGS: ExportSettings = {
  container: "mp4",
  videoCodec: "h264",
  videoRateControl: { mode: "crf", value: 20 },
  frameRate: "source",
  audioCodec: "aac",
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};

const capabilityDescriptor = {
  profileId: "local-editing-renderer",
  profileVersion: 1,
  container: ["mp4"],
  videoCodec: ["h264"],
  videoRateControl: ["crf"],
  frameRate: ["source"],
  scaling: false,
  audioCodec: ["aac"],
  audioRate: "adapter_default",
  subtitleEmbedding: false,
  acceleration: ["software"],
} as const;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export const CURRENT_EXPORT_WORKER_CAPABILITY = {
  profileId: capabilityDescriptor.profileId,
  profileVersion: capabilityDescriptor.profileVersion,
  fingerprint: sha256Fingerprint(capabilityDescriptor),
  validation: "validated" as const,
};

export interface ResolvedPresetLayer {
  snapshot: ExportPresetSnapshot;
  scope: ExportPresetScope;
}

export interface ResolveExportSettingsInput {
  context: "logged" | "export_only";
  sourceLanguageClass: ExportSourceLanguageClass;
  contextDefault?: ResolvedPresetLayer;
  selectedPreset?: ResolvedPresetLayer;
  legacyPreset?: ExportPresetSnapshot;
  useApplicationDefault?: boolean;
  overrides?: ExportSettingsOverride;
  resolvedAt: string;
}

function applyOverrides(
  base: ExportSettings,
  overrides: ExportSettingsOverride,
): ExportSettings {
  const next: Record<string, unknown> = structuredClone(base) as Record<
    string,
    unknown
  >;
  for (const [field, value] of Object.entries(overrides)) {
    if (value === null) delete next[field];
    else if (value !== undefined) next[field] = structuredClone(value);
  }
  return ExportSettingsSchema.parse(next);
}

export function validateExportSettingsCapabilities(
  settings: ExportSettings,
): ExportCapabilityIssue[] {
  const issues: ExportCapabilityIssue[] = [];
  const reject = (field: string, code: string, message: string) =>
    issues.push({ field, code, message });
  if (settings.container !== "mp4")
    reject(
      "container",
      "unsupported_container",
      "The current renderer supports MP4 only.",
    );
  if (settings.videoCodec !== "h264")
    reject(
      "videoCodec",
      "unsupported_video_codec",
      "The current renderer supports H.264 only.",
    );
  if (settings.videoRateControl.mode !== "crf")
    reject(
      "videoRateControl",
      "unsupported_rate_control",
      "The current renderer supports CRF rate control only.",
    );
  if (settings.maxWidth !== undefined)
    reject(
      "maxWidth",
      "unsupported_scaling",
      "The current renderer does not support scaling.",
    );
  if (settings.frameRate !== "source")
    reject(
      "frameRate",
      "unsupported_frame_rate",
      "The current renderer preserves source frame rate only.",
    );
  if (settings.audioCodec !== "aac")
    reject(
      "audioCodec",
      "unsupported_audio_codec",
      "The current renderer supports AAC audio only.",
    );
  if (settings.audioKilobitsPerSecond !== undefined)
    reject(
      "audioKilobitsPerSecond",
      "unsupported_audio_rate",
      "The current renderer uses the adapter default audio rate.",
    );
  if (settings.embedEnglishSubtitleTrack)
    reject(
      "embedEnglishSubtitleTrack",
      "unsupported_subtitle_embedding",
      "The current renderer does not support embedded subtitle tracks.",
    );
  return issues;
}

export function resolveSubtitlePolicy(
  sourceLanguageClass: ExportSourceLanguageClass,
  settings: ExportSettings,
): ExportResolvedSubtitlePolicy {
  if (
    sourceLanguageClass === "confirmed_english" &&
    settings.omitSubtitleFilesForConfirmedEnglish
  ) {
    return {
      requiredSidecars: [],
      subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
    };
  }
  if (sourceLanguageClass === "confirmed_english") {
    return { requiredSidecars: ["english"] };
  }
  return { requiredSidecars: ["original", "english"] };
}

function addFingerprint(
  snapshot: Omit<ResolvedExportSettingsSnapshot, "resolutionFingerprint">,
): ResolvedExportSettingsSnapshot {
  const { resolvedAt: _resolvedAt, ...stableSnapshot } = snapshot;
  return ResolvedExportSettingsSnapshotSchema.parse({
    ...snapshot,
    resolutionFingerprint: sha256Fingerprint(stableSnapshot),
  });
}

export function resolveExportSettings(
  input: ResolveExportSettingsInput,
): ExportSettingsPreview {
  let settings = APPLICATION_EDITING_EXPORT_SETTINGS;
  if (!input.useApplicationDefault && input.contextDefault)
    settings = input.contextDefault.snapshot.settings;
  if (input.selectedPreset) settings = input.selectedPreset.snapshot.settings;
  if (input.legacyPreset) settings = input.legacyPreset.settings;
  const overrides = input.overrides ?? {};
  settings = applyOverrides(settings, overrides);
  const snapshot = addFingerprint({
    schemaVersion: 1,
    resolutionKind: input.legacyPreset ? "legacy_inline" : "catalog",
    context: input.context,
    base: input.legacyPreset
      ? "legacy_inline"
      : input.useApplicationDefault
        ? "application_default"
        : "context_default",
    applicationDefaultVersion: APPLICATION_EXPORT_SETTINGS_VERSION,
    contextDefault: input.contextDefault?.snapshot,
    selectedPreset: input.selectedPreset?.snapshot,
    selectedPresetScope: input.selectedPreset?.scope,
    legacyPreset: input.legacyPreset,
    overrides,
    overrideFields: Object.keys(overrides).sort(),
    settings,
    capability: {
      ...CURRENT_EXPORT_WORKER_CAPABILITY,
      validation: input.legacyPreset ? "legacy_unvalidated" : "validated",
    },
    resolvedAt: input.resolvedAt,
  });
  return ExportSettingsPreviewSchema.parse({
    snapshot,
    issues: validateExportSettingsCapabilities(settings),
    effectiveSubtitlePolicy: resolveSubtitlePolicy(
      input.sourceLanguageClass,
      settings,
    ),
  });
}

export function validateStoredResolvedSettingsSnapshot(
  snapshotInput: ResolvedExportSettingsSnapshot,
): ExportCapabilityIssue[] {
  const snapshot = ResolvedExportSettingsSnapshotSchema.parse(snapshotInput);
  const issues = validateExportSettingsCapabilities(snapshot.settings);
  if (
    snapshot.capability.profileId !==
      CURRENT_EXPORT_WORKER_CAPABILITY.profileId ||
    snapshot.capability.profileVersion !==
      CURRENT_EXPORT_WORKER_CAPABILITY.profileVersion ||
    snapshot.capability.fingerprint !==
      CURRENT_EXPORT_WORKER_CAPABILITY.fingerprint
  ) {
    issues.unshift({
      field: "capability",
      code: "capability_profile_unavailable",
      message:
        "The export was resolved for a worker capability profile that is not available.",
    });
  }
  if (
    snapshot.resolutionFingerprint &&
    snapshot.capability.validation === "validated"
  ) {
    const {
      resolutionFingerprint: _ignored,
      resolvedAt: _resolvedAt,
      ...unsigned
    } = snapshot;
    if (sha256Fingerprint(unsigned) !== snapshot.resolutionFingerprint) {
      issues.unshift({
        field: "resolutionFingerprint",
        code: "resolved_settings_snapshot_changed",
        message:
          "The immutable resolved export settings snapshot fingerprint does not match.",
      });
    }
  }
  return issues;
}

export function resolvedPresetForCompatibility(
  snapshot: ResolvedExportSettingsSnapshot,
): ExportPresetSnapshot {
  const base =
    snapshot.selectedPreset ?? snapshot.contextDefault ?? snapshot.legacyPreset;
  return {
    presetId: snapshot.overrideFields.length === 0 ? base?.presetId : undefined,
    presetVersion: base?.presetVersion ?? APPLICATION_EXPORT_SETTINGS_VERSION,
    name: `${base?.name ?? "Editing"}${snapshot.overrideFields.length ? " + overrides" : ""}`,
    settings: snapshot.settings,
  };
}
