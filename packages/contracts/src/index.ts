import { z } from "zod";

const IdSchema = z.string().uuid();
const UtcTimestampSchema = z.string().datetime({ offset: true });

export function normalizeLanguageTag(value: string): string {
  const candidate = value.trim().replaceAll("_", "-");
  if (!candidate || candidate.length > 35) {
    throw new Error("Language must be a valid BCP-47 tag.");
  }
  try {
    return new Intl.Locale(candidate).toString();
  } catch {
    throw new Error("Language must be a valid BCP-47 tag.");
  }
}

export function primaryLanguage(value: string): string {
  return new Intl.Locale(normalizeLanguageTag(value)).language.toLowerCase();
}

export function languagesEquivalent(left: string, right: string): boolean {
  return primaryLanguage(left) === primaryLanguage(right);
}

export const LanguageTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(35)
  .transform((value, context) => {
    try {
      return normalizeLanguageTag(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Language must be a valid BCP-47 tag.",
      });
      return z.NEVER;
    }
  });

export const ProjectRoleSchema = z.enum([
  "owner",
  "editor",
  "researcher",
  "viewer",
]);

export const AuthenticatedActorSchema = z.object({
  userId: IdSchema,
  externalSubject: z.string().min(1).max(512),
});

export const UserSchema = z.object({
  id: IdSchema,
  externalSubject: z.string().min(1).max(512),
  displayName: z.string().trim().min(1).max(160),
  preferredLanguage: LanguageTagSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const UpdatePreferredLanguageRequestSchema = z.object({
  preferredLanguage: LanguageTagSchema,
});

export const CreateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
});

export const AddProjectMemberRequestSchema = z.object({
  userId: IdSchema,
  role: z.enum(["editor", "researcher", "viewer"]),
});

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  version: z.number().int().positive(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const ProjectMemberSchema = z.object({
  projectId: IdSchema,
  userId: IdSchema,
  role: ProjectRoleSchema,
  version: z.number().int().positive(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const VideoSchema = z.object({
  id: IdSchema,
  youtubeVideoId: z.string().min(1).max(64),
  canonicalUrl: z.url(),
  title: z.string().trim().min(1).max(500),
  channel: z.string().trim().min(1).max(300).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  sourceLanguage: z.string().min(2).max(35).optional(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const AddProjectVideoRequestSchema = z.object({
  youtubeVideoId: z.string().min(1).max(64),
  canonicalUrl: z.url(),
  title: z.string().trim().min(1).max(500),
  channel: z.string().trim().min(1).max(300).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  sourceLanguage: z.string().min(2).max(35).optional(),
});

export const ProjectVideoSchema = z.object({
  projectId: IdSchema,
  videoId: IdSchema,
  activeTranscriptVersionId: IdSchema.optional(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const TimingPrecisionSchema = z.enum(["word", "cue", "estimated"]);

export const TranscriptSourceSchema = z.enum([
  "youtube-manual",
  "youtube-auto",
  "generated",
  "translated",
  "fixture",
]);

export const TranscriptTrackSchema = z.object({
  id: IdSchema,
  videoId: z.string().min(1).max(64),
  language: LanguageTagSchema,
  kind: z.enum(["original", "english", "translation"]),
  source: TranscriptSourceSchema,
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  sourceTrackId: IdSchema.optional(),
  timingPrecision: TimingPrecisionSchema,
  schemaVersion: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
});

export const TranscriptSegmentSchema = z
  .object({
    id: IdSchema,
    trackId: IdSchema,
    ordinal: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1),
  })
  .refine((segment) => segment.endMs > segment.startMs, {
    message: "Transcript segment end must be after its start.",
  });

export const TranscriptTokenSchema = z
  .object({
    id: IdSchema,
    segmentId: IdSchema,
    ordinal: z.number().int().nonnegative(),
    text: z.string().min(1),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(),
    timingConfidence: z.number().min(0).max(1).optional(),
  })
  .refine(
    (token) =>
      token.startMs === undefined ||
      token.endMs === undefined ||
      token.endMs > token.startMs,
    { message: "Transcript token end must be after its start." },
  );

export const NormalizedTranscriptSchema = z.object({
  track: TranscriptTrackSchema,
  segments: z.array(TranscriptSegmentSchema),
  tokens: z.array(TranscriptTokenSchema).default([]),
});

export const TranscriptSelectionSchema = z
  .object({
    trackId: IdSchema,
    transcriptVersion: z.number().int().positive(),
    firstSegmentId: IdSchema,
    lastSegmentId: IdSchema,
    firstTokenId: IdSchema.optional(),
    lastTokenId: IdSchema.optional(),
    transcriptStartMs: z.number().int().nonnegative(),
    transcriptEndMs: z.number().int().positive(),
    exportStartMs: z.number().int().nonnegative(),
    exportEndMs: z.number().int().positive(),
    text: z.string().trim().min(1),
    timingPrecision: TimingPrecisionSchema,
  })
  .refine(
    (selection) => selection.transcriptEndMs > selection.transcriptStartMs,
    {
      message: "Transcript selection end must be after its start.",
    },
  )
  .refine(
    (selection) => selection.exportStartMs <= selection.transcriptStartMs,
    {
      message: "Export start must include the transcript selection.",
    },
  )
  .refine((selection) => selection.exportEndMs >= selection.transcriptEndMs, {
    message: "Export end must include the transcript selection.",
  });

export const ClipResearchStatusSchema = z.enum([
  "candidate",
  "approved",
  "rejected",
]);
export const ClipExportStatusSchema = z.enum([
  "not_requested",
  "queued",
  "processing",
  "complete",
  "failed",
  "canceled",
]);
export const ClipTagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Clip tags cannot contain control characters.",
  });
export const ClipVideoSnapshotSchema = z.object({
  youtubeVideoId: z.string().min(1).max(64),
  canonicalUrl: z.url(),
  title: z.string().trim().min(1).max(500),
  channel: z.string().trim().min(1).max(300).optional(),
  sourceLanguage: LanguageTagSchema.optional(),
});

export const ClipLanguageSnapshotSchema = z.object({
  role: z.enum(["native", "english", "preferred"]),
  language: LanguageTagSchema,
  text: z.string().trim().min(1).max(100_000),
  trackId: IdSchema,
  trackVersion: z.number().int().positive(),
  sourceTrackId: IdSchema.optional(),
  timingPrecision: TimingPrecisionSchema,
});

export const ClipLanguageEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    native: ClipLanguageSnapshotSchema.extend({ role: z.literal("native") }),
    english: ClipLanguageSnapshotSchema.extend({
      role: z.literal("english"),
    }),
    preferred: ClipLanguageSnapshotSchema.extend({
      role: z.literal("preferred"),
      sourceTrackId: IdSchema,
    }).optional(),
  })
  .superRefine((evidence, context) => {
    if (!languagesEquivalent(evidence.english.language, "en")) {
      context.addIssue({
        code: "custom",
        path: ["english", "language"],
        message: "The English evidence role must contain English text.",
      });
    }
    if (
      evidence.english.trackId !== evidence.native.trackId &&
      evidence.english.sourceTrackId !== evidence.native.trackId
    ) {
      context.addIssue({
        code: "custom",
        path: ["english", "sourceTrackId"],
        message: "A distinct English track must be linked to the native track.",
      });
    }
    if (!evidence.preferred) return;
    if (languagesEquivalent(evidence.preferred.language, "en")) {
      context.addIssue({
        code: "custom",
        path: ["preferred", "language"],
        message: "Preferred evidence must be a distinct non-English language.",
      });
    }
    if (
      languagesEquivalent(evidence.preferred.language, evidence.native.language)
    ) {
      context.addIssue({
        code: "custom",
        path: ["preferred", "language"],
        message: "Preferred evidence cannot duplicate the native language.",
      });
    }
    if (evidence.preferred.sourceTrackId !== evidence.native.trackId) {
      context.addIssue({
        code: "custom",
        path: ["preferred", "sourceTrackId"],
        message: "Preferred evidence must be derived from the native track.",
      });
    }
  });

export const LegacyClipLanguageEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  englishText: z.string().min(1),
  originalText: z.string().min(1).optional(),
});

export const ClipLanguageEvidenceSchema = z.union([
  ClipLanguageEvidenceV2Schema,
  LegacyClipLanguageEvidenceSchema,
]);

export const CreateClipCandidateRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(512),
  video: ClipVideoSnapshotSchema,
  selection: TranscriptSelectionSchema,
  languageEvidence: ClipLanguageEvidenceV2Schema,
  notes: z.string().trim().max(20_000).default(""),
  tags: z.array(ClipTagNameSchema).max(50).default([]),
});
export const ClipCandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  catalogVideoId: IdSchema,
  video: ClipVideoSnapshotSchema,
  selection: TranscriptSelectionSchema,
  languageEvidence: ClipLanguageEvidenceSchema,
  englishText: z.string().min(1),
  originalText: z.string().min(1).optional(),
  notes: z.string(),
  tags: z.array(ClipTagNameSchema),
  researchStatus: ClipResearchStatusSchema,
  exportStatus: ClipExportStatusSchema,
  createdBy: IdSchema,
  version: z.number().int().positive(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export const UpdateClipCandidateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  notes: z.string().trim().max(20_000),
  tags: z.array(ClipTagNameSchema).max(50),
});

export const ExportSourceLanguageClassSchema = z.enum([
  "confirmed_english",
  "foreign",
  "mixed",
  "unknown",
]);
export const ExportSubtitleTrackReferenceSchema = z.object({
  trackId: IdSchema,
  trackVersion: z.number().int().positive(),
});
export const ExportSubtitleTrackSnapshotsSchema = z.object({
  original: ExportSubtitleTrackReferenceSchema,
  english: ExportSubtitleTrackReferenceSchema,
});
export const ExportVideoRateControlSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("crf"), value: z.number().int().min(0).max(51) }),
  z.object({
    mode: z.literal("bitrate"),
    kilobitsPerSecond: z.number().int().min(500).max(200_000),
  }),
  z.object({ mode: z.literal("codec_default") }),
]);
export const ExportSettingsSchema = z
  .object({
    container: z.enum(["mp4", "mov", "mkv"]),
    videoCodec: z.enum(["h264", "hevc", "prores"]),
    videoRateControl: ExportVideoRateControlSchema,
    maxWidth: z.number().int().min(320).max(7_680).optional(),
    frameRate: z.enum(["source", "23.976", "24", "25", "29.97", "30"]),
    audioCodec: z.enum(["aac", "pcm_s16le"]),
    audioKilobitsPerSecond: z.number().int().min(64).max(1_536).optional(),
    audioSampleRate: z.enum(["source", "44100", "48000"]).optional(),
    audioChannels: z.enum(["source", "1", "2"]).optional(),
    omitSubtitleFilesForConfirmedEnglish: z.boolean(),
    embedEnglishSubtitleTrack: z.boolean(),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.container === "mp4" && settings.videoCodec === "prores") {
      context.addIssue({
        code: "custom",
        message: "ProRes export requires MOV or MKV.",
        path: ["videoCodec"],
      });
    }
    if (settings.container === "mp4" && settings.audioCodec === "pcm_s16le") {
      context.addIssue({
        code: "custom",
        message: "PCM audio export requires MOV or MKV.",
        path: ["audioCodec"],
      });
    }
  });
export const ExportPresetSnapshotSchema = z.object({
  presetId: IdSchema.optional(),
  presetVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  settings: ExportSettingsSchema,
});
export const ExportPresetScopeSchema = z.enum(["personal", "project"]);
export const ExportPresetDescriptionSchema = z.string().trim().max(2_000);
export const ExportPresetVersionSchema = z
  .object({
    presetId: IdSchema,
    presetVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    description: ExportPresetDescriptionSchema,
    settings: ExportSettingsSchema,
    createdBy: IdSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict();
export const ExportPresetCatalogEntrySchema = z
  .object({
    id: IdSchema,
    scope: ExportPresetScopeSchema,
    projectId: IdSchema.optional(),
    currentVersion: z.number().int().positive(),
    entityVersion: z.number().int().positive(),
    current: ExportPresetVersionSchema,
    createdBy: IdSchema,
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((preset, context) => {
    if (preset.current.presetId !== preset.id) {
      context.addIssue({
        code: "custom",
        path: ["current", "presetId"],
        message: "The current revision must belong to this preset.",
      });
    }
    if (preset.current.presetVersion !== preset.currentVersion) {
      context.addIssue({
        code: "custom",
        path: ["current", "presetVersion"],
        message: "The current revision must match the current-version pointer.",
      });
    }
    if (preset.scope === "project" && !preset.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project presets require their project identity.",
      });
    }
    if (preset.scope === "personal" && preset.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Personal presets cannot carry a project identity.",
      });
    }
  });
export const ExportPresetDefaultSchema = z
  .object({
    scope: ExportPresetScopeSchema,
    projectId: IdSchema.optional(),
    presetId: IdSchema,
    presetVersion: z.number().int().positive(),
    entityVersion: z.number().int().positive(),
    snapshot: ExportPresetSnapshotSchema.extend({ presetId: IdSchema }),
    description: ExportPresetDescriptionSchema,
    updatedBy: IdSchema,
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.snapshot.presetId !== record.presetId ||
      record.snapshot.presetVersion !== record.presetVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshot"],
        message: "The default snapshot must match its fixed preset version.",
      });
    }
    if (record.scope === "project" && !record.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project defaults require their project identity.",
      });
    }
    if (record.scope === "personal" && record.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Personal defaults cannot carry a project identity.",
      });
    }
  });
export const CreateExportPresetRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(160),
    description: ExportPresetDescriptionSchema.default(""),
    settings: ExportSettingsSchema,
  })
  .strict();
export const ReviseExportPresetRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    presetId: IdSchema,
    expectedEntityVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    description: ExportPresetDescriptionSchema,
    settings: ExportSettingsSchema,
  })
  .strict();
export const SetExportPresetDefaultRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    expectedEntityVersion: z.number().int().nonnegative(),
    presetId: IdSchema,
    presetVersion: z.number().int().positive(),
  })
  .strict();
export const PersonalExportPresetCatalogSchema = z
  .object({
    presets: z.array(ExportPresetCatalogEntrySchema),
    default: ExportPresetDefaultSchema.optional(),
  })
  .strict();
export const ProjectExportPresetCatalogSchema = z
  .object({
    projectPresets: z.array(ExportPresetCatalogEntrySchema),
    projectDefault: ExportPresetDefaultSchema.optional(),
    personalPresets: z.array(ExportPresetCatalogEntrySchema),
    personalDefault: ExportPresetDefaultSchema.optional(),
  })
  .strict();
export const ExportPresetDefaultResponseSchema = z
  .object({ default: ExportPresetDefaultSchema.optional() })
  .strict();
export const ExportSettingsOverrideSchema = z
  .object({
    container: z.enum(["mp4", "mov", "mkv"]).optional(),
    videoCodec: z.enum(["h264", "hevc", "prores"]).optional(),
    videoRateControl: ExportVideoRateControlSchema.optional(),
    maxWidth: z.number().int().min(320).max(7_680).nullable().optional(),
    frameRate: z
      .enum(["source", "23.976", "24", "25", "29.97", "30"])
      .optional(),
    audioCodec: z.enum(["aac", "pcm_s16le"]).optional(),
    audioKilobitsPerSecond: z
      .number()
      .int()
      .min(64)
      .max(1_536)
      .nullable()
      .optional(),
    audioSampleRate: z.enum(["source", "44100", "48000"]).nullable().optional(),
    audioChannels: z.enum(["source", "1", "2"]).nullable().optional(),
    omitSubtitleFilesForConfirmedEnglish: z.boolean().optional(),
    embedEnglishSubtitleTrack: z.boolean().optional(),
  })
  .strict();
export const ExportPresetReferenceSchema = z
  .object({
    scope: ExportPresetScopeSchema,
    presetId: IdSchema,
    presetVersion: z.number().int().positive(),
  })
  .strict();
export const ExportSettingsSelectionSchema = z
  .object({
    base: z.enum(["context_default", "application_default"]),
    selectedPreset: ExportPresetReferenceSchema.optional(),
    overrides: ExportSettingsOverrideSchema.default({}),
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.base === "application_default" && selection.selectedPreset) {
      context.addIssue({
        code: "custom",
        path: ["selectedPreset"],
        message:
          "An explicit preset cannot be combined with the application-default base.",
      });
    }
  });
export const ExportCapabilityIssueSchema = z
  .object({
    field: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export const ExportWorkerCapabilityReferenceSchema = z
  .object({
    profileId: z.string().min(1),
    profileVersion: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    validation: z.enum(["validated", "legacy_unvalidated"]),
  })
  .strict();
export const ExportRendererCapabilityIdSchema = z.enum([
  "h264_mp4",
  "hevc_mkv",
  "prores_mov",
]);
const ExportRendererCapabilityIds = ExportRendererCapabilityIdSchema.options;

export const ExportWorkerAvailabilitySchema = z
  .object({
    discovery: z.enum(["canonical_only", "installed"]),
    availableRendererIds: z.array(ExportRendererCapabilityIdSchema).max(3),
    unavailableRendererIds: z.array(ExportRendererCapabilityIdSchema).max(3),
    ffmpegVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/** Safe, normalized result of the local fixed FFmpeg capability discovery. */
export const InstalledExportWorkerCapabilitySummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    availableRendererIds: z.array(ExportRendererCapabilityIdSchema).max(3),
    unavailableRendererIds: z.array(ExportRendererCapabilityIdSchema).max(3),
    ffmpegVersion: z
      .string()
      .regex(/^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9._-]+)?$/)
      .optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    const available = new Set(summary.availableRendererIds);
    const unavailable = new Set(summary.unavailableRendererIds);
    if (available.size !== summary.availableRendererIds.length) {
      context.addIssue({
        code: "custom",
        path: ["availableRendererIds"],
        message: "Available renderer IDs must be unique.",
      });
    }
    if (unavailable.size !== summary.unavailableRendererIds.length) {
      context.addIssue({
        code: "custom",
        path: ["unavailableRendererIds"],
        message: "Unavailable renderer IDs must be unique.",
      });
    }
    if ([...available].some((id) => unavailable.has(id))) {
      context.addIssue({
        code: "custom",
        message: "Renderer IDs cannot be both available and unavailable.",
      });
    }
    const expectedAvailable = ExportRendererCapabilityIds.filter((id) =>
      available.has(id),
    );
    const expectedUnavailable = ExportRendererCapabilityIds.filter((id) =>
      unavailable.has(id),
    );
    if (
      available.size + unavailable.size !==
      ExportRendererCapabilityIds.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Renderer availability must partition every known renderer ID.",
      });
    }
    if (
      summary.availableRendererIds.join("|") !== expectedAvailable.join("|") ||
      summary.unavailableRendererIds.join("|") !== expectedUnavailable.join("|")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Renderer availability arrays must use the canonical renderer order.",
      });
    }
  });
export const RegisteredExportWorkerSchema = z
  .object({
    id: IdSchema,
    epoch: z.number().int().positive(),
    capability: ExportWorkerCapabilityReferenceSchema,
    installedCapabilities: InstalledExportWorkerCapabilitySummarySchema,
    advertisementFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    heartbeatAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export const RegisterExportWorkerRequestSchema = z
  .object({
    workerId: IdSchema,
    epoch: z.number().int().positive(),
    capability: ExportWorkerCapabilityReferenceSchema,
    installedCapabilities: InstalledExportWorkerCapabilitySummarySchema,
    advertisementFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const HeartbeatExportWorkerRequestSchema = z
  .object({
    workerId: IdSchema,
    epoch: z.number().int().positive(),
  })
  .strict();
export const RevokeExportWorkerRequestSchema =
  HeartbeatExportWorkerRequestSchema;
export const ExportWorkerCompatibilityRequestSchema = z
  .object({
    capability: ExportWorkerCapabilityReferenceSchema,
    rendererId: ExportRendererCapabilityIdSchema,
  })
  .strict();
export const ExportWorkerAvailabilityResponseSchema = z
  .object({
    compatible: z.boolean(),
    availableWorkerCount: z.number().int().nonnegative().max(100),
  })
  .strict();
export const ResolvedExportSettingsSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    resolutionKind: z.enum(["catalog", "legacy_inline"]),
    context: z.enum(["logged", "export_only"]),
    base: z.enum(["application_default", "context_default", "legacy_inline"]),
    applicationDefaultVersion: z.literal(1),
    contextDefault: ExportPresetSnapshotSchema.optional(),
    selectedPreset: ExportPresetSnapshotSchema.optional(),
    selectedPresetScope: ExportPresetScopeSchema.optional(),
    legacyPreset: ExportPresetSnapshotSchema.optional(),
    overrides: ExportSettingsOverrideSchema,
    overrideFields: z.array(z.string().min(1)),
    settings: ExportSettingsSchema,
    capability: ExportWorkerCapabilityReferenceSchema,
    resolutionFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    resolvedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const legacy = snapshot.resolutionKind === "legacy_inline";
    if (
      legacy !==
      (snapshot.base === "legacy_inline" &&
        Boolean(snapshot.legacyPreset) &&
        snapshot.capability.validation === "legacy_unvalidated")
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolutionKind"],
        message: "Legacy resolution provenance is inconsistent.",
      });
    }
    if (
      (legacy &&
        (snapshot.contextDefault ||
          snapshot.selectedPreset ||
          snapshot.selectedPresetScope ||
          snapshot.overrideFields.length > 0)) ||
      (snapshot.base === "application_default" && snapshot.contextDefault)
    ) {
      context.addIssue({
        code: "custom",
        path: ["base"],
        message: "Resolved base-layer provenance is inconsistent.",
      });
    }
    if (
      !legacy &&
      (snapshot.base === "legacy_inline" ||
        snapshot.legacyPreset ||
        snapshot.capability.validation !== "validated" ||
        !snapshot.resolutionFingerprint)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolutionKind"],
        message: "Catalog resolution provenance is inconsistent.",
      });
    }
    if (
      Boolean(snapshot.selectedPreset) !== Boolean(snapshot.selectedPresetScope)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedPresetScope"],
        message:
          "Selected preset scope must accompany selected preset provenance.",
      });
    }
    const overrideFields = Object.keys(snapshot.overrides).sort();
    if (
      overrideFields.length !== snapshot.overrideFields.length ||
      overrideFields.some(
        (field, index) => field !== snapshot.overrideFields[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["overrideFields"],
        message:
          "Override fields must exactly name the sorted override payload fields.",
      });
    }
  });
export const ExportSettingsPreviewRequestSchema = z
  .object({
    sourceLanguageClass: ExportSourceLanguageClassSchema,
    selection: ExportSettingsSelectionSchema,
  })
  .strict();
export const ExportSettingsPreviewSchema = z
  .object({
    snapshot: ResolvedExportSettingsSnapshotSchema,
    issues: z.array(ExportCapabilityIssueSchema),
    workerAvailability: ExportWorkerAvailabilitySchema.optional(),
    effectiveSubtitlePolicy: z.object({
      requiredSidecars: z.array(z.enum(["original", "english"])).max(2),
      subtitleSidecarsOmittedReason: z
        .literal("confirmed_english_user_setting")
        .optional(),
    }),
  })
  .strict();
export const ExportRequestOriginSchema = z.enum([
  "selection_action",
  "clip_library",
  "authoring_build",
]);
const createExportRequestBaseSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    requestOrigin: ExportRequestOriginSchema.optional(),
    sourceLanguageClass: ExportSourceLanguageClassSchema,
    subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
    preset: ExportPresetSnapshotSchema.optional(),
    settingsSelection: ExportSettingsSelectionSchema.optional(),
    expectedResolutionFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (Boolean(request.preset) === Boolean(request.settingsSelection)) {
      context.addIssue({
        code: "custom",
        path: ["settingsSelection"],
        message:
          "Provide exactly one legacy preset or catalog settings selection.",
      });
    }
    if (request.settingsSelection && !request.expectedResolutionFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["expectedResolutionFingerprint"],
        message: "Catalog settings creation requires the preview fingerprint.",
      });
    }
    if (request.preset && request.expectedResolutionFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["expectedResolutionFingerprint"],
        message: "Legacy inline presets do not accept a preview fingerprint.",
      });
    }
  });

function requireBilingualSubtitleTrackSnapshots(
  request: {
    sourceLanguageClass: z.infer<typeof ExportSourceLanguageClassSchema>;
    subtitleTracks?:
      z.infer<typeof ExportSubtitleTrackSnapshotsSchema> | undefined;
  },
  context: z.RefinementCtx,
) {
  if (
    request.sourceLanguageClass !== "confirmed_english" &&
    !request.subtitleTracks
  ) {
    context.addIssue({
      code: "custom",
      path: ["subtitleTracks"],
      message:
        "Foreign, mixed, and unknown exports require immutable original and English subtitle track snapshots.",
    });
  }
}

export const CreateClipExportRequestSchema =
  createExportRequestBaseSchema.superRefine(
    requireBilingualSubtitleTrackSnapshots,
  );
export const CreateLoggedExportBatchRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    items: z
      .array(
        z
          .object({
            clipId: IdSchema,
            export: CreateClipExportRequestSchema,
          })
          .strict(),
      )
      .min(2)
      .max(25),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>();
    request.items.forEach((item, index) => {
      if (seen.has(item.clipId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "clipId"],
          message: "A clip can appear only once in an export batch.",
        });
      }
      seen.add(item.clipId);
    });
  });
export const CreateExportOnlyRequestSchema = createExportRequestBaseSchema
  .extend({
    video: ClipVideoSnapshotSchema,
    selection: TranscriptSelectionSchema,
  })
  .superRefine(requireBilingualSubtitleTrackSnapshots);
export const TranscriptArtifactSchema = z.object({
  type: z.enum([
    "manifest",
    "provider-response",
    "original-normalized",
    "english-normalized",
    "original-srt",
    "english-srt",
  ]),
  objectKey: z.string().min(1),
  objectVersionId: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const TranscriptManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: IdSchema,
  projectId: IdSchema,
  catalogVideoId: IdSchema,
  videoId: z.string().min(1).max(64),
  lineageId: IdSchema,
  version: z.number().int().positive(),
  sourceLanguage: z.string().min(2).max(35),
  targetLanguage: z.string().min(2).max(35),
  timingPrecision: TimingPrecisionSchema,
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  normalizationSchemaVersion: z.number().int().positive(),
  jobId: IdSchema,
  createdBy: IdSchema,
  createdAt: UtcTimestampSchema,
  artifacts: z.array(TranscriptArtifactSchema).min(1),
});

export const DerivedTranslationIdentitySchema = z
  .object({
    projectId: IdSchema,
    catalogVideoId: IdSchema,
    baseTranscriptVersionId: IdSchema,
    originalTrackId: IdSchema,
    originalContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    targetLanguage: LanguageTagSchema,
    provider: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(160).optional(),
    normalizationSchemaVersion: z.number().int().positive(),
  })
  .superRefine((identity, context) => {
    if (languagesEquivalent(identity.targetLanguage, "en")) {
      context.addIssue({
        code: "custom",
        path: ["targetLanguage"],
        message:
          "Supplemental derived translations must target a non-English language.",
      });
    }
  });

export const DerivedTranslationArtifactSchema = z.object({
  type: z.enum(["manifest", "translated-normalized"]),
  objectKey: z.string().min(1),
  objectVersionId: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const DerivedTranslationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: IdSchema,
  lineageId: IdSchema,
  version: z.number().int().positive(),
  identity: DerivedTranslationIdentitySchema,
  translatedTrackId: IdSchema,
  translatedTrackVersion: z.number().int().positive(),
  sourceTrackId: IdSchema,
  timingPrecision: TimingPrecisionSchema,
  idempotencyKey: z.string().trim().min(1).max(512),
  createdBy: IdSchema,
  createdAt: UtcTimestampSchema,
  artifacts: z.array(DerivedTranslationArtifactSchema).min(1),
});

export const PublishDerivedTranslationRequestSchema = z
  .object({
    identity: DerivedTranslationIdentitySchema,
    idempotencyKey: z.string().trim().min(1).max(512),
    transcript: NormalizedTranscriptSchema,
  })
  .superRefine((request, context) => {
    const track = request.transcript.track;
    if (track.kind !== "translation") {
      context.addIssue({
        code: "custom",
        path: ["transcript", "track", "kind"],
        message: "A supplemental translation must use the translation kind.",
      });
    }
    if (!languagesEquivalent(track.language, request.identity.targetLanguage)) {
      context.addIssue({
        code: "custom",
        path: ["transcript", "track", "language"],
        message:
          "Translated track language does not match the requested target.",
      });
    }
    if (track.sourceTrackId !== request.identity.originalTrackId) {
      context.addIssue({
        code: "custom",
        path: ["transcript", "track", "sourceTrackId"],
        message: "Translated track must link directly to the original track.",
      });
    }
  });

export const RequestDerivedTranslationSchema = z.object({
  identity: DerivedTranslationIdentitySchema,
  idempotencyKey: z.string().trim().min(1).max(512),
});

export const DerivedTranslationJobSchema = z.object({
  id: IdSchema,
  lineageId: IdSchema,
  state: z.enum([
    "queued",
    "processing",
    "complete",
    "failed",
    "canceled",
    "superseded",
  ]),
  attempt: z.number().int().nonnegative(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const DerivedTranslationSchema = z.object({
  manifest: DerivedTranslationManifestSchema,
  transcript: NormalizedTranscriptSchema,
});

export const PreferredTranscriptResolutionSchema = z.discriminatedUnion(
  "state",
  [
    z.object({
      state: z.literal("ready"),
      source: z.enum(["original", "english", "local", "shared", "generated"]),
      transcript: NormalizedTranscriptSchema,
    }),
    z.object({
      state: z.literal("needs_translation"),
      targetLanguage: LanguageTagSchema,
    }),
    z.object({
      state: z.literal("preferred_translation_unavailable"),
      targetLanguage: LanguageTagSchema,
      reason: z.string().trim().min(1).max(2_000),
    }),
  ],
);

export const FinalizedObjectSchema = TranscriptArtifactSchema.extend({
  objectVersionId: z.string().min(1),
});

export const TranscriptUploadTargetSchema = z.object({
  type: TranscriptArtifactSchema.shape.type,
  objectKey: z.string().min(1),
  uploadUrl: z.string().min(1),
});

export const TranscriptUploadGrantSchema = z.object({
  uploadId: IdSchema,
  jobId: IdSchema,
  projectId: IdSchema,
  catalogVideoId: IdSchema,
  lineageId: IdSchema,
  version: z.number().int().positive(),
  expiresAt: UtcTimestampSchema,
  targets: z.array(TranscriptUploadTargetSchema).min(2),
});

export const TranscriptDownloadTargetSchema = FinalizedObjectSchema.extend({
  downloadUrl: z.string().min(1),
});

export const FinalizeTranscriptRequestSchema = z.object({
  uploadId: IdSchema,
  idempotencyKey: z.string().min(1).max(512),
  manifest: FinalizedObjectSchema.extend({ type: z.literal("manifest") }),
});

export const ActiveTranscriptBundleSchema = z.object({
  transcriptVersionId: IdSchema,
  manifest: TranscriptManifestSchema,
  manifestObject: FinalizedObjectSchema.extend({
    type: z.literal("manifest"),
  }),
  downloads: z.array(TranscriptDownloadTargetSchema).min(2),
});

export const TranscriptionItemStateSchema = z.enum([
  "draft",
  "preflight",
  "queued",
  "resolving",
  "acquiring",
  "transcribing",
  "translating",
  "aligning",
  "uploading",
  "ready_for_review",
  "blocked",
  "failed",
  "canceled",
]);

export const BatchSourcePolicySchema = z.enum([
  "prefer-existing",
  "captions-then-generate",
  "force-generate",
]);

export const BatchPrioritySchema = z.enum(["low", "normal", "high"]);

export const CaptionTrackCandidateSchema = z.object({
  id: z.string().min(1).max(512),
  language: z.string().min(2).max(35),
  kind: z.enum(["manual", "automatic"]),
  translatable: z.boolean(),
  downloadAccess: z.enum([
    "available",
    "authorization-required",
    "unavailable",
  ]),
});

export const TranscriptSourcePlanSchema = z.discriminatedUnion("strategy", [
  z.object({
    strategy: z.literal("caption"),
    track: CaptionTrackCandidateSchema,
    sourceLanguage: z.string().min(2).max(35),
    targetLanguage: z.string().min(2).max(35),
    requiresTranslation: z.boolean(),
    reason: z.enum([
      "manual-target-language",
      "automatic-target-language",
      "manual-original-language",
      "automatic-original-language",
    ]),
  }),
  z.object({
    strategy: z.literal("speech-to-text"),
    targetLanguage: z.string().min(2).max(35),
    requiresLanguageDetection: z.literal(true),
    reason: z.enum([
      "forced-generation",
      "no-caption-tracks",
      "no-downloadable-caption-tracks",
      "caption-acquisition-failed",
    ]),
  }),
]);

export const BatchPreflightStatusSchema = z.enum([
  "ready",
  "existing-transcript",
  "duplicate",
  "unsupported",
  "metadata-failed",
]);

export const BatchProcessingNeedSchema = z.enum([
  "transcription",
  "reuse-shared",
  "none",
]);

export const BatchInputListSchema = z
  .array(z.string().trim().min(1).max(2_000))
  .min(1)
  .max(500);

export const BatchOptionsSchema = z.object({
  targetLanguage: z.string().min(2).max(35).default("en"),
  transcriptionProfile: z.string().trim().min(1).max(160).default("default"),
  sourcePolicy: BatchSourcePolicySchema.default("prefer-existing"),
  executionLocation: z.enum(["local", "hosted"]).default("local"),
  priority: BatchPrioritySchema.default("normal"),
});

export const BatchPreflightRequestSchema = BatchOptionsSchema.extend({
  inputs: BatchInputListSchema,
});

export const BatchPreflightItemSchema = z.object({
  inputIndex: z.number().int().nonnegative(),
  input: z.string().min(1),
  status: BatchPreflightStatusSchema,
  processingNeed: BatchProcessingNeedSchema,
  youtubeVideoId: z.string().min(1).max(64).optional(),
  canonicalUrl: z.url().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  channel: z.string().trim().min(1).max(300).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  sourceLanguage: z.string().min(2).max(35).optional(),
  catalogVideoId: IdSchema.optional(),
  activeTranscriptVersionId: IdSchema.optional(),
  duplicateOfInputIndex: z.number().int().nonnegative().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});

export const BatchPreflightSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  existingTranscripts: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  metadataFailed: z.number().int().nonnegative(),
});

export const BatchPreflightResponseSchema = z.object({
  projectId: IdSchema,
  options: BatchOptionsSchema,
  items: z.array(BatchPreflightItemSchema),
  summary: BatchPreflightSummarySchema,
});

export const CreateTranscriptionBatchRequestSchema =
  BatchPreflightRequestSchema.extend({
    name: z.string().trim().min(1).max(160),
  });

export const TranscriptionBatchSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  name: z.string().trim().min(1).max(160),
  targetLanguage: z.string().min(2).max(35).default("en"),
  transcriptionProfile: z.string().trim().min(1).max(160),
  sourcePolicy: BatchSourcePolicySchema,
  executionLocation: z.enum(["local", "hosted"]),
  priority: BatchPrioritySchema,
  dispatchStatus: z.enum(["active", "paused", "canceled"]),
  createdBy: IdSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  version: z.number().int().positive(),
});

export const TranscriptionBatchItemSchema = BatchPreflightItemSchema.extend({
  id: IdSchema,
  batchId: IdSchema,
  state: TranscriptionItemStateSchema,
  reviewStatus: z.enum(["unreviewed", "reviewing", "reviewed", "skipped"]),
  jobId: IdSchema.optional(),
  idempotencyKey: z.string().min(1).max(512).optional(),
  sourcePlan: TranscriptSourcePlanSchema.optional(),
  sourceResolvedAt: UtcTimestampSchema.optional(),
  attempt: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean().optional(),
    })
    .optional(),
});

export const TranscriptionBatchProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  readyForReview: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  retryableFailed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  unreviewed: z.number().int().nonnegative(),
  reviewing: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const CreateTranscriptionBatchResponseSchema = z.object({
  batch: TranscriptionBatchSchema,
  items: z.array(TranscriptionBatchItemSchema),
  summary: BatchPreflightSummarySchema,
  progress: TranscriptionBatchProgressSchema,
});

export const TranscriptionBatchControlRequestSchema = z.object({
  action: z.enum([
    "pause_pending",
    "resume",
    "cancel_unstarted",
    "retry_failed",
  ]),
  expectedVersion: z.number().int().positive(),
});

export const TranscriptionBatchListItemSchema = z.object({
  batch: TranscriptionBatchSchema,
  progress: TranscriptionBatchProgressSchema,
});

export const TranscriptionBatchListResponseSchema = z.object({
  batches: z.array(TranscriptionBatchListItemSchema).max(200),
});

export const ReviewInboxItemSchema = TranscriptionBatchItemSchema.extend({
  batchName: z.string().trim().min(1).max(160),
});

export const ReviewInboxResponseSchema = z.object({
  items: z.array(ReviewInboxItemSchema).max(500),
});

export const UpdateReviewStatusRequestSchema = z.object({
  reviewStatus: z.enum(["unreviewed", "reviewing", "reviewed", "skipped"]),
  expectedVersion: z.number().int().positive(),
});

export const JobKindSchema = z.enum(["transcription", "export", "sync"]);
export const JobStateSchema = z.enum([
  "queued",
  "claimed",
  "processing",
  "needs_user_action",
  "complete",
  "failed",
  "canceled",
]);

export const ExportMediaProvenanceSchema = z.object({
  durationMs: z.number().int().positive(),
  containerFormat: z.string().trim().min(1).max(240).optional(),
  videoCodec: z.string().trim().min(1).max(120).optional(),
  audioCodec: z.string().trim().min(1).max(120).optional(),
  ffprobeVersion: z.string().trim().min(1).max(120).optional(),
});

export const ResolvedExportBoundsSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
    resolvedAt: UtcTimestampSchema,
  })
  .refine((bounds) => bounds.endMs > bounds.startMs, {
    message: "Resolved export end must be after its start.",
  });

export const ExportMediaRationalSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
  })
  .strict();

export const ExportObservedMediaPropertiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    container: z
      .object({
        formatNames: z.array(z.string().trim().min(1).max(64)).min(1).max(16),
        majorBrand: z.string().trim().min(1).max(64).optional(),
      })
      .strict(),
    streamCounts: z
      .object({
        total: z.number().int().nonnegative(),
        video: z.number().int().nonnegative(),
        audio: z.number().int().nonnegative(),
        subtitle: z.number().int().nonnegative(),
        data: z.number().int().nonnegative(),
        other: z.number().int().nonnegative(),
      })
      .strict(),
    video: z
      .object({
        codec: z.string().trim().min(1).max(120),
        profile: z.string().trim().min(1).max(120),
        pixelFormat: z.string().trim().min(1).max(120),
        width: z.number().int().positive().max(7_680),
        height: z.number().int().positive().max(4_320),
        sampleAspectRatio: ExportMediaRationalSchema,
        displayAspectRatio: ExportMediaRationalSchema,
        averageFrameRate: ExportMediaRationalSchema,
      })
      .strict(),
    audio: z
      .object({
        codec: z.string().trim().min(1).max(120),
        sampleRate: z.number().int().positive().max(384_000),
        channels: z.number().int().positive().max(32),
        channelLayout: z.string().trim().min(1).max(120),
        reportedBitRate: z.number().int().positive().optional(),
      })
      .strict(),
    subtitle: z
      .object({
        codec: z.string().trim().min(1).max(120),
        language: z.string().trim().min(2).max(35),
        title: z.string().trim().min(1).max(120).optional(),
        default: z.boolean(),
        forced: z.boolean(),
      })
      .strict()
      .optional(),
    durationMs: z.number().int().positive(),
    ffprobeVersion: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const RenderedExportMediaProvenanceSchema =
  ExportMediaProvenanceSchema.extend({
    ffmpegVersion: z.string().trim().min(1).max(120).optional(),
    verificationSchemaVersion: z.literal(1).optional(),
    settingsSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    observedProperties: ExportObservedMediaPropertiesSchema.optional(),
    sourceAttempt: z.number().int().positive(),
    validatedAt: UtcTimestampSchema,
  });

export const ExportThumbnailProvenanceSchema = z
  .object({
    extractionTimeMs: z.number().int().nonnegative(),
    width: z.number().int().positive().max(1_280),
    height: z.number().int().positive().max(720),
    sourceAttempt: z.number().int().positive(),
    validatedAt: UtcTimestampSchema,
  })
  .refine(
    (thumbnail) => thumbnail.width % 2 === 0 && thumbnail.height % 2 === 0,
    {
      message: "Thumbnail dimensions must be even.",
    },
  );

const ExportClipManifestThumbnailSchema = z
  .object({
    extractionTimeMs: z.number().int().nonnegative(),
    width: z.number().int().positive().max(1_280),
    height: z.number().int().positive().max(720),
    jpegQuality: z.literal(3),
  })
  .refine(
    (thumbnail) => thumbnail.width % 2 === 0 && thumbnail.height % 2 === 0,
    { message: "Thumbnail dimensions must be even." },
  );

export const SubtitleOmissionProvenanceSchema = z.object({
  policy: z.literal("confirmed_english_user_setting"),
  sourceAttempt: z.number().int().positive(),
  validatedAt: UtcTimestampSchema,
});

export const EnglishSubtitleSidecarProvenanceSchema = z
  .object({
    trackId: IdSchema,
    trackVersion: z.number().int().positive(),
    cueCount: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
    validatedAt: UtcTimestampSchema,
  })
  .refine((sidecar) => sidecar.endMs > sidecar.startMs, {
    message: "English subtitle timing bounds must be nonempty.",
  });

export const SubtitleSidecarProvenanceSchema = z
  .object({
    role: z.enum(["original", "english"]),
    language: z.string().trim().min(2).max(35),
    trackId: IdSchema,
    trackVersion: z.number().int().positive(),
    cueCount: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
    validatedAt: UtcTimestampSchema,
  })
  .refine((sidecar) => sidecar.endMs > sidecar.startMs, {
    message: "Subtitle timing bounds must be nonempty.",
  });

export const FinalArtifactRoleSchema = z.enum([
  "video_mp4",
  "video_mkv",
  "video_mov",
  "english_srt",
  "original_srt",
  "clip_metadata_json",
  "thumbnail_jpg",
  "manifest_json",
]);

export const FinalArtifactProvenanceSchema = z.object({
  role: FinalArtifactRoleSchema,
  packageIdentity: z.string().regex(/^clip-[a-f0-9-]{36}$/),
  byteSize: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceAttempt: z.number().int().positive(),
  validatedAt: UtcTimestampSchema,
});

export const ExportClipManifestV1SchemaVersion = 1;
export const ExportClipManifestSchemaVersion = 2;
export const ExportClipMetadataV1SchemaVersion = 1;
export const ExportClipMetadataSchemaVersion = 2;

const PackageVideoSnapshotSchema = ClipVideoSnapshotSchema.superRefine(
  (video, context) => {
    const url = new URL(video.canonicalUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      url.pathname !== "/watch" ||
      url.searchParams.get("v") !== video.youtubeVideoId
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalUrl"],
        message:
          "Package video identity must use the canonical public YouTube watch URL.",
      });
    }
  },
);

export const ExportResolvedSubtitlePolicySchema = z.object({
  requiredSidecars: z.array(z.enum(["original", "english"])).max(2),
  subtitleSidecarsOmittedReason: z
    .literal("confirmed_english_user_setting")
    .optional(),
});

/**
 * The descriptive clip sidecar is derived only from immutable request snapshot
 * values and persisted validation provenance. `canonicalUrl` is deliberately
 * limited to the canonical public YouTube watch URL in the video snapshot;
 * acquisition, presigned, provider, local-file, and command-derived URLs are
 * never package metadata.
 */
const ExportClipMetadataBaseSchema = z.object({
  exportRequestId: IdSchema,
  jobId: IdSchema,
  mode: z.enum(["logged", "export_only"]),
  packageIdentity: z.string().regex(/^clip-[a-f0-9-]{36}$/),
  sourceAttempt: z.number().int().positive(),
  validatedAt: UtcTimestampSchema,
  video: PackageVideoSnapshotSchema,
  sourceLanguageClass: ExportSourceLanguageClassSchema,
  selection: TranscriptSelectionSchema,
  resolvedExportBounds: z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
  }),
  renderedDurationMs: z.number().int().positive(),
  preset: ExportPresetSnapshotSchema,
  subtitlePolicy: ExportResolvedSubtitlePolicySchema,
  subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
});

export const ExportClipMetadataV1Schema = ExportClipMetadataBaseSchema.extend({
  schemaVersion: z.literal(ExportClipMetadataV1SchemaVersion),
});

export const ExportClipConversionSummarySchema = z
  .object({
    rendererCapabilityId: ExportRendererCapabilityIdSchema,
    videoRole: z.enum(["video_mp4", "video_mkv", "video_mov"]),
    videoFilename: z.string().regex(/^clip-[a-f0-9-]{36}\.(?:mp4|mkv|mov)$/),
    container: z.enum(["mp4", "mkv", "mov"]),
    videoCodec: z.enum(["h264", "hevc", "prores"]),
    videoProfile: z.string().trim().min(1).max(120),
    pixelFormat: z.string().trim().min(1).max(120),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: ExportMediaRationalSchema,
    audioCodec: z.enum(["aac", "pcm_s16le"]),
    audioSampleRate: z.number().int().positive(),
    audioChannels: z.number().int().positive(),
    embeddedEnglishSubtitle: z
      .object({
        codec: z.enum(["mov_text", "subrip"]),
        language: z.literal("eng"),
        title: z.literal("English").optional(),
        default: z.literal(false),
        forced: z.literal(false),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ExportClipMetadataV2Schema = ExportClipMetadataBaseSchema.extend({
  schemaVersion: z.literal(ExportClipMetadataSchemaVersion),
  conversion: ExportClipConversionSummarySchema,
});

export const ExportClipMetadataSchema = z.union([
  ExportClipMetadataV1Schema,
  ExportClipMetadataV2Schema,
]);

export const ExportClipManifestArtifactSchema = z.object({
  role: z.enum([
    "video_mp4",
    "video_mkv",
    "video_mov",
    "english_srt",
    "original_srt",
    "clip_metadata_json",
    "thumbnail_jpg",
  ]),
  filename: z.string().trim().min(1).max(255),
  byteSize: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  subtitle: z
    .object({
      language: z.string().trim().min(2).max(35),
      trackId: IdSchema,
      trackVersion: z.number().int().positive(),
      timingPrecision: TimingPrecisionSchema,
      cueCount: z.number().int().positive(),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
    })
    .optional(),
  thumbnail: ExportClipManifestThumbnailSchema.optional(),
});

export const ExportClipManifestArtifactV1Schema =
  ExportClipManifestArtifactSchema.extend({
    role: z.enum([
      "video_mp4",
      "english_srt",
      "original_srt",
      "clip_metadata_json",
      "thumbnail_jpg",
    ]),
  });

/**
 * The auditable provenance record promoted beside a verified clip package. It
 * is derived only from the immutable request snapshot, persisted validation
 * provenance, and the staged bytes it names, so replaying one request
 * reproduces it exactly. It never contains its own hash, a filesystem path, a
 * command line, or subtitle text. Its canonical URL, when present, is only
 * the immutable public YouTube watch URL from the request video snapshot.
 */
const ExportClipManifestBaseSchema = z.object({
  exportRequestId: IdSchema,
  jobId: IdSchema,
  mode: z.enum(["logged", "export_only"]),
  packageIdentity: z.string().regex(/^clip-[a-f0-9-]{36}$/),
  sourceAttempt: z.number().int().positive(),
  validatedAt: UtcTimestampSchema,
  video: PackageVideoSnapshotSchema,
  sourceLanguageClass: ExportSourceLanguageClassSchema,
  resolvedExportBounds: z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
  }),
  renderedDurationMs: z.number().int().positive(),
  subtitlePolicy: ExportResolvedSubtitlePolicySchema,
  toolVersions: z.object({
    ffprobeVersion: z.string().trim().min(1).max(120).optional(),
    ffmpegVersion: z.string().trim().min(1).max(120).optional(),
  }),
  artifacts: z.array(ExportClipManifestArtifactSchema).min(1).max(5),
});

export const ExportClipManifestV1Schema = ExportClipManifestBaseSchema.extend({
  schemaVersion: z.literal(ExportClipManifestV1SchemaVersion),
  artifacts: z.array(ExportClipManifestArtifactV1Schema).min(1).max(5),
});

export const ExportClipManifestV2Schema = ExportClipManifestBaseSchema.extend({
  schemaVersion: z.literal(ExportClipManifestSchemaVersion),
  verificationSchemaVersion: z.literal(1),
  settingsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  resolvedSettingsSnapshot: ResolvedExportSettingsSnapshotSchema,
  rendererCapabilityId: ExportRendererCapabilityIdSchema,
  observedMedia: ExportObservedMediaPropertiesSchema,
  toolVersions: z
    .object({
      ffprobeVersion: z.string().trim().min(1).max(120),
      ffmpegVersion: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  videoArtifact: z
    .object({
      role: z.enum(["video_mp4", "video_mkv", "video_mov"]),
      filename: z.string().regex(/^clip-[a-f0-9-]{36}\.(?:mp4|mkv|mov)$/),
    })
    .strict(),
}).superRefine((manifest, context) => {
  const videos = manifest.artifacts.filter((artifact) =>
    ["video_mp4", "video_mkv", "video_mov"].includes(artifact.role),
  );
  if (
    videos.length !== 1 ||
    videos[0]?.role !== manifest.videoArtifact.role ||
    videos[0]?.filename !== manifest.videoArtifact.filename
  ) {
    context.addIssue({
      code: "custom",
      path: ["videoArtifact"],
      message:
        "The dynamic video artifact must identify the manifest's one packaged video.",
    });
  }
  const expectedExtension = {
    video_mp4: ".mp4",
    video_mkv: ".mkv",
    video_mov: ".mov",
  }[manifest.videoArtifact.role];
  if (!manifest.videoArtifact.filename.endsWith(expectedExtension)) {
    context.addIssue({
      code: "custom",
      path: ["videoArtifact", "filename"],
      message: "The packaged video role and extension must agree.",
    });
  }
  const expectedFamily = {
    h264_mp4: {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      videoRole: "video_mp4",
      observedVideoCodec: "h264",
      pixelFormat: "yuv420p",
    },
    hevc_mkv: {
      container: "mkv",
      videoCodec: "hevc",
      audioCodec: "aac",
      videoRole: "video_mkv",
      observedVideoCodec: "hevc",
      pixelFormat: "yuv420p",
    },
    prores_mov: {
      container: "mov",
      videoCodec: "prores",
      audioCodec: "pcm_s16le",
      videoRole: "video_mov",
      observedVideoCodec: "prores",
      pixelFormat: "yuv422p10le",
    },
  }[manifest.rendererCapabilityId];
  const settings = manifest.resolvedSettingsSnapshot.settings;
  if (
    settings.container !== expectedFamily.container ||
    settings.videoCodec !== expectedFamily.videoCodec ||
    settings.audioCodec !== expectedFamily.audioCodec ||
    manifest.videoArtifact.role !== expectedFamily.videoRole ||
    manifest.observedMedia.video.codec !== expectedFamily.observedVideoCodec ||
    manifest.observedMedia.video.pixelFormat !== expectedFamily.pixelFormat ||
    manifest.observedMedia.audio.codec !== expectedFamily.audioCodec
  ) {
    context.addIssue({
      code: "custom",
      path: ["rendererCapabilityId"],
      message:
        "Renderer capability, resolved settings, observed codecs, and video role must identify one family.",
    });
  }
  if (
    manifest.observedMedia.durationMs !== manifest.renderedDurationMs ||
    manifest.observedMedia.ffprobeVersion !==
      manifest.toolVersions.ffprobeVersion
  ) {
    context.addIssue({
      code: "custom",
      path: ["observedMedia"],
      message:
        "Observed duration and FFprobe version must match manifest provenance.",
    });
  }
});

export const ExportClipManifestSchema = z.union([
  ExportClipManifestV1Schema,
  ExportClipManifestV2Schema,
]);

export const ExportRequestSchema = z
  .object({
    id: IdSchema,
    jobId: IdSchema,
    mode: z.enum(["logged", "export_only"]),
    requestOrigin: ExportRequestOriginSchema.optional(),
    projectId: IdSchema.optional(),
    clipId: IdSchema.optional(),
    retryOfRequestId: IdSchema.optional(),
    retryOrdinal: z.number().int().positive().optional(),
    batchItemId: IdSchema.optional(),
    video: ClipVideoSnapshotSchema,
    selection: TranscriptSelectionSchema,
    sourceLanguageClass: ExportSourceLanguageClassSchema,
    subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
    preset: ExportPresetSnapshotSchema,
    resolvedSettingsSnapshot: ResolvedExportSettingsSnapshotSchema.optional(),
    mediaProvenance: ExportMediaProvenanceSchema.optional(),
    resolvedExportBounds: ResolvedExportBoundsSchema.optional(),
    renderedMediaProvenance: RenderedExportMediaProvenanceSchema.optional(),
    thumbnailProvenance: ExportThumbnailProvenanceSchema.optional(),
    subtitleOmissionProvenance: SubtitleOmissionProvenanceSchema.optional(),
    englishSubtitleProvenance:
      EnglishSubtitleSidecarProvenanceSchema.optional(),
    subtitleSidecars: z
      .array(SubtitleSidecarProvenanceSchema)
      .max(2)
      .optional(),
    finalArtifacts: z
      .array(FinalArtifactProvenanceSchema)
      .min(1)
      .max(6)
      .optional(),
    state: JobStateSchema,
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .superRefine((request, context) => {
    if (
      Boolean(request.retryOfRequestId) !== Boolean(request.retryOrdinal) ||
      (request.retryOfRequestId && request.mode !== "logged")
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryOfRequestId"],
        message:
          "Retry provenance is an all-or-none positive lineage available only to logged exports.",
      });
    }
  });

export const RetryLoggedExportRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
  })
  .strict();

export const RetryLoggedExportResponseSchema = z
  .object({ request: ExportRequestSchema })
  .strict()
  .superRefine((response, context) => {
    if (
      response.request.mode !== "logged" ||
      !response.request.retryOfRequestId ||
      !response.request.retryOrdinal
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "retryOfRequestId"],
        message: "A retry response must contain one logged retry child.",
      });
    }
  });

export const ClaimLoggedExportDeliveryRequestSchema = z
  .object({
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
  })
  .strict();

export const LoggedExportDeliverySchema = z
  .object({
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    reservationToken: IdSchema,
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    status: z.enum(["reserved", "accepted"]),
    reservedAt: UtcTimestampSchema,
    reservationExpiresAt: UtcTimestampSchema,
    acceptedAt: UtcTimestampSchema.optional(),
    sourceGroup: z
      .object({
        batchId: IdSchema,
        batchItemId: IdSchema,
      })
      .strict()
      .optional(),
    request: ExportRequestSchema,
  })
  .strict()
  .superRefine((delivery, context) => {
    if (
      delivery.request.mode !== "logged" ||
      !delivery.request.projectId ||
      !delivery.request.clipId ||
      !delivery.request.resolvedSettingsSnapshot
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "mode"],
        message:
          "A cloud delivery must contain one project-owned logged export request.",
      });
    }
    if (
      Boolean(delivery.sourceGroup) !== Boolean(delivery.request.batchItemId) ||
      (delivery.sourceGroup &&
        delivery.sourceGroup.batchItemId !== delivery.request.batchItemId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceGroup"],
        message:
          "Delivery-only source grouping must exactly identify one immutable batch item.",
      });
    }
    const sourceUrl = new URL(delivery.request.video.canonicalUrl);
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.hostname !== "www.youtube.com" ||
      sourceUrl.username !== "" ||
      sourceUrl.password !== "" ||
      sourceUrl.port !== "" ||
      sourceUrl.pathname !== "/watch" ||
      sourceUrl.searchParams.get("v") !==
        delivery.request.video.youtubeVideoId ||
      [...sourceUrl.searchParams.keys()].length !== 1 ||
      sourceUrl.hash !== ""
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "video", "canonicalUrl"],
        message:
          "A cloud delivery may contain only the canonical public YouTube watch URL, never a private acquisition URL.",
      });
    }
    if ((delivery.status === "accepted") !== Boolean(delivery.acceptedAt)) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message: "Accepted delivery provenance is inconsistent.",
      });
    }
    const reservedAt = Date.parse(delivery.reservedAt);
    const expiresAt = Date.parse(delivery.reservationExpiresAt);
    const acceptedAt = delivery.acceptedAt
      ? Date.parse(delivery.acceptedAt)
      : undefined;
    if (expiresAt <= reservedAt) {
      context.addIssue({
        code: "custom",
        path: ["reservationExpiresAt"],
        message: "A delivery reservation must expire after it begins.",
      });
    }
    if (
      acceptedAt !== undefined &&
      (acceptedAt < reservedAt || acceptedAt >= expiresAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message:
          "A delivery must be accepted during its exact reservation window.",
      });
    }
  });

export const ClaimLoggedExportDeliveryResponseSchema = z
  .object({ delivery: LoggedExportDeliverySchema.optional() })
  .strict();

export const AcceptLoggedExportDeliveryRequestSchema = z
  .object({
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    reservationToken: IdSchema,
  })
  .strict();

const LoggedExportExecutionCredentialSchema = z
  .object({
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    reservationToken: IdSchema,
  })
  .strict();

export const StartLoggedExportExecutionRequestSchema =
  LoggedExportExecutionCredentialSchema;

export const LoggedExportProgressStageSchema = z.enum([
  "preparing",
  "acquiring_source",
  "inspecting_source",
  "rendering",
  "validating_media",
  "building_thumbnail",
  "building_subtitles",
  "packaging",
  "cleaning_source",
  "local_complete",
]);

export const LoggedExportProgressSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: IdSchema,
    requestId: IdSchema,
    attempt: z.number().int().positive(),
    sequence: z.number().int().positive(),
    stage: LoggedExportProgressStageSchema,
    basisPoints: z.number().int().min(0).max(10_000),
    updatedAt: UtcTimestampSchema,
  })
  .strict();

export const LoggedExportExecutionSchema = z
  .object({
    executionId: IdSchema,
    requestId: IdSchema,
    attempt: z.number().int().positive(),
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    leaseToken: IdSchema,
    startedAt: UtcTimestampSchema,
    heartbeatAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    cancelRequestedAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .superRefine((execution, context) => {
    const startedAt = Date.parse(execution.startedAt);
    const heartbeatAt = Date.parse(execution.heartbeatAt);
    const expiresAt = Date.parse(execution.expiresAt);
    if (heartbeatAt < startedAt || expiresAt <= heartbeatAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Execution heartbeat chronology is invalid.",
      });
    }
    if (
      execution.cancelRequestedAt &&
      Date.parse(execution.cancelRequestedAt) > heartbeatAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["cancelRequestedAt"],
        message: "Cancellation cannot be observed after the heartbeat.",
      });
    }
  });

export const StartLoggedExportExecutionResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("started"),
        execution: LoggedExportExecutionSchema,
        progress: LoggedExportProgressSnapshotSchema.optional(),
      })
      .strict(),
    z
      .object({
        status: z.literal("cancel_requested"),
        cancelRequestedAt: UtcTimestampSchema,
      })
      .strict(),
  ],
);

export const HeartbeatLoggedExportExecutionRequestSchema =
  LoggedExportExecutionCredentialSchema.extend({
    executionId: IdSchema,
    attempt: z.number().int().positive(),
    leaseToken: IdSchema,
    progress: LoggedExportProgressSnapshotSchema.optional(),
  }).strict();

export const HeartbeatLoggedExportExecutionResponseSchema = z
  .object({
    execution: LoggedExportExecutionSchema,
    progress: LoggedExportProgressSnapshotSchema.optional(),
  })
  .strict();

export const GetLoggedExportProgressResponseSchema = z
  .object({
    requestId: IdSchema,
    jobId: IdSchema,
    state: JobStateSchema,
    progress: LoggedExportProgressSnapshotSchema.optional(),
  })
  .strict();

export const LoggedExportBatchSummarySchema = z
  .object({
    total: z.number().int().min(2).max(25),
    queued: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    needsUserAction: z.number().int().nonnegative(),
    complete: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    status: z.enum(["active", "complete", "mixed_terminal"]),
  })
  .strict()
  .superRefine((summary, context) => {
    const count =
      summary.queued +
      summary.claimed +
      summary.processing +
      summary.needsUserAction +
      summary.complete +
      summary.failed +
      summary.canceled;
    if (count !== summary.total) {
      context.addIssue({
        code: "custom",
        path: ["total"],
        message: "Batch summary counts must equal its total.",
      });
    }
    const terminal = summary.complete + summary.failed + summary.canceled;
    const consistent =
      (summary.status === "complete" && summary.complete === summary.total) ||
      (summary.status === "mixed_terminal" &&
        terminal === summary.total &&
        summary.complete < summary.total) ||
      (summary.status === "active" && terminal < summary.total);
    if (!consistent) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Batch summary status must agree with its terminal counts.",
      });
    }
  });

export const LoggedExportBatchItemSchema = z
  .object({
    id: IdSchema,
    batchId: IdSchema,
    ordinal: z.number().int().nonnegative(),
    clipId: IdSchema,
    rootRequestId: IdSchema,
    currentRequest: z
      .object({
        id: IdSchema,
        jobId: IdSchema,
        state: JobStateSchema,
        retryOfRequestId: IdSchema.optional(),
        retryOrdinal: z.number().int().positive().optional(),
      })
      .strict(),
    progress: LoggedExportProgressSnapshotSchema.optional(),
  })
  .strict();

export const LoggedExportBatchSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    createdAt: UtcTimestampSchema,
    summary: LoggedExportBatchSummarySchema,
    items: z.array(LoggedExportBatchItemSchema).min(2).max(25),
  })
  .strict();

export const LoggedExportBatchListResponseSchema = z
  .object({ batches: z.array(LoggedExportBatchSchema).max(100) })
  .strict();

export const CancelLoggedExportRequestSchema = z
  .object({ idempotencyKey: z.string().trim().min(1).max(512) })
  .strict();

export const CancelLoggedExportResponseSchema = z
  .object({
    outcome: z.enum(["cancel_requested", "canceled", "already_terminal"]),
    request: ExportRequestSchema,
    cancelRequestedAt: UtcTimestampSchema.optional(),
  })
  .strict();

export const LoggedExportSuccessResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: IdSchema,
    jobId: IdSchema,
    projectId: IdSchema,
    clipId: IdSchema,
    sourceLanguageClass: ExportSourceLanguageClassSchema,
    resolvedExportBounds: ResolvedExportBoundsSchema,
    renderedMediaProvenance: RenderedExportMediaProvenanceSchema,
    thumbnailProvenance: ExportThumbnailProvenanceSchema,
    subtitleOmissionProvenance: SubtitleOmissionProvenanceSchema.optional(),
    englishSubtitleProvenance:
      EnglishSubtitleSidecarProvenanceSchema.optional(),
    subtitleSidecars: z
      .array(SubtitleSidecarProvenanceSchema)
      .max(2)
      .optional(),
    artifacts: z.array(FinalArtifactProvenanceSchema).min(4).max(6),
  })
  .strict()
  .superRefine((result, context) => {
    const attempts = [
      result.resolvedExportBounds.sourceAttempt,
      result.renderedMediaProvenance.sourceAttempt,
      result.thumbnailProvenance.sourceAttempt,
      ...(result.subtitleOmissionProvenance
        ? [result.subtitleOmissionProvenance.sourceAttempt]
        : []),
      ...(result.englishSubtitleProvenance
        ? [result.englishSubtitleProvenance.sourceAttempt]
        : []),
      ...(result.subtitleSidecars ?? []).map(
        (sidecar) => sidecar.sourceAttempt,
      ),
      ...result.artifacts.map((artifact) => artifact.sourceAttempt),
    ];
    if (attempts.some((attempt) => attempt !== attempts[0])) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message:
          "A reconciled export result must come from one exact local source attempt.",
      });
    }
    if (
      !result.renderedMediaProvenance.settingsSha256 ||
      result.renderedMediaProvenance.verificationSchemaVersion !== 1 ||
      !result.renderedMediaProvenance.observedProperties
    ) {
      context.addIssue({
        code: "custom",
        path: ["renderedMediaProvenance"],
        message:
          "A reconciled export requires normalized settings and media-conformance provenance.",
      });
    }

    const roles = result.artifacts.map((artifact) => artifact.role);
    const sortedRoles = [...roles].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    if (
      new Set(roles).size !== roles.length ||
      roles.some((role, index) => role !== sortedRoles[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message:
          "Reconciled artifact roles must be unique and canonically sorted.",
      });
    }
    const requiredCore = [
      "clip_metadata_json",
      "manifest_json",
      "thumbnail_jpg",
    ] as const;
    const videoRoles = roles.filter((role) =>
      ["video_mp4", "video_mkv", "video_mov"].includes(role),
    );
    if (
      videoRoles.length !== 1 ||
      requiredCore.some((role) => !roles.includes(role))
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message:
          "A reconciled export requires one video, metadata, thumbnail, and manifest artifact.",
      });
    }
    const packageIdentity = `clip-${result.requestId}`;
    if (
      result.artifacts.some(
        (artifact) => artifact.packageIdentity !== packageIdentity,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message:
          "Reconciled artifact identity must match the exact export request.",
      });
    }

    const sidecars = result.subtitleSidecars ?? [];
    const sidecarRolesInOrder = sidecars.map((sidecar) => sidecar.role);
    if (
      sidecarRolesInOrder.some(
        (role, index) =>
          role !==
          [...sidecarRolesInOrder].sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
          )[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["subtitleSidecars"],
        message: "Subtitle result roles must be canonically sorted.",
      });
    }
    if (result.sourceLanguageClass === "confirmed_english") {
      const omitted = Boolean(result.subtitleOmissionProvenance);
      if (
        sidecars.length > 0 ||
        (omitted &&
          (result.englishSubtitleProvenance ||
            roles.includes("english_srt"))) ||
        (!omitted &&
          (!result.englishSubtitleProvenance ||
            !roles.includes("english_srt"))) ||
        roles.includes("original_srt")
      ) {
        context.addIssue({
          code: "custom",
          path: ["artifacts"],
          message:
            "Confirmed-English result artifacts do not match the recorded sidecar policy.",
        });
      }
    } else {
      const sidecarRoles = sidecars.map((sidecar) => sidecar.role).sort();
      if (
        result.subtitleOmissionProvenance ||
        result.englishSubtitleProvenance ||
        sidecars.length !== 2 ||
        sidecarRoles[0] !== "english" ||
        sidecarRoles[1] !== "original" ||
        !roles.includes("english_srt") ||
        !roles.includes("original_srt")
      ) {
        context.addIssue({
          code: "custom",
          path: ["artifacts"],
          message:
            "Foreign or uncertain-language results require exact original and English sidecar provenance.",
        });
      }
    }
  });

export const ReconcileLoggedExportSuccessRequestSchema = z
  .object({
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    reservationToken: IdSchema,
    result: LoggedExportSuccessResultSchema,
  })
  .strict();

export const LoggedExportSuccessSchema = z
  .object({
    id: IdSchema,
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    result: LoggedExportSuccessResultSchema,
    resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reconciledAt: UtcTimestampSchema,
  })
  .strict();

export const ArtifactVersionSummarySchema = z
  .object({
    artifactVersionId: IdSchema,
    requestId: IdSchema,
    jobId: IdSchema,
    projectId: IdSchema,
    clipId: IdSchema,
    requestOrigin: ExportRequestOriginSchema.nullable(),
    retryOfRequestId: IdSchema.optional(),
    retryOrdinal: z.number().int().positive().optional(),
    batchItemId: IdSchema.optional(),
    packageIdentity: z.string().regex(/^clip-[a-f0-9-]{36}$/),
    video: ClipVideoSnapshotSchema,
    selection: TranscriptSelectionSchema,
    sourceLanguageClass: ExportSourceLanguageClassSchema,
    subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
    preset: ExportPresetSnapshotSchema,
    resolvedSettingsSnapshot: ResolvedExportSettingsSnapshotSchema,
    resolvedExportBounds: ResolvedExportBoundsSchema,
    renderedMediaProvenance: RenderedExportMediaProvenanceSchema,
    thumbnailProvenance: ExportThumbnailProvenanceSchema,
    subtitleOmissionProvenance: SubtitleOmissionProvenanceSchema.optional(),
    englishSubtitleProvenance:
      EnglishSubtitleSidecarProvenanceSchema.optional(),
    subtitleSidecars: z
      .array(SubtitleSidecarProvenanceSchema)
      .max(2)
      .optional(),
    artifacts: z.array(FinalArtifactProvenanceSchema).min(4).max(6),
    manifest: z
      .object({
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
        schemaVersion: z.union([
          z.literal(1),
          z.literal(2),
          z.literal("unknown"),
        ]),
      })
      .strict(),
    resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    completedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.packageIdentity !== `clip-${summary.requestId}`) {
      context.addIssue({
        code: "custom",
        path: ["packageIdentity"],
        message:
          "Artifact package identity must name the immutable export request.",
      });
    }
    const manifest = summary.artifacts.find(
      (artifact) => artifact.role === "manifest_json",
    );
    if (
      !manifest ||
      manifest.contentSha256 !== summary.manifest.contentSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "contentSha256"],
        message:
          "Artifact history manifest identity must match its manifest role.",
      });
    }
  });

export const ArtifactVersionHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: IdSchema.optional(),
  })
  .strict();

export const ArtifactVersionHistoryResponseSchema = z
  .object({
    versions: z.array(ArtifactVersionSummarySchema).max(100),
    nextCursor: IdSchema.optional(),
  })
  .strict();

export const ArtifactStoragePlatformSchema = z.enum(["posix", "windows"]);
export const ArtifactAvailabilityStateSchema = z.enum([
  "verified",
  "missing",
  "invalid",
]);
export const ArtifactVerificationFailureClassSchema = z.enum([
  "root_unavailable",
  "root_changed",
  "package_missing",
  "unsafe_path",
  "unsupported_schema",
  "manifest_invalid",
  "identity_mismatch",
  "snapshot_mismatch",
  "artifact_mismatch",
  "filesystem_untrusted",
  "io_error",
]);

export const ArtifactRootSummarySchema = z
  .object({
    id: IdSchema,
    label: z.string().trim().min(1).max(120),
    platform: ArtifactStoragePlatformSchema,
    enabled: z.boolean(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();

export const ConfigureLocalArtifactRootRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    platform: ArtifactStoragePlatformSchema,
    // This command is local-agent-only. The path is never present in a root
    // summary, cloud request, project event, diagnostic, or support record.
    absolutePath: z.string().min(1).max(4_096),
  })
  .strict();

export const ArtifactRootListResponseSchema = z
  .object({ roots: z.array(ArtifactRootSummarySchema).max(100) })
  .strict();

export const VerifyLocalArtifactVersionRequestSchema = z
  .object({
    projectId: IdSchema,
    clipId: IdSchema,
    artifactVersionId: IdSchema,
    rootId: IdSchema,
  })
  .strict();

export const ArtifactLocatorSummarySchema = z
  .object({
    id: IdSchema,
    artifactVersionId: IdSchema,
    rootId: IdSchema,
    platform: ArtifactStoragePlatformSchema,
    availability: ArtifactAvailabilityStateSchema,
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSchemaVersion: z.union([z.literal(1), z.literal(2)]).nullable(),
    checkedAt: UtcTimestampSchema,
    lastVerifiedAt: UtcTimestampSchema.optional(),
    failureClass: ArtifactVerificationFailureClassSchema.optional(),
  })
  .strict()
  .superRefine((locator, context) => {
    if (
      (locator.availability === "verified") ===
      Boolean(locator.failureClass)
    ) {
      context.addIssue({
        code: "custom",
        path: ["failureClass"],
        message:
          "Verified locators cannot carry a failure, and unavailable locators require one.",
      });
    }
    if (
      locator.availability === "verified" &&
      (locator.manifestSchemaVersion === null || !locator.lastVerifiedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastVerifiedAt"],
        message:
          "Verified locators require a verified manifest schema and timestamp.",
      });
    }
  });

export const ArtifactLocatorListResponseSchema = z
  .object({ locators: z.array(ArtifactLocatorSummarySchema).max(100) })
  .strict();

export const ClipLibraryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{10,1024}$/)
      .optional(),
    query: z.string().trim().max(200).optional(),
    tag: ClipTagNameSchema.optional(),
    researchStatus: ClipResearchStatusSchema.optional(),
    exportStatus: ClipExportStatusSchema.optional(),
    completed: z.enum(["any", "yes", "no"]).default("any"),
  })
  .strict();

export const ClipLibraryExportLeafSchema = z
  .object({
    requestId: IdSchema,
    jobId: IdSchema,
    state: JobStateSchema,
    requestOrigin: ExportRequestOriginSchema.nullable(),
    retryOfRequestId: IdSchema.optional(),
    retryOrdinal: z.number().int().positive().optional(),
    batchItemId: IdSchema.optional(),
    progress: LoggedExportProgressSnapshotSchema.optional(),
    updatedAt: UtcTimestampSchema,
  })
  .strict();

export const ClipLibraryEntrySchema = z
  .object({
    clip: ClipCandidateSchema,
    currentLeaves: z.array(ClipLibraryExportLeafSchema).max(10),
    hasMoreLeaves: z.boolean(),
    completedVersionCount: z.number().int().nonnegative(),
    recentArtifactVersions: z.array(ArtifactVersionSummarySchema).max(5),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.recentArtifactVersions.some(
        (version) =>
          version.projectId !== entry.clip.projectId ||
          version.clipId !== entry.clip.id,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["recentArtifactVersions"],
        message: "Clip Library history must belong to the exact clip entry.",
      });
    }
    if (entry.completedVersionCount < entry.recentArtifactVersions.length) {
      context.addIssue({
        code: "custom",
        path: ["completedVersionCount"],
        message: "Recent history cannot exceed the completed-version count.",
      });
    }
  });

export const ClipLibraryPageSchema = z
  .object({
    projectId: IdSchema,
    entries: z.array(ClipLibraryEntrySchema).max(50),
    nextCursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{10,1024}$/)
      .optional(),
    syncCursor: z.string().regex(/^\d+$/),
    fetchedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((page, context) => {
    if (page.entries.some((entry) => entry.clip.projectId !== page.projectId)) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Clip Library entries must belong to the requested project.",
      });
    }
  });

export const LocalClipLibraryAvailabilitySchema = z
  .object({
    artifactVersionId: IdSchema,
    locators: z.array(ArtifactLocatorSummarySchema).max(100),
  })
  .strict()
  .superRefine((availability, context) => {
    if (
      availability.locators.some(
        (locator) =>
          locator.artifactVersionId !== availability.artifactVersionId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["locators"],
        message: "Local availability must match one artifact version.",
      });
    }
  });

export const LocalClipLibraryPageSchema = ClipLibraryPageSchema.extend({
  query: ClipLibraryQuerySchema,
  freshness: z.enum(["fresh", "stale"]),
  cachedAt: UtcTimestampSchema,
  cacheCoverage: z.literal("cached_subset"),
  selectedClipIds: z.array(IdSchema).max(50),
  localAvailability: z.array(LocalClipLibraryAvailabilitySchema).max(250),
}).superRefine((page, context) => {
  const clipIds = new Set(page.entries.map((entry) => entry.clip.id));
  if (page.selectedClipIds.some((clipId) => !clipIds.has(clipId))) {
    context.addIssue({
      code: "custom",
      path: ["selectedClipIds"],
      message: "Restored Clip Library selection must exist on this page.",
    });
  }
  const artifactVersionIds = new Set(
    page.entries.flatMap((entry) =>
      entry.recentArtifactVersions.map((version) => version.artifactVersionId),
    ),
  );
  if (
    page.localAvailability.some(
      (availability) => !artifactVersionIds.has(availability.artifactVersionId),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["localAvailability"],
      message:
        "Local availability may include only authorized versions on this page.",
    });
  }
});

export const LocalClipLibrarySelectionSchema = z
  .object({ selectedClipIds: z.array(IdSchema).max(50) })
  .strict();

export const UpdateLocalClipLibrarySelectionSchema = z
  .object({
    pageClipIds: z.array(IdSchema).max(50),
    selectedClipIds: z.array(IdSchema).max(50),
  })
  .strict()
  .superRefine((command, context) => {
    const pageClipIds = new Set(command.pageClipIds);
    if (command.selectedClipIds.some((clipId) => !pageClipIds.has(clipId))) {
      context.addIssue({
        code: "custom",
        path: ["selectedClipIds"],
        message: "Selected clips must occur in the visible Clip Library page.",
      });
    }
  });

export function sanitizeLoggedExportFailureCode(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .slice(0, 120);
  return /^[a-z][a-z0-9_]*$/u.test(sanitized)
    ? sanitized
    : "export_runtime_failed";
}

export function sanitizeLoggedExportFailureMessage(value: string): string {
  const sanitized = value
    .replaceAll(/https?:\/\/[^\s'"<>]+/giu, "<url>")
    .replaceAll(/file:\/\/[^\s'"<>]+/giu, "<path>")
    .replaceAll(/\\\\[^\s'"]+/gu, "<path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s'"]+/gu, "<path>")
    .replaceAll(/(?:[A-Za-z]:)?\/(?:[^\s'"]+)/gu, "<path>")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+\/-]+={0,2}/giu, "Bearer <redacted>")
    .replaceAll(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "<id>",
    )
    .replaceAll(/\b[a-f0-9]{64}\b/giu, "<digest>")
    .replaceAll(
      /\b(token|secret|credential|authorization)=\S+/giu,
      "$1=<redacted>",
    )
    .replaceAll(/[\u0000-\u001f\u007f]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
  return sanitized || "Local export processing failed.";
}

const LoggedExportFailureCodeSchema = z
  .string()
  .min(1)
  .max(240)
  .transform(sanitizeLoggedExportFailureCode)
  .pipe(z.string().regex(/^[a-z][a-z0-9_]{0,119}$/u));

const LoggedExportFailureMessageSchema = z
  .string()
  .min(1)
  .max(2_000)
  .transform(sanitizeLoggedExportFailureMessage)
  .pipe(z.string().min(1).max(500));

const LoggedExportTerminalSourceCleanupSchema = z.discriminatedUnion(
  "lifecycle",
  [
    z.object({ lifecycle: z.literal("not_started") }).strict(),
    z
      .object({
        lifecycle: z.literal("deleted"),
        deletedAt: UtcTimestampSchema,
      })
      .strict(),
  ],
);

export const LoggedExportFailureResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: IdSchema,
    jobId: IdSchema,
    projectId: IdSchema,
    clipId: IdSchema,
    error: z
      .object({
        code: LoggedExportFailureCodeSchema,
        message: LoggedExportFailureMessageSchema,
      })
      .strict(),
    attempt: z.number().int().nonnegative(),
    sourceCleanup: LoggedExportTerminalSourceCleanupSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.attempt === 0) !==
      (result.sourceCleanup.lifecycle === "not_started")
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceCleanup"],
        message:
          "A not-started failure has attempt zero; an attempted failure requires verified deletion.",
      });
    }
  });

export const ReconcileLoggedExportFailureRequestSchema = z
  .object({
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    reservationToken: IdSchema,
    result: LoggedExportFailureResultSchema,
  })
  .strict();

export const LoggedExportFailureSchema = z
  .object({
    id: IdSchema,
    deliveryId: IdSchema,
    generation: z.number().int().positive(),
    workerId: IdSchema,
    workerEpoch: z.number().int().positive(),
    result: LoggedExportFailureResultSchema,
    resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reconciledAt: UtcTimestampSchema,
  })
  .strict();

export const LoggedExportCanceledResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: IdSchema,
    jobId: IdSchema,
    projectId: IdSchema,
    clipId: IdSchema,
    reason: z.enum(["user_requested", "execution_lease_lost"]),
    attempt: z.number().int().nonnegative(),
    sourceCleanup: LoggedExportTerminalSourceCleanupSchema,
    executionId: IdSchema.optional(),
    executionAttempt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.attempt === 0) !==
        (result.sourceCleanup.lifecycle === "not_started") ||
      Boolean(result.executionId) !== Boolean(result.executionAttempt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceCleanup"],
        message:
          "Cancellation execution provenance is all-or-none; source attempt zero is not-started.",
      });
    }
    if (
      result.attempt > 0 &&
      (!result.executionId || result.executionAttempt !== result.attempt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["executionAttempt"],
        message:
          "A started cancellation must match its exact execution attempt.",
      });
    }
  });

export const ReconcileLoggedExportCanceledRequestSchema =
  LoggedExportExecutionCredentialSchema.extend({
    executionId: IdSchema.optional(),
    leaseToken: IdSchema.optional(),
    result: LoggedExportCanceledResultSchema,
  })
    .strict()
    .superRefine((request, context) => {
      if (
        Boolean(request.executionId) !== Boolean(request.leaseToken) ||
        Boolean(request.executionId) !== Boolean(request.result.executionId) ||
        (request.executionId &&
          request.executionId !== request.result.executionId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["executionId"],
          message: "Canceled execution credentials must be complete and exact.",
        });
      }
    });

export const LoggedExportCanceledSchema = z
  .object({
    id: IdSchema,
    deliveryId: IdSchema.optional(),
    generation: z.number().int().positive().optional(),
    workerId: IdSchema.optional(),
    workerEpoch: z.number().int().positive().optional(),
    result: LoggedExportCanceledResultSchema,
    resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reconciledAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const deliveryFields = [
      result.deliveryId,
      result.generation,
      result.workerId,
      result.workerEpoch,
    ];
    if (
      deliveryFields.some(Boolean) &&
      !deliveryFields.every((value) => value !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveryId"],
        message: "Canceled delivery provenance is all-or-none.",
      });
    }
  });

export const ProcessAcceptedLoggedExportRequestSchema = z
  .object({
    requestId: IdSchema,
    authorizationConfirmed: z.literal(true),
  })
  .strict();

export const ProcessAcceptedLoggedExportResponseSchema = z.union([
  z
    .object({
      execution: z.enum(["complete", "already_complete"]),
      reconciliation: LoggedExportSuccessSchema,
    })
    .strict(),
  z
    .object({
      execution: z.literal("failed"),
      failure: LoggedExportFailureSchema,
    })
    .strict(),
  z
    .object({
      execution: z.literal("canceled"),
      canceled: LoggedExportCanceledSchema,
    })
    .strict(),
]);

export const JobSchema = z.object({
  id: IdSchema,
  kind: JobKindSchema,
  state: JobStateSchema,
  projectId: IdSchema.optional(),
  idempotencyKey: z.string().min(1).max(512),
  attempt: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export const WorkerProgressStageSchema = z.enum([
  "resolving",
  "acquiring",
  "transcribing",
  "translating",
  "aligning",
  "uploading",
]);

export const WorkerClaimRequestSchema = z.object({
  executionLocation: z.enum(["local", "hosted"]),
  leaseSeconds: z.number().int().min(15).max(900).default(120),
});

export const WorkerHeartbeatRequestSchema = z.object({
  attempt: z.number().int().positive(),
  leaseSeconds: z.number().int().min(15).max(900).default(120),
  stage: WorkerProgressStageSchema,
});

export const WorkerSourcePlanRequestSchema = z.object({
  attempt: z.number().int().positive(),
  plan: TranscriptSourcePlanSchema,
});

const WorkerTranscriptArtifactTypeSchema = z.enum([
  "provider-response",
  "original-normalized",
  "english-normalized",
  "original-srt",
  "english-srt",
]);

export const WorkerCreateTranscriptUploadRequestSchema = z.object({
  attempt: z.number().int().positive(),
  lineageId: IdSchema,
  version: z.number().int().positive(),
  artifactTypes: z.array(WorkerTranscriptArtifactTypeSchema).min(1),
});

export const WorkerFinalizeTranscriptRequestSchema =
  FinalizeTranscriptRequestSchema.extend({
    attempt: z.number().int().positive(),
  });

export const TranscriptionJobPayloadSchema = z.object({
  batchId: IdSchema,
  catalogVideoId: IdSchema,
  youtubeVideoId: z.string().min(1).max(64),
  targetLanguage: z.string().min(2).max(35),
  transcriptionProfile: z.string().trim().min(1).max(160),
  sourcePolicy: BatchSourcePolicySchema,
  executionLocation: z.enum(["local", "hosted"]),
  priority: BatchPrioritySchema,
  sourcePlan: TranscriptSourcePlanSchema.optional(),
});

export const WorkerFailureRequestSchema = z.object({
  attempt: z.number().int().positive(),
  code: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2_000),
  retryable: z.boolean(),
});

export const WorkerLeaseSchema = z.object({
  jobId: IdSchema,
  workerId: IdSchema,
  attempt: z.number().int().positive(),
  claimedAt: UtcTimestampSchema,
  heartbeatAt: UtcTimestampSchema,
  expiresAt: UtcTimestampSchema,
});

export const ClaimedTranscriptionJobSchema = z.object({
  job: JobSchema,
  lease: WorkerLeaseSchema,
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const HealthResponseSchema = z.object({
  service: z.enum(["local-agent", "cloud-api", "worker"]),
  status: z.literal("ok"),
  version: z.string().min(1),
  timestamp: UtcTimestampSchema,
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;
export type AuthenticatedActor = z.infer<typeof AuthenticatedActorSchema>;
export type User = z.infer<typeof UserSchema>;
export type UpdatePreferredLanguageRequest = z.infer<
  typeof UpdatePreferredLanguageRequestSchema
>;
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type ProjectVideo = z.infer<typeof ProjectVideoSchema>;
export type TranscriptTrack = z.infer<typeof TranscriptTrackSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptToken = z.infer<typeof TranscriptTokenSchema>;
export type NormalizedTranscript = z.infer<typeof NormalizedTranscriptSchema>;
export type TranscriptSelection = z.infer<typeof TranscriptSelectionSchema>;
export type ClipLanguageSnapshot = z.infer<typeof ClipLanguageSnapshotSchema>;
export type ClipLanguageEvidenceV2 = z.infer<
  typeof ClipLanguageEvidenceV2Schema
>;
export type ClipLanguageEvidence = z.infer<typeof ClipLanguageEvidenceSchema>;
export type ClipCandidate = z.infer<typeof ClipCandidateSchema>;
export type CreateClipCandidateRequest = z.infer<
  typeof CreateClipCandidateRequestSchema
>;
export type UpdateClipCandidateRequest = z.infer<
  typeof UpdateClipCandidateRequestSchema
>;
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export type ExportSourceLanguageClass = z.infer<
  typeof ExportSourceLanguageClassSchema
>;
export type ExportSettingsOverride = z.infer<
  typeof ExportSettingsOverrideSchema
>;
export type ExportPresetReference = z.infer<typeof ExportPresetReferenceSchema>;
export type ExportSettingsSelection = z.infer<
  typeof ExportSettingsSelectionSchema
>;
export type ExportCapabilityIssue = z.infer<typeof ExportCapabilityIssueSchema>;
export type ExportWorkerCapabilityReference = z.infer<
  typeof ExportWorkerCapabilityReferenceSchema
>;
export type ExportRendererCapabilityId = z.infer<
  typeof ExportRendererCapabilityIdSchema
>;
export type ExportWorkerAvailability = z.infer<
  typeof ExportWorkerAvailabilitySchema
>;
export type InstalledExportWorkerCapabilitySummary = z.infer<
  typeof InstalledExportWorkerCapabilitySummarySchema
>;
export type ExportWorkerCompatibilityRequest = z.infer<
  typeof ExportWorkerCompatibilityRequestSchema
>;
export type ResolvedExportSettingsSnapshot = z.infer<
  typeof ResolvedExportSettingsSnapshotSchema
>;
export type ExportSettingsPreviewRequest = z.infer<
  typeof ExportSettingsPreviewRequestSchema
>;
export type ExportSettingsPreview = z.infer<typeof ExportSettingsPreviewSchema>;
export type ExportRequestOrigin = z.infer<typeof ExportRequestOriginSchema>;
export type ExportPresetSnapshot = z.infer<typeof ExportPresetSnapshotSchema>;
export type ExportPresetScope = z.infer<typeof ExportPresetScopeSchema>;
export type ExportPresetVersion = z.infer<typeof ExportPresetVersionSchema>;
export type ExportPresetCatalogEntry = z.infer<
  typeof ExportPresetCatalogEntrySchema
>;
export type ExportPresetDefault = z.infer<typeof ExportPresetDefaultSchema>;
export type CreateExportPresetRequest = z.infer<
  typeof CreateExportPresetRequestSchema
>;
export type ReviseExportPresetRequest = z.infer<
  typeof ReviseExportPresetRequestSchema
>;
export type SetExportPresetDefaultRequest = z.infer<
  typeof SetExportPresetDefaultRequestSchema
>;
export type PersonalExportPresetCatalog = z.infer<
  typeof PersonalExportPresetCatalogSchema
>;
export type ProjectExportPresetCatalog = z.infer<
  typeof ProjectExportPresetCatalogSchema
>;
export type ExportSubtitleTrackSnapshots = z.infer<
  typeof ExportSubtitleTrackSnapshotsSchema
>;
export type SubtitleSidecarProvenance = z.infer<
  typeof SubtitleSidecarProvenanceSchema
>;
export type CreateClipExportRequest = z.infer<
  typeof CreateClipExportRequestSchema
>;
export type CreateLoggedExportBatchRequest = z.infer<
  typeof CreateLoggedExportBatchRequestSchema
>;
export type CreateExportOnlyRequest = z.infer<
  typeof CreateExportOnlyRequestSchema
>;
export type ExportMediaProvenance = z.infer<typeof ExportMediaProvenanceSchema>;
export type ExportObservedMediaProperties = z.infer<
  typeof ExportObservedMediaPropertiesSchema
>;
export type RenderedExportMediaProvenance = z.infer<
  typeof RenderedExportMediaProvenanceSchema
>;
export type ExportThumbnailProvenance = z.infer<
  typeof ExportThumbnailProvenanceSchema
>;
export type ResolvedExportBounds = z.infer<typeof ResolvedExportBoundsSchema>;
export type FinalArtifactRole = z.infer<typeof FinalArtifactRoleSchema>;
export type FinalArtifactProvenance = z.infer<
  typeof FinalArtifactProvenanceSchema
>;
export type ExportClipManifestArtifact = z.infer<
  typeof ExportClipManifestArtifactSchema
>;
export type ExportClipManifest = z.infer<typeof ExportClipManifestSchema>;
export type ExportResolvedSubtitlePolicy = z.infer<
  typeof ExportResolvedSubtitlePolicySchema
>;
export type ExportClipMetadata = z.infer<typeof ExportClipMetadataSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type RetryLoggedExportRequest = z.infer<
  typeof RetryLoggedExportRequestSchema
>;
export type RetryLoggedExportResponse = z.infer<
  typeof RetryLoggedExportResponseSchema
>;
export type ClaimLoggedExportDeliveryRequest = z.infer<
  typeof ClaimLoggedExportDeliveryRequestSchema
>;
export type LoggedExportDelivery = z.infer<typeof LoggedExportDeliverySchema>;
export type ClaimLoggedExportDeliveryResponse = z.infer<
  typeof ClaimLoggedExportDeliveryResponseSchema
>;
export type AcceptLoggedExportDeliveryRequest = z.infer<
  typeof AcceptLoggedExportDeliveryRequestSchema
>;
export type StartLoggedExportExecutionRequest = z.infer<
  typeof StartLoggedExportExecutionRequestSchema
>;
export type LoggedExportExecution = z.infer<typeof LoggedExportExecutionSchema>;
export type StartLoggedExportExecutionResponse = z.infer<
  typeof StartLoggedExportExecutionResponseSchema
>;
export type LoggedExportProgressStage = z.infer<
  typeof LoggedExportProgressStageSchema
>;
export type LoggedExportProgressSnapshot = z.infer<
  typeof LoggedExportProgressSnapshotSchema
>;
export type HeartbeatLoggedExportExecutionRequest = z.infer<
  typeof HeartbeatLoggedExportExecutionRequestSchema
>;
export type HeartbeatLoggedExportExecutionResponse = z.infer<
  typeof HeartbeatLoggedExportExecutionResponseSchema
>;
export type GetLoggedExportProgressResponse = z.infer<
  typeof GetLoggedExportProgressResponseSchema
>;
export type LoggedExportBatchSummary = z.infer<
  typeof LoggedExportBatchSummarySchema
>;
export type LoggedExportBatchItem = z.infer<typeof LoggedExportBatchItemSchema>;
export type LoggedExportBatch = z.infer<typeof LoggedExportBatchSchema>;
export type LoggedExportBatchListResponse = z.infer<
  typeof LoggedExportBatchListResponseSchema
>;
export type CancelLoggedExportRequest = z.infer<
  typeof CancelLoggedExportRequestSchema
>;
export type CancelLoggedExportResponse = z.infer<
  typeof CancelLoggedExportResponseSchema
>;
export type LoggedExportSuccessResult = z.infer<
  typeof LoggedExportSuccessResultSchema
>;
export type ReconcileLoggedExportSuccessRequest = z.infer<
  typeof ReconcileLoggedExportSuccessRequestSchema
>;
export type LoggedExportSuccess = z.infer<typeof LoggedExportSuccessSchema>;
export type ArtifactVersionSummary = z.infer<
  typeof ArtifactVersionSummarySchema
>;
export type ArtifactVersionHistoryQuery = z.infer<
  typeof ArtifactVersionHistoryQuerySchema
>;
export type ArtifactVersionHistoryResponse = z.infer<
  typeof ArtifactVersionHistoryResponseSchema
>;
export type ArtifactStoragePlatform = z.infer<
  typeof ArtifactStoragePlatformSchema
>;
export type ArtifactAvailabilityState = z.infer<
  typeof ArtifactAvailabilityStateSchema
>;
export type ArtifactVerificationFailureClass = z.infer<
  typeof ArtifactVerificationFailureClassSchema
>;
export type ArtifactRootSummary = z.infer<typeof ArtifactRootSummarySchema>;
export type ConfigureLocalArtifactRootRequest = z.infer<
  typeof ConfigureLocalArtifactRootRequestSchema
>;
export type VerifyLocalArtifactVersionRequest = z.infer<
  typeof VerifyLocalArtifactVersionRequestSchema
>;
export type ArtifactLocatorSummary = z.infer<
  typeof ArtifactLocatorSummarySchema
>;
export type ClipLibraryQuery = z.infer<typeof ClipLibraryQuerySchema>;
export type ClipLibraryExportLeaf = z.infer<typeof ClipLibraryExportLeafSchema>;
export type ClipLibraryEntry = z.infer<typeof ClipLibraryEntrySchema>;
export type ClipLibraryPage = z.infer<typeof ClipLibraryPageSchema>;
export type LocalClipLibraryAvailability = z.infer<
  typeof LocalClipLibraryAvailabilitySchema
>;
export type LocalClipLibraryPage = z.infer<typeof LocalClipLibraryPageSchema>;
export type LocalClipLibrarySelection = z.infer<
  typeof LocalClipLibrarySelectionSchema
>;
export type UpdateLocalClipLibrarySelection = z.infer<
  typeof UpdateLocalClipLibrarySelectionSchema
>;
export type LoggedExportFailureResult = z.infer<
  typeof LoggedExportFailureResultSchema
>;
export type ReconcileLoggedExportFailureRequest = z.infer<
  typeof ReconcileLoggedExportFailureRequestSchema
>;
export type LoggedExportFailure = z.infer<typeof LoggedExportFailureSchema>;
export type LoggedExportCanceledResult = z.infer<
  typeof LoggedExportCanceledResultSchema
>;
export type ReconcileLoggedExportCanceledRequest = z.infer<
  typeof ReconcileLoggedExportCanceledRequestSchema
>;
export type LoggedExportCanceled = z.infer<typeof LoggedExportCanceledSchema>;
export type ProcessAcceptedLoggedExportRequest = z.infer<
  typeof ProcessAcceptedLoggedExportRequestSchema
>;
export type ProcessAcceptedLoggedExportResponse = z.infer<
  typeof ProcessAcceptedLoggedExportResponseSchema
>;
export type TranscriptArtifact = z.infer<typeof TranscriptArtifactSchema>;
export type TranscriptManifest = z.infer<typeof TranscriptManifestSchema>;
export type DerivedTranslationIdentity = z.infer<
  typeof DerivedTranslationIdentitySchema
>;
export type DerivedTranslationManifest = z.infer<
  typeof DerivedTranslationManifestSchema
>;
export type PublishDerivedTranslationRequest = z.infer<
  typeof PublishDerivedTranslationRequestSchema
>;
export type RequestDerivedTranslation = z.infer<
  typeof RequestDerivedTranslationSchema
>;
export type DerivedTranslationJob = z.infer<typeof DerivedTranslationJobSchema>;
export type DerivedTranslation = z.infer<typeof DerivedTranslationSchema>;
export type PreferredTranscriptResolution = z.infer<
  typeof PreferredTranscriptResolutionSchema
>;
export type FinalizedObject = z.infer<typeof FinalizedObjectSchema>;
export type TranscriptUploadGrant = z.infer<typeof TranscriptUploadGrantSchema>;
export type TranscriptDownloadTarget = z.infer<
  typeof TranscriptDownloadTargetSchema
>;
export type FinalizeTranscriptRequest = z.infer<
  typeof FinalizeTranscriptRequestSchema
>;
export type ActiveTranscriptBundle = z.infer<
  typeof ActiveTranscriptBundleSchema
>;
export type TranscriptionBatch = z.infer<typeof TranscriptionBatchSchema>;
export type BatchOptions = z.infer<typeof BatchOptionsSchema>;
export type BatchSourcePolicy = z.infer<typeof BatchSourcePolicySchema>;
export type CaptionTrackCandidate = z.infer<typeof CaptionTrackCandidateSchema>;
export type TranscriptSourcePlan = z.infer<typeof TranscriptSourcePlanSchema>;
export type BatchPreflightItem = z.infer<typeof BatchPreflightItemSchema>;
export type BatchPreflightResponse = z.infer<
  typeof BatchPreflightResponseSchema
>;
export type CreateTranscriptionBatchRequest = z.infer<
  typeof CreateTranscriptionBatchRequestSchema
>;
export type CreateTranscriptionBatchResponse = z.infer<
  typeof CreateTranscriptionBatchResponseSchema
>;
export type TranscriptionBatchItem = z.infer<
  typeof TranscriptionBatchItemSchema
>;
export type TranscriptionBatchProgress = z.infer<
  typeof TranscriptionBatchProgressSchema
>;
export type TranscriptionBatchControlRequest = z.infer<
  typeof TranscriptionBatchControlRequestSchema
>;
export type TranscriptionBatchListResponse = z.infer<
  typeof TranscriptionBatchListResponseSchema
>;
export type ReviewInboxItem = z.infer<typeof ReviewInboxItemSchema>;
export type ReviewInboxResponse = z.infer<typeof ReviewInboxResponseSchema>;
export type UpdateReviewStatusRequest = z.infer<
  typeof UpdateReviewStatusRequestSchema
>;
export type Job = z.infer<typeof JobSchema>;
export type WorkerLease = z.infer<typeof WorkerLeaseSchema>;
export type ClaimedTranscriptionJob = z.infer<
  typeof ClaimedTranscriptionJobSchema
>;
export type WorkerProgressStage = z.infer<typeof WorkerProgressStageSchema>;
export type WorkerFailureRequest = z.infer<typeof WorkerFailureRequestSchema>;
export type WorkerCreateTranscriptUploadRequest = z.infer<
  typeof WorkerCreateTranscriptUploadRequestSchema
>;
export type WorkerFinalizeTranscriptRequest = z.infer<
  typeof WorkerFinalizeTranscriptRequestSchema
>;
export type TranscriptionJobPayload = z.infer<
  typeof TranscriptionJobPayloadSchema
>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type RegisteredExportWorker = z.infer<
  typeof RegisteredExportWorkerSchema
>;
export type RegisterExportWorkerRequest = z.infer<
  typeof RegisterExportWorkerRequestSchema
>;
export type HeartbeatExportWorkerRequest = z.infer<
  typeof HeartbeatExportWorkerRequestSchema
>;
export type RevokeExportWorkerRequest = z.infer<
  typeof RevokeExportWorkerRequestSchema
>;
