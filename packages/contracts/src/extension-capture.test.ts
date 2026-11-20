import { describe, it, expect } from "vitest";
import {
  ExtensionCaptureRequestSchema as capture,
  ExtensionDraftSchema,
} from "./index.ts";

const requestId = "fff78656-660a-4669-abd7-14c35ceaac97";
const url = "https://example.test/story";
const quote = {
  kind: "quote",
  requestId,
  url,
  metadata: {},
  quote: { text: "  first line\nlast line  " },
};
describe("browser captures", () => {
  it("preserves verbatim text and absent bibliography", () => {
    expect(capture.parse(quote)).toEqual({ ...quote, notes: "", topics: [] });
  });
  it("accepts a page without a selection or invented geometry", () => {
    expect(
      capture.safeParse({ kind: "page", requestId, url, metadata: {} }).success,
    ).toBe(true);
  });
  it("requires a passage image for supplied geometry", () => {
    const positioned = {
      ...quote,
      quote: {
        ...quote.quote,
        highlight: { rectangles: [{ x: 0, y: 0, width: 0.5, height: 0.1 }] },
      },
    };
    expect(capture.safeParse(positioned).success).toBe(false);
    expect(
      capture.safeParse({
        ...positioned,
        passage: { width: 800, height: 600, data: "YQ==" },
      }).success,
    ).toBe(true);
  });
  it("rejects credentials, scripts, unexpected fields and unbounded images", () => {
    for (const extra of [
      { url: "javascript:alert(1)" },
      { url: "https://name:pass@example.test" },
      { metadata: { url: "https://name:pass@example.test" } },
      { html: "<form></form>" },
      { top: { width: 8192, height: 8192, data: "YQ==" } },
    ]) {
      expect(capture.safeParse({ ...quote, ...extra }).success).toBe(false);
    }
  });
  it("keeps still upload and video queueing on their own services", () => {
    for (const value of [
      {
        kind: "youtube",
        requestId,
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
      {
        kind: "still",
        requestId,
        url,
        pageUrl: url,
        title: "Fixture",
        mimeType: "image/png",
        data: "YQ==",
      },
    ]) {
      expect(ExtensionDraftSchema.safeParse(value).success).toBe(true);
      expect(capture.safeParse(value).success).toBe(false);
    }
  });

  it("requires an exact elapsed time for a moment and keeps the two save kinds distinct", () => {
    const video = {
      kind: "youtube",
      requestId,
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    };
    for (const youtubeDetails of [
      { kind: "general" },
      { kind: "general", reason: "" },
      { kind: "general", reason: "x".repeat(200) },
      { kind: "moment", timecodeMs: 0, note: "" },
      { kind: "moment", timecodeMs: 0 },
    ])
      expect(
        ExtensionDraftSchema.safeParse({ ...video, youtubeDetails }).success,
      ).toBe(true);
    for (const youtubeDetails of [
      { kind: "general", reason: "x".repeat(201) },
      { kind: "general", reason: "", timecodeMs: 0 },
      { kind: "moment", note: "" },
      { kind: "moment", timecodeMs: -1, note: "" },
      { kind: "moment", timecodeMs: 12.5, note: "" },
      { kind: "moment", timecodeMs: 12, note: "\0" },
    ])
      expect(
        ExtensionDraftSchema.safeParse({ ...video, youtubeDetails }).success,
      ).toBe(false);
    expect(
      ExtensionDraftSchema.safeParse({
        ...video,
        timecodeMs: 0,
        youtubeDetails: { kind: "general", reason: "" },
      }).success,
    ).toBe(false);
  });
});
