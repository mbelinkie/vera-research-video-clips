import { describe, expect, it } from "vitest";

import {
  findRetryableTranscriptionItem,
  selectTranscriptionBatchId,
} from "./transcription-action-batch.ts";

describe("action-required transcription batch selection", () => {
  it("surfaces a hidden automatic batch that needs language confirmation", () => {
    expect(
      selectTranscriptionBatchId(
        [],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "automatic-batch",
            },
          },
        ],
        "",
      ),
    ).toBe("automatic-batch");
  });

  it("preserves an explicitly selected listed batch", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual-one" } }, { batch: { id: "manual-two" } }],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "automatic-batch",
            },
          },
        ],
        "manual-two",
      ),
    ).toBe("manual-two");
  });

  it("does not retain a stale hidden batch after its action resolves", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual-one" } }],
        [
          {
            processing: { state: "queued", batchId: "automatic-batch" },
          },
        ],
        "automatic-batch",
      ),
    ).toBe("manual-one");
  });
});

describe("selected-video transcript retry", () => {
  it("selects only the exact retryable failed video from the newest batch", () => {
    expect(
      findRetryableTranscriptionItem(
        [
          {
            batch: { id: "newer", version: 4 },
            items: [
              {
                id: "other-video",
                catalogVideoId: "catalog-other",
                youtubeVideoId: "OtherVideo1",
                state: "failed",
                version: 7,
                error: { retryable: true },
              },
            ],
          },
          {
            batch: { id: "exact-batch", version: 3 },
            items: [
              {
                id: "exact-item",
                catalogVideoId: "catalog-selected",
                youtubeVideoId: "SelectedVid",
                state: "failed",
                version: 9,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
        "SelectedVid",
      ),
    ).toEqual({
      batchId: "exact-batch",
      batchVersion: 3,
      itemId: "exact-item",
      itemVersion: 9,
    });
  });

  it("rejects nonretryable, nonfailed, and identity-mismatched items", () => {
    expect(
      findRetryableTranscriptionItem(
        [
          {
            batch: { id: "batch", version: 1 },
            items: [
              {
                id: "not-retryable",
                catalogVideoId: "catalog-selected",
                youtubeVideoId: "SelectedVid",
                state: "failed",
                version: 1,
                error: { retryable: false },
              },
              {
                id: "already-queued",
                catalogVideoId: "catalog-selected",
                youtubeVideoId: "SelectedVid",
                state: "queued",
                version: 2,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
        "SelectedVid",
      ),
    ).toBeUndefined();
  });
});
