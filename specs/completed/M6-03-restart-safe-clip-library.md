# M6-03 — Restart-safe Clip Library

- Status: implementation complete
- Task/thread: M6-03 only
- Dependencies: M6-01 immutable history and M6-02 local locator verification
  implemented; M5 request/retry/progress/batch primitives unchanged

## User-visible outcome and current evidence

A researcher can open a dedicated project Clip Library, search and filter a
bounded server page, select clips, move through deterministic pages, see
historical completed versions separately from workstation availability, and
recover the last authorized page and selection after browser/local-agent
restart. If the cloud is unreachable, the exact previously authorized cached
page is visibly stale and all cloud mutations remain disabled.

The existing `ClipQueue` loads as many as 500 clips and filters only React
memory. M5 durably stores clip versions, export requests/retry leaves, progress,
and terminal state; M6-01 stores immutable success history; M6-02 stores local
locator state. No bounded composition, authorization-scoped local snapshot, or
restart-safe Clip Library surface currently joins those facts.

## Smallest end-to-end proof

Create three clips across two videos, including a completed artifact with a
verified local locator and an active retry leaf. Fetch two bounded Clip Library
pages through the local agent, persist the authorized page and selected clip
IDs, restart the local repository and UI, and recover the same cloud history,
durable request state, and local availability. Then make the cloud fetch fail
and prove only the matching credential-scoped cached page returns with a stale
label and no mutation capability.

## Affected boundaries

- Shared contracts: strict bounded cloud query/page, sanitized retry-leaf and
  progress summaries, recent completed versions, path-free local availability,
  cache freshness, and persisted selection commands.
- Cloud catalog/API: a new project-authorized Clip Library route with literal
  search, typed filters, deterministic keyset pagination, a project sync-event
  high-water cursor, bounded current leaves, and bounded recent history.
- Local persistence: ordered SQLite migration for exact query-page cache and
  selected IDs keyed by project plus SHA-256 authorization fingerprint. Raw
  credentials, paths, and filenames are never stored in this cache.
- Local agent: an Authorization-required route that refreshes through cloud,
  caches only parsed authorized responses, rejects 401/403 without fallback,
  and falls back on network/5xx failure only to the exact matching cached page.
  Local locator state is joined internally by artifact-version ID.
- Web: replace the embedded queue presentation with a dedicated Clip Library
  surface using server search/filter/pagination and local cache/selection APIs.
  Existing note/tag edits remain online-only; export operations stay M6-04.

## In-scope behavior

1. Preserve the legacy bare clip-list route for CSV, M5 batch eligibility, and
   existing callers. Add a dedicated `/clip-library` route instead.
2. Bound page size to 1–50 (default 25) and order by immutable
   `(created_at DESC, id DESC)`. Bind the opaque cursor to the normalized filter
   fingerprint; reject malformed, cross-project, or cross-filter cursors.
3. Search literal normalized transcript/English/original text, video title,
   notes, and tags. Support research status, export status, and completed-version
   presence filters. Tag joins must not duplicate clips.
4. Return each clip's authoritative version, up to ten independent current
   retry leaves with durable progress and `hasMoreLeaves`, completed-version
   count, and up to five recent immutable artifact summaries. Never flatten
   completion into current byte availability.
5. Cache an exact authorized query/cursor page atomically with cloud sync
   high-water sequence and fetch time. A cached page is a clearly labeled
   subset, never claimed to be a complete project snapshot.
6. Scope cache and selected clip IDs to `(projectId,
sha256(Authorization header))`. Require the exact credential again after
   restart; never store or return the raw header. Online 401/403 deletes that
   credential scope and cannot fall back to stale data.
7. Overlay only locator summaries whose artifact-version IDs already occur in
   the authorized page. A sibling project/version cannot be enumerated through
   the overlay. Local availability filtering is visibly limited to the cached
   page, never represented as a global cloud predicate.
8. Restore selection only for entries still present in the matching page and
   show its cached/stale state. Project or credential changes cannot reuse
   another scope's selection.
9. Keep notes/tags and every other cloud mutation online-only. A timeout or
   unknown result requires refresh; no non-idempotent patch is blindly replayed.
   M6-04 will compose persistent idempotent export commands.

## Explicit non-goals

- Export submission, retry/cancel controls, storage preflight, or same-source
  batch operations (M6-04).
- Verify/reveal/open/relink or compatibility actions (M6-05).
- Authoring-client APIs (M6-06), quiescence/drain (M6-07), cloud clip storage,
  or Google Sheets control.
- A complete offline replica, replaying `sync_events.payload` as state, local
  availability as a cloud-global filter, raw token persistence, or a second job
  state machine.

## Failures and recovery

- Missing/malformed cursor or query fails before data enumeration; outsiders
  receive the normal authorization failure without counts or cursor evidence.
- Network/5xx failure with a matching cached page returns only that page as
  `stale`; no matching cache returns a bounded unavailable error.
- Online 401/403 purges the matching credential scope and never serves stale
  project notes, tags, transcript text, or history.
- A partial page remains explicitly `cached_subset`; it cannot make global
  statements about local-availability filtering or total project membership.
- New/edited clips between pages cannot duplicate or reorder the immutable
  creation cursor. A refreshed first page carries a newer sync cursor.
- One clip's failure, progress, locator change, or cache refresh cannot mutate
  a sibling entry.

## Migration and compatibility

Add local migration 0027 only. Existing local M5/M6 rows remain unchanged and
no eager cache/backfill occurs. Cache tables use foreign keys only within the
cache scope; cloud clip/artifact IDs are validated at the authorized service
boundary because SQLite cannot authoritatively foreign-key cloud identity. No
cloud migration or M5 schema change is expected.

## Acceptance criteria

1. Contract, catalog, API, local cache, and UI form one real path from an
   authorized bounded cloud query through restart-safe local rendering.
2. Literal search and all typed cloud filters paginate deterministically with
   bounded recent history and independent current retry leaves/progress.
3. Historical completion and local verified/missing/invalid availability are
   visibly distinct and joined only by authorized artifact-version ID.
4. Restart restores the exact cached page and selected IDs for the same
   credential fingerprint; offline data is stale/cached-subset and mutations
   are unavailable.
5. Credential/project changes, online revocation, malformed cursors, sibling
   IDs, and empty cache fail closed without enumeration.
6. Cached JSON, contracts, API/errors, events, and browser state contain no raw
   authorization, absolute/relative path, filename, delivery secret, raw
   filesystem error, command, or source identity.
7. Fresh/populated migration, focused integration, aggregate, build, browser,
   migration CLI, formatting, and diff checks pass.

## Verification plan

Run strict contract tests; catalog search/filter/pagination/current-leaf/history
and outsider tests; cloud route forwarding tests; fresh/populated SQLite cache,
restart, authorization-scope, selection, stale fallback, and locator-overlay
tests; local-agent online/offline/revocation/leakage tests; and browser flows for
dedicated surface, next page, selection restore, separate availability, and
stale offline labeling. Then run formatting, typecheck, relevant integration,
both migration CLIs, Playwright, `git diff --check`, and full `npm run check` in
a clean worktree. Record any platform/real-source skips without weakening them.

## Decisions and delivered behavior

- Kept every completed M5 schema and migration unchanged. Local migration 0027
  creates empty cache/selection tables and performs no eager backfill.
- Preserved the legacy bare `/clips` route for M5 batch and CSV callers. The
  dedicated `/clip-library` route performs bounded literal search, typed
  filtering, and immutable `(created_at, id)` keyset pagination.
- Reads clip rows, tags/language evidence, retry leaves/progress, immutable
  history, and the sync-event high-water from one repeatable-read snapshot.
- Stores parsed pages and selection under project plus SHA-256 of the exact
  Authorization header. A 401 purges that credential across projects; a 403
  purges its project scope. Raw credentials are never persisted.
- Restores the most recently viewed exact query/cursor page using a monotonic
  local view sequence. Offline fallback is limited to the exact cached query
  and is always labeled `stale` and `cached_subset`.
- Updates selection incrementally so hidden pages and filters retain their
  choices. Selection IDs must already occur in an authorized cached page.
- Joins path-free local locator summaries only for artifact-version IDs already
  present in the authorized page. Cloud completion remains distinct from local
  verified/missing/invalid availability.
- Keeps note/tag edits online-only and generation-guards page, tag, and
  selection responses so an older project or credential cannot repopulate the
  current UI. Export operations remain deferred to M6-04.

## Changed files

- `packages/contracts/src/index.ts` and tests: bounded cloud/local page,
  current-leaf, cache freshness, availability, and selection contracts.
- `packages/catalog/src/index.ts` and tests: authorized repeatable-read Clip
  Library projection, literal NFKC search, filters, pagination, leaves,
  progress, recent history, and sync high-water.
- `apps/cloud-api/src/app.ts` and tests: dedicated cloud Clip Library route.
- `packages/db-local/migrations/0027_clip_library_cache.sql`, repository, and
  tests: authorization-scoped exact-page cache, monotonic last-view recovery,
  selection preservation, restart, revocation, and populated-M5 compatibility.
- `apps/local-agent/src/clip-library.ts`, app/main wiring, and tests: online
  refresh, exact stale fallback, latest-page restore, path-free overlays, and
  fail-closed authorization behavior.
- `apps/web/src/clip-queue.tsx` and Playwright coverage: dedicated Clip Library
  presentation, cloud filters/pagination, history versus workstation state,
  restart-safe selection, and stale mutation lockout.

## Verification evidence

- Focused contract/catalog/cloud API/local cache/local-agent suite: 107 tests
  passed after review fixes.
- Focused local cache, service, app, and contract suite: 68 tests passed; local
  migration CLI validated all 27 ordered migrations.
- Catalog concurrency/NFKC Clip Library proof passed against PGlite.
- Production web build and TypeScript typecheck passed.
- Playwright browser regression passed 4 of 4 tests.
- Aggregate repository tests passed 290 tests with the two declared existing
  skips; cloud migration CLI validated all 20 ordered migrations.
- `git diff --check` and scoped formatting passed. Repository-wide formatting
  remains blocked only by the preserved user-owned edits in
  `docs/Script-to-Resolve Product Spec.md`; this slice did not reformat them.

## Independent review and remaining scope

The Sol review drove fixes for exact latest-page recovery, selection retention
across unloaded pages, repeatable-read sync coherence, project/credential race
guards, invalid status filtering, contract-drift fallback, tag cursor
normalization, and Unicode search. Its final follow-up found no remaining P1.

M6-04–M6-07 remain deliberately unopened. M6-03 does not submit, retry, cancel,
verify, reveal, open, relink, or build authoring exports.

## Commits

- Implementation, migration, tests, and active specification: `65f56c1`
- Completion documentation and status: `41f97af`
