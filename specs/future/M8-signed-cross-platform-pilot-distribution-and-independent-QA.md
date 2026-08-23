# M8 — Signed cross-platform pilot distribution and independent QA

Status: future milestone specification. Begin only after M7 closes. OPS-01
production observability remains separate and must complete before external M8
testing. Execute the six slices below sequentially with exactly one bounded
specification in `specs/active/` at a time.

## User-visible outcome

A nontechnical remote collaborator can install **Research Video Clips** as a
signed desktop application on macOS 15+ or Windows 11 23H2+, sign in, complete
guided setup, run the M7-validated local-first workflow, receive background
updates, understand recoverable failures, use version-matched help, and submit a
bug, feedback item, or suggestion without source code, a terminal, cloud
credentials, or live developer coaching.

Three independent profiles—macOS Apple Silicon, macOS Intel, and Windows 11
x64—must pass the release matrix before M8 closes.

## Supported pilot profile

- Product name: **Research Video Clips**.
- macOS 15+ on Intel and Apple Silicon as one Universal application.
- Windows 11 23H2+ on x64.
- Hardware baseline: four CPU cores and 16 GB RAM.
- Storage guidance: recommend 10 GB free; do not make it a global hard gate.
  Heavy work uses measured input/output plus a 2 GB safety reserve.
- Processing: registered local workers with signed platform tool/model packs;
  the M7 production cloud and Cognito boundary remains authoritative.
- One pilot release channel with no percentage rollout or app-store delivery.
- An unavailable component blocks only dependent operations; unaffected cached
  research and logging remain usable.

## M7 baseline retained

M8 hardens and distributes the working M7 application. It must not reopen or
fork these M7 decisions:

- The hardened Electron shell, authenticated loopback local agent, Cognito PKCE
  broker, Keychain/DPAPI protected storage boundary, and supervised local
  workers remain the desktop architecture.
- The production ECS/RDS/S3/SQS control plane remains the shared authority.
- Project, transcript, clip, export, artifact, cache, and locator authority
  remains unchanged.
- The arbitrary-video transcript and automatic local transcription/export
  workflows proven in M7 are release-gated behavior, not optional demo paths.
- M6 drain/quiescence is the only safe updater shutdown boundary.

## Sequential bounded slices

### 1. Release identity and portable dependency packs

- Add semantic `BuildIdentity` with version, commit, build time, channel,
  platform, architecture, and tool-manifest version.
- Define the approved semantic-version tag and release-channel rules.
- Produce reproducible build/commit manifests, SHA-256 checksums, SBOM,
  third-party licenses, notices, and release-note inputs.
- Publish signed platform-specific manifests/packs for FFmpeg/FFprobe, yt-dlp
  plus its required JavaScript runtime, whisper.cpp, and the selected model.
- Verify signature, manifest version, size, and SHA-256 before activation; never
  execute an unverified binary or model pack.

### 2. Signed cross-platform packaging and GitHub publication

- Adapt and verify the M7 desktop, local-agent, worker, path, process, credential,
  and artifact-launch behavior for macOS Universal and Windows x64 without
  weakening containment or renderer security.
- Use Electron Forge to produce Developer ID-signed/notarized macOS DMG and
  Universal ZIP update artifacts.
- Produce Azure Trusted Signing-signed Windows Squirrel installer/update assets.
- Add an approved tag release workflow that runs the clean aggregate gate,
  builds both platforms, verifies signatures/notarization on fresh runners,
  generates checksums/manifests/SBOM/licenses/release notes, and publishes the
  public assets to this repository's GitHub Releases page.
- Installation and launch must not require a source checkout, package manager,
  terminal, bypass of normal platform trust, or cloud console.

### 3. Automatic updates, data recovery, reinstall, and removal

- Add `UpdateState = checking | available | downloading | ready | installing |
current | failed` to the header and About screen.
- Check through the public release service at startup, network resume, every
  four hours, and on demand; download in the background and offer restart.
- Install on ordinary quit only after M6 drain/quiescence reports safe stop;
  never terminate active media processing.
- Enforce a minimum version only through a valid Ed25519-signed
  `ReleasePolicy`. Invalid signatures fail closed without forcing an update;
  cached browsing remains available while valid forced-update work drains.
- Keep data outside installed binaries. Before an update, checkpoint SQLite/WAL,
  validate storage/cloud compatibility, migrate and integrity-check a copy,
  atomically promote it, and retain the latest two checkpoints.
- On migration failure, do not start workers against partial data. Offer
  checkpoint restore, diagnostics export, and verified previous-release
  recovery instructions/artifacts.
- Use expand/migrate/contract for cloud compatibility. Add contained
  preserve-by-default reinstall and `Settings → Uninstall / reset`, asking
  separately before removing completed export packages.

### 4. Diagnostics, support bundles, and in-app reporting

- Add plain-language component health and a previewable bounded support-bundle
  ZIP described by `SupportBundleManifest`.
- Add a Help/failure-panel form for `bug | feedback | suggestion`. Require a
  short summary and description; offer bug reproduction, expected/actual, and
  frequency fields.
- Contact is optional and included only with explicit consent. Bug diagnostics
  are default-off, previewed exactly, allowlisted, and limited to 20 KB of
  stages, error codes, component states, and opaque correlation IDs.
- Never include transcript/subtitle text, notes/tags, media, YouTube URLs,
  credentials, headers, tokens, cookies, presigned URLs, object keys, commands/
  output, unrestricted paths, or filenames. Uncertain redaction omits the
  diagnostics attachment without losing the text report.
- Add authenticated create/status feedback APIs with size, consent, build,
  rate-limit, and idempotency validation. Preserve the form and retry timing on
  throttling.
- Deliver one issue per report through an SQS-backed outbox and least-privilege
  GitHub App to private `mbelinkie/youtube-clip-converter-feedback`. Retain only
  status, hashes, and final issue mapping after delivery; GitHub Issues is the
  triage authority.

### 5. Versioned documentation and external QA kit

- Bundle offline, version-matched help and publish the same content on a
  versioned public help site.
- Cover system requirements, install/update/uninstall, first run, rights/
  privacy, providers/tool packs, transcription, all three selection actions,
  Clip Library, storage, recovery, diagnostics/reporting, and known issues.
- Prepare dedicated least-privilege Cognito tester accounts/projects, reset and
  teardown automation, rights-cleared fixtures, one authorized-real-source
  slot, severity rubric, issue/report templates, and evidence requirements.
- Give testers no AWS credentials, production administration, private project
  media, source checkout, or developer workstation access.

### 6. Independent three-profile QA, fixes, and release decision

- Independently execute clean install, N-1-to-N update, first run, core workflow,
  degraded states, diagnostics/reporting, recovery, preserve/remove uninstall,
  and reinstall on macOS Apple Silicon, macOS Intel, and Windows 11 x64.
- Verify signatures, notarization, checksums, installer launch, updater download/
  install, migration/data preservation, and relaunch on clean machines.
- Publish fixes as newer signed pilot releases so testers exercise the real
  updater rather than sideloaded patches.
- Close and retest every critical/high defect. Link each accepted medium/low
  issue from release notes or known issues with its limitation/workaround.
- Retain final artifacts/checksums, documentation version, feedback-repository
  reference, QA evidence, account/project teardown, residual risks, and the
  release decision.

Automated architecture coverage cannot substitute for a missing independent
hardware/OS profile.

## Shared interfaces

Add M8 release/support contracts without changing M7 research authority:

- `BuildIdentity`
- `UpdateState` and signed `ReleasePolicy`
- `SupportBundleManifest`
- `FeedbackKind = bug | feedback | suggestion`
- `CreateFeedbackReportRequest`, `CreateFeedbackReportResponse`, and feedback
  delivery status

Consume M7 `ComponentHealth`/`ReadinessReport` plus M6
`ExportStoragePreflight`, `LocalRuntimeQuiescence`, sanitized
`OperationFailure`, and opaque correlation metadata. Do not duplicate export,
shutdown, health, or readiness semantics in the updater/reporting layers.

## Failure states

- A release, pack, policy signature, or checksum is invalid: reject it; an
  invalid policy never forces an update.
- Current version is below a valid signed minimum: allow cached browsing, stop
  new work, drain existing work, and require update before new claims.
- Update is ready during active media work: explain and wait for quiescence.
- Local migration fails: retain the untouched database, start no workers against
  partial data, and offer checkpoint recovery.
- A required platform component is unavailable: name affected operations and
  leave unrelated research usable.
- Diagnostics contain prohibited or uncertain data: omit the attachment or fail
  support-bundle creation closed without losing report text.
- GitHub delivery is unavailable: retain one queued outbox record and retry with
  the same idempotency identity.
- A required independent profile/case cannot run: keep M8 release-blocked rather
  than substituting CI or maintainer execution.

## Acceptance and release gate

1. Signed installers and update artifacts are reproducible from an approved tag
   for macOS Universal and Windows x64.
2. A clean-machine tester installs, signs in, completes readiness, and runs the
   fixture plus authorized-real-source workflow without developer tools/help.
3. Automatic/manual update checks and install-on-quit preserve durable work.
4. N-1 update, migration recovery, reinstall, and preserve/remove uninstall pass
   without data loss or out-of-scope deletion.
5. Low space blocks only measured heavy operations; lightweight work remains
   available below the recommendation.
6. Each feedback kind reaches private triage exactly once after retries, with
   consent honored and no prohibited diagnostics.
7. Every packaged E2E and contract/integration gate passes.
8. All three independent profiles pass the complete matrix.
9. All critical/high defects are fixed/retested and accepted lower-severity
   issues are documented.
10. Final records include artifacts/checksums, build/help versions, feedback
    repository, QA evidence, teardown, residual risks, and release decision.

## Verification plan when activated

- Unit/integration coverage for build identity, signed manifests/policy, updater
  transitions, checkpoints/restore, uninstall containment, diagnostics
  redaction, feedback idempotency/delivery, and platform abstractions.
- Packaged E2E for clean install, first run, full M7 workflow, worker restart,
  N-1 update, reporting, recovery, and preserve/remove uninstall.
- Fresh-runner and clean-machine verification of signatures, notarization,
  checksums, updater install, data preservation, and relaunch.
- Independent human execution on all three supported profiles.

## External prerequisites

M8 requires Apple Developer ID/notarization credentials, Azure Trusted Signing,
approved GitHub release configuration, signed tool/model asset publication, a
GitHub App, private `mbelinkie/youtube-clip-converter-feedback`, dedicated tester
identities/projects, and three independent platform profiles. This planning
record does not create or imply possession of them.

## Explicit non-goals

- Linux, mobile, app stores, enterprise/silent deployment, or percentage rollout.
- Automatic screenshots or arbitrary in-app report attachments.
- Cloud export workers or cloud storage of completed clip packages.
- New research, editing, scriptwriting, or M9 enhancement features.
- Giving testers AWS credentials, production administration, or private project
  media.
