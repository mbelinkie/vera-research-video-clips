import { describe, expect, it } from "vitest";

import {
  desktopIpcChannels,
  isLocalTranscriptWorkspaceRequest,
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
      "desktop:check-recommended-setup",
      "desktop:apply-recommended-setup",
      "desktop:choose-setup-target",
      "desktop:start-model-download",
      "desktop:cancel-model-download",
      "desktop:model-download-progress",
      "desktop:timed-transcript-upload",
      "desktop:get-notification-preferences",
      "desktop:update-notification-preferences",
      "desktop:get-notification-support",
      "desktop:notification-navigation",
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
      isPrivateDesktopSetupPath("/api/desktop-setup/recommended/apply"),
    ).toBe(true);
    expect(
      isPrivateDesktopSetupPath(
        "/api/desktop-setup/public/../runtime-config?ignored=1",
      ),
    ).toBe(true);
    expect(isPrivateDesktopSetupPath("/api/projects?limit=25")).toBe(false);
  });
});

describe("desktop transcript capability route policy", () => {
  const request = {
    target: "local" as const,
    method: "GET" as const,
    path: "/api/projects/019fbb95-cd76-7920-93fa-e23ba755e391/videos/019fbb95-cd76-7920-93fa-e23ba755e392/transcript?preferredLanguage=es-MX",
  };

  it("matches only the exact canonical local transcript GET", () => {
    expect(isLocalTranscriptWorkspaceRequest(request)).toBe(true);
    expect(
      isLocalTranscriptWorkspaceRequest({
        ...request,
        path: request.path.replace("?preferredLanguage=es-MX", ""),
      }),
    ).toBe(true);
    for (const candidate of [
      { ...request, target: "cloud" as const },
      { ...request, method: "POST" as const },
      { ...request, path: `${request.path}&extra=1` },
      {
        ...request,
        path: request.path.replace("/transcript?", "/other/../transcript?"),
      },
      { ...request, path: `https://attacker.example${request.path}` },
    ]) {
      expect(isLocalTranscriptWorkspaceRequest(candidate)).toBe(false);
    }
  });
});
