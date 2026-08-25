import { describe, expect, it } from "vitest";

import { selectTranscriptionBatchId } from "./transcription-action-batch.ts";

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
