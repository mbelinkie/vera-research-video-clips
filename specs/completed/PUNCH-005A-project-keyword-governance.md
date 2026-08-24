# PUNCH-005A — Project keyword and alias governance

- Status: active
- Parent entry: `PUNCH-005`
- Priority: P1 high
- Dependencies: completed PUNCH-001 language integrity, PUNCH-003A authority,
  and PUNCH-004A–E canonical project-video/work-processing foundations

## User-visible outcome

Each project has one durable, versioned set of approved positive literal
keywords. An approved keyword has a stable identity, display label, optional
description, enabled state, and one or more language-tagged literal aliases.
Project members can read the bounded set. Researchers can suggest a new keyword
or an alias for an existing keyword with optional rationale; current Owners or
Administrators can approve or reject the suggestion. Approval atomically creates
or attaches the alias and advances the project keyword-set version exactly once.

The existing Workbench exposes the real approved vocabulary and pending
suggestions. It keeps these project scan rules visibly separate from clip tags
and does not claim that a keyword has matched any transcript before the later
scan slice exists.

## Smallest end-to-end proof

A Researcher suggests `Climate change` in English. Unicode/case-equivalent
replay returns the same pending suggestion instead of another review row. The
Researcher cannot approve it. An Administrator approves with the current
suggestion and keyword-set versions; one canonical keyword plus one normalized
English alias appears, the set version advances once, and exact command replay
returns the stored response. A divergent key, stale/concurrent approval,
removed member, Viewer, nonmember, or cross-project request fails closed.
Another Researcher can suggest a distinct-language alias for the approved
keyword, while an alias equivalent within the same language resolves to the
already-approved record.

## Affected authority boundaries and persisted records

- Shared contracts own normalized literal phrase/language bounds, approved
  keyword/alias summaries, suggestion states, bounded project reads, strict
  suggest/review commands, and exact result shapes.
- Cloud migration 0033 adds the project keyword-set version, canonical keyword
  and alias tables, pending/reviewed suggestions, and exact-replay command
  receipts. No local migration is required.
- The shared catalog owns Unicode normalization, current-membership/role checks,
  duplicate resolution, optimistic set/suggestion versions, transactional
  approval/rejection, and bounded reads.
- Strict cloud API routes expose the catalog. `BatchWorkspace` only renders and
  invokes those typed boundaries; it never owns approved state or normalization.

## Failure, restart, concurrency, authorization, and migration behavior

- Keywords and aliases survive restart and use stable IDs. Phrase uniqueness is
  project-and-language scoped after deterministic NFKC plus locale-independent
  case folding and whitespace normalization. Uniqueness uses the exact
  normalized BCP-47 tag, so regional aliases such as `en` and `en-US` remain
  deliberately distinct, as do aliases in different languages.
- Suggestion creation requires current project write authority. Current Owners,
  Administrators, and Researchers may suggest; compatibility-only Viewers,
  removed members, and nonmembers are denied.
- Only a current Owner or Administrator may approve/reject. Review requires the
  exact suggestion version; approval additionally requires the exact project
  keyword-set version. Project-row locking plus alias uniqueness prevents two
  approvals from advancing the set twice or creating duplicate aliases.
- Exact command replay returns the stored response. Reusing an idempotency key
  for a divergent payload conflicts. An equivalent approved alias returns that
  canonical keyword/alias; an equivalent pending suggestion returns the
  existing suggestion without a second receipt or notification row.
- Approval of a new-keyword suggestion creates the keyword and primary alias in
  the same transaction. Approval of an alias suggestion requires the still-
  current target keyword and enforces the bounded 100-alias catalog shape.
  A normalized display-label collision fails with an actionable conflict rather
  than a generic database error. Rejection records reviewer/time/reason and does
  not advance the keyword-set version; its supplied set version is retained in
  exact command identity but is not a mutation precondition because rejection
  does not change the approved set.
- Historical projects migrate to keyword-set version 1 with an empty approved
  set and no fabricated keyword, suggestion, actor, or audit evidence.

## Explicit non-goals

- Transcript scanning, scan jobs/artifacts/checksums, occurrence counts,
  contexts, density, freshness, highlighting, worklist grouping, or rescan.
- Fuzzy/stemmed/semantic/Boolean/exclusion matching, AI analysis, or PUNCH-009.
- Clip tags/topics, clip descriptions/comments, automatic project-video
  priority/dismissal, notifications beyond retained governance evidence, or
  Project Settings shell redesign.
- Live providers/media, production data, deployment, external services, commit,
  or push.
- Suggestion withdrawal and direct keyword/alias rename, enable/disable, or
  deletion controls. This bounded slice supports approved vocabulary creation
  through suggestion/review; later Project Settings governance must add those
  maintenance commands before claiming the parent entry's complete settings
  surface.

## Acceptance criteria

1. Approved keyword/alias reads are project-authorized, bounded, stable-ID,
   restart-safe, and separate from clip tags and transcript evidence.
2. Researcher suggestion deduplicates exact replay plus same-language
   case/Unicode/whitespace-equivalent approved or pending aliases while allowing
   a distinct-language alias.
3. Owner/Administrator review is current-role checked, optimistic, exactly
   replayable, divergent-key safe, cross-project isolated, and denied to
   Researcher/Viewer/nonmember/removed-member actors.
4. Approval atomically creates/attaches one alias and advances one keyword-set
   version; reject leaves the set unchanged. Concurrent/stale approvals produce
   no partial keyword, orphan alias, duplicate receipt, or double increment.
5. Clean/populated migration tests prove empty historical defaults, uniqueness,
   foreign keys, and safe compatibility.
6. Workbench browser coverage proves approved/pending separation, suggestion,
   approval/rejection, stable command keys, refresh, and project-state clearing.
7. Contracts, catalog/API/browser tests, typecheck, builds, migration CLIs,
   scoped formatting, aggregate tests, and `git diff --check` pass without
   external access.

## Narrow tests first

1. Strict contracts plus clean/populated migration 0033 tests.
2. Catalog normalization, duplicate, role, replay, optimistic-concurrency, and
   cross-project tests.
3. Strict cloud API forwarding tests.
4. Focused Chromium keyword suggestion/review flow.
5. Typecheck, affected/aggregate suites, migration CLIs, full Playwright,
   builds, scoped Prettier, and `git diff --check` before closure.

## Completion record — 2026-08-24

Status: completed and ready to move to `specs/completed/` after final scoped
formatting and diff validation.

### Decisions

- Alias uniqueness uses the exact normalized BCP-47 tag. `en` and `en-US` are
  intentionally distinct rather than primary-language equivalent.
- A project catalog is bounded to 100 aliases. Approval that would create alias
  101 fails transactionally and leaves the pending suggestion, set version,
  review fields, and command receipts unchanged.
- Normalized new-keyword label collisions and overlong normalized labels return
  actionable conflicts/validation errors instead of generic SQL failures.
- Rejection requires the exact suggestion version and retains
  `expectedKeywordSetVersion` in command identity, but does not reject a stale
  set version because it does not mutate the approved set.
- The supported suggestion lifecycle is `pending | approved | rejected`.
  Suggestion withdrawal and direct keyword/alias rename, enable/disable, and
  deletion remain deferred to a later Project Settings maintenance slice.
- Vitest file workers are bounded to four because the growing independent
  PGlite migration suites and FFmpeg fixtures otherwise turn the existing
  per-test timeout into a machine-load race.

### Files changed

- `packages/contracts/src/index.ts` and `index.test.ts`
- `packages/db-cloud/migrations/0033_project_keyword_governance.sql`
- `packages/db-cloud/src/index.test.ts`
- `packages/catalog/src/index.ts` and `index.test.ts`
- `apps/cloud-api/src/app.ts` and `app.test.ts`
- `apps/web/src/batch-workspace.tsx`
- `tests/e2e/workspace.spec.ts`
- `vitest.config.ts`
- `PROJECT_GUIDE.md`, `outline.md`, and
  `specs/future/PILOT-punch-list.md`

### Verification evidence

- Focused contract test: 1 passed, 51 skipped.
- Focused populated migration 0033 test: passed.
- Focused catalog keyword/alias tests: 3 passed, 48 skipped.
- Focused keyword and project-switch browser flows: 2 passed.
- Full PUNCH-005A matrix: 4 files passed; 142 tests passed, 2 skipped.
- `npm run typecheck`: passed.
- `npm run build:desktop`: passed with the existing Vite chunk-size advisory
  (approximately 516 kB).
- Cloud migration CLI: 33 migrations passed.
- Local migration CLI: 30 migrations passed.
- Full sequential Playwright run: 11 passed.
- Aggregate Vitest with four workers: 53 files passed, 1 skipped; 588 tests
  passed, 4 skipped. The exact `npm test` script was rerun after encoding the
  same four-worker limit in `vitest.config.ts`; its final result is recorded
  before the spec is moved.
- `git diff --check`: passed before this completion-record edit and is rerun
  after scoped formatting.

### Review, external evidence, and remaining risks

- Terra/multi-agent tooling was unavailable, so no independent-agent review is
  claimed. The root implementation reviewed the bounded authorization,
  migration, replay, and concurrent-approval behavior directly.
- No live provider, live media, production cloud, deployment, external-service,
  commit, or push evidence was used or claimed. No commit was requested, so
  there is no completion commit ID.
- Direct vocabulary maintenance and suggestion withdrawal remain open as
  documented non-goals. Deterministic multilingual scanning, private match
  artifacts, freshness/rescan behavior, and worklist relevance UI remain for
  PUNCH-005B and later bounded slices.
