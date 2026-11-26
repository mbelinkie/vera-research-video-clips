import { describe, expect, it } from "vitest";
import { findExactQuoteSpan, selectionQuote } from "./quote-spans.ts";

describe("article quote locations", () => {
  it("preserves exact whitespace and finds the original span", () => {
    const text = "Before\n A  quote\n with spaces.\nAfter";
    const end = text.indexOf("After");
    const quote = selectionQuote(text, 7, end);
    expect(quote.text).toBe(" A  quote\n with spaces.\n");
    expect(findExactQuoteSpan(text, quote)).toEqual({ start: 7, end });
  });

  it("requires context when a passage appears more than once", () => {
    const text = "One: repeat. Two: repeat.";
    expect(findExactQuoteSpan(text, { text: "repeat" })).toBeUndefined();
    expect(
      findExactQuoteSpan(text, {
        text: "repeat",
        surroundingWords: { before: "Two: " },
      }),
    ).toEqual({ start: 18, end: 24 });
    expect(findExactQuoteSpan(text, { text: "missing" })).toBeUndefined();
    expect(() => selectionQuote(text, -1, 3)).toThrow(RangeError);
  });
});
