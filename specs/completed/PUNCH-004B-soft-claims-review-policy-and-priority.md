# PUNCH-004B — Soft claims, review cycles, policy, and priority

- Status: completed 2026-08-24
- Parent entry: `PUNCH-004`
- Priority: P1 high
- Dependencies: completed PUNCH-004A canonical worklist identity/flags and
  completed PUNCH-003A Owner/Administrator/Researcher authority

## User-visible outcome

Authorized members can coordinate review on a canonical project-video row
without making it exclusive. Opening/claiming a row records a renewable soft
claim; another member may inspect it and can take over only through an explicit
confirmed command. Review completion creates append-only cycle evidence rather
than overwriting processing state. Owners/Administrators can set per-row
priority and choose whether a Researcher or only an Administrator may complete
the next review cycle.

## Smallest end-to-end proof

A Researcher claims one canonical row, renews the claim, and completes a review
under the ordinary policy. Reopening with a reason creates a second cycle while
preserving the first. An Administrator changes the next-cycle policy to
Administrator-only and priority to High; the Researcher may still open and log
research but cannot complete that cycle. A second member's unconfirmed takeover
conflicts, while an explicit takeover records both actors and succeeds. The
canonical Workbench row displays these independent facts without changing its
transcription state or flags.

## Affected authority boundaries and persisted records

- Shared contracts own claim, takeover, review-complete/reopen, policy, priority,
  optimistic command, and bounded worklist summary shapes.
- Cloud migration 0029 adds project-video policy/priority state, renewable claim
  records, append-only review cycles/events, and command receipts where replay
  needs a stable identity. No local migration is required.
- The catalog centralizes Owner/Administrator/Researcher claim/review authority,
  Administrator governance, expiry, optimistic conflicts, and append-only
  transitions. Processing jobs/batches remain a separate authority.
- Strict cloud API routes expose only project-authorized canonical commands.
- `BatchWorkspace` consumes the enriched worklist and offers bounded claim,
  complete, reopen, policy, and priority controls without inferring authority in
  React.

## Failure, restart, concurrency, authorization, and migration behavior

- Claims survive restart, carry claimant and expiry, renew monotonically, and
  become stale after a bounded timeout. Stale claims do not silently transfer;
  takeover requires an explicit confirmation and audit evidence.
- Exact command replay is a no-op. Divergent idempotency payloads, stale row or
  cycle versions, unconfirmed takeover, and competing completion/reopen
  commands conflict without discarding prior evidence.
- Completion is allowed without a ready transcript only when the command
  explicitly acknowledges that warning; the cycle records that basis.
- Administrator-only completion blocks Researchers but does not revoke ordinary
  project read/write, claim, clip, comment, or keyword-suggestion authority.
- Reopen requires a bounded nonempty reason and appends a new cycle. It never
  mutates the completed cycle or processing state.
- Priority and completion policy are independent of immutable batch priority,
  jobs, flags, transcript pointers, and later keyword/triage axes.
- Populated migration gives every historical project-video Normal priority,
  Researcher-or-Administrator completion policy, and one initial open cycle only
  when needed by the read model; it fabricates no completed reviewer evidence.

## Explicit non-goals

- Dismissal/restore, dependency-aware cancellation, activity receipts or
  notifications, keyword scans, automatic-processing/budget policy, or visible
  VERA redesign.
- Exclusive locks that prevent another member from opening/logging research.
- Editing or deleting completed review evidence, deriving completion from batch
  `review_status`, or changing transcription jobs when a review changes.
- Invitations, ownership transfer, Project Settings, comments, player-range
  logging, live providers/media, deployment, production data, or PUNCH-009.

## Acceptance criteria

1. Claims renew across reload and expire deterministically; same-user replay is
   idempotent and two-user takeover requires explicit confirmation.
2. Review completion/reopen creates append-only ordered cycles with stable IDs,
   actor/time, optimistic versions, transcript-readiness basis, and reason.
3. Administrator-only policy blocks Researcher completion while preserving
   ordinary write access; Owner/Administrator governance and nonmember denial
   pass the closed matrix.
4. Priority, policy, claim, review, flags, processing, transcript, and clip count
   remain independent in the canonical bounded read model.
5. Clean/populated migration plus catalog/API concurrency, replay, stale,
   expiry, authorization, and cross-project tests pass.
6. The Workbench displays and mutates the real canonical claim/review model with
   project-generation guards and browser coverage.

## Narrow tests first

1. Contracts for closed claim/review/policy/priority commands and summaries.
2. Clean/populated migration tests for safe defaults, append-only constraints,
   claim uniqueness/expiry, and project isolation.
3. Catalog authority/replay/concurrency tests for claim/renew/takeover,
   complete/reopen, policy, priority, and independent processing/flag evidence.
4. Strict cloud API route tests, then focused Workbench Chromium coverage.
5. Typecheck, migration CLIs, affected and aggregate tests, full Playwright,
   builds, scoped Prettier, and `git diff --check` before closure.

## Completion record

### Decisions and delivered behavior

- Cloud migration `0029_project_video_review_coordination.sql` adds independent
  High/Normal/Low worklist priority and Researcher-or-Administrator versus
  Administrator-only completion policy, one current renewable claim, append-
  only claim/governance/review events, and append-only review cycles. Historical
  project videos receive a deterministic contract-valid UUIDv4-shaped open
  cycle with no fabricated reviewer; direct ingest and clip-first project-video
  creation add the same initial cycle for new rows.
- Claims serialize on the canonical project-video row, survive restart, expire
  without disappearing, renew monotonically, require explicit takeover when
  another member owns or owned the current claim, and preserve generation/
  version monotonicity through release and re-claim. Exact request replay
  returns the stored response; a divergent payload under the same actor/key
  conflicts.
- Claim, governance, and review mutations recheck current membership while
  holding a transaction membership lock. Claims and review actions are limited
  to Owner, Administrator, or Researcher; priority/policy governance requires
  Owner or Administrator. Removed members, Viewers, and nonmembers fail closed.
- Completion snapshots the exact policy and active transcript version used by
  that cycle. Completing without a ready transcript requires explicit warning
  acknowledgment. Reopen requires a reason, creates the next open cycle, and
  retains the completed cycle unchanged. Concurrent completion serializes so
  only one command/event wins.
- The cursor-bounded canonical read model returns priority, completion policy,
  one current-member claim summary with active/expired state, and the latest
  review cycle independently from flags, processing, transcript readiness, and
  clip count. Removed claimants are not disclosed in the current coordination
  read, while append-only evidence remains durable.
- `BatchWorkspace` exposes claim/renew/release/reclaim/takeover, complete/reopen,
  priority, and policy controls through the strict cloud routes. Commands use
  stable payload-derived idempotency keys and the existing project/auth request-
  generation guards; React does not become the authority for role or state.

### Files changed for this slice

- `packages/contracts/src/index.ts` and `index.test.ts`
- `packages/db-cloud/migrations/0029_project_video_review_coordination.sql`
- `packages/db-cloud/src/index.test.ts`
- `packages/catalog/src/index.ts` and `index.test.ts`
- `apps/cloud-api/src/app.ts` and `app.test.ts`
- `apps/web/src/batch-workspace.tsx`
- `tests/e2e/workspace.spec.ts`
- `PROJECT_GUIDE.md`, `outline.md`, and
  `specs/future/PILOT-punch-list.md`

### Verification evidence

- Final focused coordination regressions after review fixes: 4 passed.
- Final affected contracts/cloud-migration/catalog/cloud-API matrix: 4 files
  passed; 122 tests passed and 2 optional real-PostgreSQL tests skipped.
- Focused Chromium claim/renew/governance/complete/reopen flow: 1 passed,
  0 failed.
- Aggregate network-free Vitest rerun in isolation: 53 files passed, 1 file
  skipped; 566 tests passed and 4 skipped. An earlier aggregate attempt was run
  concurrently with other heavy gates and four unrelated PGlite tests exceeded
  their 15-second timeout; the isolated rerun had no failure.
- Full Playwright: 11 passed, 0 failed.
- `npm run typecheck`: passed after the final migration/authorization review
  fixes.
- `npm run build:web` and `npm run build:desktop`: passed.
- Cloud migration CLI: 29 migrations newly applied successfully after the final
  deterministic UUID correction.
- Local migration CLI: 30 migrations newly applied successfully; no local
  migration was required.
- Scoped Prettier for supported TypeScript/TSX files and `git diff --check`:
  passed. The SQL migration was reviewed manually because this repository's
  Prettier configuration has no SQL parser. Full-repository Prettier remains
  blocked by the unrelated pre-existing
  `docs/Script-to-Resolve Product Spec.md` formatting failure.

### Remaining risks and follow-ups

- `CLOUD_DATABASE_TEST_URL` was not configured, so two optional real PostgreSQL
  tests remain skipped. Clean and populated PGlite migration, constraints,
  replay, and concurrency tests passed; no production database was used.
- Terra/multi-agent tooling was unavailable, so no independent review is
  claimed. Root review covered authorization/removal races, role boundaries,
  exact replay, migration/backfill compatibility, concurrency, bounded identity
  disclosure, and UI project-state guards; it found and fixed the deterministic
  UUID and transaction membership-lock issues before closure.
- Dismissal/restore, dependency-aware cancellation, durable activity receipts,
  and notifications remain the next bounded PUNCH-004 slice. Automatic local/
  hosted processing and project budget policy remain separate later work.
- No commit was created; this slice remains part of the preserved coherent dirty
  worktree.
