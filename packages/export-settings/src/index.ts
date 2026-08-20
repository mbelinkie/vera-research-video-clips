import { createHash } from "node:crypto";

import {
  ExportSettingsPreviewSchema,
  ExportSettingsSchema,
  ResolvedExportSettingsSnapshotSchema,
  type ExportCapabilityIssue,
  type ExportPresetScope,
  type ExportPresetSnapshot,
  type ExportRendererCapabilityId,
  type ExportResolvedSubtitlePolicy,
  type ExportSettings,
  type ExportSettingsOverride,
  type ExportSettingsPreview,
  type ExportSourceLanguageClass,
  type ExportWorkerCapabilityReference,
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
  profileVersion: 3,
  renderers: [
    {
      id: "h264_mp4",
      container: "mp4",
      videoCodec: "h264",
      profile: "high",
      pixelFormat: "yuv420p",
      rateControl: ["crf", "bitrate"],
      audioCodec: "aac",
    },
    {
      id: "hevc_mkv",
      container: "mkv",
      videoCodec: "hevc",
      profile: "main",
      pixelFormat: "yuv420p",
      rateControl: ["crf", "bitrate"],
      audioCodec: "aac",
    },
    {
      id: "prores_mov",
      container: "mov",
      videoCodec: "prores",
      profile: "prores_422",
      pixelFormat: "yuv422p10le",
      rateControl: ["codec_default"],
      audioCodec: "pcm_s16le",
    },
  ],
  fitWidths: [640, 1280, 1920, 3840],
  frameRate: ["source", "23.976", "24", "25", "29.97", "30"],
  aacBitratesKbps: [96, 128, 192, 256, 320],
  audioSampleRate: ["source", "44100", "48000"],
  audioChannels: ["source", "1", "2"],
  subtitleEmbedding: true,
  acceleration: ["software"],
} as const;

export const EXPORT_RENDERER_CAPABILITIES = capabilityDescriptor.renderers;
export const EXPORT_FIT_WIDTHS = capabilityDescriptor.fitWidths;
export const EXPORT_AAC_BITRATES_KBPS = capabilityDescriptor.aacBitratesKbps;

export type InstalledExportWorkerCapabilities = {
  ffmpegVersion?: string;
  encoders: readonly string[];
  muxers: readonly string[];
  filters: readonly string[];
};

export interface ExportWorkerCapabilityProvider {
  discover(signal?: AbortSignal): Promise<InstalledExportWorkerCapabilities>;
}

export const FULLY_AVAILABLE_EXPORT_WORKER_CAPABILITIES: InstalledExportWorkerCapabilities =
  {
    encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt", "subrip"],
    muxers: ["mp4", "matroska", "mov"],
    filters: ["scale", "fps"],
  };

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

/** M5-14A snapshots remain executable when they did not request embedding. */
export const M5_14A_EXPORT_WORKER_CAPABILITY = {
  profileId: "local-editing-renderer",
  profileVersion: 2,
  fingerprint: sha256Fingerprint({
    ...capabilityDescriptor,
    profileVersion: 2,
    subtitleEmbedding: false,
  }),
} as const;

export const CURRENT_EXPORT_WORKER_CAPABILITY = {
  profileId: capabilityDescriptor.profileId,
  profileVersion: capabilityDescriptor.profileVersion,
  fingerprint: sha256Fingerprint(capabilityDescriptor),
  validation: "validated" as const,
};

/** The M5-13 profile remains executable for already-queued Editing MP4 work. */
export const LEGACY_EDITING_EXPORT_WORKER_CAPABILITY = {
  profileId: "local-editing-renderer",
  profileVersion: 1,
  fingerprint:
    "08f7b71d54b157ee151f91a0a43a58b426484e0cd9dd91a9579d9baa3559a5a9",
} as const;

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
  const renderer = rendererCapabilityForSettings(settings);
  if (!renderer)
    reject(
      "container",
      "unsupported_render_tuple",
      "Choose MP4/H.264/AAC, MKV/HEVC/AAC, or MOV/ProRes/PCM.",
    );
  if (
    renderer &&
    !renderer.rateControl.includes(settings.videoRateControl.mode as never)
  )
    reject(
      "videoRateControl",
      "unsupported_rate_control",
      renderer.id === "prores_mov"
        ? "ProRes 422 uses codec-fixed rate control."
        : "H.264 and HEVC support CRF or target bitrate rate control.",
    );
  if (
    settings.maxWidth !== undefined &&
    !EXPORT_FIT_WIDTHS.includes(settings.maxWidth as never)
  )
    reject(
      "maxWidth",
      "unsupported_scaling",
      `Maximum width must be one of ${EXPORT_FIT_WIDTHS.join(", ")} pixels.`,
    );
  if (
    settings.audioCodec === "aac" &&
    settings.audioKilobitsPerSecond !== undefined &&
    !EXPORT_AAC_BITRATES_KBPS.includes(settings.audioKilobitsPerSecond as never)
  )
    reject(
      "audioKilobitsPerSecond",
      "unsupported_audio_rate",
      `AAC bitrate must be one of ${EXPORT_AAC_BITRATES_KBPS.join(", ")} kbps.`,
    );
  if (
    settings.audioCodec === "pcm_s16le" &&
    settings.audioKilobitsPerSecond !== undefined
  )
    reject(
      "audioKilobitsPerSecond",
      "pcm_bitrate_forbidden",
      "PCM uses its fixed sample format and cannot request a target bitrate.",
    );
  if (
    settings.audioSampleRate !== undefined &&
    !capabilityDescriptor.audioSampleRate.includes(
      settings.audioSampleRate as never,
    )
  )
    reject(
      "audioSampleRate",
      "unsupported_audio_sample_rate",
      "Audio sample rate must preserve source, use 44100 Hz, or use 48000 Hz.",
    );
  if (
    settings.audioChannels !== undefined &&
    !capabilityDescriptor.audioChannels.includes(
      settings.audioChannels as never,
    )
  )
    reject(
      "audioChannels",
      "unsupported_audio_channels",
      "Audio channels must preserve source, use mono, or use stereo.",
    );
  return issues;
}

export function rendererCapabilityForSettings(
  settings: ExportSettings,
): (typeof EXPORT_RENDERER_CAPABILITIES)[number] | undefined {
  return EXPORT_RENDERER_CAPABILITIES.find(
    (renderer) =>
      renderer.container === settings.container &&
      renderer.videoCodec === settings.videoCodec &&
      renderer.audioCodec === settings.audioCodec,
  );
}

export function rendererCapabilityIdForSettings(
  settings: ExportSettings,
): ExportRendererCapabilityId | undefined {
  return rendererCapabilityForSettings(settings)?.id;
}

const installedRequirements: Record<
  ExportRendererCapabilityId,
  { encoder: string; muxer: string; filters: readonly string[] }
> = {
  h264_mp4: { encoder: "libx264", muxer: "mp4", filters: [] },
  hevc_mkv: { encoder: "libx265", muxer: "matroska", filters: [] },
  prores_mov: { encoder: "prores_ks", muxer: "mov", filters: [] },
};

export function availableRendererCapabilityIds(
  installed: InstalledExportWorkerCapabilities,
): ExportRendererCapabilityId[] {
  const encoders = new Set(installed.encoders);
  const muxers = new Set(installed.muxers);
  const filters = new Set(installed.filters);
  return EXPORT_RENDERER_CAPABILITIES.map((renderer) => renderer.id).filter(
    (id) => {
      const required = installedRequirements[id];
      return (
        encoders.has(required.encoder) &&
        muxers.has(required.muxer) &&
        required.filters.every((filter) => filters.has(filter))
      );
    },
  );
}

export function validateInstalledExportCapabilities(
  settings: ExportSettings,
  installed: InstalledExportWorkerCapabilities,
): ExportCapabilityIssue[] {
  const rendererId = rendererCapabilityIdForSettings(settings);
  if (!rendererId) return [];
  const required = installedRequirements[rendererId];
  const missing: string[] = [];
  if (!installed.encoders.includes(required.encoder))
    missing.push(`encoder ${required.encoder}`);
  if (!installed.muxers.includes(required.muxer))
    missing.push(`muxer ${required.muxer}`);
  const filters = new Set(installed.filters);
  if (settings.maxWidth !== undefined && !filters.has("scale"))
    missing.push("filter scale");
  if (settings.frameRate !== "source" && !filters.has("fps"))
    missing.push("filter fps");
  if (settings.embedEnglishSubtitleTrack) {
    const subtitleEncoder = settings.container === "mkv" ? "srt" : "mov_text";
    if (!installed.encoders.includes(subtitleEncoder))
      missing.push(`subtitle encoder ${subtitleEncoder}`);
  }
  return missing.length
    ? [
        {
          field: "capability",
          code: "installed_renderer_unavailable",
          message: `The installed FFmpeg cannot run ${rendererId}: missing ${missing.join(", ")}.`,
        },
      ]
    : [];
}

export function withInstalledExportWorkerAvailability(
  preview: ExportSettingsPreview,
  installed: InstalledExportWorkerCapabilities,
): ExportSettingsPreview {
  const all = EXPORT_RENDERER_CAPABILITIES.map((renderer) => renderer.id);
  const available = availableRendererCapabilityIds(installed);
  const issues = [
    ...preview.issues,
    ...validateInstalledExportCapabilities(
      preview.snapshot.settings,
      installed,
    ),
  ];
  return ExportSettingsPreviewSchema.parse({
    ...preview,
    issues: issues.filter(
      (issue, index) =>
        issues.findIndex(
          (candidate) =>
            candidate.field === issue.field && candidate.code === issue.code,
        ) === index,
    ),
    workerAvailability: {
      discovery: "installed",
      availableRendererIds: available,
      unavailableRendererIds: all.filter((id) => !available.includes(id)),
      ...(installed.ffmpegVersion
        ? { ffmpegVersion: installed.ffmpegVersion }
        : {}),
    },
  });
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
    workerAvailability: {
      discovery: "canonical_only",
      availableRendererIds: EXPORT_RENDERER_CAPABILITIES.map(
        (renderer) => renderer.id,
      ),
      unavailableRendererIds: [],
    },
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
  const matchesCapability = (
    capability: Pick<
      ExportWorkerCapabilityReference,
      "profileId" | "profileVersion" | "fingerprint"
    >,
  ) =>
    snapshot.capability.profileId === capability.profileId &&
    snapshot.capability.profileVersion === capability.profileVersion &&
    snapshot.capability.fingerprint === capability.fingerprint;
  const matchesLegacyCapability = matchesCapability(
    LEGACY_EDITING_EXPORT_WORKER_CAPABILITY,
  );
  const matchesM514ACapability = matchesCapability(
    M5_14A_EXPORT_WORKER_CAPABILITY,
  );
  if (
    matchesLegacyCapability &&
    (snapshot.settings.container !== "mp4" ||
      snapshot.settings.videoCodec !== "h264" ||
      snapshot.settings.videoRateControl.mode !== "crf" ||
      snapshot.settings.maxWidth !== undefined ||
      snapshot.settings.frameRate !== "source" ||
      snapshot.settings.audioCodec !== "aac" ||
      snapshot.settings.audioKilobitsPerSecond !== undefined ||
      snapshot.settings.audioSampleRate !== undefined ||
      snapshot.settings.audioChannels !== undefined ||
      snapshot.settings.embedEnglishSubtitleTrack)
  ) {
    issues.unshift({
      field: "capability",
      code: "capability_profile_unavailable",
      message:
        "The legacy worker capability is valid only for its original Editing H.264/AAC MP4 settings.",
    });
  }
  if (matchesM514ACapability && snapshot.settings.embedEnglishSubtitleTrack) {
    issues.unshift({
      field: "capability",
      code: "capability_profile_unavailable",
      message:
        "This historical worker capability profile does not support embedded subtitle tracks.",
    });
  }
  if (
    !matchesCapability(CURRENT_EXPORT_WORKER_CAPABILITY) &&
    !matchesLegacyCapability &&
    !matchesM514ACapability
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
