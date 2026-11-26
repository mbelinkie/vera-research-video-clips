import { describe, expect, it } from "vitest";

import {
  parseYouTubeSourceReceipt,
  sourceReceiptReturnTo,
} from "./youtube-source-view.tsx";

const projectId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

describe("YouTube source receipts", () => {
  it("accepts only a validated project/source pair", () => {
    expect(
      parseYouTubeSourceReceipt(`?projectId=${projectId}&sourceId=${sourceId}`),
    ).toEqual({ projectId, sourceId });
    expect(parseYouTubeSourceReceipt("?projectId=other&sourceId=source")).toBe(
      undefined,
    );
  });

  it("preserves only the validated source query for hosted sign-in", () => {
    expect(
      sourceReceiptReturnTo(
        "/",
        `?projectId=${projectId}&sourceId=${sourceId}&returnTo=https://evil.example`,
      ),
    ).toBe(`/?projectId=${projectId}&sourceId=${sourceId}`);
    expect(sourceReceiptReturnTo("/research", "?fixture=english-word")).toBe(
      "/research",
    );
  });
});
