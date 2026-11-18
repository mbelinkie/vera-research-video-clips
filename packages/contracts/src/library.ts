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
const AudioRoleSchema = z.enum(["sound_effect", "ambience", "music", "speech"]);
const SourceDetailsByKind = {
  youtube: VideoDetailsSchema,
  provider_video: VideoDetailsSchema,
  web_page: z.strictObject({
    accessedDate: z.iso.date().optional(),
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
  location: TextSchema.trim().min(1).max(500).optional(),
});
const StillContentSchema = z.strictObject({
  ...LicenceFields,
  title: TitleSchema.optional(),
  credit: TextSchema.trim().min(1).max(2000).optional(),
});

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

export const UpdateItemRequestSchema = z
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
  QuoteItemSchema.extend(ItemReadFields),
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
});

export const ItemListQuerySchema = z.strictObject({
  ...ListQueryFields,
  kind: ItemKindSchema.optional(),
  logger: IdSchema.optional(),
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
