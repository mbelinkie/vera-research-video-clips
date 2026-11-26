import { describe, expect, it } from "vitest";

import { StillCropSchema } from "./library.ts";

describe("retained still normalized crop contract", () => {
  it("accepts exact edges and rejects crossing or negative bounds before image processing", () => {
    expect(
      StillCropSchema.safeParse({ x: 0.75, y: 0, width: 0.25, height: 1 })
        .success,
    ).toBe(true);
    for (const crop of [
      { x: -0.01, y: 0, width: 0.5, height: 1 },
      { x: 0, y: -0.01, width: 1, height: 0.5 },
      { x: 0.9, y: 0, width: 0.2, height: 1 },
      { x: 0, y: 0.9, width: 1, height: 0.2 },
      { x: 0, y: 0, width: 0, height: 1 },
    ]) {
      expect(
        StillCropSchema.safeParse(crop).success,
        JSON.stringify(crop),
      ).toBe(false);
    }
  });
});
