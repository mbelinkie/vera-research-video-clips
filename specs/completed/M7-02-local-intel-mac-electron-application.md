# M7-02 — Local Intel Mac Electron application and supervision

- Status: completed 2026-08-23
- Milestone: M7 local desktop completion and personal validation
- Dependencies: M6 drain/quiescence is complete; M7-01 local implementation is
  present, while its real AWS acceptance remains explicitly blocked

## User-visible outcome

The current Intel Mac can build and launch an unsigned, unnotarized **Research
Video Clips** `.app` from Finder or the Dock. The Electron main process owns
Cognito login/token refresh/sign-out, a random per-launch loopback session, and
bounded supervision of the local agent and transcription worker. The packaged
renderer receives neither OAuth tokens nor Node/filesystem/process authority.

## Smallest end-to-end proof

Package the trusted Vite renderer into an x64 Electron app, launch it without a
Terminal-owned service, complete a fixture-backed broker callback/token cycle,
start the local agent under a random launch session, load the renderer through
the trusted packaged protocol, exercise validated bridge status/sign-in/
sign-out calls, request M6 drain on quit, observe quiescence, and terminate all
children cleanly. Relaunch proves single-instance and protected-session restore
behavior without exposing token material.

## Affected authority boundaries

- `apps/desktop`: Electron lifecycle, protocol callback, authentication broker,
  safeStorage adapter, typed preload bridge, IPC validation, CSP, supervision,
  and packaging.
- `apps/local-agent`: strict per-launch session and Origin enforcement, dynamic
  loopback-port reporting, health, and M6 drain/quiescence.
- `apps/worker`: supervised process configuration and graceful drain/exit.
- `apps/web`: desktop bridge/session bootstrap without bearer credentials in
  React state, storage, URL, or logs.
- Root build/package scripts and Forge metadata for local macOS x64 only.

## Failure states

- `safeStorage`/Keychain is unavailable: remain signed out and retain no
  plaintext token fallback.
- Callback scheme/path/state/verifier is invalid or replayed: reject it and
  retain no partial session.
- A renderer/navigation/IPC origin is not the exact trusted app origin: deny it.
- Local-agent/worker spawn or health fails: expose bounded unhealthy state and
  restart with capped exponential backoff; do not restart forever.
- Quit begins while work is active: stop new claims, request drain, poll bounded
  quiescence, and never claim a graceful stop while source cleanup is unsafe.
- A child exceeds the bounded graceful-shutdown window: terminate it and record
  the failed shutdown without leaking paths, tokens, or research content.

## Explicit non-goals

- M7-03 first-run provider/tool/model setup or readiness UI.
- M7-04 arbitrary-video transcript hydration and automatic processing UX.
- M7-05 automatic logged/export-only work loops and rights UI.
- Signing, notarization, DMG/public installers, updates, release publication,
  Universal/Windows builds, support bundles, or M8 release infrastructure.
- Inventing production Cognito/AWS values or claiming real login without them.

## Acceptance criteria

1. Electron 43.4.1 and Forge 7.11.2 are pinned; local x64 packaging produces an
   unsigned `.app` containing only required runtime and trusted renderer assets.
2. BrowserWindow is sandboxed/context-isolated with Node integration disabled,
   restrictive CSP, denied permissions/navigation, and exact sender validation.
3. Single-instance and exact `research-video-clips://oauth/callback` routing are
   tested for cold/warm/replay/malformed cases.
4. OAuth tokens stay in the main-process broker. Refresh-token ciphertext uses
   asynchronous `safeStorage`; no plaintext fallback, renderer persistence, URL,
   log, SQLite token, or arbitrary token-bearing IPC exists.
5. A high-entropy per-launch secret authenticates the loopback renderer/agent
   boundary; strict origins and a brokered cloud proxy prevent direct renderer
   bearer access.
6. Local services use bounded supervision/backoff and M6 drain/quiescence on
   controlled quit. Crashes and unsafe shutdown are surfaced honestly.
7. Focused tests, typecheck, web/desktop builds, x64 package inspection,
   packaged launch smoke, formatting, `git diff --check`, and relevant existing
   suites pass; independent Terra review has no unresolved P0/P1.

## Narrow tests first

- Authentication broker/safeStorage failure and token-isolation unit tests.
- Callback parser/single-instance queue/replay tests.
- Preload IPC sender/schema and navigation/CSP policy tests.
- Supervisor restart/backoff/drain/quiescence/forced-stop tests.
- Local-agent launch-session/origin/cloud-proxy tests.
- Forge configuration and packaged `.app` inventory/launch smoke on macOS x64.

## Completion record

### Decisions and delivered boundaries

- Electron owns the `rvc://app` renderer protocol, native OAuth callbacks,
  Keychain-backed refresh-token ciphertext, cloud credential injection, and
  supervision. React receives only a closed status/request bridge and never a
  bearer, launch secret, filesystem path, or process primitive.
- The local agent binds its own ephemeral IPv4 loopback port and reports it over
  private utility-process IPC. A 256-bit per-launch secret plus the exact trusted
  origin protects every non-health route; crash and failed-readiness paths clear
  the endpoint before it can be reused.
- The transcription worker receives only the launch secret and a loopback proxy
  origin. The proxy obtains a fresh Cognito access token per request. Export
  execution remains inside the supervised local-agent process, matching the M6
  runtime boundary.
- Remote YouTube code runs only in a sandboxed cross-origin iframe. The
  preload-bearing renderer executes local scripts only.

### Files changed

- Added `apps/desktop`, its authentication, preload/IPC, credential proxy,
  endpoint registry, supervision, runtime configuration, and focused tests.
- Added the x64 Forge/build configuration and desktop packaging boundary test.
- Hardened the local agent for authenticated desktop sessions and dynamic port
  reporting; configured the worker for the credential proxy.
- Replaced renderer fetches with the token-free desktop bridge while retaining
  explicit browser-development behavior, and isolated the YouTube player.
- Added closed desktop contracts and desktop runtime-role configuration.

### Verification evidence

- `npm run test`: 46 files passed, 1 skipped; 427 tests passed, 4 skipped.
- `npm run typecheck`: passed.
- `npm run build:web`: passed (106 modules transformed).
- `npm run db:migrate:local:test`: 27 migrations newly applied.
- `npm run db:migrate:cloud:test`: 22 migrations newly applied.
- Scoped `prettier --check` over every M7-02 file: passed.
- `git diff --check` and staged `git diff --cached --check`: passed.
- `npm run desktop:package:x64`: produced an unsigned x86_64 Mach-O `.app` with
  the exact `research-video-clips` callback scheme and a 41-entry ASAR.
- Packaged launch smoke: `rvc://app/index.html`, exact four-method preload
  bridge, no development credential, no remote top-frame scripts, one isolated
  YouTube iframe, healthy local agent, 401 for unauthenticated loopback access,
  one main process after a second launch, and clean main/helper shutdown.
- Independent Terra review: no unresolved P0/P1 findings.

### Remaining risks and follow-ups

- The real Cognito/TLS configuration and AWS change-set acceptance from M7-01
  remain external prerequisites. Without those values the app honestly reports
  `configuration_required`; no real managed-login success is claimed here.
- The artifact is intentionally unsigned, unnotarized, x64-only, and local to
  this workstation. Signing, notarization, updates, and distribution remain M8.
- M7-03 first-run/tool/model readiness, M7-04 arbitrary-video hydration, and
  M7-05 automatic export integration remain unstarted.

### Implementation commit

- `865b9e0` — `feat: add local Intel Electron application`
