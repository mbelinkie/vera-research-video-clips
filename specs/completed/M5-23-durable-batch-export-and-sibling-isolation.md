# M5-23 — Durable batch export and sibling isolation

- Status: completed 2026-08-22
- Task/thread: M5-23 only
- Dependencies: completed M5-20 retry, M5-21 execution/cancellation, and M5-22 progress

## User-visible outcome

A project member can submit a bounded set of eligible logged clips as one
idempotent batch and read a sanitized aggregate status. Every item becomes one
ordinary immutable logged export request and continues through the existing
delivery, exact execution, progress, cancellation, retry, and reconciliation
boundaries. A sibling's failure, cancellation, cleanup problem, restart, or
replay cannot mutate another item.

## Smallest end-to-end proof

Create one three-item project batch in a single cloud transaction. Claim and
process its child requests independently through the established per-request
executor, then complete one, fail one, and cancel one. The batch read derives
`1 complete / 1 failed / 1 canceled` from the current immutable retry leaf for
each item, never reports whole-batch success, exposes each item's M5-22 progress
without credentials, and preserves exact replay after restart or a lost create
response.

## Architectural decisions and invariants

1. A batch is cloud composition and a sanitized read model, not another queue,
   executor, delivery, execution lease, cancellation scope, result, or source
   owner. The local worker still receives and runs individual deliveries.
2. Creation validates every item and all resolved-settings/subtitle snapshots
   before writing anything, then creates the batch, immutable item membership,
   one root job/request per item, clip status changes, and sync evidence in one
   transaction. Any invalid sibling rolls the whole command back.
3. Project-scoped idempotency replays the original batch exactly. Reusing the
   key with a different canonical command conflicts. Membership, ordinal, clip,
   and root request identity never change.
4. A clip may appear once in a batch and must not already have active or
   completed export state. Batch membership remains on all immutable M5-20 retry
   descendants, but aggregate status follows only the current leaf of each
   linear retry chain.
5. Summary state is derived, never a mutable batch terminal flag. It reports
   exact counts for queued, processing, complete, failed, and canceled leaves;
   `complete` means every current leaf succeeded. Mixed terminal outcomes remain
   visibly mixed.
6. Batch reads contain no delivery reservation, worker/execution lease, source
   identity, local path, artifact locator, raw error, transcript text, or command
   output. Project membership is checked at read and write time.

## Affected boundaries

- Shared contracts: bounded create command, immutable batch/item projection,
  derived summary, and list/single response schemas.
- Cloud migration/catalog/API: batch tables, immutable request membership,
  atomic creation/replay, retry inheritance, and project-authorized reads.
- Minimal web surface: select eligible project clips, submit one batch, and show
  a compact sanitized status summary without creating an M6 Clip Library.
- Local runtime: regression proof only; no batch-specific executor state.

## Explicit non-goals

- Batch cancellation, scheduling, concurrency controls, a batch worker loop, or
  a group execution lease.
- Same-source acquisition sharing or group scratch ownership; that is M5-24.
- Clip Library search/filter, artifact browsing, relink/re-export UX, M6, or M7.

## Acceptance criteria

1. Fresh and populated cloud migration adds immutable batch membership and
   preserves existing requests; retry children inherit the original item.
2. Valid mixed-language batches snapshot every item exactly and commit
   atomically; duplicate clips, ineligible state, missing foreign subtitle
   tracks, wrong project, and any settings mismatch write nothing.
3. Exact and concurrent idempotent replay produces one batch and no orphan jobs;
   divergent reuse conflicts.
4. Each sibling retains independent delivery, execution, progress, cancel,
   cleanup, package, retry, and mutually exclusive terminal evidence.
5. Aggregate reads follow retry leaves and accurately represent mixed outcomes;
   no sibling can make another item or the whole batch falsely successful.
6. A minimal project UI can submit eligible selections and poll the sanitized
   batch read without exposing private worker or artifact data.

## Verification plan

Run focused contracts, fresh/populated migration, catalog transaction,
idempotency/concurrency, retry-lineage, API authorization, local-agent sibling
regression, and minimal web tests first. Then run formatting, typecheck, both
migration CLIs, `git diff --check`, the full `npm run check`, and Playwright for
the added browser surface. Keep all source acquisition and execution delegated
to the existing per-request path.
