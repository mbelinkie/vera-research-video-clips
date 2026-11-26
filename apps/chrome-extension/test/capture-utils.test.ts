import { describe, expect, it } from "vitest";

import {
  boundedArticleText,
  boundedQuoteText,
  safePageUrl,
} from "../src/capture-utils.mjs";

describe("capture payload bounds", () => {
  it("removes credentials, camel-case secrets, and fragments from page URLs", () => {
    const safe = safePageUrl(
      "https://research.example/read?authToken=secret&story=7#private-fragment",
    );
    expect(safe).toBe("https://research.example/read?story=7");
    expect(safePageUrl(`https://research.example/${"x".repeat(4100)}`)).toBe(
      null,
    );
  });

  it("bounds article and quote text before it crosses the extension boundary", () => {
    expect(boundedArticleText("a".repeat(70_000))?.length).toBe(64 * 1024);
    expect(boundedQuoteText("a".repeat(20 * 1024 + 1))).toBe(null);
    expect(boundedQuoteText("\0visible")).toBe("visible");
  });
});
