import {
  CreateItemRequestSchema,
  CreateSourceRequestSchema,
  UpdateItemRequestSchema,
  type CreateItemRequest,
  type CreateSourceRequest,
  type LibraryItem,
  type UpdateItemRequest,
} from "@research-video/contracts";

export type OfflineSourceSubtype =
  "book" | "print_article" | "interview" | "letter" | "document" | "other";

export type OfflineSourceDraft = {
  subtype: OfflineSourceSubtype;
  title: string;
  /** One author per line; commas within a name are not separators. */
  authors: string;
  publication: string;
  publisher: string;
  date: string;
  url: string;
  notes: string;
};

export type TypedQuoteDraft = {
  text: string;
  speaker: string;
  speakerTitle: string;
  page: string;
  topics: string[];
  note: string;
  citationOverride: string;
};

export type QuoteItem = Extract<LibraryItem, { kind: "quote" }>;
export type CreateQuoteRequest = Extract<CreateItemRequest, { kind: "quote" }>;

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalVerbatim(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

function confirmed(value: string) {
  const text = optionalText(value);
  return text === undefined
    ? undefined
    : { value: text, state: "confirmed" as const };
}

/** Only the new-source branch calls this; never patch an existing source on quote save. */
export function createOfflineSourceRequest(
  draft: OfflineSourceDraft,
  idempotencyKey: string,
): CreateSourceRequest {
  if (!optionalText(draft.title)) {
    throw new Error("An offline source needs a title.");
  }
  const authors = draft.authors
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return CreateSourceRequestSchema.parse({
    kind: "offline",
    idempotencyKey,
    bibliography: {
      title: confirmed(draft.title),
      ...(authors.length
        ? { authors: { value: authors, state: "confirmed" } }
        : {}),
      ...(confirmed(draft.publication)
        ? { publication: confirmed(draft.publication) }
        : {}),
      ...(confirmed(draft.publisher)
        ? { publisher: confirmed(draft.publisher) }
        : {}),
      ...(confirmed(draft.date) ? { date: confirmed(draft.date) } : {}),
      ...(confirmed(draft.url) ? { url: confirmed(draft.url) } : {}),
    },
    details: {
      subtype: draft.subtype,
      ...(optionalVerbatim(draft.notes) !== undefined
        ? { notes: draft.notes }
        : {}),
    },
  });
}

export function emptyTypedQuoteDraft(): TypedQuoteDraft {
  return {
    text: "",
    speaker: "",
    speakerTitle: "",
    page: "",
    topics: [],
    note: "",
    citationOverride: "",
  };
}

/** Maps only editable quote fields; text is never trimmed or reconstructed. */
function quoteFields(draft: TypedQuoteDraft) {
  return {
    text: draft.text,
    ...(optionalText(draft.speaker)
      ? { speaker: optionalText(draft.speaker) }
      : {}),
    ...(optionalText(draft.speakerTitle)
      ? { speakerTitle: optionalText(draft.speakerTitle) }
      : {}),
    ...(optionalText(draft.page) ? { location: optionalText(draft.page) } : {}),
    ...(optionalVerbatim(draft.citationOverride) !== undefined
      ? { citationOverride: draft.citationOverride }
      : {}),
  };
}

/** Use the same source ID for every subsequent quote, with a new key per intent. */
export function createTypedQuoteRequest(
  sourceId: string,
  draft: TypedQuoteDraft,
  idempotencyKey: string,
): CreateQuoteRequest {
  const parsed = CreateItemRequestSchema.parse({
    sourceId,
    kind: "quote",
    idempotencyKey,
    content: quoteFields(draft),
    topics: [...draft.topics],
    notes: draft.note,
  });
  if (parsed.kind !== "quote") throw new Error("Expected a quote request.");
  return parsed;
}

/** A fetched extension quote can open in precisely the same form as a typed quote. */
export function typedQuoteDraftFromItem(item: QuoteItem): TypedQuoteDraft {
  return {
    text: item.content.text,
    speaker: item.content.speaker ?? "",
    speakerTitle: item.content.speakerTitle ?? "",
    page: item.content.location ?? "",
    topics: [...item.topics],
    note: item.notes,
    citationOverride: item.content.citationOverride ?? "",
  };
}

/** Replace the quote content without erasing capture geometry or script display text. */
export function updateTypedQuoteRequest(
  item: QuoteItem,
  draft: TypedQuoteDraft,
): UpdateItemRequest {
  const {
    text: _text,
    speaker: _speaker,
    speakerTitle: _speakerTitle,
    location: _location,
    citationOverride: _citationOverride,
    latestDisplayText: _latestDisplayText,
    ...retainedContent
  } = item.content;
  return UpdateItemRequestSchema.parse({
    expectedVersion: item.version,
    content: { ...retainedContent, ...quoteFields(draft) },
    topics: [...draft.topics],
    notes: draft.note,
  });
}
