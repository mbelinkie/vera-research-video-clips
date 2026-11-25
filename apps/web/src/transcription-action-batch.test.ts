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

  it("uses only the first exact language gate with a batch ID in canonical order", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual" } }],
        [
          { processing: { state: "queued", batchId: "unrelated" } },
          { processing: { state: "needs_language_confirmation" } },
          {
            processing: { state: "needs_translation", batchId: "translation" },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "first-exact-gate",
            },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "second-exact-gate",
            },
          },
        ],
        "stale-hidden-batch",
      ),
    ).toBe("first-exact-gate");
  });

  it("does not expose unrelated hidden batches when no exact gate remains", () => {
    expect(
      selectTranscriptionBatchId(
        [],
        [
          { processing: { state: "queued", batchId: "old-hidden" } },
          { processing: { state: "ready", batchId: "another-hidden" } },
          { processing: { state: "needs_language_confirmation" } },
        ],
        "old-hidden",
      ),
    ).toBeUndefined();
  });

  it("falls back to the first listed batch when a stale selection disappears", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "first-listed" } }, { batch: { id: "second-listed" } }],
        [],
        "no-longer-listed",
      ),
    ).toBe("first-listed");
  });

  it("keeps a selected listed batch ahead of several hidden language gates", () => {
    expect(
      selectTranscriptionBatchId(
        [
          { batch: { id: "first-listed" } },
          { batch: { id: "selected-listed" } },
        ],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "hidden-one",
            },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "hidden-two",
            },
          },
        ],
        "selected-listed",
      ),
    ).toBe("selected-listed");
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
                state: "failed",
                version: 9,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
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
                state: "failed",
                version: 1,
                error: { retryable: false },
              },
              {
                id: "already-queued",
                catalogVideoId: "catalog-selected",
                state: "queued",
                version: 2,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
      ),
    ).toBeUndefined();
  });
});
