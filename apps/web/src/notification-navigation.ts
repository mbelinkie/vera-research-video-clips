import type { DesktopNotificationNavigationTarget } from "@research-video/contracts";

export type NotificationNavigationResolution =
  | {
      state: "ready";
      destination: "videos" | "workbench" | "clips";
      projectId?: string;
    }
  | { state: "project_unavailable" };

export function resolveNotificationNavigation(
  target: DesktopNotificationNavigationTarget,
  authorizedProjectIds: ReadonlySet<string>,
): NotificationNavigationResolution {
  if (target.kind === "local_export") {
    return { state: "ready", destination: "workbench" };
  }
  if (!authorizedProjectIds.has(target.projectId)) {
    return { state: "project_unavailable" };
  }
  return {
    state: "ready",
    destination: target.kind === "transcription" ? "videos" : "clips",
    projectId: target.projectId,
  };
}
