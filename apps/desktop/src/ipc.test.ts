import { describe, expect, it } from "vitest";

import { requireTrustedRenderer } from "./ipc.ts";

describe("desktop IPC sender policy", () => {
  it("accepts only a top-level trusted renderer frame", () => {
    const frame = { url: "rvc://app/index.html" } as {
      url: string;
      top?: unknown;
    };
    frame.top = frame;
    expect(() =>
      requireTrustedRenderer({ senderFrame: frame } as never),
    ).not.toThrow();
    for (const url of [
      "https://attacker.example/",
      "file:///tmp/index.html",
      "rvc://evil/index.html",
    ]) {
      const attacker = { url } as { url: string; top?: unknown };
      attacker.top = attacker;
      expect(() =>
        requireTrustedRenderer({ senderFrame: attacker } as never),
      ).toThrow("Untrusted");
    }
  });
});
