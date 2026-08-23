import type { IpcMainInvokeEvent } from "electron";

export const desktopIpcChannels = {
  getStatus: "desktop:get-status",
  signIn: "desktop:sign-in",
  signOut: "desktop:sign-out",
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
