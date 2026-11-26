# M7-03 — Terminal-free first run, tools, model, and readiness

- Status: completed 2026-08-23
- Milestone: M7 local desktop completion and personal validation
- Dependencies: M6-02 roots/locators, M6-04 storage preflight, M6-07 drain/quiescence,
  and M7-02 Electron supervision are complete. M7-01 local implementation is
  present; its production AWS acceptance remains an explicit external blocker.

## User-visible outcome

From the locally packaged Intel macOS application, a signed-in user can complete
guided first-run setup for project access, local roots, source rights/privacy,
provider choices, worker enablement, and cloud-translation consent without
editing `.env` or using Terminal. The application detects or lets the user
choose FFmpeg, FFprobe, yt-dlp, and whisper-cli through native dialogs, validates
them before activation, and lets the user select or securely download the pinned
Whisper model. A closed readiness report explains which exact operations are
ready, blocked, degraded, or need action without globally disabling cached
review or project logging.

## Smallest end-to-end proof

Launch the packaged app with a disposable app-data root and fixture authentication.
Complete the setup flow, choose contained fixture tools through the typed native
dialog bridge, and activate only binaries whose regular-file identity, version,
and required capabilities validate. Select one checksum-pinned model and also
exercise an interrupted staged download; the valid previous model remains
active. The final readiness view reports cached review/logging as available while
transcription/export are blocked or ready according to their exact dependencies.
Quit and relaunch and prove that non-secret settings and validated references
persist while tokens and raw paths never enter React state or shared diagnostics.

## Affected authority boundaries

- `packages/contracts`: closed `ComponentHealth`, `ReadinessReport`, setup,
  tool/model selection, download-progress, operation, state, and remediation
  vocabularies. Shared/public shapes contain no credentials, command output, or
  unrestricted filesystem paths.
- `apps/desktop`: native open-dialog ownership, validated typed IPC, first-run
  lifecycle, packaged-app compatibility status, and model-download orchestration.
  The renderer receives opaque references and display-safe evidence only.
- `apps/local-agent`: authenticated filesystem/root/tool/model validation,
  executable capability probes through argument arrays, storage/permission
  evidence, app-owned configuration persistence, staged model verification and
  atomic promotion, and readiness derivation inputs.
- `apps/web`: guided setup and actionable operation-specific readiness UI. React
  does not receive OAuth tokens, loopback credentials, arbitrary process access,
  or unrestricted filesystem authority.
- `packages/config` and local persistence: app-owned, backward-compatible
  configuration. Any persistent schema change requires the next ordered local
  migration plus clean/populated migration tests; cloud authority does not move.

## In-scope behavior

1. Define closed component and operation readiness contracts for desktop,
   authentication, API/database, network, roots/permissions/storage, providers,
   workers, FFmpeg/FFprobe, yt-dlp, whisper-cli, and the pinned Whisper model.
2. Derive readiness per operation so project browsing, verified cached review,
   and logging remain usable when unrelated transcription/export dependencies
   are missing. Heavy operations retain measured storage need plus the existing
   2 GiB reserve and the 10 GB recommendation remains guidance, not a global gate.
3. Add a guided first-run flow covering login status, project access/creation,
   output/cache roots, rights/privacy acknowledgement, caption/media/speech
   provider choice, local worker enablement, and explicit server-side cloud-
   translation consent.
4. Detect tools only from a bounded allowlist of known workstation locations.
   Native selection accepts one user-selected candidate at a time. Before saving
   a reference, validate containment policy, non-symlink regular-file identity,
   executable permissions, bounded version output, and tool-specific capability.
   Invoke every probe with an argument array and never execute an unverified path.
5. Keep the prior valid tool/model reference active when replacement validation,
   permission checks, capability probes, or persistence fail. Detect changed or
   missing files on subsequent readiness checks and fail the dependent operation
   closed.
6. Permit model selection only for a regular file matching the configured pinned
   model's exact expected byte size and SHA-256. The download path writes only to
   an app-owned private staging location, reports bounded progress, supports
   cancellation, verifies size/hash before an atomic promotion, and preserves the
   prior model across interruption, mismatch, or promotion failure.
7. Persist only app-owned settings and opaque local references needed across
   relaunch. Do not persist OAuth tokens in SQLite/plaintext or expose local paths,
   secrets, provider output, or commands through renderer state or diagnostics.
8. Surface actionable remediation entirely in-app; ordinary users are never
   instructed to source an environment file, run a command, paste a bearer
   credential, or call an API.

## Failure states

- Authentication/cloud/API unavailable: cached authorized reads remain honest;
  online project mutations and cloud-dependent readiness fail closed with retry.
- A root is missing, replaced, unwritable, outside the approved boundary, or low
  on space: only dependent writes/heavy work are blocked; no data is deleted.
- A binary is missing, linked, changed, non-regular, non-executable,
  capability-incomplete, or returns malformed/oversized version output: reject
  it before activation and preserve the previous valid reference.
- A selected model has the wrong size/hash, changes after validation, or is
  outside the accepted local-file boundary: reject it without changing the
  active model.
- Download is canceled, interrupted, redirected outside policy, oversized,
  checksum-invalid, or cannot promote atomically: remove only the verified
  app-owned staging target and preserve the previous model.
- Worker/provider is disabled or unhealthy: report the exact dependent
  operations as blocked/degraded without starting work or masking the state.
- IPC payload, sender, or selection result is invalid: reject it without
  filesystem/process access or configuration mutation.

## Explicit non-goals

- M7-04 arbitrary-video transcript hydration or automatic transcript execution.
- M7-05 automatic logged/export-only processing or source-rights execution UI.
- Closing M7-01 production deployment without the missing AWS/Cognito inputs.
- Portable or signed dependency/model packs, installers, signing/notarization,
  updates, support bundles, feedback/reporting, remote testers, or any M8 work.
- Bundling or inventing model URLs, sizes, SHA-256 values, credentials, account
  identifiers, domains, certificates, or provider capabilities.
- Replacing the cloud catalog, object store, SQLite cache/outbox, M5/M6 worker,
  export, cleanup, artifact, locator, or quiescence authority.

## Acceptance criteria

1. Exactly one typed, sender-validated preload/IPC path owns native root/tool/model
   selection and model-download actions; the renderer remains sandboxed,
   context-isolated, token-free, path-authority-free, and Node-free.
2. Tool candidates are detected/selected only through bounded paths and become
   active only after regular-file, identity, version, and capability validation.
3. The pinned model becomes active only after exact size/SHA-256 verification and
   atomic promotion; cancellation/mismatch/promotion failure preserves the prior
   version and leaves no ambiguous partial activation.
4. First-run settings persist safely across packaged-app relaunch and no ordinary
   setup step requires `.env`, Terminal, a development credential, or manual API.
5. `ComponentHealth` and `ReadinessReport` use closed component, operation,
   state, reason, and remediation vocabularies and block only dependent work.
6. Missing/cloud/tool/model/permission/storage/worker/provider states are
   actionable in the UI and do not fabricate readiness, transcript data, or
   provider success.
7. Clean and populated local databases migrate safely if persistence changes;
   cloud migrations and authority remain unchanged unless a separately justified
   shared-schema requirement is discovered.
8. Focused tests, formatting, typecheck, relevant unit/integration suites, web
   and desktop builds, x64 package inspection/manual UI checks, migration gates,
   `git diff --check`, aggregate `npm run check`, and independent Terra review
   have no unresolved M7 integrity/security blocker.

## Narrow tests first

- Closed contract parsing and operation-specific readiness-decision matrices.
- Executable path/identity/permission/version/capability validation, including
  symlink, replacement-race, malformed output, timeout, cancellation, and prior-
  valid preservation cases.
- Model selection and staged download tests for size/hash, cancellation,
  interruption, atomic promotion, cleanup containment, and previous-version
  preservation.
- Native dialog/IPC sender and schema validation tests.
- First-run persistence/relaunch and token/path leakage tests.
- Packaged x64 smoke for the critical setup/readiness interaction.

## External inputs and closure boundary

Implementation may define a fail-closed pinned-model configuration contract, but
it must not invent the production model URL, expected byte size, or SHA-256. If
those values are absent, model selection can be fully implemented and model
download remains honestly `configuration_required`. M7-03 can close only if its
claimed download behavior is proven against an explicitly configured deterministic
fixture; the final real-model activation remains a recorded M7 prerequisite until
the approved production pin is supplied.

## Completion record

### Decisions and delivered behavior

- Added strict, path-free `ComponentHealth`, `ReadinessReport`, setup,
  component-reference, and model-progress contracts. The renderer receives no
  raw path, command, token, credential, or unrestricted IPC authority.
- Added local migration `0028` and a repository that preserves validated
  candidates separately, activates atomically, and supersedes a prior valid
  reference only after successful validation.
- Added canonical writable-root probes and bounded argument-array capability
  probes for FFmpeg, FFprobe, yt-dlp, and whisper-cli. Tool identity and SHA-256
  are revalidated before runtime use.
- Added Finder-owned native selection and a checksum-pinned HTTPS model
  downloader with private staging, exact byte/SHA-256 verification, atomic
  promotion, progress, pre-promotion cancellation, and prior-version
  preservation. Atomic promotion is deliberately non-cancelable.
- Added terminal-free project/setup UI for sign-in, project access/creation,
  rights/privacy, providers, worker preference, translation consent, roots,
  tools, model, and operation-specific readiness.
- Kept private runtime paths behind a separate per-launch main-to-agent secret.
  Generic renderer requests cannot reach native selection, model activation, or
  trusted runtime configuration, including traversal-spelled paths.
- Split cache/output capacity evidence. Transcription scratch uses the selected
  cache filesystem; export acquisition/group scratch, render staging, capacity,
  promotion, cancellation, recovery, and locator ownership use the selected
  output filesystem. Known pending export output plus promotion bytes are
  measured separately. The 2 GiB reserve is a hard floor; 10 GiB remains an
  advisory degraded state rather than a global block.
- Kept export-worker readiness explicitly unavailable for M7-05. No fixture
  transcript or alternate in-memory executor was introduced.

### Changed boundaries

- `packages/contracts` and `packages/db-local`: closed public contracts,
  migration `0028`, atomic local setup/reference persistence, and tests.
- `apps/local-agent`: trusted setup validation/readiness service, authenticated
  private setup routes, persisted-runtime composition, coherent export roots,
  and real FFmpeg custom-root regression coverage.
- `apps/desktop`: typed preload/IPC, native dialogs, setup/runtime restart
  policy, verified model download, worker configuration, and readiness merge.
- `apps/web`: first-run setup/readiness UI and typed client bridge.
- `docs/research/M7-03-electron-tool-and-whisper-model-readiness.md`: consulted
  primary Electron, FFmpeg, yt-dlp, and whisper.cpp sources plus version-sensitive
  implementation constraints.

### Verification evidence

- Focused post-review matrix: 164 tests passed across 12 files; final policy and
  setup recheck passed 11 tests. Independent Terra review reported no P0/P1.
- Final aggregate command
  `npx vitest run --exclude tests/e2e/** --maxWorkers=1 --testTimeout=60000`:
  49 files passed, 1 opt-in file skipped; 453 tests passed, 4 skipped. A standard
  15-second run had one unchanged PGlite catalog timeout; that exact test passed
  alone in 2.4 seconds. Earlier isolated PGlite timeouts likewise passed alone.
- `npm run typecheck`, `npm run build:web`, `npm run build:desktop`, scoped
  Prettier, and `git diff --check` passed.
- Local migration gate: 28 migrations newly applied. Cloud migration gate: 22
  migrations newly applied; no cloud schema changed.
- `npm run format:check` is blocked only by pre-existing user-owned
  `docs/Script-to-Resolve Product Spec.md`; it was preserved and not formatted.
  All M7-03 source, test, and Markdown files passed scoped Prettier.
- `npm run desktop:package:x64` passed. The final executable is Mach-O x86_64;
  bundle ID `com.researchvideoclips.desktop`, version `0.1.0`, intentionally
  unsigned. Final `app.asar` SHA-256:
  `ed69eb016733065c0e2b5730fc0d25ac2f9d55132ee9c89f1db0673cdf62b430`.
- Manual packaged launch used disposable profile
  `/tmp/rvc-m7-03-proof.wm2fwR`. Process arguments and `lsof` confirmed that
  Chromium and local SQLite used only that profile. The sandboxed UI rendered
  sign-in/project, rights/privacy, providers/worker, root/tool/model selection,
  and honest disabled model activation without a configured pin.
- After the smoke, the app quit cleanly and the two disposable profile roots
  plus three screenshots were moved from `/private/tmp` to the current user's
  Trash. They are recoverable until Trash is emptied; no app database, model,
  export, credential, or user-owned data was deleted.

### Review findings and remaining prerequisites

Independent Terra reviews drove closure of translation-consent runtime restart,
selected export-root execution, model cancellation/promotion atomicity,
canonical private-route enforcement, and separate cache/output scratch and
capacity ownership. No P0/P1 remains.

M7-03 is complete without inventing external values. Real Cognito/project access
remains blocked on the recorded M7-01 AWS inputs and deployment authority. Real
model selection/download remains blocked on an approved immutable HTTPS model
URL, exact byte size, and 64-hex SHA-256. M7-04 must supply arbitrary-video
transcript integration and M7-05 must supply continuous export-worker execution;
neither is claimed here.

### Commits

- Implementation, tests, and migration: `7295b73`
- Completion documentation: recorded by the documentation commit that moves
  this spec to `specs/completed/`.
