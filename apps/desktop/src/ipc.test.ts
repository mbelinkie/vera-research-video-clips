import { describe, expect, it } from "vitest";

import {
  desktopIpcChannels,
  isPrivateDesktopSetupPath,
  requireTrustedRenderer,
} from "./ipc.ts";

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

describe("desktop IPC channel vocabulary", () => {
  it("keeps native setup actions separately named from the generic API proxy", () => {
    expect(Object.values(desktopIpcChannels)).toEqual([
      "desktop:get-status",
      "desktop:sign-in",
      "desktop:sign-out",
      "desktop:get-setup",
      "desktop:get-readiness",
      "desktop:update-setup",
      "desktop:choose-setup-target",
      "desktop:start-model-download",
      "desktop:cancel-model-download",
      "desktop:model-download-progress",
      "desktop:request",
    ]);
  });
});

describe("desktop private setup route policy", () => {
  it("blocks canonical and traversal-spelled private routes", () => {
    expect(isPrivateDesktopSetupPath("/api/desktop-setup/runtime-config")).toBe(
      true,
    );
    expect(
      isPrivateDesktopSetupPath(
        "/api/desktop-setup/public/../runtime-config?ignored=1",
      ),
    ).toBe(true);
    expect(isPrivateDesktopSetupPath("/api/projects?limit=25")).toBe(false);
  });
});
