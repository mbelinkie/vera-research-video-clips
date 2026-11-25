import { describe, expect, it } from "vitest";

import type { DesktopNotificationNavigationTarget } from "@research-video/contracts";

import { resolveNotificationNavigation } from "./notification-navigation.ts";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755eb01";
const batchId = "019fbb95-cd76-7920-93fa-e23ba755eb02";
const videoId = "019fbb95-cd76-7920-93fa-e23ba755eb03";
const clipId = "019fbb95-cd76-7920-93fa-e23ba755eb04";
const requestId = "019fbb95-cd76-7920-93fa-e23ba755eb05";
const commentId = "019fbb95-cd76-7920-93fa-e23ba755eb06";

describe("desktop notification renderer navigation", () => {
  it("routes every supported target to its bounded destination", () => {
    const authorized = new Set([projectId]);
    const targets: Array<
      [DesktopNotificationNavigationTarget, "videos" | "workbench" | "clips"]
    > = [
      [{ kind: "transcription", projectId, batchId }, "videos"],
      [{ kind: "transcription", projectId, batchId, videoId }, "videos"],
      [{ kind: "logged_export", projectId, clipId, requestId }, "clips"],
      [
        { kind: "mention", projectId, clipId, commentId, sourceTimeMs: 42 },
        "clips",
      ],
      [{ kind: "local_export", requestId }, "workbench"],
    ];
    for (const [target, destination] of targets) {
      expect(resolveNotificationNavigation(target, authorized)).toEqual({
        state: "ready",
        destination,
        ...(target.kind === "local_export" ? {} : { projectId }),
      });
    }
  });

  it("falls back without navigating or authorizing a removed project", () => {
    expect(
      resolveNotificationNavigation(
        { kind: "mention", projectId, clipId, commentId },
        new Set(),
      ),
    ).toEqual({ state: "project_unavailable" });
  });
});
