# M5-17 — Execute and reconcile one accepted logged export success

- Status: completed 2026-08-20
- Task/thread: M5-17 only
- Dependency: completed M5-16 authorized logged-export delivery

## User-visible outcome

One logged export that has already completed M5-16 cloud acceptance can run
through the existing local `LocalExportSourceProcessor` and become one verified
local package. The owning registered worker can then reconcile a sanitized,
immutable success result to the shared catalog. The authoritative cloud export
request/job and logged clip become complete atomically, and replay after a lost
response neither rerenders nor creates a second result.

This slice reconciles verified successful completion only. A local processing
failure remains durably actionable in SQLite while the accepted cloud request
is unchanged; authenticated cloud failure reconciliation, retry policy, and
user-facing recovery are the immediate follow-up rather than being falsely
claimed here.

## Smallest end-to-end proof

Create one authorized logged export, register and heartbeat one compatible
project-member-owned local worker, claim/import/accept the request through the
M5-16 boundary, and invoke one loopback process/reconcile command with explicit
source authorization. Use injected repository-owned fixture providers to run
the accepted request through the existing processor. Prove:

1. the exact local request becomes complete only after its verified package is
   promoted and source scratch is deleted;
2. the cloud result contains only normalized result identity, resolved/rendered
   provenance, subtitle-policy provenance, and artifact roles/sizes/SHA-256s;
3. one cloud transaction inserts the immutable result and changes the exact
   export job and clip to `complete`;
4. a retry after local completion or a simulated lost cloud response skips
   rendering, replays the byte-equivalent result, and returns the same result;
5. a divergent duplicate, stale/wrong worker epoch, different delivery
   generation/token, expired/revoked registration, or removed membership is
   rejected without changing the canonical result.

## Architectural decisions and invariants

1. Execution reuses `runLocalExportOnce` and its single
   `LocalExportSourceProcessor`; this slice adds no executor, render queue, or
   alternate media path.
2. The loopback command selects one explicit request ID and requires both a
   bearer authorization and `authorizationConfirmed: true`. The locally
   persisted accepted delivery must belong to the current worker ID and epoch
   before any processor/provider call.
3. The local completed request is the only source of the result projection.
   Reconciliation is impossible unless the job is `complete`, final artifacts
   are present, and the established cleanup gate has already removed source
   scratch.
4. The shared result request carries the exact stable request/job/project/clip,
   delivery ID, accepted generation, worker ID/epoch, and reservation token for
   verification. The immutable stored result deliberately omits the token.
5. The stored result is a strict sanitized projection: schema version,
   resolved bounds, normalized rendered-media conformance, thumbnail and
   language-policy provenance, package identity, and sorted artifact
   role/size/SHA-256/source-attempt/validation values. It contains no local
   path, artifact locator, acquisition/source identity, noncanonical source URL,
   credential, presigned/private URL, raw FFmpeg arguments/output, scratch
   record, worker owner identity, or reservation token.
6. One cloud result row is unique per export request and accepted delivery.
   Its canonical SHA-256 fingerprint makes an exact replay idempotent and a
   divergent duplicate conflict. Artifact identities are immutable catalog
   provenance only; this slice does not claim the package bytes are remotely or
   currently locally reachable.
7. Reconciliation reauthorizes the actor against the exact worker owner,
   current epoch, active/unexpired/unrevoked registration, current project
   membership, accepted delivery generation/token, and immutable request/job/
   clip identity inside the result transaction.
8. The transaction inserts the result, changes only the exact export job from
   its M5-16-preserved `queued` state to `complete`, changes the
   exact clip export status to `complete`, increments the clip version, and
   emits one completion sync event. Existing exact result replay creates no
   second event or version increment.
9. Cloud reads map the immutable reconciled provenance back onto the existing
   `ExportRequest` contract. Pre-result requests remain backward-compatible.
10. A local success/cloud-call crash window is recovered by rerunning the same
    command: `runLocalExportOnce` returns `already_complete`, the same persisted
    provenance is projected, and reconciliation retries. A cloud-commit/lost-
    response window is recovered by the catalog's exact-result replay.

## Affected boundaries

- Shared contracts: strict success result payload, reconcile command, and
  response schemas with cross-field identity/provenance validation.
- Cloud persistence/catalog/API: one migration for immutable logged-export
  results, atomic authorization/idempotency/completion, mapped request reads,
  and one authenticated reconcile route.
- Local repository/runtime/loopback API: retrieve exact accepted delivery,
  project deterministic completed provenance, run exactly one request through
  the existing one-shot executor, and reconcile it through a narrow cloud
  adapter.
- Tests: contracts, fresh/populated cloud migrations, catalog/API
  authorization and replay, local repository projection, loopback crash
  windows, and a smallest injected processor-boundary integration proof.

## Failure windows

- Before local execution starts: ownership/provenance/authentication mismatch
  fails before any capability, transcript, acquisition, or renderer call.
- During local processing: the existing processor records its safe local error
  and cleanup outcome; this slice sends no success result and changes no cloud
  terminal state.
- After local completion but before/cloud-during reconciliation: the verified
  package and local terminal provenance remain; retry does not rerender and
  resends the exact result.
- After cloud commit but before the local caller receives the response: replay
  returns the existing result without a second clip version/event.
- Divergent replay or mismatched request/job/clip/delivery/artifact provenance:
  cloud returns conflict and preserves the first immutable result.
- Registration expiry/revocation, epoch change, actor mismatch, or project
  membership removal before reconciliation: cloud rejects the result and leaves
  the local package intact. An expiry may be renewed at the same epoch; a
  revocation or changed epoch can require explicit administrative/reassignment
  recovery because the accepted delivery remains pinned. This slice promises no
  automatic recovery for those states.

## Explicit non-goals

- Failure/cancellation reconciliation, execution leases/heartbeats, continuous
  polling/supervision, progress events, automatic retry, user-facing retry or
  cancellation, and cleanup-only recovery.
- Batch export, sibling isolation, same-source grouping, source reuse, abandoned
  scratch sweeping, the 30-second fixture gate, or a live YouTube smoke test.
- Artifact upload/cloud clip bytes, local locator publication, reveal/open,
  availability verification, relink, Clip Library, authoring handoff, M6/M7, or
  export-only cloud synchronization.
- Mutating or replacing an earlier completed local package or cloud result.

## Acceptance criteria

1. Only one already accepted logged request owned by the current exact local
   worker can enter the established processor from the loopback command.
2. Local processing retains all existing capability, transcript, subtitle,
   package, hash, and verified source-cleanup gates.
3. Cloud reconciliation requires current worker ownership/epoch/registration
   and project membership plus the exact accepted delivery token/generation.
4. The first verified success atomically creates one immutable result and marks
   the exact cloud job and clip complete; no unrelated request/clip changes.
5. Exact replay returns the same result without rerender, duplicate rows,
   duplicate events, or extra clip version increments. Any different result
   bytes or provenance conflicts.
6. The result and cloud database contain no local path/locator, source
   acquisition identity or URL, credential/token beyond the existing delivery
   table, raw tool arguments/output, scratch details, or owner identity.
7. Existing M5-16 claim/import/accept behavior and local export-only execution
   remain unchanged.
8. Local failures are explicitly not reported as cloud success or completion;
   durable failure reconciliation remains named as the next follow-up.

## Verification plan

Run focused contract, local DB, cloud migration/catalog, cloud API, local-agent
route, and existing processor/one-shot tests first. Add a deterministic injected
end-to-end test crossing accepted local delivery -> existing processor -> cloud
result without live media/network access. Then run `npm run typecheck`, fresh and
populated migration checks, full `npm run check`, proportional Playwright only
if a browser surface changes, and `git diff --check`.

Before completion, inspect the entire diff for duplicate processor/queue paths,
incorrect cloud authority, missing authorization, replay races, mutable result
fields, path/token/source leakage, premature cloud completion, relaxed cleanup
or subtitle gates, export-only sync, and populated-schema compatibility. Do not
update `PROJECT_GUIDE.md`/`outline.md`, move this spec, stage, or commit until the
orchestrator reviews the verified no-commit checkpoint.

## Completion record

- Completed 2026-08-20. One explicit loopback command now verifies that an
  accepted logged delivery belongs to the current local worker/epoch before any
  provider call, requires `authorizationConfirmed: true`, and reuses the
  existing `runLocalExportOnce`/`LocalExportSourceProcessor` composition. A
  locally complete retry projects the same persisted verified provenance and
  never touches media again.
- The cloud transaction reauthorizes the actor-owned worker, exact current
  epoch, live/unrevoked registration, current project membership, accepted
  delivery generation/token, and immutable request/job/project/clip identity.
  It binds settings, media family, bounds/duration, subtitle track IDs/versions,
  English language policy, and sorted artifact roles before changing only the
  exact `queued` job/clip to `complete` and emitting one sync event. Exact replay
  is a no-op; divergent or request-inconsistent replay conflicts.
- Cloud migration `0014_logged_export_success_results.sql` adds the immutable
  unique result/fingerprint record. Local migration
  `0020_logged_export_delivery_acceptance_time.sql` preserves the exact accepted
  timestamp across fresh and populated SQLite schemas. The result row, event,
  and response contain no reservation token, owner identity, authorization
  header, local path/locator, source-acquisition identity/private URL, scratch
  detail, or raw FFmpeg arguments/output.
- Independent orchestration verification passed the focused contract/database/
  catalog/API/local-runtime suite 94/94. Final `npm run check` passed formatting,
  typecheck, 207 tests with one declared skip, the production web build, and
  fresh local/cloud migration checks (20 and 14 migrations). The real
  repository-owned FFmpeg/FFprobe accepted-logged-delivery proof passed. No
  Playwright run was needed because this slice changes no browser/UI surface.
  `git diff --check` and the final security/compatibility audit passed.
- The immutable cloud `subtitle_tracks_snapshot` records track IDs and versions
  but not original-language tags. Reconciliation therefore exact-binds both
  track identities/versions and validates the English result as `en`; it cannot
  compare the original result language tag with snapshot data that does not
  exist. Extending that immutable snapshot is a future request-schema decision.
- Remaining risk/follow-up is authenticated failure reconciliation and recovery:
  local failures remain durable while the cloud request stays queued. Expired
  registration may recover after same-epoch renewal, but revocation or epoch
  change leaves the accepted delivery pinned and may require explicit
  administrative/reassignment recovery. User-facing retry/progress/cancel,
  batching/grouping, polling/supervision, cleanup sweeping, the 30-second gate,
  and live-provider release proof remain outside this slice.
- Implementation commit: `475c0e8` (`Implement logged export success reconciliation`).
