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
