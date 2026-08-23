# M7-02 Electron local-desktop boundary research

Date: 2026-08-23

## Version and packaging decision

The project pins Electron `43.4.1` and Electron Forge `7.11.2` as approved by
the M7/M8 boundary decision. The local M7 artifact targets the current Intel Mac
explicitly with `electron-forge package --platform=darwin --arch=x64`. M7 does
not configure signing, notarization, an updater, a public installer, or a
Universal/Windows build.

- [Electron Forge CLI](https://www.electronforge.io/cli)
- [Electron Forge configuration](https://www.electronforge.io/config/configuration)
- [Electron Forge makers](https://www.electronforge.io/config/makers)

## Renderer and IPC security

The BrowserWindow explicitly uses `nodeIntegration: false`,
`contextIsolation: true`, and `sandbox: true`. The renderer is trusted packaged
content with a restrictive CSP, denied permissions, blocked arbitrary
navigation/new windows, and a minimal contextBridge API. Every main-process IPC
handler validates both its input schema and the exact sender frame URL. No IPC
method accepts a raw token, path, command, process argument list, or arbitrary
URL.

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [BrowserWindow options](https://www.electronjs.org/docs/latest/api/structures/browser-window-options)

## Native callback and single instance

The main process acquires `app.requestSingleInstanceLock()` before readiness.
It registers `open-url` synchronously for macOS, prevents default handling, and
accepts only the exact `research-video-clips://oauth/callback` scheme/host/path
with the bounded OAuth query shape. Valid callbacks are queued until the broker
is ready. A `second-instance`/argv path remains for deterministic tests and
future portability. Forge registers the protocol through packager metadata;
deep-link behavior is a packaged-app property on macOS.

- [Electron deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)

## Protected token storage

Refresh-token persistence uses only asynchronous `safeStorage` APIs after app
readiness and availability checks. On macOS this delegates to Keychain and may
prompt. Unavailable or temporarily unavailable protection leaves the app signed
out; there is no plaintext file, SQLite, environment, or renderer fallback.
Only encrypted bytes and a nonsecret schema version are written to the
main-process-owned session file.

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## Local process supervision

Electron recommends `utilityProcess.fork` for Node child processes. M7 starts
services only after readiness and observes spawn/error/exit events. Restart is
bounded by capped exponential backoff and a finite failure budget. Controlled
quit first requests the authenticated M6 drain endpoint, polls bounded
quiescence, and terminates children only after safe stop or an explicitly
recorded timeout. Quit events are not treated as a reliable OS shutdown/logout
hook.

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)
