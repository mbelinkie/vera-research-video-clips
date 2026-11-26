import { z } from "zod";

const IdSchema = z.uuid();
const TimestampSchema = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().positive();
const TextSchema = z
  .string()
  .refine((text) => !text.includes("\0"), "Text cannot contain NUL.");
const WebUrlSchema = z.url({ protocol: /^https?$/ }).pipe(TextSchema.max(4096));
const ProviderMediaIdSchema = z.string().trim().min(1).max(256);
const TitleSchema = TextSchema.trim().min(1).max(500);
const NotesSchema = TextSchema.max(20_000);
const IdempotencyKeySchema = TextSchema.trim().min(1).max(512).optional();
const ExcerptSchema = TextSchema.min(1)
  .max(100_000)
  .refine((text) => text.trim().length > 0, "Text cannot be blank.");

export const ClipTagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Clip tags cannot contain control characters.",
  });

const TopicsSchema = z.array(ClipTagNameSchema).max(50);

export const SourceIdentityV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.enum(["youtube", "tiktok", "instagram", "facebook"]),
  providerMediaId: ProviderMediaIdSchema,
  canonicalUrl: z.url(),
});

const SourceIdentityWriteSchema = SourceIdentityV1Schema.extend({
  providerMediaId: TextSchema.trim().min(1).max(256),
  canonicalUrl: WebUrlSchema,
});

export const SourceKindSchema = z.enum([
  "youtube",
  "web_page",
  "pdf",
  "offline",
  "image",
  "audio",
  "local_video",
  "provider_video",
]);

export const ItemKindSchema = z.enum(["clip", "quote", "still", "audio"]);

const CitationStateSchema = z.enum(["automatic", "confirmed"]);
function citationField<T extends z.ZodType>(value: T) {
  return z.strictObject({ value, state: CitationStateSchema });
}

const BibliographyFields = {
  title: citationField(TitleSchema),
  authors: citationField(
    z.array(TextSchema.trim().min(1).max(300)).min(1).max(50),
  ),
  publication: citationField(TitleSchema),
  publisher: citationField(TitleSchema),
  date: citationField(TextSchema.trim().min(1).max(100)),
  url: citationField(WebUrlSchema),
  credit: citationField(TextSchema.trim().min(1).max(2000)),
};

const BibliographyWriteSchema = z.strictObject(BibliographyFields).partial();
const BibliographyPatchSchema = z
  .strictObject({
    title: BibliographyFields.title.nullable(),
    authors: BibliographyFields.authors.nullable(),
    publication: BibliographyFields.publication.nullable(),
    publisher: BibliographyFields.publisher.nullable(),
    date: BibliographyFields.date.nullable(),
    url: BibliographyFields.url.nullable(),
    credit: BibliographyFields.credit.nullable(),
  })
  .partial();
const BibliographyReadSchema = z.strictObject({
  title: BibliographyFields.title.partial({ state: true }).optional(),
  authors: BibliographyFields.authors.partial({ state: true }).optional(),
  publication: BibliographyFields.publication
    .partial({ state: true })
    .optional(),
  publisher: BibliographyFields.publisher.partial({ state: true }).optional(),
  date: BibliographyFields.date.partial({ state: true }).optional(),
  url: citationField(z.url()).partial({ state: true }).optional(),
  credit: BibliographyFields.credit.partial({ state: true }).optional(),
});

const MediaDetails = {
  durationMs: z.number().int().nonnegative().optional(),
  sourceLanguage: TextSchema.min(2).max(35).optional(),
};
const VideoDetailsSchema = z.strictObject({
  ...MediaDetails,
  channel: TextSchema.trim().min(1).max(300).optional(),
});
const LicenceFields = {
  licence: TextSchema.trim().min(1).max(2000).optional(),
  usageNote: NotesSchema.optional(),
};
export const AudioRoleSchema = z.enum([
  "sound_effect",
  "ambience",
  "music",
  "speech",
]);
export const WebPageExtractionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), text: ExcerptSchema }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum([
      "blocked",
      "unavailable",
      "not_html",
      "too_large",
      "timed_out",
      "no_article",
    ]),
  }),
]);
export type WebPageExtraction = z.infer<typeof WebPageExtractionSchema>;

export const webPageExtractionMessages = {
  blocked:
    "This address or page could not be accessed publicly. Add a typed quote or send the page from your browser.",
  unavailable:
    "The page could not be downloaded. Check the address or add a typed quote.",
  not_html:
    "The address did not return a supported HTML page. You can still add a typed quote.",
  too_large:
    "The page exceeded the extraction size limit. Add a typed quote from the page.",
  timed_out:
    "The page took too long to download. Try again or add a typed quote.",
  no_article:
    "No readable article text was found. You can still add a typed quote.",
} satisfies Record<
  Extract<
    z.infer<typeof WebPageExtractionSchema>,
    { status: "failed" }
  >["reason"],
  string
>;

const WebPageMetadataFields = {
  title: TitleSchema,
  authors: BibliographyFields.authors.shape.value,
  publication: TitleSchema,
  date: BibliographyFields.date.shape.value,
  url: WebUrlSchema,
};

export const MaxWebPageHtmlBytes = 1024 * 1024;
export const ImportWebPageRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("public_url"),
    url: WebUrlSchema,
  }),
  z.strictObject({
    mode: z.literal("extension"),
    url: WebUrlSchema,
    html: TextSchema.max(MaxWebPageHtmlBytes),
    metadata: z.strictObject(WebPageMetadataFields).partial().default({}),
    idempotencyKey: IdempotencyKeySchema,
  }),
]);
export type ImportWebPageRequest = z.infer<typeof ImportWebPageRequestSchema>;

const SourceDetailsByKind = {
  youtube: VideoDetailsSchema,
  provider_video: VideoDetailsSchema,
  web_page: z.strictObject({
    accessedDate: z.iso.date().optional(),
    submittedUrl: WebUrlSchema.optional(),
    extraction: WebPageExtractionSchema.optional(),
  }),
  pdf: z.strictObject({
    pageCount: z.number().int().positive().optional(),
  }),
  offline: z.strictObject({
    subtype: z
      .enum([
        "book",
        "print_article",
        "interview",
        "letter",
        "document",
        "other",
      ])
      .optional(),
    notes: NotesSchema.optional(),
  }),
  image: z.strictObject({
    ...LicenceFields,
    originalUrl: WebUrlSchema.optional(),
    pageUrl: WebUrlSchema.optional(),
    altText: TextSchema.max(2000).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  audio: z.strictObject({
    ...MediaDetails,
    role: AudioRoleSchema.optional(),
  }),
  local_video: z.strictObject(MediaDetails),
} satisfies Record<z.infer<typeof SourceKindSchema>, z.ZodType>;

const SourceDetailsSchema = z.union(Object.values(SourceDetailsByKind));
const SourceFields = {
  kind: SourceKindSchema,
  sourceIdentity: SourceIdentityV1Schema.optional(),
};

function sourceIdentityMatchesKind(
  kind: z.infer<typeof SourceKindSchema>,
  identity: z.infer<typeof SourceIdentityV1Schema>,
) {
  return (
    kind === (identity.provider === "youtube" ? "youtube" : "provider_video")
  );
}

function sourceDetailsMatchKind(source: {
  kind: z.infer<typeof SourceKindSchema>;
  details: z.infer<typeof SourceDetailsSchema>;
}) {
  return SourceDetailsByKind[source.kind].safeParse(source.details).success;
}

export const CreateSourceRequestSchema = z
  .strictObject({
    kind: SourceKindSchema,
    idempotencyKey: IdempotencyKeySchema,
    sourceIdentity: SourceIdentityWriteSchema.optional(),
    bibliography: BibliographyWriteSchema.default({}),
    details: SourceDetailsSchema.default({}),
  })
  .refine(
    ({ kind, sourceIdentity }) =>
      sourceIdentity
        ? kind === "youtube" &&
          sourceIdentity.providerMediaId.length <= 64 &&
          sourceIdentityMatchesKind(kind, sourceIdentity)
        : kind !== "youtube" && kind !== "provider_video",
    {
      path: ["sourceIdentity"],
      message: "Source identity must match the source kind.",
    },
  )
  .refine(sourceDetailsMatchKind, {
    path: ["details"],
    message: "Details must match the source kind.",
  });

export const UpdateSourceRequestSchema = z
  .strictObject({
    expectedVersion: VersionSchema,
    bibliography: BibliographyPatchSchema.optional(),
    details: SourceDetailsSchema.optional(),
  })
  .refine(
    ({ bibliography, details }) =>
      bibliography !== undefined || details !== undefined,
    "Provide bibliography or details to update.",
  );

export const LibrarySourceSchema = z
  .strictObject({
    ...SourceFields,
    id: IdSchema,
    projectId: IdSchema,
    providerMediaId: ProviderMediaIdSchema.optional(),
    bibliography: BibliographyReadSchema,
    details: SourceDetailsSchema,
    version: VersionSchema,
  })
  .refine(
    ({ kind, sourceIdentity, providerMediaId }) =>
      sourceIdentity
        ? providerMediaId === undefined &&
          sourceIdentityMatchesKind(kind, sourceIdentity)
        : providerMediaId === undefined ||
          kind === "youtube" ||
          kind === "provider_video",
    {
      path: ["sourceIdentity"],
      message: "Source identity must match the source kind.",
    },
  )
  .refine(sourceDetailsMatchKind, {
    path: ["details"],
    message: "Details must match the source kind.",
  });

const TimedContentFields = {
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  title: TitleSchema.optional(),
  text: ExcerptSchema.optional(),
  originalText: ExcerptSchema.optional(),
  speaker: TextSchema.trim().min(1).max(300).optional(),
};

function hasOrderedBounds(content: { startMs: number; endMs: number }) {
  return content.startMs < content.endMs;
}

const ClipContentSchema = z
  .strictObject(TimedContentFields)
  .refine(hasOrderedBounds, {
    path: ["endMs"],
    message: "End time must be after start time.",
  });
const AudioContentSchema = z
  .strictObject({ ...TimedContentFields, role: AudioRoleSchema.optional() })
  .refine(hasOrderedBounds, {
    path: ["endMs"],
    message: "End time must be after start time.",
  });
const QuoteContentSchema = z.strictObject({
  text: ExcerptSchema,
  speaker: TextSchema.trim().min(1).max(300).optional(),
  title: TitleSchema.optional(),
  speakerTitle: TitleSchema.optional(),
  location: TextSchema.trim().min(1).max(500).optional(),
  surroundingWords: z
    .strictObject({
      before: TextSchema.max(5000).optional(),
      after: TextSchema.max(5000).optional(),
    })
    .optional(),
  // Normalized rectangles on the passage picture or PDF page.
  highlight: z
    .strictObject({
      page: z.number().int().positive().optional(),
      rectangles: z
        .array(
          z
            .strictObject({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().gt(0).max(1),
              height: z.number().gt(0).max(1),
            })
            .refine(
              ({ x, y, width, height }) => x + width <= 1 && y + height <= 1,
              "Highlight must fit within the image or page.",
            ),
        )
        .min(1)
        .max(200),
    })
    .optional(),
  citationOverride: TextSchema.max(20_000).optional(),
});
const DisplayTextSchema = TextSchema.max(100_000);
const StillContentSchema = z.strictObject({
  ...LicenceFields,
  title: TitleSchema.optional(),
  credit: TextSchema.trim().min(1).max(2000).optional(),
});

export const StillCropSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine(
    ({ x, y, width, height }) => x + width <= 1 && y + height <= 1,
    "Crop must fit within the image.",
  );

export const StillProvenanceUrlSchema = WebUrlSchema.refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "Image provenance URLs must not contain credentials.");

export const MaxAudioBytes = 50 * 1024 * 1024;
export const MaxAudioDurationMs = 30 * 60 * 1000;
export const AudioPreviewLimitMs = 15_000;
export const AudioPeakCount = 256;

const AudioChecksumSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const AudioAnalysisSchema = z.strictObject({
  durationMs: z.number().int().positive().max(MaxAudioDurationMs),
  peaks: z.array(z.number().min(0).max(1)).length(AudioPeakCount),
});

const AudioImportFields = {
  title: TitleSchema,
  role: AudioRoleSchema.optional(),
  idempotencyKey: IdempotencyKeySchema.unwrap(),
};
export const AudioFileImportSchema = AudioAnalysisSchema.extend({
  ...AudioImportFields,
  originalSha256: AudioChecksumSchema,
  previewBase64: z.base64().max(321_000),
});
export const AudioUrlImportSchema = z.strictObject({
  ...AudioImportFields,
  url: WebUrlSchema,
});
export const AudioMimeSchema = z.enum([
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
]);
export const AudioAssetManifestSchema = AudioAnalysisSchema.extend({
  playbackSha256: AudioChecksumSchema,
  playbackDurationMs: z.number().int().positive().max(MaxAudioDurationMs),
  mimeType: AudioMimeSchema,
  origin: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("url") }),
    z.strictObject({
      kind: z.literal("file"),
      originalSha256: AudioChecksumSchema,
    }),
  ]),
});
export type AudioAssetManifest = z.infer<typeof AudioAssetManifestSchema>;

export const StillUploadSchema = StillContentSchema.extend({
  title: TitleSchema,
  idempotencyKey: IdempotencyKeySchema.unwrap(),
  topics: TopicsSchema.default([]),
  originalUrl: StillProvenanceUrlSchema.optional(),
  pageUrl: StillProvenanceUrlSchema.optional(),
  altText: TextSchema.max(2000).optional(),
});
export const StillUrlImportSchema = StillUploadSchema.omit({
  originalUrl: true,
}).extend({ url: WebUrlSchema });
export const StillPageCropSchema = StillUploadSchema.extend({
  sourceId: IdSchema,
  crop: StillCropSchema,
});
export const StillCropRequestSchema = StillUploadSchema.omit({
  originalUrl: true,
  pageUrl: true,
}).extend({ crop: StillCropSchema });

export const StillAssetRoleSchema = z.enum([
  "original",
  "display",
  "thumbnail",
]);
export const StillImageMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const StillAssetSchema = z.strictObject({
  versionId: z.string().min(1),
  sha256: Sha256Schema,
  byteCount: z.number().int().positive(),
  mimeType: StillImageMimeSchema,
  width: VersionSchema,
  height: VersionSchema,
});
export const StillAssetManifestSchema = z.strictObject({
  assets: z.strictObject({
    original: StillAssetSchema,
    display: StillAssetSchema,
    thumbnail: StillAssetSchema,
  }),
  provenance: z.strictObject({
    kind: z.enum(["url", "file", "page_picture", "still_crop"]),
    sourceUrl: StillProvenanceUrlSchema.optional(),
    resolvedUrl: StillProvenanceUrlSchema.optional(),
    pageUrl: StillProvenanceUrlSchema.optional(),
    altText: TextSchema.max(2000).optional(),
    parentItemId: IdSchema.optional(),
    crop: StillCropSchema.optional(),
    inputSha256: Sha256Schema,
  }),
});
export type StillUpload = z.infer<typeof StillUploadSchema>;
export type StillContent = z.infer<typeof StillContentSchema>;
export type StillAssetRole = z.infer<typeof StillAssetRoleSchema>;
export type StillAsset = z.infer<typeof StillAssetSchema>;
export type StillAssetManifest = z.infer<typeof StillAssetManifestSchema>;

const ItemFields = {
  sourceId: IdSchema,
  notes: NotesSchema.default(""),
  topics: TopicsSchema.default([]),
};
const ItemCreateFields = {
  ...ItemFields,
  idempotencyKey: IdempotencyKeySchema,
};
const ClipItemSchema = z.strictObject({
  kind: z.literal("clip"),
  content: ClipContentSchema,
});
const QuoteItemSchema = z.strictObject({
  kind: z.literal("quote"),
  content: QuoteContentSchema,
});
const StillItemSchema = z.strictObject({
  kind: z.literal("still"),
  content: StillContentSchema,
});
const AudioItemSchema = z.strictObject({
  kind: z.literal("audio"),
  content: AudioContentSchema,
});

export const CreateItemRequestSchema = z.discriminatedUnion("kind", [
  ClipItemSchema.extend(ItemCreateFields),
  QuoteItemSchema.extend(ItemCreateFields),
  StillItemSchema.extend(ItemCreateFields),
  AudioItemSchema.extend(ItemCreateFields),
]);

const EditItemRequestSchema = z
  .strictObject({
    expectedVersion: VersionSchema,
    notes: NotesSchema.optional(),
    topics: TopicsSchema.optional(),
    content: z
      .union([
        ClipContentSchema,
        QuoteContentSchema,
        StillContentSchema,
        AudioContentSchema,
      ])
      .optional(),
  })
  .refine(
    ({ notes, topics, content }) =>
      notes !== undefined || topics !== undefined || content !== undefined,
    "Provide notes, topics or content to update.",
  );

export const UpdateItemRequestSchema = z.union([
  EditItemRequestSchema,
  z.strictObject({
    expectedVersion: VersionSchema,
    latestDisplayText: DisplayTextSchema,
  }),
]);

export const DeleteQuoteRequestSchema = z.strictObject({
  expectedVersion: VersionSchema,
});

const ItemReadFields = {
  ...ItemFields,
  notes: NotesSchema,
  topics: TopicsSchema,
  id: IdSchema,
  projectId: IdSchema,
  createdBy: IdSchema,
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const LibraryItemSchema = z.discriminatedUnion("kind", [
  ClipItemSchema.extend(ItemReadFields),
  QuoteItemSchema.extend({
    ...ItemReadFields,
    content: QuoteContentSchema.extend({
      latestDisplayText: DisplayTextSchema.optional(),
    }),
  }),
  StillItemSchema.extend(ItemReadFields),
  AudioItemSchema.extend(ItemReadFields),
]);

const QueryIntegerSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number);
const ListQueryFields = {
  topic: ClipTagNameSchema.optional(),
  q: TextSchema.trim().min(1).max(500).optional(),
  limit: QueryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(50),
  offset: QueryIntegerSchema.pipe(z.number().int().min(0).max(100_000)).default(
    0,
  ),
};

export const SourceListQuerySchema = z.strictObject({
  ...ListQueryFields,
  kind: SourceKindSchema.optional(),
  sort: z.literal("recent").optional(),
});

export const ItemListQuerySchema = z.strictObject({
  ...ListQueryFields,
  kind: ItemKindSchema.optional(),
  logger: IdSchema.optional(),
  sourceId: IdSchema.optional(),
});

export type SourceIdentityV1 = z.infer<typeof SourceIdentityV1Schema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type ItemKind = z.infer<typeof ItemKindSchema>;
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequestSchema>;
export type LibrarySource = z.infer<typeof LibrarySourceSchema>;
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type SourceListQuery = z.infer<typeof SourceListQuerySchema>;
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

// A browser capture supplies the rendered article and image bytes. Its URLs
// identify provenance and are never instructions to fetch the signed-in page.
const CaptureUrl = StillProvenanceUrlSchema;
const captureAction = { requestId: IdSchema, url: CaptureUrl };
const encodedBytes = (max: number) =>
  z
    .string()
    .min(4)
    .max(4 * Math.ceil(max / 3))
    .pipe(z.base64());
const CapturePicture = z
  .strictObject({
    data: encodedBytes(8 * 1024 * 1024),
    width: z.int().min(1).max(16384),
    height: z.int().min(1).max(16384),
  })
  .refine(
    ({ width, height }) => width * height <= 25_000_000,
    "Picture exceeds pixel limit.",
  );
const webCapture = {
  ...captureAction,
  repairCaptureId: IdSchema.optional(),
  metadata: z
    .strictObject({ ...WebPageMetadataFields, url: CaptureUrl })
    .partial(),
  articleText: ExcerptSchema.optional(),
  top: CapturePicture.optional(),
  passage: CapturePicture.optional(),
};
const PageCapture = z.strictObject({ kind: z.literal("page"), ...webCapture });
const QuoteCapture = z
  .strictObject({
    kind: z.literal("quote"),
    ...webCapture,
    quote: QuoteContentSchema.pick({
      text: true,
      speaker: true,
      speakerTitle: true,
      surroundingWords: true,
      highlight: true,
    }),
    topics: TopicsSchema.default([]),
    notes: NotesSchema.default(""),
  })
  .refine(
    (capture) => !capture.quote.highlight || capture.passage,
    "A highlight requires its passage picture.",
  );
const AudioCapture = z.strictObject({
  kind: z.literal("audio"),
  ...captureAction,
  pageUrl: CaptureUrl,
  title: TitleSchema.optional(),
});
export const ExtensionCaptureRequestSchema = z.discriminatedUnion("kind", [
  PageCapture,
  QuoteCapture,
  AudioCapture,
]);
export type ExtensionCaptureRequest = z.infer<
  typeof ExtensionCaptureRequestSchema
>;

export const YouTubeCaptureDetailsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("general"),
    reason: TextSchema.trim().max(200).optional(),
  }),
  z.strictObject({
    kind: z.literal("moment"),
    timecodeMs: z.int().nonnegative(),
    note: TextSchema.trim().max(2000).default(""),
  }),
]);
export type YouTubeCaptureDetails = z.infer<typeof YouTubeCaptureDetailsSchema>;

const YouTubeSourceReasonSchema = z.strictObject({
  text: TextSchema.min(1).max(200),
  updatedBy: IdSchema,
  updatedByName: z.string(),
  updatedAt: TimestampSchema,
});
export type YouTubeSourceReason = z.infer<typeof YouTubeSourceReasonSchema>;

export const YouTubeSourceDetailsSchema = z.strictObject({
  sourceId: IdSchema,
  url: WebUrlSchema,
  title: z.string(),
  reason: YouTubeSourceReasonSchema.nullable(),
  moments: z.array(
    z.strictObject({
      id: IdSchema,
      timecodeMs: z.int().nonnegative(),
      note: TextSchema.min(1).max(2000).nullable(),
      authorId: IdSchema,
      authorName: z.string(),
      createdAt: TimestampSchema,
    }),
  ),
});
export type YouTubeSourceDetails = z.infer<typeof YouTubeSourceDetailsSchema>;

export const ExtensionDraftSchema = z.discriminatedUnion("kind", [
  PageCapture,
  QuoteCapture,
  AudioCapture,
  z.strictObject({
    kind: z.literal("still"),
    ...captureAction,
    pageUrl: CaptureUrl,
    title: TitleSchema,
    altText: TextSchema.max(2000).optional(),
    credit: BibliographyFields.credit.shape.value.optional(),
    data: encodedBytes(20 * 1024 * 1024),
    mimeType: StillImageMimeSchema,
  }),
  z
    .strictObject({
      kind: z.literal("youtube"),
      ...captureAction,
      timecodeMs: z.int().nonnegative().optional(),
      comment: TextSchema.trim().max(2000).optional(),
      youtubeDetails: YouTubeCaptureDetailsSchema.optional(),
    })
    .refine(
      (capture) =>
        !capture.youtubeDetails ||
        (capture.comment === undefined && capture.timecodeMs === undefined),
      "A YouTube source save cannot also include a legacy comment.",
    ),
]);
export type ExtensionDraft = z.infer<typeof ExtensionDraftSchema>;

export const SourceDiscussionIdsSchema = z.array(IdSchema).min(1).max(30);
export const SourceDiscussionReadSchema = z.array(IdSchema).min(1).max(50);
export const CreateSourceDiscussionCommentSchema = z.strictObject({
  id: IdSchema,
  body: TextSchema.trim().min(1).max(2000),
});
export type CreateSourceDiscussionComment = z.infer<
  typeof CreateSourceDiscussionCommentSchema
>;

export const SourceDiscussionCountSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});
export const SourceDiscussionCommentSchema = z.strictObject({
  id: IdSchema,
  authorName: z.string(),
  body: z.string(),
  createdAt: TimestampSchema,
  unread: z.boolean(),
});
export const SourceDiscussionPageSchema = z.strictObject({
  comments: SourceDiscussionCommentSchema.array(),
  canReply: z.boolean(),
  more: z.boolean(),
});
