import { describe, expect, it } from "vitest";

import { formatTimestamp } from "./index.ts";

describe("formatTimestamp", () => {
  it("formats under an hour as m:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(59)).toBe("0:59");
    expect(formatTimestamp(60)).toBe("1:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3_599)).toBe("59:59");
  });

  it("floors fractional seconds", () => {
    expect(formatTimestamp(59.9)).toBe("0:59");
    expect(formatTimestamp(3_599.999)).toBe("59:59");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatTimestamp(3_600)).toBe("1:00:00");
    expect(formatTimestamp(3_725)).toBe("1:02:05");
    expect(formatTimestamp(36_000)).toBe("10:00:00");
  });

  it("rejects negative and non-finite input", () => {
    expect(() => formatTimestamp(-1)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.NaN)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});
