# M7 local desktop and M8 pilot distribution boundary

Date: 2026-08-23

## Context

Milestones 1–6 prove the browser/local-agent research, transcript, export, Clip
Library, artifact, authoring-handoff, restart, and quiescence boundaries. The
previous M7 plan combined two different outcomes:

1. make the complete application usable on the owner's current Mac without a
   terminal or manual service/API operation; and
2. package, update, document, support, and independently validate the software
   for remote macOS and Windows testers.

Combining them delayed personal product testing until signing identities,
cross-platform packaging, public releases, reporting infrastructure,
documentation, and three-profile QA were all ready. It also obscured product
integration gaps recorded in `LOCAL_STARTUP_AND_TESTING.md`: fixture-only
transcript hydration, development credentials, separately launched workers,
manual logged-export claim/process calls, and one-shot export execution.

## Decision

### Milestone boundary

- **M7 — Local desktop completion and personal validation** delivers the full
  real workflow on the current Intel Mac running macOS 15 through a locally
  built, unsigned and unnotarized Electron `.app`.
- **M8 — Signed cross-platform pilot distribution and independent QA** turns the
  M7-validated application into signed, self-updating macOS Universal and
  Windows x64 releases for remote testers.
- **M9 — Research and capacity enhancements** inherits the former M8 backlog
  without expanding it.

### M7 desktop and backend

Use Electron 43.4.1 and Electron Forge 7.11.2 for the local desktop. The M7 app
owns lifecycle, Cognito authentication, protected secrets, guided setup,
component readiness, and supervision of the local agent plus transcription and
export workers. The renderer remains sandboxed and context-isolated with no
Node integration, filesystem/tool/token access, or arbitrary IPC.

M7 uses the real CloudFormation-managed ECS Fargate/RDS PostgreSQL/S3/SQS/
Cognito/TLS control plane that M8 testers will later use. PGlite remains a test
substitute, not a disposable personal backend. Cognito uses authorization-code
grant with S256 PKCE, no client secret, and the registered
`research-video-clips://oauth/callback` scheme. Refresh tokens use asynchronous
Keychain-backed `safeStorage`; SQLite contains only opaque references.

M7 closes ordinary Terminal-only and fixture-only paths. The app hydrates real
verified project transcripts, automatically supervises transcription and export
workers, moves rights/provider/model setup into the UI, and retains all existing
project/transcript/clip/export/artifact authority.

Existing local FFmpeg/FFprobe, yt-dlp, and whisper-cli may be reused after
in-app validation or Finder selection. The pinned Whisper model may be selected
or downloaded and checksum-verified in-app. Portable signed tool/model packs
belong to M8.

### M8 distribution and support

M8 owns semantic release identity, public GitHub Releases, Developer ID signing
and notarization, Azure Trusted Signing, macOS Universal and Windows x64
artifacts, signed platform tool/model packs, automatic updates, signed minimum-
version policy, checkpoint/recovery/uninstall, version-matched documentation,
support bundles, in-app `bug | feedback | suggestion` delivery, tester
identities/fixtures, and independent three-profile QA.

OPS-01 production observability remains separate and must complete before
external M8 testing. Feedback uses an authenticated SQS-backed outbox and a
least-privilege GitHub App to create one issue in private
`mbelinkie/youtube-clip-converter-feedback`; GitHub Issues remains triage
authority.

### Storage policy

Retain the 10 GB free-space recommendation rather than a global gate.
Transcription, export, application update/checkpoint, and tool/model operations
preflight known input/output plus a 2 GB safety reserve. Unknown-size
acquisition warns first and is rechecked after acquisition. Browsing, cached
transcript review, and clip logging remain available when unrelated heavy work
is blocked.

## Alternatives considered

- **Keep one combined milestone:** preserves the prior numbering but delays
  personal workflow iteration behind unrelated release-engineering prerequisites.
- **M7 development backend:** reaches a desktop sooner but tests a development
  credential/catalog path that M8 must replace before remote use.
- **Fully local M7 backend:** avoids cloud deployment but removes real shared
  project/authentication behavior and introduces a migration path M8 does not
  otherwise need.
- **Signed M7 Mac build:** validates platform trust early but moves a
  remote-distribution concern into the personal dogfood gate.
- **Double-click developer launcher:** hides Terminal without proving the final
  Electron lifecycle, authentication, security, and supervision architecture.

## Consequences

- M7 can close only after real arbitrary-video transcript hydration, automatic
  transcription/export execution, first-run readiness, and personal dogfood
  succeed without manual developer operations.
- Production AWS/Cognito/TLS configuration and a pinned model source/checksum
  are M7 prerequisites.
- Apple/Azure signing, public GitHub release configuration, portable signed
  packs, the feedback GitHub App/repository, tester identities, documentation,
  and independent platform machines move to M8.
- `ComponentHealth` and `ReadinessReport` are M7 contracts. `BuildIdentity`,
  `UpdateState`, signed `ReleasePolicy`, `SupportBundleManifest`, and feedback
  delivery contracts are M8 contracts, except that M7 may expose a minimal
  local version/commit for dogfood evidence.
- M6 drain/quiescence serves the M7 supervisor and later the M8 updater.
- Completed project, transcript, export, and artifact boundaries remain
  unchanged.

## Supersession

This decision supersedes the uncommitted combined planning record formerly
named `M7-electron-pilot-distribution-auth-feedback-and-storage.md`. It changes
milestone ownership and sequencing, not the approved Electron, AWS, Cognito,
privacy, feedback, or storage architecture.

## Adoption commit

Not created by this documentation task; record the eventual commit ID when the
documentation change is committed.
