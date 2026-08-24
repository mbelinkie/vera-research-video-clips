import type { IpcMainInvokeEvent } from "electron";

export const desktopIpcChannels = {
  getStatus: "desktop:get-status",
  signIn: "desktop:sign-in",
  signOut: "desktop:sign-out",
  getSetup: "desktop:get-setup",
  getReadiness: "desktop:get-readiness",
  updateSetup: "desktop:update-setup",
  chooseSetupTarget: "desktop:choose-setup-target",
  startModelDownload: "desktop:start-model-download",
  cancelModelDownload: "desktop:cancel-model-download",
  modelDownloadProgress: "desktop:model-download-progress",
  timedTranscriptUpload: "desktop:timed-transcript-upload",
  request: "desktop:request",
} as const;

export function requireTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame !== frame.top) {
    throw new Error("Untrusted desktop IPC sender.");
  }
  let url: URL;
  try {
    url = new URL(frame.url);
  } catch {
    throw new Error("Untrusted desktop IPC sender.");
  }
  if (
    url.protocol !== "rvc:" ||
    url.hostname !== "app" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Untrusted desktop IPC sender.");
  }
}

export function isPrivateDesktopSetupPath(path: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(path, "https://desktop.invalid").pathname;
  } catch {
    return true;
  }
  return (
    pathname === "/api/desktop-setup/native-selection" ||
    pathname === "/api/desktop-setup/model-download/activate" ||
    pathname === "/api/desktop-setup/runtime-config"
  );
}

/** Exact renderer request eligible for the main-only offline-review capability. */
export function isLocalTranscriptWorkspaceRequest(input: {
  target: "cloud" | "local";
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
}): boolean {
  if (input.target !== "local" || input.method !== "GET") return false;
  let target: URL;
  try {
    target = new URL(input.path, "https://desktop.invalid");
  } catch {
    return false;
  }
  if (
    target.origin !== "https://desktop.invalid" ||
    target.hash ||
    input.path !== `${target.pathname}${target.search}`
  ) {
    return false;
  }
  if (
    !/^\/api\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/transcript$/iu.test(
      target.pathname,
    )
  ) {
    return false;
  }
  return (
    target.searchParams.size === 0 ||
    (target.searchParams.size === 1 &&
      target.searchParams.has("preferredLanguage"))
  );
}
