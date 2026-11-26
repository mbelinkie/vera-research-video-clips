/// <reference types="vite/client" />

import type { DesktopBridge } from "./api-client.ts";

declare global {
  interface Window {
    /** Present only in the trusted Electron renderer. */
    researchVideoDesktop?: DesktopBridge;
  }
}

export {};
