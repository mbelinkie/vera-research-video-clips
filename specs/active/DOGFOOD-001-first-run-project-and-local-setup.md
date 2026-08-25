# DOGFOOD-001 — First-run project creation and local setup

## User-visible outcome

After completing Cognito sign-in in the packaged desktop app, a first-time
invited user can establish an application profile, create and select their
first project, and persist the rights/privacy/local-worker checkboxes without a
development credential or terminal. The same first-run surface offers one
guided **Set up this Mac** action that proposes safe local folders, discovers
the compatible installed media/transcription tools through closed native
candidates, and explains the separately confirmed approved Whisper model
download without requiring Finder navigation into Homebrew Cellar directories.

## Confirmed reproduction

- The packaged app reports Cognito `signed_in`.
- `GET /api/session/profile` and `GET /api/projects` both return `404` with
  `User is not registered.` because the desktop flow never invokes the existing
  authenticated `/api/session/register` boundary.
- The supervised local agent reaches `unexpected_exit` restart exhaustion, so
  setup checkbox actions fail with `Desktop setup service is unavailable.`
- Checkbox input events themselves are live; the controlled value rolls back
  only after the failed desktop IPC action.

## Affected boundaries

- Desktop Cognito-to-application-profile onboarding.
- Web session/profile/project initialization and first-project controls.
- Electron local-agent startup/supervision and desktop setup IPC.
- Native recommended-root creation, canonical tool discovery/validation, and
  approved-model pin/download orchestration.
- Capability-oriented setup/readiness presentation with the existing manual
  selectors retained under Advanced setup.
- Packaged desktop build and focused browser/desktop regression coverage.

## Non-goals

- No production AWS topology change or additional AWS resources.
- No hosted transcription-worker enablement.
- No weakening of Cognito verification, project authorization, renderer IPC,
  loopback authentication, or local setup validation.
- No redesign of project governance or account-profile editing.
- No Homebrew/package-manager mutation, arbitrary PATH/filesystem search,
  portable dependency/model pack, signing/notarization, updater, or M8 work.

## Failure states

- A valid Cognito session with no catalog user must enter an explicit bounded
  onboarding state rather than appearing connected but unusable.
- Registration failure must remain visible and retryable without fabricating a
  project or profile.
- A local-agent launch failure must not make controls appear to save; the app
  must expose actionable service state and recover after the launch defect is
  corrected.
- Repeated registration or project creation must remain idempotent/concurrency
  safe through the existing catalog boundaries.
- Broken/out-of-policy symlinks, replacement races, incompatible probes, folder
  creation failures, and model mismatch/cancellation preserve every prior
  validated component and expose one bounded recovery action.

## Acceptance criteria

1. A newly authenticated Cognito subject can create its catalog profile through
   the desktop UI using the existing authenticated register route.
2. After profile registration, project listing works and the same user can
   create/select a personal or shared project.
3. Existing registered users continue directly to their profile/projects.
4. The packaged local agent reaches healthy state and desktop setup checkbox
   changes persist across a renderer/app restart.
5. No token, Cognito callback value, local path, or transcript content is added
   to renderer-visible errors or logs.
6. **Set up this Mac** shows path-free proposed folder labels, detected safe
   tool names/versions, the approved model name/size, and enabled outcomes before
   one explicit local activation confirmation.
7. Confirmation creates only the approved roots and activates only canonical
   regular tool files after exact identity/hash/capability validation; the four
   current Intel Homebrew tools require no manual hidden-directory selection.
8. The production desktop configuration includes an immutable, documented
   `ggml-large-v3-turbo.bin` pin with exact bytes and independently verified
   SHA-256. Download remains an explicit progress/cancel/verify action that
   preserves the prior model.
9. Primary readiness says **Browse and log research**, **Review transcripts**,
   **Create transcripts**, and **Export clips**. Component replacement remains
   available under **Advanced setup**, and setup persists across relaunch.

## Narrow verification first

- Focused web tests for unregistered-session onboarding, registration retry,
  existing-user loading, and first-project creation.
- Focused desktop/local-agent startup and IPC tests covering the confirmed
  packaged launch cause.
- Typecheck and focused Vitest files.
- Rebuild/package the Intel macOS app, launch it against the current protected
  Cognito session, verify local-agent health, register the user, create/select a
  first project, toggle a setup checkbox, and restart to verify persistence.
- Focused discovery/root tests for deterministic Intel/Apple-Silicon/app-owned
  candidates, safe symlink canonicalization, races, prior-state preservation,
  setup confirmation, path-free contracts, and restart persistence.
- Focused build/config tests for complete/partial/invalid production model pin,
  then model download regression tests and the packaged one-click setup flow.
