# M5-16 — Authorized logged-export delivery to the local worker

- Status: completed
- Task/thread: M5-16 only
- Dependency: M5-15 registered local-worker capability advertisement

## User-visible outcome

One immutable logged export request that is already queued for an authorized
project can be assigned to one compatible live local worker owned by a current
project member and durably accepted into that workstation's existing local
export queue. Repeated transport delivery imports the same local request and
does not mutate its video, transcript selection, subtitle-track, source-language,
or resolved-settings snapshots. If no eligible worker exists, the project
request remains queued.

This slice stops at durable local acceptance. It does not acquire source media,
render, or report an execution result.

## Smallest end-to-end proof

Create one logged export through the existing authorized project command,
register a compatible actor-owned local worker, and invoke one loopback
claim/import command. Prove that the cloud catalog atomically reserves the exact
queued request, returns only a bounded immutable delivery envelope, SQLite
imports it into the existing `LocalExportQueue`, and cloud acceptance records
that durable handoff. Replay the same delivery and command, including a
simulated lost acceptance response, and prove there is still one local request
with byte-equivalent immutable snapshots. Prove an incompatible, expired,
revoked, wrong-epoch, nonmember, or differently owned worker receives no work.

## Decisions

1. The cloud database is authoritative for request reservation and worker
   ownership. One stable delivery UUID per export request plus a monotonically
   increasing reservation generation and fresh token identifies each
   at-least-once handoff attempt; one nonexpired reservation or accepted
   delivery excludes every other worker.
2. A reservation belongs to an exact worker ID and registration epoch. Its
   owner must still be a project member both when claiming and accepting.
3. Claim eligibility requires an active, unexpired, unrevoked registration,
   an exact match to the request's immutable capability profile, and the exact
   renderer ID in the worker's conservative installed summary. Legacy or
   malformed snapshots remain queued rather than falling back.
4. Expired unaccepted reservations may be redelivered under the same stable
   delivery ID with a higher generation and fresh token. The previous
   generation/token can no longer be accepted after expiry. An accepted
   delivery remains assigned; execution/result recovery is a later slice.
5. Local import is deliberately two-phase. One SQLite transaction inserts the
   cloud job and logged request using their stable IDs plus delivery provenance
   in `pending_acceptance`; neither the processor nor any future queue runner
   may start it. An exact replay returns the existing request. Any same-ID or
   same-delivery payload mismatch conflicts instead of overwriting immutable
   data. Only a successful cloud acceptance moves it atomically to runnable
   `queued` state.
6. Claim and acceptance carry the delivery ID, monotonically increasing
   reservation generation, and a fresh opaque reservation token. The loopback
   adapter claims from cloud, imports pending locally, acknowledges cloud
   acceptance, then activates the exact local generation/token. If the cloud
   acceptance response is lost after the cloud commit, the owning worker can
   replay/read the accepted delivery, idempotently reuse the pending row, and
   activate it. If reservation expiry/reassignment wins first, stale acceptance
   conflicts and the stale pending local copy is transactionally removed or
   durably rejected so it can never execute.
7. Delivery responses contain the required opaque reservation token, but no
   worker owner identity, local path, source-media acquisition credential,
   presigned/private source URL, or private source-media locator.

## In scope

1. Strict shared claim, delivery-envelope, empty-result, and acceptance
   contracts with stable delivery identity, reservation generation/token,
   worker epoch, reservation expiry, and the immutable logged `ExportRequest`
   snapshot.
2. One cloud migration for durable logged-export delivery reservations,
   acceptance state, attempt numbering, uniqueness, and claim indexes.
3. Project- and worker-authorized catalog claim/accept commands using an atomic
   locked candidate selection supported by both PGlite tests and PostgreSQL.
4. Cloud API routes for the authenticated worker claim and acceptance commands.
5. One local migration allowing delivered `logged` requests in the existing
   local export queue and recording stable cloud-delivery provenance without
   weakening the projectless `export_only` boundary.
6. A transactional `LocalExportQueue` import method with strict replay equality.
7. One local-agent cloud adapter and loopback claim/import/accept route using
   the already persisted worker identity. It must not call the processor.
8. Focused contract, cloud migration/catalog/API, local migration/repository,
   and local-agent tests, followed by proportional repository verification.

## Failure states

- No compatible current-member-owned worker or no compatible queued request
  returns an empty claim result; the request remains queued.
- Worker identity/epoch ownership mismatch, expiry, revocation, or lost project
  membership fails closed for claim and acceptance.
- Capability profile or renderer mismatch leaves the request queued without
  fallback or mutation.
- A concurrent claimant cannot reserve a request that already has a live
  reservation or accepted delivery.
- An expired delivery generation/token cannot be accepted; the request becomes
  eligible for a fresh reservation generation/token. A stale pending local copy
  is removed or durably rejected and can never execute.
- Local duplicate delivery with different immutable bytes, IDs, mode, project,
  clip, or worker provenance conflicts and preserves the original row.
- Local persistence failure prevents cloud acceptance. An ambiguous lost
  response after cloud acceptance leaves a non-runnable pending row that the
  owning worker can activate from the accepted-delivery replay. A definitive
  stale-generation conflict rejects/removes the pending row.
- Authentication and remote failures return bounded actionable errors without
  logging or returning source-media acquisition secrets, paths, or private URLs.

## Explicit non-goals

- Starting `LocalExportSourceProcessor`, source acquisition, transcript fetch,
  FFprobe, FFmpeg, subtitle derivation, package promotion, or any rendering.
- Durable execution leases/heartbeats, progress, result/artifact reconciliation,
  completion/failure reporting, retry/cancel controls, or cleanup-only retry.
- Batches, sibling isolation, same-source grouping, queue polling/supervision,
  cleanup sweeping, final 30-second fixture/live-provider gates, M6 Clip Library
  or authoring handoff, M7 distribution, hosted execution, or cloud clip bytes.
- Export-only cloud delivery or importing a local export-only request into the
  shared catalog.
- A second executor, alternate render queue, or any bypass of
  `LocalExportSourceProcessor` and the existing local export-request boundary.

## Acceptance criteria

1. Claim and acceptance authorize the actor, exact worker owner/epoch, active
   registration, and current project membership on every shared operation.
2. Atomic concurrent claims yield at most one reservation for a queued request;
   no other worker can claim it while reserved or after acceptance.
3. Eligibility matches the exact immutable capability profile and renderer
   required by the resolved snapshot against the conservative installed summary.
4. No eligible worker/request returns no delivery and leaves cloud job/request
   state and immutable snapshots unchanged.
5. The local queue stores the logged project/clip request and exact immutable
   snapshots once; identical replay is a no-op and divergent replay conflicts.
6. A lost cloud-accept response is recoverable by replaying the same accepted
   generation/token and activating the existing pending row. If expiry and
   reassignment win before acceptance, stale accept conflicts and the stale
   local copy is proven non-runnable; both ambiguity windows have deterministic
   tests.
7. Beyond the required opaque reservation token, the handoff response and
   persisted cloud state contain no local filesystem path, source-media
   acquisition credential, private/presigned source URL, raw FFmpeg vocabulary,
   or worker-owner identity.
8. Existing local `export_only` creation/processing remains local-only and
   unchanged, and no processor/provider/media call occurs in delivery tests.

## Verification plan

Run focused contracts/export-settings, cloud migration/catalog/API, local
migration/repository, and local-agent adapter/loopback tests first. Then run
typecheck, format check, full unit/integration tests, production web build,
fresh migration checks, `git diff --check`, and a complete security and
compatibility diff review. Update `PROJECT_GUIDE.md` and `outline.md` only after
behavior is verified. Move this spec to `specs/completed/` only after recording
actual results, migration compatibility, remaining risks, and commit IDs.

## Completion record

- Completed 2026-08-20. Cloud delivery now uses one stable delivery ID per
  logged export request, with a monotonically increasing reservation generation
  and fresh opaque token. Atomic PostgreSQL/PGlite locked selection authorizes
  the worker owner and current project membership, excludes live or accepted
  assignments, and performs exact capability-profile plus conservative renderer
  eligibility in SQL without a bounded incompatible-candidate scan.
- Local import uses the existing `LocalExportQueue` and historical physical
  `export_only` row shape while deriving logical `logged` mode only from complete
  project/clip/delivery provenance. Import, older-pending replacement, orphan-job
  cleanup, and reinsertion are one SQLite transaction. A stable delivery ID is
  locally unique, exact replay is idempotent, divergent/cross-request aliases
  conflict, and failed replacement rolls back to the prior durable pending copy.
- Imported work remains `pending_acceptance` and non-runnable until exact cloud
  acceptance changes it to queued. Lost acceptance responses retry from the
  dedicated local provenance columns before any new claim; definitive stale
  generations are removed and cannot reach `LocalExportSourceProcessor`. The
  generic job payload does not duplicate the reservation token.
- Added cloud migration `0013_logged_export_deliveries.sql` and local migration
  `0019_logged_export_delivery_import.sql`. Fresh and populated-schema migration
  tests passed. Cloud constraints enforce acceptance inside the reservation
  window; SQLite rejects partial provenance, cross-request delivery aliases,
  and every state transition except `pending_acceptance` to `accepted`.
- Verification: `npm run check` passed formatting, typecheck, 197 tests plus one
  declared skip, the production web build, and fresh local/cloud migration
  checks (19 and 13 migrations). After the final local hardening, focused
  db-local/local-agent/processor tests passed 41/41; typecheck, local migration,
  and `git diff --check` passed. Playwright passed 4/4.
- Remaining risk is deliberately bounded to the next slices: the 30-second
  reservation is a handoff window, not a durable execution lease; this slice
  adds no polling supervisor, execution heartbeat, source acquisition, render,
  result/artifact reconciliation, user-visible progress/retry/cancel, grouping,
  cleanup sweep, final 30-second/live-provider gate, M6, or M7 behavior. PGlite
  covers the PostgreSQL locking SQL, but managed-PostgreSQL concurrency remains
  part of deployment validation.
- Implementation commit: `53f1e96` (`Implement authorized logged export delivery`).
