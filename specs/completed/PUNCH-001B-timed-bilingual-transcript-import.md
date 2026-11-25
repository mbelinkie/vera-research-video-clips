# PUNCH-001B — Strict timed bilingual transcript import

- Status: completed 2026-08-24
- Parent entry: `PUNCH-001`
- Priority: P1 high
- Dependencies: completed PUNCH-001A language-decision/conflict gate and the
  existing M7 immutable transcript upload/finalize boundary

## User-visible outcome

When configured speech recognition or translation cannot support a confirmed
spoken language, a project researcher can import a bounded timed original
transcript and a directly linked timed English transcript. The application
validates both tracks, stages them through private object storage, and finalizes
one immutable transcript candidate for review without relabeling provider bytes
or silently replacing the project's active transcript.

## Smallest end-to-end proof

Use a project video whose confirmed source language is Dzongkha and whose batch
item is actionable. Import deterministic UTF-8 Dzongkha-original and English
SRT fixtures, prove their cues are ordered and within the catalog video's known
duration, normalize them into exact linked tracks, stage only grant-owned
objects, and finalize one immutable candidate. Reload and a second authorized
client must observe the same candidate while the prior active transcript pointer
is unchanged. Reject a mismatched English linkage and an out-of-bounds cue with
no transcript-version row, active-pointer change, or partially published bundle.

## Affected authority boundaries and persisted records

- Shared contracts own closed import format/track roles, bounded requests,
  sanitized import status/errors, immutable linkage, and candidate projection.
- `packages/transcript` owns strict UTF-8 VTT/SRT parsing and deterministic
  normalization; it must not accept renderer-authored normalized objects as
  trusted publication evidence without server verification.
- The shared catalog owns project authorization, confirmed-language binding,
  idempotency/concurrency, upload-grant scope, object/hash verification,
  immutable candidate finalization, and the distinction between finalized and
  active transcript versions.
- A forward-only cloud migration may add manual-import purpose/status and a
  durable candidate pointer or import record. It must preserve existing worker
  uploads, finalized versions, active pointers, and legacy reads.
- The cloud API exposes bounded authenticated create/finalize/read operations;
  raw file contents, local paths, object keys, signed URLs, parser internals,
  credentials, and tokens never enter durable events or safe status reads.
- Storage performs a manual-import-only bounded read that checks authoritative
  object length and enforces a streaming ceiling before buffering; parser limits
  alone are not an allocation boundary.
- The web batch remediation path selects two local timed-text files, shows only
  bounded file metadata and validation outcomes, and clears file/request state
  across project, video, batch, authorization, success, and stale-response
  changes.
- The desktop uses a dedicated typed native upload bridge for the two ephemeral
  grant targets because its renderer CSP intentionally forbids arbitrary
  cross-origin PUTs. The generic JSON proxy and CSP remain closed.
- Local SQLite cache/index authority is unchanged in this slice because a
  candidate is not active. Second-workstation download/activation belongs to
  PUNCH-001C.

## Failure, restart, concurrency, authorization, and migration behavior

- Only current members with write/research authority can create or finalize an
  import. Viewers and nonmembers cannot obtain grants, inspect candidates, or
  infer object identities.
- Import requires the current confirmed project-video language decision and
  snapshots its exact ID/version together with the project-video version, known
  positive duration, source-video update identity, and optional batch-item
  version. Any changed snapshot or conflicting/unknown/mixed status fails before
  publication.
- Inputs are bounded UTF-8 VTT or SRT. Empty, oversized, malformed, duplicate,
  unordered, overlapping when disallowed, negative, non-increasing, or
  duration-exceeding cues fail with closed safe codes. Text and cue counts are
  bounded.
- The original track must use the confirmed non-`und`/non-`mul` language. The
  English track must be English and link directly to the exact original track,
  video, timing-precision class, normalization schema, and import identity.
- Exact create/finalize replay is idempotent. Divergent idempotency-key reuse,
  stale optimistic versions, duplicate lineage/version identities, expired
  grants, wrong object versions/hashes, and grant-external keys conflict without
  mutating an existing candidate or active pointer.
- Validation occurs from pinned staged object bytes on the server boundary.
  Failed or expired staging never creates a transcript version; version-aware
  safe cleanup may remove only the exact import-owned prefix/version and must
  tolerate retry/restart.
- Finalization inserts all manifest/artifact/candidate records transactionally
  and leaves `project_videos.active_transcript_version_id` unchanged. It may
  move the affected batch item to `ready_for_review` with the exact candidate
  ID, but activation is an explicit later command.
- Clean and populated migration validation covers existing uploads, worker
  claims, active versions, language-gated batches, and replay after restart.

## In-scope behavior

1. Add strict timed-import contracts and deterministic SRT/VTT normalization
   for manual original and English cue tracks.
2. Persist a manual-import upload purpose/status and immutable finalized
   candidate identity bound to the project video and exact confirmed language
   decision.
3. Reuse private staged upload targets and pinned hashes/object versions, then
   validate and finalize through the catalog transaction without activating.
4. Add authorized API routes to create the bounded import, finalize it, and
   read its safe candidate status for reload/second-client continuity.
5. Add the real batch remediation UI for original plus English timed files,
   strict format/language display, progress, retry, and safe validation errors.
6. Add the narrow native byte-upload bridge with HTTPS/grant-shape and size
   validation while retaining the renderer's closed JSON proxy and CSP.
7. Preserve existing worker publication, active transcript resolution,
   translation, clip logging, export, and authoring behavior.

## Explicit non-goals

- Side-by-side cue review, candidate approval/activation, active-version
  supersession, second-workstation cache download, or corrected clip/export
  regressions; those are PUNCH-001C.
- Editing, overwriting, deleting, or relabeling any immutable transcript bundle.
- Untimed plain text, arbitrary JSON upload, OCR, DOCX/PDF import, automatic
  language detection, machine translation, or new live provider execution.
- PUNCH-002 through PUNCH-010 work, M7-06 live-source dogfood, AWS deployment,
  Cognito acceptance, or hosted spending.

## Acceptance criteria

1. Valid confirmed-Dzongkha original plus English VTT/SRT inputs finalize one
   immutable linked candidate through staged object verification.
2. The current active transcript ID remains byte-for-byte unchanged after
   import finalization, including when another active version already exists.
3. Original language, English role, video ID, direct source-track linkage,
   timing precision, cue ordering/bounds, schema, byte size, and SHA-256 are
   checked from pinned staged bytes before the transaction commits.
4. Malformed UTF-8/format, empty/oversized text, out-of-bounds or invalid cues,
   mismatched language/linkage, expired grant, wrong hash/version/key, and stale
   decision all fail without a transcript-version/candidate row or active change.
5. Exact replay returns the same import/candidate; divergent or concurrent
   mutation conflicts safely and cannot publish two winners.
6. Write-authorized members can import/read status; viewers and nonmembers are
   denied without object-key, signed-URL, transcript-text, or parser leakage.
7. Browser reload and a second authorized client show the durable finalized
   candidate; project/video/batch switches and delayed responses cannot leak
   selected files or status into another context.
8. Existing worker upload/finalize, active resolver, migration, language-gate,
   clip/export, and aggregate tests remain green.

## Narrow tests first

- Transcript/contracts: strict SRT/VTT decoding, bounds/order/text limits,
  deterministic IDs, original/English roles, direct linkage, and redaction.
- Cloud migration/catalog: clean/populated compatibility, authorization,
  confirmed-decision binding, exact replay/concurrency, staged-object scope and
  hash verification, atomic candidate insert, and active-pointer non-mutation.
- Cloud API: create/finalize/status route schemas and safe error projection.
- Web/Playwright: two-file remediation, valid finalization, safe invalid-file
  result, reload/second client, and project/video/batch delayed-response clearing.
- Existing worker finalize, shared transcript resolver, PUNCH-001A, migrations,
  typecheck/build, and bounded aggregate gates proportional to changed seams.

## Completion requirements

Run narrow tests first, then formatting, typecheck, clean/populated migrations,
affected unit/integration suites, web build, focused browser tests, bounded
aggregate checks, and `git diff --check`. Obtain fresh independent Terra review
for authorization, migration compatibility, idempotency/concurrency, object
scope/hash verification, active-pointer isolation, privacy, stale renderer
state, and missing failure tests. Record actual evidence and remaining risks
before moving this file to `specs/completed/` and opening PUNCH-001C.

## Completion evidence

Completed 2026-08-24. The slice now provides a strict staged SRT/VTT import for
confirmed non-English original plus English tracks, server-side bounded parsing
and normalization, immutable candidate finalization without activation, safe
reload/second-client status, a catalog-bound desktop upload bridge, exact replay
and restart recovery, and short-lifecycle private staging. Independent review
closed the create/finalize concurrency, expiry, candidate ordering, native grant,
renderer retry, and exact-version cleanup findings with no remaining P0/P1/P2.

Verification evidence:

- focused contracts/transcript/storage/desktop/web checks: 87 passing tests;
- focused timed-import catalog, cloud API, clean/populated migration checks: all
  passing, including expiry races and partial-artifact cleanup;
- cloud migrations: 25 applied; local migrations: 30 applied;
- production TypeScript/web build passed;
- focused Playwright timed-import flow passed, including delayed project switch,
  invalid finalize retry, second client/reload, and delayed-finalizer takeover
  without re-upload;
- bounded aggregate: 53 files passed, one skipped; 542 tests passed and four
  skipped before the final narrowly targeted race fixes, whose focused tests and
  build then passed;
- changed-file Prettier and `git diff --check` passed.

Remaining boundary: the candidate is deliberately inactive. Side-by-side review,
explicit activation, normal active-cache reuse, and corrected clip/export
regressions remain PUNCH-001C.
