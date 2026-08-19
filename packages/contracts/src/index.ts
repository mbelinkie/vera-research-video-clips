import { z } from "zod";

const IdSchema = z.string().uuid();
const UtcTimestampSchema = z.string().datetime({ offset: true });

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
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
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
  language: z.string().min(2).max(35),
  kind: z.enum(["original", "english"]),
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
  sourceLanguage: z.string().min(2).max(35).optional(),
});
export const CreateClipCandidateRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(512),
  video: ClipVideoSnapshotSchema,
  selection: TranscriptSelectionSchema,
  englishText: z.string().trim().min(1).max(100_000),
  originalText: z.string().trim().min(1).max(100_000).optional(),
  notes: z.string().trim().max(20_000).default(""),
  tags: z.array(ClipTagNameSchema).max(50).default([]),
});
export const ClipCandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  catalogVideoId: IdSchema,
  video: ClipVideoSnapshotSchema,
  selection: TranscriptSelectionSchema,
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
    omitSubtitleFilesForConfirmedEnglish: z.boolean(),
    embedEnglishSubtitleTrack: z.boolean(),
  })
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
const createExportRequestBaseSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(512),
  sourceLanguageClass: ExportSourceLanguageClassSchema,
  subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
  preset: ExportPresetSnapshotSchema,
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

export const RenderedExportMediaProvenanceSchema =
  ExportMediaProvenanceSchema.extend({
    ffmpegVersion: z.string().trim().min(1).max(120).optional(),
    sourceAttempt: z.number().int().positive(),
    validatedAt: UtcTimestampSchema,
  });

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
  "english_srt",
  "original_srt",
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

export const ExportClipManifestSchemaVersion = 1;

export const ExportClipManifestArtifactSchema = z.object({
  role: z.enum(["video_mp4", "english_srt", "original_srt"]),
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
});

/**
 * The auditable provenance record promoted beside a verified clip package. It
 * is derived only from the immutable request snapshot, persisted validation
 * provenance, and the staged bytes it names, so replaying one request
 * reproduces it exactly. It never contains its own hash, a filesystem path, a
 * command line, or subtitle text.
 */
export const ExportClipManifestSchema = z.object({
  schemaVersion: z.literal(ExportClipManifestSchemaVersion),
  exportRequestId: IdSchema,
  jobId: IdSchema,
  mode: z.enum(["logged", "export_only"]),
  packageIdentity: z.string().regex(/^clip-[a-f0-9-]{36}$/),
  sourceAttempt: z.number().int().positive(),
  validatedAt: UtcTimestampSchema,
  video: ClipVideoSnapshotSchema,
  sourceLanguageClass: ExportSourceLanguageClassSchema,
  resolvedExportBounds: z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceAttempt: z.number().int().positive(),
  }),
  renderedDurationMs: z.number().int().positive(),
  subtitlePolicy: z.object({
    requiredSidecars: z.array(z.enum(["original", "english"])).max(2),
    subtitleSidecarsOmittedReason: z
      .literal("confirmed_english_user_setting")
      .optional(),
  }),
  toolVersions: z.object({
    ffprobeVersion: z.string().trim().min(1).max(120).optional(),
    ffmpegVersion: z.string().trim().min(1).max(120).optional(),
  }),
  artifacts: z.array(ExportClipManifestArtifactSchema).min(1).max(3),
});

export const ExportRequestSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  mode: z.enum(["logged", "export_only"]),
  projectId: IdSchema.optional(),
  clipId: IdSchema.optional(),
  video: ClipVideoSnapshotSchema,
  selection: TranscriptSelectionSchema,
  sourceLanguageClass: ExportSourceLanguageClassSchema,
  subtitleTracks: ExportSubtitleTrackSnapshotsSchema.optional(),
  preset: ExportPresetSnapshotSchema,
  mediaProvenance: ExportMediaProvenanceSchema.optional(),
  resolvedExportBounds: ResolvedExportBoundsSchema.optional(),
  renderedMediaProvenance: RenderedExportMediaProvenanceSchema.optional(),
  subtitleOmissionProvenance: SubtitleOmissionProvenanceSchema.optional(),
  englishSubtitleProvenance: EnglishSubtitleSidecarProvenanceSchema.optional(),
  subtitleSidecars: z.array(SubtitleSidecarProvenanceSchema).max(2).optional(),
  finalArtifacts: z
    .array(FinalArtifactProvenanceSchema)
    .min(1)
    .max(4)
    .optional(),
  state: JobStateSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

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
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type ProjectVideo = z.infer<typeof ProjectVideoSchema>;
export type TranscriptTrack = z.infer<typeof TranscriptTrackSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptToken = z.infer<typeof TranscriptTokenSchema>;
export type NormalizedTranscript = z.infer<typeof NormalizedTranscriptSchema>;
export type TranscriptSelection = z.infer<typeof TranscriptSelectionSchema>;
export type ClipCandidate = z.infer<typeof ClipCandidateSchema>;
export type CreateClipCandidateRequest = z.infer<
  typeof CreateClipCandidateRequestSchema
>;
export type UpdateClipCandidateRequest = z.infer<
  typeof UpdateClipCandidateRequestSchema
>;
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export type ExportPresetSnapshot = z.infer<typeof ExportPresetSnapshotSchema>;
export type ExportSubtitleTrackSnapshots = z.infer<
  typeof ExportSubtitleTrackSnapshotsSchema
>;
export type SubtitleSidecarProvenance = z.infer<
  typeof SubtitleSidecarProvenanceSchema
>;
export type CreateClipExportRequest = z.infer<
  typeof CreateClipExportRequestSchema
>;
export type CreateExportOnlyRequest = z.infer<
  typeof CreateExportOnlyRequestSchema
>;
export type ExportMediaProvenance = z.infer<typeof ExportMediaProvenanceSchema>;
export type RenderedExportMediaProvenance = z.infer<
  typeof RenderedExportMediaProvenanceSchema
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
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type TranscriptArtifact = z.infer<typeof TranscriptArtifactSchema>;
export type TranscriptManifest = z.infer<typeof TranscriptManifestSchema>;
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
