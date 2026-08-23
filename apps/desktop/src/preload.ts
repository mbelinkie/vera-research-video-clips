import { contextBridge, ipcRenderer } from "electron";

import {
  DesktopApiRequestSchema,
  DesktopApiResponseSchema,
  DesktopAuthStatusSchema,
  DesktopStatusSchema,
} from "@research-video/contracts";

import { desktopIpcChannels } from "./ipc.ts";

contextBridge.exposeInMainWorld("researchVideoDesktop", {
  getStatus: async () =>
    DesktopStatusSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.getStatus),
    ),
  signIn: async () => {
    DesktopAuthStatusSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.signIn),
    );
  },
  signOut: async () => {
    DesktopAuthStatusSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.signOut),
    );
  },
  request: async (input: unknown) =>
    DesktopApiResponseSchema.parse(
      await ipcRenderer.invoke(
        desktopIpcChannels.request,
        DesktopApiRequestSchema.parse(input),
      ),
    ),
});
