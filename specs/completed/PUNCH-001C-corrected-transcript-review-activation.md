# PUNCH-001C — Corrected transcript review, activation, and reuse

- Status: completed 2026-08-24
- Parent entry: `PUNCH-001`
- Priority: P1 high
- Dependencies: completed PUNCH-001A language integrity gate and PUNCH-001B
  strict immutable timed bilingual import

## User-visible outcome

A write-authorized researcher can inspect a finalized timed-import candidate's
original and directly linked English cues side by side, explicitly approve and
activate that exact immutable version, and then open it through the normal
shared-first transcript workspace. A second authorized workstation downloads,
verifies, caches, and reuses the same active version without regeneration.

## Smallest end-to-end proof

Finalize a deterministic corrected bilingual candidate while an older version
is active. Read bounded side-by-side review pages, explicitly activate the
candidate with its exact candidate/version/language-decision/project-video
snapshot, and prove one `transcript.activated` event and one active-pointer
change. Resolve the active version into two disposable local caches and prove
the second resolution on each workstation reuses verified bytes. Log/export a
selection from the corrected original/English tracks and prove the immutable
clip and subtitle snapshots name those exact corrected tracks.

## Affected authority boundaries and persisted records

- Shared contracts own bounded review pages, explicit activation commands, and
  safe activation status.
- The shared catalog owns candidate/version authorization, current language
  decision and project-video optimistic checks, idempotent activation audit,
  active pointer mutation, and the activation event.
- A forward-only cloud migration records activation actor/time, exact command
  hash, idempotency key, and candidate/version snapshots without changing
  existing candidate or active-version reads.
- Private object storage remains authoritative for immutable normalized tracks;
  review reads verify exact pinned bytes before returning bounded cue text.
- Existing active-transcript download, local verified cache, workspace reader,
  clip language evidence, subtitle policy, and export boundaries are reused.
- The web batch review path displays bounded original/English evidence and an
  explicit activation action; it does not manufacture authority in component
  state.

## Failure, restart, concurrency, authorization, and migration behavior

- Candidate review and activation require current project write authority.
  Nonmembers and compatibility viewers are denied.
- Missing, malformed, wrong-project, wrong-video, wrong-decision, or corrupt
  candidate artifacts fail without changing the active pointer.
- Activation requires the exact current project-video version, candidate,
  transcript version, and confirmed decision/version. Stale or concurrent
  mutations conflict and preserve the previous active version.
- Exact activation replay returns the durable activation status without a
  second pointer mutation or event. Divergent idempotency-key reuse conflicts.
- Concurrent activation attempts serialize on the project-video row; only one
  stale snapshot wins. An older activation replay never reactivates a candidate
  after a later deliberate change.
- Clean and representative populated migrations preserve all existing active
  versions, finalized candidates, batches, jobs, clips, and caches.
- Review and status responses omit object keys, signed URLs, local paths,
  credentials, provider raw output, and unrelated transcript content.

## Explicit non-goals

- Editing, relabeling, overwriting, or deleting immutable transcript bundles.
- Arbitrary transcript comparison/history UI, unbounded full-text cloud reads,
  or automatic activation after import.
- New provider work, live media, AWS deployment, Cognito acceptance, M7-06
  dogfood, or PUNCH-002 through PUNCH-010 behavior.
- Workspace decomposition or visible VERA redesign.

## Acceptance criteria

1. Bounded authorized review returns exact original and English cue evidence,
   timing precision, language, direct source-track linkage, and provenance.
2. Explicit activation atomically records actor/time/command identity, moves
   only the exact project-video active pointer, and emits one safe event.
3. Exact replay is a no-op; divergent replay, stale project-video/decision,
   concurrent activation, nonmember, and viewer attempts fail safely.
4. Corrupt or mismatched candidate bytes cannot be reviewed or activated.
5. The existing active-transcript API exposes the activated immutable bundle;
   two disposable workstation caches verify and reuse it independently.
6. Corrected-version clip language evidence and export subtitle snapshots keep
   the exact original/English track IDs, versions, linkage, language, timing,
   and transcript version without mutating older records.
7. Focused contracts, catalog/API, migration, cache/workspace, clip/export, UI,
   typecheck/build, aggregate, and diff checks pass.

## Narrow tests first

- Contracts: strict bounded review page and activation command/status.
- Migration/catalog: populated compatibility, authorization, verified review,
  exact replay, stale/concurrent conflict, one pointer/event mutation.
- Cloud API/web: bounded review and explicit activation with stale-response
  clearing across project/video/batch changes.
- Sync/local: active download, checksum verification, second-workstation cache
  reuse, and no regeneration.
- Selection/export: corrected native/English evidence, clip snapshot, subtitle
  track snapshots, and all three command effects remain compatible.

## Restart checkpoint — 2026-08-24

The core review and activation boundary is implemented but this slice remains
active and must not yet be marked complete.

Implemented at this checkpoint:

- strict bounded review-page, exact activation-command, and safe
  activated/superseded status contracts;
- forward-only cloud migration `0026_manual_timed_transcript_activations.sql`
  with immutable actor/time/request-hash evidence and populated-candidate
  compatibility coverage;
- write-authorized checksum/version-verified candidate review through exact
  manifest, original normalized track, and directly linked English normalized
  track objects;
- explicit optimistic activation serialized on the project-video row, with
  durable exact replay, divergent replay rejection, stale/concurrent conflict,
  one pointer mutation, and one `transcript.activated` event;
- exact replay after a later active-version change reports `superseded` and
  never reactivates the older candidate;
- cloud review/activation routes; and
- side-by-side bounded web review with explicit activation and generation
  guards that discard delayed review responses after a project switch.

Checkpoint evidence:

- focused contracts: 42 passed;
- focused catalog activation test: 1 passed;
- full contracts/catalog/cloud-API suites passed in the combined run; the only
  initial combined failures were migration-count expectations updated for
  migration 0026;
- full cloud migration suite after that update: 9 passed, 2 optional PostgreSQL
  tests skipped;
- `npm run typecheck`: passed;
- `npm run build:web`: passed;
- focused Playwright timed-import/review/activation flow: 1 passed;
- targeted Prettier check and `git diff --check`: passed.

## Completion evidence

Completed 2026-08-24. Final integration coverage now creates and confirms a
foreign-language project video, finalizes and explicitly activates an exact
timed bilingual candidate, and resolves the activated bundle on two independent
disposable workstation roots. Each workstation's first resolution downloads
from the shared store, its second resolution uses the verified local cache with
no additional object downloads, and both retain the same transcript-version,
original-track, English-track, and direct-link identities.

The same proof logs an English-display selection with exact corrected native
and English evidence, queues a foreign logged export with exact corrected
subtitle-track snapshots and source-rights evidence, inspects both the request
row and export-job payload, then explicitly activates a later corrected bundle.
The older clip language/selection evidence and export request/job snapshots
remain byte-for-byte unchanged. This reuses the established track ID/version
and selection snapshot boundaries; no second transcript-provenance model was
introduced.

Files added or materially completed for this slice:

- bounded review/activation contracts and tests in
  `packages/contracts/src/index.ts` and `packages/contracts/src/index.test.ts`;
- immutable activation migration
  `packages/db-cloud/migrations/0026_manual_timed_transcript_activations.sql`
  plus clean/populated migration coverage;
- verified candidate review, optimistic/idempotent activation, immutable audit,
  active-pointer update, and safe event behavior in `packages/catalog`;
- authenticated cloud review/activation routes and strict route/body checks;
- bounded side-by-side web review, pagination, explicit activation, superseded
  status, and cross-context generation guards;
- Playwright activation/stale-state coverage; and
- `tests/integration/shared-transcript-store.test.ts` for two-workstation cache
  reuse plus corrected clip/export immutability.

Final verification evidence:

- focused shared-store integration: 2 tests passed;
- focused contracts/catalog/cloud API/shared-store matrix: 4 files and 94
  tests passed;
- cloud migration suite: 9 passed and 2 optional PostgreSQL tests skipped;
- migration CLIs: 26 cloud and 30 local migrations applied successfully to
  disposable test stores;
- `npm run typecheck`, `npm run build:web`, and `npm run build:desktop` passed;
- full Playwright suite: 11 passed; expected proxy warnings came only from
  intentionally unstarted mocked background services;
- aggregate network-free suite: 53 files passed, 1 skipped; 544 tests passed
  and 4 skipped;
- changed-scope Prettier check and `git diff --check` passed. The repository-wide
  Prettier command still reports the preexisting unrelated
  `docs/Script-to-Resolve Product Spec.md`, which this slice did not modify.

Final root review found no unresolved authorization, privacy, migration,
idempotency/concurrency, immutable-object, or stale-renderer-state defect in the
PUNCH-001C diff. Terra review tooling was unavailable in this environment, so
no independent-agent claim is made. No commit was requested or created; the
coherent PUNCH-001A/B/C handoff remains in the dirty worktree.
