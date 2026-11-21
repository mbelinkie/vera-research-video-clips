import { describe, expect, it } from "vitest";

import {
  CreateItemRequestSchema,
  CreateSourceRequestSchema,
  LibraryItemSchema,
  UpdateItemRequestSchema,
} from "@research-video/contracts";

import {
  createOfflineSourceRequest,
  createTypedQuoteRequest,
  emptyTypedQuoteDraft,
  typedQuoteDraftFromItem,
  updateTypedQuoteRequest,
  type OfflineSourceDraft,
  type QuoteItem,
  type TypedQuoteDraft,
} from "./typed-quote-model.ts";

const sourceId = "019fbb95-cd76-7920-93fa-e23ba755ee3f";
const itemId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
const userId = "019fbb95-cd76-7920-93fa-e23ba755ee42";

function sourceDraft(
  overrides: Partial<OfflineSourceDraft> = {},
): OfflineSourceDraft {
  return {
    subtype: "book",
    title: "  A Great History  ",
    authors: "",
    publication: "",
    publisher: "",
    date: "",
    url: "",
    notes: "",
    ...overrides,
  };
}

function quoteDraft(overrides: Partial<TypedQuoteDraft> = {}): TypedQuoteDraft {
  return {
    ...emptyTypedQuoteDraft(),
    text: "  “A line,” she said.\n\n  ",
    ...overrides,
  };
}

function savedExtensionQuote(): QuoteItem {
  const parsed = LibraryItemSchema.parse({
    id: itemId,
    projectId,
    sourceId,
    createdBy: userId,
    createdAt: "2026-11-19T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    version: 7,
    kind: "quote",
    notes: "Before correction",
    topics: ["Context", "Evidence"],
    content: {
      text: "  captured text\n",
      speaker: "Wrong person",
      speakerTitle: "Wrong role",
      title: "Capture-provided heading",
      location: "p. 15",
      citationOverride: "Provisional citation",
      surroundingWords: { before: "prior words", after: "following words" },
      highlight: {
        page: 3,
        rectangles: [{ x: 0.15, y: 0.25, width: 0.3, height: 0.08 }],
      },
      latestDisplayText: "Changed later in a script, not the original",
    },
  });
  if (parsed.kind !== "quote") throw new Error("Expected quote fixture");
  return parsed;
}

describe("typed quote offline source payload", () => {
  it("uses an explicit offline subtype, title and confirmed bibliographic fields", () => {
    const payload = createOfflineSourceRequest(
      sourceDraft({
        subtype: "print_article",
        authors: "  Smith, Jane  \n\nJohn A. Doe\r\n  Lee, Kim ",
        publication: "  Historical Review  ",
        publisher: "  Example Press ",
        date: "  Winter 1987  ",
        url: "  https://archive.example/article?year=1987  ",
        notes: "  Private bibliography note\n",
      }),
      "create-source-intent-1",
    );

    expect(CreateSourceRequestSchema.parse(payload)).toEqual(payload);
    expect(payload).toEqual({
      kind: "offline",
      idempotencyKey: "create-source-intent-1",
      bibliography: {
        title: { value: "A Great History", state: "confirmed" },
        authors: {
          value: ["Smith, Jane", "John A. Doe", "Lee, Kim"],
          state: "confirmed",
        },
        publication: { value: "Historical Review", state: "confirmed" },
        publisher: { value: "Example Press", state: "confirmed" },
        date: { value: "Winter 1987", state: "confirmed" },
        url: {
          value: "https://archive.example/article?year=1987",
          state: "confirmed",
        },
      },
      details: {
        subtype: "print_article",
        notes: "  Private bibliography note\n",
      },
    });
  });

  it("permits incomplete bibliography without fabricating absent fields", () => {
    const payload = createOfflineSourceRequest(
      sourceDraft({ subtype: "letter" }),
      "letter-key",
    );
    expect(payload.bibliography).toEqual({
      title: { value: "A Great History", state: "confirmed" },
    });
    expect(payload.details).toEqual({ subtype: "letter" });
    expect(payload).not.toHaveProperty("sourceIdentity");
    expect(
      createOfflineSourceRequest(sourceDraft({ subtype: "other" }), "other-key")
        .details,
    ).toEqual({ subtype: "other" });
  });

  it("requires a real title and rejects malformed URLs and over-bounded metadata", () => {
    expect(() =>
      createOfflineSourceRequest(sourceDraft({ title: "   " }), "key"),
    ).toThrow(/title/u);
    expect(() =>
      createOfflineSourceRequest(
        sourceDraft({ title: "x".repeat(501) }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createOfflineSourceRequest(
        sourceDraft({ url: "javascript:alert(1)" }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createOfflineSourceRequest(
        sourceDraft({ url: "ftp://example.com/book" }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createOfflineSourceRequest(
        sourceDraft({ authors: Array(51).fill("Person").join("\n") }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createOfflineSourceRequest(
        sourceDraft({ notes: "x".repeat(20_001) }),
        "key",
      ),
    ).toThrow();
  });

  it("never produces a title-based deduplication or an invented offline ID", () => {
    const first = createOfflineSourceRequest(sourceDraft(), "book-1");
    const second = createOfflineSourceRequest(sourceDraft(), "book-2");
    expect(first.bibliography).toEqual(second.bibliography);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first).not.toHaveProperty("id");
    expect(second).not.toHaveProperty("id");
  });
});

describe("typed quote create payload", () => {
  it("preserves verbatim quote text while mapping separate speaker, role, page and Topics", () => {
    const draft = quoteDraft({
      speaker: "  Speaker A  ",
      speakerTitle: "  Committee chair ",
      page: "  113b  ",
      topics: ["  Politics ", "Source checking"],
      note: "  Research note\n",
      citationOverride: "  Author, book, p. 113b  ",
    });
    const created = createTypedQuoteRequest(sourceId, draft, "quote-intent-1");
    expect(CreateItemRequestSchema.parse(created)).toEqual(created);
    expect(created).toEqual({
      kind: "quote",
      sourceId,
      idempotencyKey: "quote-intent-1",
      content: {
        text: draft.text,
        speaker: "Speaker A",
        speakerTitle: "Committee chair",
        location: "113b",
        citationOverride: "  Author, book, p. 113b  ",
      },
      topics: ["Politics", "Source checking"],
      notes: "  Research note\n",
    });
    expect(draft.topics).toEqual(["  Politics ", "Source checking"]);
    expect(created.content.text).toBe(draft.text);
  });

  it("uses an existing source without creating or modifying its bibliography", () => {
    const first = createTypedQuoteRequest(sourceId, quoteDraft(), "quote-1");
    const second = createTypedQuoteRequest(
      sourceId,
      quoteDraft({ text: "Second quote" }),
      "quote-2",
    );
    expect(first.sourceId).toBe(second.sourceId);
    expect(second).not.toHaveProperty("bibliography");
    expect(second.content).toEqual({ text: "Second quote" });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.content).not.toHaveProperty("speaker");
    expect(first.content).not.toHaveProperty("speakerTitle");
    expect(first.content).not.toHaveProperty("title");
  });

  it("refuses blank text, invalid source IDs and Topics rather than silently dropping data", () => {
    expect(() =>
      createTypedQuoteRequest(sourceId, quoteDraft({ text: "  \n\t " }), "key"),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest(
        sourceId,
        quoteDraft({ text: "x".repeat(100_001) }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest(sourceId, quoteDraft({ text: "a\0b" }), "key"),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest("not-a-uuid", quoteDraft(), "key"),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest(
        sourceId,
        quoteDraft({ topics: ["valid", "  "] }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest(
        sourceId,
        quoteDraft({ topics: ["bad\ncontrol"] }),
        "key",
      ),
    ).toThrow();
    expect(() =>
      createTypedQuoteRequest(
        sourceId,
        quoteDraft({ topics: Array(51).fill("tag") }),
        "key",
      ),
    ).toThrow();
  });

  it("clears only quote-specific state for Save and add another", () => {
    const previous = quoteDraft({ topics: ["Context"] });
    const cleared = emptyTypedQuoteDraft();
    expect(cleared).toEqual({
      text: "",
      speaker: "",
      speakerTitle: "",
      page: "",
      topics: [],
      note: "",
      citationOverride: "",
    });
    cleared.topics.push("New");
    expect(previous.topics).toEqual(["Context"]);
    expect(emptyTypedQuoteDraft().topics).toEqual([]);
  });
});

describe("typed quote edit payload", () => {
  it("loads an extension quote into the same editable draft", () => {
    const item = savedExtensionQuote();
    const draft = typedQuoteDraftFromItem(item);
    expect(draft).toEqual({
      text: "  captured text\n",
      speaker: "Wrong person",
      speakerTitle: "Wrong role",
      page: "p. 15",
      topics: ["Context", "Evidence"],
      note: "Before correction",
      citationOverride: "Provisional citation",
    });
    draft.topics.push("New");
    expect(item.topics).toEqual(["Context", "Evidence"]);
  });

  it("clears optional details and preserves extension provenance and generic content title", () => {
    const item = savedExtensionQuote();
    const original = structuredClone(item);
    const draft = typedQuoteDraftFromItem(item);
    draft.text = "  corrected original text\n";
    draft.speaker = "";
    draft.speakerTitle = " ";
    draft.page = "";
    draft.citationOverride = "";
    draft.note = "";
    draft.topics = [];

    const patch = updateTypedQuoteRequest(item, draft);
    expect(UpdateItemRequestSchema.parse(patch)).toEqual(patch);
    expect(patch).toEqual({
      expectedVersion: 7,
      content: {
        text: "  corrected original text\n",
        title: "Capture-provided heading",
        surroundingWords: { before: "prior words", after: "following words" },
        highlight: {
          page: 3,
          rectangles: [{ x: 0.15, y: 0.25, width: 0.3, height: 0.08 }],
        },
      },
      topics: [],
      notes: "",
    });
    expect(patch).not.toHaveProperty("sourceId");
    expect(patch).not.toHaveProperty("latestDisplayText");
    expect(JSON.stringify(patch)).not.toContain("Changed later in a script");
    expect(item).toEqual(original);
  });

  it("sets corrected person and role without inventing an author or changing source", () => {
    const item = savedExtensionQuote();
    const patch = updateTypedQuoteRequest(item, {
      ...typedQuoteDraftFromItem(item),
      speaker: "  Witness  ",
      speakerTitle: "  Archivist ",
      page: "  page 81 ",
      topics: ["  Revised  "],
    });
    expect(patch).toMatchObject({
      expectedVersion: 7,
      content: {
        speaker: "Witness",
        speakerTitle: "Archivist",
        location: "page 81",
        text: "  captured text\n",
      },
      topics: ["Revised"],
    });
    expect(patch).not.toHaveProperty("sourceId");
    expect(patch).not.toHaveProperty("bibliography");
  });

  it("validates stale/invalid versions and refuses an invalid quote correction", () => {
    const item = savedExtensionQuote();
    expect(() =>
      updateTypedQuoteRequest(
        { ...item, version: 0 },
        typedQuoteDraftFromItem(item),
      ),
    ).toThrow();
    expect(() =>
      updateTypedQuoteRequest(item, {
        ...typedQuoteDraftFromItem(item),
        text: "\n  ",
      }),
    ).toThrow();
    expect(() =>
      updateTypedQuoteRequest(item, {
        ...typedQuoteDraftFromItem(item),
        topics: ["bad\nname"],
      }),
    ).toThrow();
  });
});
