# M5-15 — Registered local-worker identity and capability advertisement

- Status: completed
- Dependency: M5-14B verified local export capability matrix

## User-visible outcome

An authorized local workstation can register one durable worker identity with the
shared catalog and advertise its immutable worker software/capability profile.
Authorized project export creation can see whether a compatible worker is
currently available; no compatible authorized worker leaves work queued rather
than claiming, downloading, or rendering it.

## Smallest vertical slice

Add one versioned worker-registration contract, cloud persistence/migration,
authorized local-agent registration/heartbeat command, and project-authorized
read model. The advertised capability is a typed immutable profile reference
plus a normalized installed renderer summary/fingerprint and bounded expiry; it
contains no paths, credentials, source media, raw capability vocabulary, or raw
FFmpeg arguments.

## In scope

1. Shared strict schemas for worker ID, owner, capability profile/version and
   fingerprint, installed capability summary, registration epoch, heartbeat,
   expiry, and compatible-worker availability.
2. Cloud migration and catalog/API commands: actor-owned registration/upsert,
   heartbeat, revocation-safe authorization, expiry filtering, and
   project-authorized compatibility query.
3. Local-agent durable identity/config boundary and loopback command which
   discovers the existing installed capability adapter and registers only the
   typed normalized result.
4. Deterministic contract/catalog/API/local-agent tests for authorization,
   expiry, profile mismatch, duplicate registration, and unavailable workers.

## Non-goals

No logged-export delivery/claim, lease, result reconciliation, progress, retry,
cancellation, batch/group ownership, cleanup sweep, UI executor, cloud media,
or M6/M7 behavior. This slice advertises availability only.

## Failure states

- Missing/expired registration, invalid capability vocabulary, profile mismatch,
  or unauthorized actor is not available for projects and cannot be used as a
  worker claim authority.
- Registration and heartbeats fail closed without exposing credentials or local
  paths. A local discovery failure advertises nothing.

## Acceptance criteria

1. Registration is actor-owned, durable, idempotent by worker identity and
   epoch, and visible only through authorized project-compatible queries.
2. Capability profiles are immutable/versioned and derived only from existing
   typed discovery; profile and installed capability mismatch is rejected.
3. Expired/revoked/mismatched workers are unavailable while requests stay
   queued; this slice makes no render or source-acquisition call.
4. Existing export-only local processing and M5-14B packages are unchanged.

## Verification plan

Run shared contracts, cloud migration/catalog/API, and local-agent registration
tests first; then typecheck, relevant web/build checks if an availability read
is exposed, migration checks, `git diff --check`, and full staged-diff review.

## Completion record

- Completed 2026-08-20. The local agent persists one SQLite-backed worker ID,
  epoch, and previous immutable advertisement fingerprint. A restart replays the
  same identity/epoch; a discovery-derived capability change advances the epoch.
- Registration accepts only the current explicitly implemented typed renderer
  profile. It persists a safe normalized installed summary and deterministic
  advertisement fingerprint—not FFmpeg paths, raw encoders/muxers/filters,
  tool arguments, source data, or credentials. Discovery failure does not
  persist or send an advertisement.
- The advertised renderer set is a unique, canonical complete partition of the
  three known renderer IDs. It is deliberately conservative: every advertised
  renderer requires its base encoder/muxer plus `scale`, `fps`, and the fixed
  English soft-subtitle encoder (`mov_text` for MP4/MOV or `srt` for MKV).
- Cloud registration is actor-owned. The same epoch may only refresh an
  identical immutable advertisement; a changed payload conflicts, a stale epoch
  conflicts, and a higher epoch replaces it. Heartbeat is a separate owner-only
  60-second bounded command that cannot mutate capabilities. Revocation blocks
  availability and requires a higher epoch to register again.
- Project availability authorizes the reader, joins worker owners to project
  membership, filters expired/revoked workers, checks the requested immutable
  profile plus renderer ID, and returns only a compatible boolean/count—never
  a worker-owner identity. No export delivery, claim, source acquisition,
  render, result, progress, retry, cancellation, grouping, or cleanup behavior
  was introduced.
- Added cloud migration `0012_registered_export_workers.sql` and local migration
  `0018_registered_export_worker_identity.sql`. Existing local export-only
  processing and M5-14B packages are unchanged.
- Verification: focused contracts/export-settings/local DB/cloud DB/catalog/
  cloud API/local-agent tests passed; `npm run check` passed formatting,
  typecheck, 183 tests with one declared skip, production web build, and fresh
  local/cloud migration checks (18 and 12 migrations respectively). The five
  final catalog audit regressions also passed in a focused four-test run, and
  the staged diff whitespace check passed.
- Implementation commit: `e2ba1a7` (`feat: register local export worker capabilities`).
