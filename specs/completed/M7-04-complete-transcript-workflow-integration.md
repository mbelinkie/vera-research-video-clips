# M7-04 — Complete transcript workflow integration

- Status: completed 2026-08-23
- Milestone: M7 local desktop completion and personal validation
- Dependencies: M3 shared batch/transcript pipeline, M5 selection/logging, M6
  durable recovery, M7-02 desktop supervision, and M7-03 setup/readiness are
  complete. M7-01 real AWS/Cognito acceptance remains externally blocked.

## User-visible outcome

From the packaged Intel macOS application, an authenticated project member can
open any supported project video and receive its verified original, canonical
English, and preferred-language transcript tracks from the project-authorized
shared-first resolver and local cache. When no shared transcript exists, the
existing durable transcription workflow progresses automatically under the
supervised local worker and the resulting ready item opens into real navigation,
search, paired-language review, selection, and logging without Terminal or a
fixture substitution.

## Smallest end-to-end proof

Load a project video whose immutable transcript manifest points to deterministic
fixture-backed artifact bytes through the real authorized catalog/download/cache
boundary. Prove the first load downloads, checksum-verifies, atomically caches,
indexes, and hydrates the exact original/English/preferred tracks; prove a second
load reuses the verified cache without download. Open the ready video from both
immediate and batch review paths and use the hydrated tracks for seek, search,
paired display, range selection, and language evidence. For a video with no
active transcript, show its durable batch/job stage and actionable controls and
never render fixture text after resolution or processing failure.

## Affected authority boundaries

- Cloud project/catalog APIs remain authoritative for membership, project
  videos, active transcript manifests, batches/jobs, stages, and ready state.
- Private object storage remains authoritative for immutable shared transcript
  bytes; the local agent downloads only through project-authorized artifact
  URLs and verifies exact size/SHA-256 before cache promotion.
- SQLite remains verified transcript cache/index and local process state. It
  does not become a second active-version catalog or store OAuth tokens.
- The local agent composes the existing `SharedFirstTranscriptResolver`,
  `VerifiedTranscriptCache`, `CachedTranscriptDocumentReader`, and workspace
  service behind authenticated loopback routes.
- Electron owns authenticated lifecycle and worker supervision. The renderer
  receives typed transcript/workflow results only, never tokens, raw object
  credentials, filesystem paths, process handles, or arbitrary IPC.
- The web workspace owns navigation/search/selection presentation but never
  manufactures track bytes or changes transcript authority.

## In-scope behavior

1. Replace hard-coded selectable fixtures in the normal research workspace with
   a typed project-video load request and the real shared-first local-agent
   workspace response. Fixtures remain available only through explicit test or
   demo injection.
2. Resolve exact active original, English, preferred, and paired track views;
   preserve track/version IDs, source linkage, BCP-47 language, provider/model
   provenance, and honest word/cue/estimated timing.
3. Connect project-video and `Ready for review` navigation to the same load
   boundary. A ready item that cannot hydrate retains its durable ready evidence
   and exposes retry; it never falls back to fixture text.
4. Reuse existing immediate/batch creation, worker claim/heartbeat, caption
   discovery, authorized audio acquisition, Whisper, conditional translation,
   staging/finalize publication, verified cache promotion, and review-status
   contracts. Do not create a parallel transcript executor.
5. Expose durable batch/item stage and progress plus existing pause/resume,
   cancel-unstarted, retry-failed, and cooperative-cancellation behavior with
   actionable closed failure/needs states.
6. Keep cached authorized review useful across cloud/network degradation when
   the exact verified local transcript is available; cloud mutations continue
   to fail closed.

## Failure states

- Missing membership, project/video mismatch, or inactive manifest: deny or
  return an actionable unavailable state without local cache probing by guessed
  identity.
- Download unavailable, wrong size/hash, malformed bundle, cache promotion or
  indexing failure: retain prior verified cache bytes and ready catalog state;
  expose retry and never substitute a fixture.
- Missing original/English/preferred linkage or provenance mismatch: reject the
  inconsistent view while preserving valid durable work.
- Provider/tool/model/rights/translation-consent unavailable: leave the durable
  item in its exact actionable stage and do not invoke dependent acquisition or
  translation.
- Worker crash, lease loss, pause, cancel, retry, app quit, or restart: preserve
  catalog ownership and cleanup requirements; no full-source scratch remains
  after terminal completion.
- Cloud/network loss with an exact verified cache: allow bounded cached review;
  otherwise report the dependency rather than fabricating content.

## Explicit non-goals

- M7-05 export-worker registration/heartbeat/continuous execution or changing
  any of the three selection-command effects.
- M7-06 authorized live-source dogfood, production deployment, or final M7
  decision.
- M8 signing/notarization, Universal/Windows builds, updates, releases, remote
  testers, support/reporting, or independent cross-platform QA.
- New transcript authority, schema duplication, alternate in-memory execution,
  live-source access without source-specific authorization, or invented AWS,
  Cognito, provider, tool, or model values.

## Acceptance criteria

1. Every normal supported loaded/ready project video uses the authorized
   shared-first resolver and verified cache; arbitrary video failure never shows
   hard-coded fixture text.
2. Original, English, preferred, and paired views hydrate exact immutable track
   identities and drive the existing navigation, search, selection, and language
   evidence paths.
3. First resolution verifies/downloads/promotes/indexes; a second workstation or
   cache-miss path downloads once, while a subsequent local load reuses verified
   cache without regeneration.
4. Immediate and batch workflows expose durable stages, progress, pause/resume,
   safe cancellation, retry, and actionable failure/needs states through the
   existing control plane and supervised worker.
5. Cached review remains available only with exact verified local evidence;
   authorization and cloud-dependent mutations remain fail-closed.
6. Focused tests, formatting, typecheck, migrations if changed, affected unit
   and integration suites, web/desktop builds, packaged UI proof, aggregate
   verification, `git diff --check`, and independent Terra review find no
   unresolved P0/P1.

## Narrow tests first

- Local-agent authenticated workspace route: membership/project/video binding,
  shared download, exact cache hit, malformed/hash-mismatched artifact, missing
  track, preferred-language reuse, and path/token leakage.
- Web transcript loader: fixture-free arbitrary video, ready-item handoff,
  original/English/preferred/paired hydration, retry/error state, and no stale
  transcript after video/project change.
- Worker/batch integration: durable stages and controls, supervised execution,
  lease-loss/cancellation, finalize-to-ready, restart, and scratch cleanup.
- Packaged-app manual proof against deterministic fixture-backed cloud/catalog
  adapters; live sources remain separately authorized M7-06 evidence.

## External closure boundary

Normal tests and the complete local integration proof remain fixture-backed and
network-free. Real S3/Cognito publication and live English/foreign source proof
cannot be claimed until the recorded M7-01 AWS inputs/deployment authority,
approved Whisper model pin, and source-specific user authorization exist. Those
external prerequisites block M7-06/final M7 acceptance, but not honest M7-04
implementation through the existing deterministic shared-store and worker
boundaries.

## Completion record

### Decisions and delivered behavior

- Replaced production fixture imports and demo-video identity branches with a
  strict project-video workspace load. Pasted URLs resolve only against the
  authenticated project's catalog IDs, and `Ready for review` opens the exact
  project/catalog/video tuple rather than reconstructing authority from a URL.
- Added a renderer-safe `TranscriptWorkspaceResponse` with exact original,
  canonical-English, preferred, provenance, timing, active-version, cache
  source, and online/offline catalog state. It rejects paths, object metadata,
  download URLs, tokens, and inconsistent track linkage.
- Expanded the shared-first resolver to download, verify, atomically promote,
  index, and re-read original plus English tracks. Direct-English workspaces
  alias the exact validated English track. Every download target is bound to
  its immutable manifest descriptor, the downloaded/cached manifest must equal
  the catalog manifest, and same-version replacement attempts preserve prior
  bytes and metadata.
- Added a project-authorized, read-only derived-translation lookup. Existing
  exact local translations are preferred, then exact shared translations are
  verified and promoted. A miss creates no translation job and is surfaced as
  an honest `needs_translation`/unavailable state. Canonical foreign-to-English
  translation remains the established supervised base-transcription pipeline;
  the uncomposed translation-only job executor recorded by PL-01 is not claimed.
- Added a volatile per-login offline-review capability owned by Electron main.
  SQLite stores only its SHA-256 against an exact verified cache row. Only
  typed network/catalog outages may reuse that cache; authentication,
  authorization, not-found, new login sessions, and app restarts fail closed
  until online access is reverified. Offline review is labeled explicitly and
  disables project logging/cloud mutation.
- Added contained, regular/no-symlink/no-follow cache reads plus a bounded,
  fail-closed transcription-scratch startup sweep before the supervised worker
  can claim work. Abandoned full-source scratch is removed or worker startup
  stops with an actionable failure.
- Preserved the existing durable immediate/batch control plane, worker
  supervision, stages, pause/resume, cancel/retry, publication, and Ready for
  review boundaries. No alternate executor, fixture fallback, or in-memory
  orchestration was introduced.

### Changed boundaries

- `packages/contracts`, `packages/sync`, and `packages/db-local`: closed
  workspace/read-only-lookup contracts, exact bilingual cache resolution,
  typed catalog failures, scoped offline authorization, migration `0029`, and
  immutable manifest/download binding.
- `apps/cloud-api` and `apps/local-agent`: authorized read-only preferred-track
  lookup, strict transcript workspace route, safe error projection, and real
  resolver composition.
- `apps/desktop`: volatile login-session capability and exact canonical
  transcript-route injection; the capability never crosses preload/renderer.
- `apps/web`: fixture-free project-video hydration, retry/offline/preferred
  states, exact Ready-item identity, stale-response clearing, and real
  transcript navigation/search/selection/language evidence.
- `apps/worker`: startup cleanup verification for private transcription scratch.

### Verification evidence

- Final aggregate Vitest run: 51 files passed and 1 opt-in file skipped; 489
  tests passed and 4 skipped. The shared transcript-store integration passed
  first publication, verified promotion, and second-resolution cache reuse.
- Final cache-binding matrix passed 20 tests. Independent Terra re-review found
  no remaining P0/P1 after exact active-bundle, manifest, artifact, cache-hit,
  and immutable same-version replacement checks were added.
- `npx playwright test tests/e2e/workspace.spec.ts`: 6 passed. It covered no
  arbitrary fixture hydration, exact catalog-UUID Ready navigation, first-load
  failure/retry, original/English/preferred navigation and evidence, verified
  offline review restrictions, missing preferred evidence, selection, seek,
  and player control.
- `npm run typecheck`, `npm run build:web`, and `npm run build:desktop` passed.
  Local migration validation applied 29 migrations; cloud validation applied 22. Scoped Prettier and `git diff --check` passed.
- `npm run check` stopped only at global `format:check` because the pre-existing
  user-owned `docs/Script-to-Resolve Product Spec.md` is not formatted. That
  file was preserved untouched by this slice; every M7-04 source, test, and spec
  file passed scoped formatting, and all later aggregate gates were run
  separately.
- `npm run desktop:package:x64` passed. Bundle ID is
  `com.researchvideoclips.desktop`, version `0.1.0`; the executable is Mach-O
  x86_64. Final `app.asar` SHA-256 is
  `1936662e1f0e2b0ff9fe1c838844808e7fcb0c14784262283d46c80939b0758d`
  (5,341,218 bytes).
- The packaged app launched with disposable profile
  `/tmp/research-video-clips-m704-smoke.VELiAl`; process inspection confirmed
  the x64 main process and sandboxed renderer. It quit cleanly, left no child
  process, and the exact disposable profile was removed. No user app data,
  database, model, credential, export, or source media was touched.

### Review findings and remaining prerequisites

Independent review drove the same-login offline authorization scope, exact
cache containment/no-follow reads, manifest/download-target binding,
same-version preservation, preferred-language evidence correction, and removal
of an accidental call to the unexecuted derived-translation job path. No M7-04
P0/P1 remains. Offline capability-hash rows may accumulate until their parent
cache rows are removed, but old rows are unusable after the volatile capability
is cleared and this is accepted as a lower-priority maintenance risk.

M7-04 is complete at the deterministic local/shared boundary. Real Cognito/S3
acceptance remains blocked on M7-01 inputs and deployment authority. Real model
activation still requires the approved immutable Whisper URL, byte size, and
SHA-256. Live English/foreign sources require separate source-specific user
authorization in M7-06. Those prerequisites block final M7 dogfood, not this
fixture-backed integration slice.

### Commits

- Implementation, tests, and migration: `3b7e35f`
- Completion documentation: recorded by the documentation commit that moves
  this spec to `specs/completed/`.
