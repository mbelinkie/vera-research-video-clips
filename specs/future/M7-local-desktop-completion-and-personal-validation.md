# M7 — Local desktop completion and personal validation

Status: future milestone specification. Begin only after Milestone 6. Execute
the six slices below sequentially with exactly one bounded specification in
`specs/active/` at a time.

## User-visible outcome

The owner can launch a locally built **Research Video Clips.app** from Finder or
the Dock on the current Intel Mac, sign in to the real service, complete guided
setup, and use every supported research, transcription, translation, logging,
Clip Library, and export capability without opening Terminal, launching a
service manually, pasting a development credential, or calling an API by hand.

M7 includes personal dogfood and defect iteration. It does not claim that the
app can yet be installed on another computer or updated automatically.

## Supported M7 profile

- Current workstation: Intel (`x86_64`) Mac running macOS 15.
- Artifact: locally built, unsigned and unnotarized Electron x64 `.app`.
- Installation: developer-assisted build/copy is allowed; ordinary launch,
  setup, use, quit, and relaunch afterward are terminal-free.
- Backend: the real CloudFormation-managed AWS control plane and Cognito login
  that M8 testers will later use. PGlite remains test-only.
- Processing: supervised local transcription and export workers.
- Existing FFmpeg/FFprobe, yt-dlp, and whisper-cli may be detected or selected
  through the UI after version/capability validation.
- The pinned Whisper model can be selected or downloaded in-app and is
  checksum-verified before activation.
- Amazon Translate runs only through the authenticated project API after an
  explicit disclosure and opt-in.
- Storage guidance remains a 10 GB recommendation. Heavy operations preflight
  measured need plus a 2 GB reserve; low space does not globally disable
  browsing, cached transcript review, or clip logging.

## Architecture and authority

M7 adds lifecycle, authentication, local supervision, setup, and readiness
authority through `apps/desktop`. It does not move project, transcript, clip,
export, or artifact ownership:

- The cloud catalog remains authoritative for membership, projects, transcript
  manifests, batches/jobs, clips, presets, and immutable artifact history.
- Private object storage remains authoritative for shared transcript bytes.
- Local SQLite remains the verified cache, local queue/process history,
  workstation locator store, and offline outbox.
- The local agent retains filesystem/tool authority behind authenticated
  loopback APIs. The renderer receives no Node, filesystem, tool, token, or
  arbitrary IPC access.
- Local workers continue to use the existing lease, progress, cancellation,
  cleanup, and immutable result contracts.

## Sequential bounded slices

### 1. Production cloud deployment and Cognito authentication

- Add the real PostgreSQL production adapter and backward-compatible cloud
  migrations while retaining PGlite for deterministic tests.
- Provision ECS Fargate, private RDS PostgreSQL, versioned private S3, SQS/DLQs,
  Cognito, ACM/TLS, Secrets Manager, backups, alarms, and least-privilege roles
  through production CloudFormation parameters.
- Implement Cognito managed-login authorization code with S256 PKCE, state and
  verifier validation, `research-video-clips://oauth/callback`, refresh,
  project authorization, and sign-out.
- Move Amazon Translate behind the authenticated project API and ECS task role.
  Users receive no AWS credentials; transcript text leaves the workstation only
  after explicit opt-in.

### 2. Local Intel Mac Electron application and service supervision

- Add `apps/desktop` with Electron 43.4.1 and Forge 7.11.2 and package the
  production web build as trusted local renderer content.
- Enable renderer sandboxing and context isolation, disable Node integration,
  apply restrictive CSP, validate every IPC message, and expose only a minimal
  typed preload bridge.
- Keep OAuth tokens out of React state. Store refresh tokens and protected local
  secrets with asynchronous Keychain-backed `safeStorage`; SQLite stores opaque
  references only and protected-storage failure leaves no plaintext session.
- Retain the loopback local-agent boundary with a random per-launch session and
  strict origins. Proxy cloud requests after the desktop broker injects the
  access token.
- Supervise local-agent, transcription-worker, and export-worker utility
  processes with bounded restart/backoff, health reporting, M6 drain/
  quiescence, and graceful app shutdown.
- Enforce a single app instance and safe OAuth callback/deep-link routing.
- Produce a local Intel macOS `.app` that can be copied into Applications and
  launched from Finder/Dock. Do not sign, notarize, publish, or add updates.

### 3. Terminal-free first run, tools, model, and readiness

- Guide sign-in, project creation/access, output/cache roots, rights and privacy
  acknowledgement, worker enablement, provider choices, and explicit cloud-
  translation consent.
- Detect the current installed FFmpeg/FFprobe, yt-dlp, and whisper-cli using
  bounded known locations; permit Finder selection when detection fails or a
  different binary is desired.
- Validate every selected executable as a contained regular file and verify
  version/capability before saving an app-owned configuration reference. Never
  execute an unvalidated selection.
- Offer Finder selection or an in-app download for the pinned Whisper model.
  Download into app-owned staging, verify expected byte size and SHA-256, then
  atomically activate; interruption or mismatch leaves the previous model
  untouched.
- Add `ComponentHealth` and `ReadinessReport` covering desktop compatibility,
  authentication, API/database, worker registration, providers, network,
  permissions, roots, free space, tools, and model.
- A missing component blocks only dependent operations and provides an in-app
  remediation; it never asks the ordinary user to edit `.env` or run a command.

### 4. Complete transcript workflow integration

- Replace the two hard-coded fixture transcript sources in the research
  workspace with the existing project-authorized shared-first resolver and
  verified local transcript cache for every supported loaded video.
- Preserve fixtures only for deterministic tests and explicit demo/QA modes;
  never substitute fixture text for an arbitrary source.
- Connect immediate and batch review to automatically supervised caption
  discovery, authorized audio acquisition, Whisper transcription, conditional
  translation, staging/finalize publication, local verification/cache, and
  `Ready for review`.
- Hydrate original, canonical English, and verified preferred-language tracks
  into transcript navigation, search, selection, and paired views while
  retaining exact timing/provenance.
- Show durable per-item stage/progress, pause/resume, cancel-unstarted or
  cooperative cancellation, retry, and actionable `needs_*`/failure states.
- A resolved ready video opens directly into the real selectable transcript;
  no separate worker command, object-store credential, or browser credential is
  required.

### 5. Complete export workflow integration

- Automatically register and heartbeat the local export worker after login and
  readiness. Stop claims on sign-out, lost authorization, drain, or incompatible
  capability state.
- Continuously claim/accept/process eligible logged work through the existing
  M5 delivery/execution/result contracts and automatically process persisted
  export-only requests through the established local executor.
- Move source-rights confirmation into the UI and snapshot it for the exact
  request/attempt. A denied or absent confirmation performs no acquisition.
- Remove normal reliance on manual worker registration/heartbeat, delivery
  claim/process `curl`, and `export:run-once` commands.
- Preserve all three selection actions, conversion presets/overrides,
  individual and batch Clip Library requests, progress, safe cancellation,
  immutable retry/re-export, same-source grouping, cleanup recovery, artifact
  verification, reveal/open, relink, and authoring handoff.
- Surface every terminal/actionable state and keep queued/logged research useful
  when a provider, tool, network, or export capability is unavailable.

### 6. Personal dogfood, defect fixes, and M7 decision

- Install the local `.app` and execute fixture-backed plus explicitly authorized
  real English and foreign-language workflows against the real cloud.
- Exercise project creation, immediate and batch transcription, preferred-
  language review, all three selection actions, Clip Library individual/batch
  export, presets, artifact actions, re-export, and restart persistence.
- Seed and recover from network/cloud/provider failure, missing/incompatible
  tool or model, permission denial, low disk, application restart, worker crash,
  and cleanup-required states.
- Fix and retest every defect that blocks the normal supported workflow. Record
  accepted nonblocking personal-dogfood findings in the pilot punch list for M8
  or M9 as appropriate.
- Retain the exact local build identity, cloud environment, tests, real-source
  authorization evidence, cleanup evidence, residual risks, and M7 decision.

## Shared interfaces

Add only the desktop/local-completion contracts needed in M7:

- `ComponentHealth` and `ReadinessReport` with closed component, operation,
  state, and remediation vocabularies.
- Typed preload messages for authentication state/actions, readiness, approved
  root/tool/model selection, model download progress, and app lifecycle.
- A protected desktop-session boundary that supplies the per-launch loopback
  credential and cloud access token without exposing either to React.
- Typed transcript-workspace load/progress results that compose the existing
  transcript, batch, and job contracts rather than duplicating them.

`BuildIdentity` may expose a minimal local version/commit for dogfood evidence,
but release channels, `UpdateState`, signed `ReleasePolicy`,
`SupportBundleManifest`, and feedback-report contracts belong to M8.

## Failure states

- Cloud/API or Cognito is unavailable: retain verified cached browsing and local
  artifact reads, block unauthorized mutations, and explain retry.
- Keychain/safeStorage fails: persist no token or plaintext fallback and leave a
  clean signed-out state.
- A supervised service crashes: bound restart attempts, preserve durable work,
  show component health, and never hide cleanup-required state.
- A selected tool/model is missing, changed, incompatible, or checksum-invalid:
  reject it before execution and preserve the prior valid configuration.
- Transcript work completes but cannot hydrate the workspace: retain the ready
  catalog/cache evidence and expose a retryable integration failure; never fall
  back to fixture text.
- Authorization is absent for source acquisition: leave work actionable without
  invoking yt-dlp.
- App quit begins while media work is active: consume drain/quiescence and wait
  or explain the blocker; never abandon a child/source lifecycle silently.

## Acceptance gate

1. The locally built Intel macOS `.app` launches from Finder/Dock and reaches a
   real Cognito session without a terminal or pasted development bearer value.
2. First run configures roots, providers, binaries, model, rights, and consent
   entirely in-app and reports operation-specific readiness honestly.
3. An arbitrary authorized English source and one foreign-language source reach
   real selectable transcripts through the supervised pipeline and preserve
   original/English/preferred provenance.
4. Immediate and batch work show durable progress/recovery and require no
   separately launched transcription worker.
5. Queue/log only, Export + log, and Export only behave through their established
   boundaries; logged and projectless exports execute without manual API or
   one-shot commands.
6. Clip Library individual/batch export, retry/cancel, artifact history,
   verify/reveal/open/relink, and immutable re-export all work in the app.
7. Quit/relaunch, worker crash, network/provider degradation, and low-space
   cases preserve durable work and leave no full source media after terminal
   cleanup.
8. Normal supported use requires no Terminal, manual service launch,
   development credential, `.env` editing, AWS console, or manual API call.

## Verification plan when activated

- Unit/integration tests for Cognito PKCE, safeStorage failure, IPC validation,
  process supervision, readiness decisions, tool/model validation/download,
  transcript hydration, automatic workers, and rights confirmation.
- Packaged Electron E2E on the current Intel Mac for first run, sign-in,
  arbitrary transcript review, all three actions, Clip Library, automatic
  processing, quit/relaunch, and degraded states.
- Existing contract, database, transcript, export, cleanup, browser, and
  migration gates remain green.
- Fixture-backed real FFmpeg/FFprobe/Whisper checks plus separately authorized
  real-source English and foreign-language dogfood evidence.

## External prerequisites

Implementation requires approved production AWS/Cognito/TLS configuration and
the pinned model download source/checksum. It does not require Apple Developer
ID, notarization, Azure Trusted Signing, public GitHub Releases, a GitHub App,
the feedback repository, or independent tester machines; those are M8 inputs.

## Explicit non-goals

- Signing, notarization, installers, automatic updates, rollback installers,
  public releases, macOS Universal, Windows, Linux, or app stores.
- Public/offline operator documentation, support bundles, in-app issue delivery,
  tester identities/kits, or independent release QA.
- Cloud export workers, cloud clip storage, or new M9 research features.
