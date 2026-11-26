# DOC-02 — Split M7 local completion, M8 distribution, and M9 enhancements

Status: completed documentation-only specification.

## User-visible outcome

The durable roadmap separates a terminal-free personal Intel-macOS application
from the later signed cross-platform tester release. Milestone 7 delivers the
complete real workflow on this machine through a locally built Electron app;
Milestone 8 owns remote-tester distribution, updates, documentation, reporting,
and independent QA; Milestone 9 retains the existing enhancement backlog.

## Focused context

Milestones 1–6 are complete. The current M7 plan combines local product
completion with release engineering and external QA. The local startup guide
also records material terminal-only and fixture-only gaps that M7 must close:
development credentials, separately launched services/workers, fixture-only
transcript hydration, manual logged-export claim/process commands, manual
export-only execution, and provider/model configuration outside the app.

## Affected boundaries

- `PROJECT_GUIDE.md` and `outline.md`: authoritative milestone sequencing,
  architecture ownership, gates, and checklists.
- Future milestone specifications: new M7 local-completion specification,
  rewritten M8 distribution specification, OPS prerequisite, and pilot punch
  list milestone ownership.
- Decision and operator documentation: the M7/M8 boundary, M6 handoff consumer,
  and current versus planned terminal-free behavior.

## Decisions fixed for this task

1. M7 targets the current Intel Mac on macOS 15 and produces a locally built,
   unsigned and unnotarized `Research Video Clips.app` that launches from
   Finder/Dock after developer-assisted build/install.
2. M7 deploys and uses the real AWS control plane and Cognito login that M8
   testers will later use; it does not create a disposable local-only backend.
3. M7 owns the Electron shell, Keychain-backed authentication, supervised local
   services/workers, in-app setup/readiness, arbitrary transcript hydration,
   automatic transcription/export execution, and personal dogfood fixes.
4. Existing local FFmpeg/FFprobe, yt-dlp, and whisper-cli binaries may be
   detected and selected in-app. M7 supports in-app selection or checksum-
   verified download of the pinned Whisper model. Portable signed platform tool
   packs remain M8 work.
5. M8 owns semantic releases, GitHub packaging, macOS Universal and Windows x64
   signing, updates/recovery/uninstall, support bundles, bug/feedback reporting,
   public/offline documentation, tester provisioning, and independent QA.
6. OPS-01 remains separate and must complete before external M8 testing.
7. Current M8 research/capacity enhancements become M9 without expansion.
8. Completed implementation specifications remain historical records unless a
   live planning cross-reference must distinguish the M7 supervisor from the M8
   updater.

## Explicit non-goals

- Do not implement Electron, AWS/Cognito, transcript hydration, worker
  supervision, packaging, updates, reporting, or any application behavior.
- Do not add dependencies, migrations, infrastructure resources, credentials,
  signing identities, GitHub releases, tester accounts, or external services.
- Do not mark any M7/M8/M9 implementation item complete.
- Do not modify unrelated product-spec, CLAUDE, or mistakes files already in the
  worktree.

## Failure states

- M7 still requires Terminal commands, a development credential, manual service
  launch, fixture-only transcript data, or manual export/transcription worker
  operation for a supported normal workflow.
- Distribution, signing, updating, documentation, feedback delivery, or
  independent remote QA remains assigned to M7.
- Production cloud/authentication moves to M8, causing the local app to validate
  against a disposable backend.
- Current enhancements remain labeled M8 rather than M9.
- Historical completed specs are rewritten broadly or unrelated worktree edits
  are overwritten.
- Cross-document terminology or milestone numbering diverges.

## Acceptance criteria

1. The guide, outline, and future specs define decision-complete M7, M8, and M9
   milestones with the approved boundaries and explicit gates.
2. M7 has six sequential slices covering production cloud/auth, local Electron,
   terminal-free setup/readiness, transcript integration, export integration,
   and personal dogfood/iteration.
3. M8 has six sequential slices covering release identity, signed cross-platform
   packaging, updates/data lifecycle, diagnostics/reporting, documentation/QA
   kit, and independent release QA.
4. M7 explicitly closes every terminal-only and fixture-only limitation listed
   in `LOCAL_STARTUP_AND_TESTING.md`.
5. `ComponentHealth` and `ReadinessReport` belong to M7; update, release-policy,
   support-bundle, and feedback contracts belong to M8.
6. OPS-01 and pilot punch-list language use the new ownership and sequencing.
7. No application code, dependencies, schemas, infrastructure, or external
   resources change.

## Verification plan

- Run targeted Prettier checks on every changed roadmap file.
- Search authoritative/current planning docs for stale M7 distribution and M8
  enhancement ownership.
- Search M7 for every current terminal/fixture gap and M8 for every requested
  remote-tester concern.
- Run `git diff --check` and review the complete targeted diff.
- Do not run application tests for this documentation-only task.

## Completion record

### Decisions

- M7 is the terminal-free local-completion milestone for the current Intel Mac
  and uses the real AWS/Cognito boundary.
- M8 owns every remote-distribution concern: portable signed dependencies,
  signed macOS Universal and Windows x64 packaging, GitHub Releases, updates,
  recovery/removal, support/reporting, documentation, tester provisioning, and
  independent QA.
- M9 inherits the former M8 research/capacity backlog without expansion.
- M6 quiescence serves the M7 supervisor and M8 updater. OPS-01 must complete
  before external M8 testing.

### Files changed

- `PROJECT_GUIDE.md`
- `outline.md`
- `LOCAL_STARTUP_AND_TESTING.md`
- `specs/future/M6-project-clip-library-and-authoring-handoff.md`
- `specs/future/M7-local-desktop-completion-and-personal-validation.md`
- `specs/future/M8-signed-cross-platform-pilot-distribution-and-independent-QA.md`
- `specs/future/OPS-01-production-observability-and-sentry-pilot.md`
- `specs/future/PILOT-punch-list.md`
- `docs/decisions/M7-M8-local-desktop-and-pilot-distribution-boundary.md`
- This completed specification.

The former combined future M7 spec and combined decision-record filename were
removed and superseded by the M7/M8 files above.

### Checks and actual results

- Targeted `npx prettier --check` passed for all ten roadmap/decision/spec files.
- The stale-ownership search found no old self-updating M7 heading, old M8
  research heading, M7 distribution checklist, or M7 pilot-distribution label
  in the current authoritative/future milestone documents.
- The M7 coverage check found every current gap category: fixtures, development
  credential, manual service/API operation, `export:run-once`, delivery
  claim/process, transcription/export workers, and `.env` setup.
- The M8 coverage check found GitHub Releases, Universal macOS, Windows 11,
  updates, all three feedback kinds, version-matched help, and three-profile QA.
- `git diff --check` passed with no whitespace errors.
- Application tests were not run because this task changed documentation only.

### Remaining risks and follow-ups

- M7, M8, M9, and OPS-01 remain future work and require one active bounded spec
  per implementation slice.
- M7 still requires approved production AWS/Cognito/TLS configuration and a
  pinned Whisper-model source/checksum.
- M8 still requires Apple/Azure signing, GitHub release configuration, signed
  tool/model assets, the feedback GitHub App/repository, tester identities, and
  independent platform access.
- Unrelated pre-existing worktree changes were preserved.

### Commit IDs

None; the user did not request a commit.
