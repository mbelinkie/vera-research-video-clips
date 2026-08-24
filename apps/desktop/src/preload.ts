import { contextBridge, ipcRenderer } from "electron";

import {
  DesktopApiRequestSchema,
  DesktopApiResponseSchema,
  DesktopTimedTranscriptUploadRequestSchema,
  DesktopTimedTranscriptUploadResponseSchema,
  DesktopAuthStatusSchema,
  DesktopStatusSchema,
  ModelDownloadProgressSchema,
  ReadinessReportSchema,
  SetupActionSchema,
  SetupSelectionTargetSchema,
  SetupSnapshotSchema,
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
  getSetup: async () =>
    SetupSnapshotSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.getSetup),
    ),
  getReadiness: async () =>
    ReadinessReportSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.getReadiness),
    ),
  updateSetup: async (action: unknown) =>
    SetupSnapshotSchema.parse(
      await ipcRenderer.invoke(
        desktopIpcChannels.updateSetup,
        SetupActionSchema.parse(action),
      ),
    ),
  chooseSetupTarget: async (target: unknown) =>
    SetupSnapshotSchema.parse(
      await ipcRenderer.invoke(
        desktopIpcChannels.chooseSetupTarget,
        SetupSelectionTargetSchema.parse(target),
      ),
    ),
  startModelDownload: async () =>
    ModelDownloadProgressSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.startModelDownload),
    ),
  cancelModelDownload: async () =>
    ModelDownloadProgressSchema.parse(
      await ipcRenderer.invoke(desktopIpcChannels.cancelModelDownload),
    ),
  onModelDownloadProgress: (listener: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      listener(ModelDownloadProgressSchema.parse(progress));
    ipcRenderer.on(desktopIpcChannels.modelDownloadProgress, handler);
    return () =>
      ipcRenderer.removeListener(
        desktopIpcChannels.modelDownloadProgress,
        handler,
      );
  },
  request: async (input: unknown) =>
    DesktopApiResponseSchema.parse(
      await ipcRenderer.invoke(
        desktopIpcChannels.request,
        DesktopApiRequestSchema.parse(input),
      ),
    ),
  uploadTimedTranscript: async (input: unknown) =>
    DesktopTimedTranscriptUploadResponseSchema.parse(
      await ipcRenderer.invoke(
        desktopIpcChannels.timedTranscriptUpload,
        DesktopTimedTranscriptUploadRequestSchema.parse(input),
      ),
    ),
});
