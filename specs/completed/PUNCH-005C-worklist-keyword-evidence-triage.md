# PUNCH-005C — Worklist keyword evidence and deliberate triage

- Status: completed 2026-08-24
- Parent entry: `PUNCH-005`
- Priority: P1 high
- Dependencies: completed PUNCH-005A governance, completed PUNCH-005B scan
  evidence, and PUNCH-004 canonical worklist/triage/activity authority

## User-visible outcome

The canonical project-video worklist presents every bounded row in one stable
keyword-result group: Promising, No matches, Processing, or Action needed.
Researchers can filter by exact approved keyword or scan state, sort within a
group by coverage, occurrences, density, duration, priority, or recency, and
distinguish waiting, stale, failed, and genuine zero-match evidence.

Expanding a completed or prior-stale result downloads the authorized pinned
private artifact, verifies object version, checksum, byte size, schema, and
exact project/video/transcript/keyword identities, then shows per-keyword counts
and bounded timestamped context with language, track, and timing precision.
Clicking evidence opens that canonical video, seeks to the honest source time,
and highlights the selected keyword occurrences in the hydrated transcript.

Scan completion creates a durable per-user activity receipt for other current
members, so a newly completed filter/badge survives reload and a member can mark
it seen. Multi-row priority or dismissal remains an explicit confirmed
Administrator action; zero matches never changes triage automatically.

## Smallest end-to-end proof

Create a bounded fifty-video fixture containing current matches, genuine zero
matches, queued/scanning work, waiting/no-transcript work, a failed scan, and a
replacement scan with readable prior stale evidence. One authorized client
sees stable group counts/order and filters, verifies and expands exact pinned
context, opens one match at its timestamp, and deliberately bulk-prioritizes or
dismisses selected rows. A second authorized client sees the same evidence and
one unread scan-completed receipt; a nonmember cannot read the page, artifact,
or receipt. Reload and project switch preserve only valid project-scoped state.

## Affected authority boundaries and persisted records

- Shared contracts own worklist keyword projection/query/group/sort shapes,
  prior-stale evidence, bounded artifact presentation, exact seek/highlight
  intent, bulk priority requests, and scan-completed activity types.
- Cloud migration 0035 extends the existing project-video activity event check
  for keyword-scan completion. It adds no transcript excerpts or duplicate scan
  evidence and fabricates no historical receipts.
- The catalog remains authoritative for project membership, canonical rows,
  stable filtering/sorting/pagination, scan summaries, current/prior freshness,
  optimistic bulk priority/triage, and per-user unread/seen receipts.
- Private object storage remains authoritative for context bytes. Browser code
  receives a short-lived authorized descriptor only after membership checks and
  verifies the pinned artifact before rendering any excerpt.
- React owns presentation, bounded lazy artifact loading, project-scoped UI
  state, and seek/highlight intent; it does not infer authorization, scan
  freshness, or canonical triage state.

## Failure, restart, concurrency, authorization, and migration behavior

- Worklist reads remain membership-bounded and max 50. Filter/sort identity is
  bound into cursors; a cursor from another project/query fails closed.
- Stable groups never collapse waiting, queued/scanning, stale-prior, failed,
  current-zero, or current-match states. Replacement processing can expose a
  prior verified result without presenting it as current.
- Artifact expansion is lazy and bounded. Missing, overwritten, oversized,
  wrong-version, checksum-invalid, schema-invalid, or cross-input bytes render
  an actionable evidence error and no context; the worklist summary remains.
- A member removed before artifact/read/receipt access is denied. Project switch
  clears selections, expanded bytes, filters, and highlight/seek intent.
- Finalize creates at most one scan-completed activity event keyed to the stable
  scan ID and one receipt per eligible other current member. Exact finalize
  replay and concurrent finalize cannot duplicate notices.
- Bulk priority and triage require current Owner/Administrator authority,
  optimistic row versions, unique video IDs, explicit user confirmation, and
  exact idempotency. Any stale row conflicts the whole command without partial
  mutation. Researchers may select/filter/open evidence but cannot govern rows.
- Migration 0035 only widens the event-type check; historical rows and receipt
  states are retained and no historical completion is guessed.

## Explicit non-goals

- Keyword rename/enable/disable/delete, suggestion withdrawal, or the final
  Project Settings destination.
- Transcript mutation, rescan execution changes, fuzzy/semantic matching,
  exclusions, Boolean rules, AI scoring, or automatic dismissal.
- The broader PUNCH-002/PUNCH-006 visual shell/layout redesign beyond the
  bounded existing Workbench component seam.
- Comments, topics/PUNCH-010, player-time logging, clip-tag changes, broader
  notifications, live providers/media, deployment, commit, push, or PUNCH-009.

## Acceptance criteria

1. Every row maps deterministically to Promising, No matches, Processing, or
   Action needed while retaining explicit scan freshness/failure labels.
2. Fifty fixture rows prove bounded pagination, stable group/order, exact
   keyword/state filters, supported sorts, dynamic counts, and sibling failure
   isolation without chaotic reordering.
3. Current zero-match is visually/contractually distinct from waiting, stale,
   failed, queued, and not-scanned; it never mutates priority or triage.
4. Replacement processing exposes prior stale evidence until exact finalize,
   then switches atomically to the new current artifact.
5. Lazy context verifies pinned version/checksum/size/schema/input and shows
   bounded per-keyword counts plus language/track/timing labels; tampering and
   nonmember/removed-member access fail closed.
6. Clicking exact-word or cue/estimated evidence opens the correct canonical
   video, seeks to its honest start bound, and highlights only the chosen
   keyword's visible occurrences after transcript hydration.
7. Exact/concurrent finalize creates one durable other-member activity receipt;
   unread/newly-completed filtering survives reload and mark-seen is
   idempotent without exposing excerpt text.
8. Confirmed bulk priority and dismissal/restore are Administrator-authorized,
   optimistic, exact-replay safe, all-or-nothing, and never automatic from scan
   evidence.
9. Project switching clears every selection/filter/artifact/highlight state and
   prevents stale project evidence from rendering.
10. Contracts, migration, catalog/API, browser tests, typecheck, build, scoped
    formatting, aggregate tests, and `git diff --check` pass network-free.

## Narrow tests first

1. Contract fixtures for groups, prior stale evidence, filters/sorts/cursors,
   verified presentation, activity type, and bulk priority.
2. Clean/populated migration 0035 plus catalog fifty-row grouping/filter/sort,
   current/prior summaries, receipt replay, authorization, and bulk conflict.
3. Cloud API forwarding and browser artifact verification/tamper/project-switch
   tests through the existing bounded Workbench seam.
4. Focused Vitest and Playwright, then typecheck, migration CLIs, build,
   aggregate Vitest, scoped Prettier, and `git diff --check` before closure.

## Completion evidence

- Shared worklist contracts, migration 0035, catalog/API authorization,
  deterministic scan finalization, per-user activity receipts, exact-replay
  bulk priority, and private artifact access passed the focused five-file
  Vitest matrix: 22 passed, 136 skipped by the focused name filter.
- The Workbench browser fixture proves genuine zero-match/current-match group
  transitions, exact scan and approved-keyword filters, checksum/size tamper
  rejection, verified retry, bounded word-timed context, transcript
  seek/highlight intent, confirmed bulk priority, and project-scoped filter
  reset. The complete workspace Playwright file passed all 11 flows.
- Populated migration coverage preserves a pre-0035 completed scan with
  `NULL keyword_counts`, accepts a new JSON count array, rejects non-array
  storage, retains historical activity/receipts, and fabricates no priority
  commands.
- `db:migrate:cloud:test` applied 35 migrations, `db:migrate:local:test`
  applied 30, desktop build and typecheck passed, the aggregate network-free
  suite passed 606 tests with 4 skipped, scoped Prettier passed, and
  `git diff --check` passed.
