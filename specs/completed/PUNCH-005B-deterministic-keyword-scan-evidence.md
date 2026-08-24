# PUNCH-005B — Deterministic keyword scan evidence

- Status: completed 2026-08-24
- Parent entry: `PUNCH-005`
- Priority: P1 high
- Dependencies: completed PUNCH-005A keyword governance, PUNCH-001 language
  integrity, and immutable shared transcript publication/cache boundaries

## User-visible outcome

Every canonical project video with an active transcript can acquire one durable
project-authorized keyword scan keyed to the exact active transcript version,
approved keyword-set version, and scanner schema version. Matching is literal,
Unicode-aware, language-specific, and deterministic. One spoken interval found
in linked original and translated tracks contributes one canonical occurrence
while retaining each supporting track/alias as inspectable evidence.

The shared catalog exposes a bounded summary with distinct waiting, queued,
scanning, current, stale, and failed states. A completed result references a
private checksummed artifact rather than copying transcript context into catalog
rows. A newly active transcript or approved keyword-set version schedules a
new scan without retranscription and leaves the prior completed evidence
available as stale until the replacement finalizes.

## Smallest end-to-end proof

For one project video with linked Romanian and English tracks, approve aliases
that match the same source-time interval in both tracks. Schedule, claim, and
finalize the scan through duplicate-safe commands. The catalog reports one
canonical occurrence, one matched canonical keyword, the exact transcript and
keyword-set identities, and a private artifact checksum containing both track
evidence records. A second authorized catalog/client can verify and reuse the
same result; a nonmember cannot read it. Changing the active transcript or
keyword set marks the summary stale and queues exactly one replacement while
the transcript version itself remains unchanged.

## Affected authority boundaries and persisted records

- Shared contracts own scanner identity, lifecycle/status, claims/leases,
  deterministic match/artifact shapes, bounded aggregate summaries, and strict
  schedule/claim/heartbeat/finalize/fail requests.
- Cloud migration 0034 adds scan jobs/results, immutable artifact identity,
  exact input uniqueness, leases/attempts, and one current summary pointer per
  project video. Transcript bundles remain unchanged.
- A provider-neutral matcher consumes already verified canonical transcript
  tracks plus the approved alias snapshot and returns deterministic evidence;
  it performs no provider/media/network work.
- The shared catalog owns current membership, scan scheduling, lease recovery,
  exact-input deduplication, stale/current derivation, atomic finalize, and
  bounded authorized summary reads.
- Private object storage owns match-artifact bytes. The catalog retains only
  immutable key/checksum/size/schema identity and bounded aggregate counts.
- Strict cloud API routes expose authorized lifecycle operations. UI grouping,
  context expansion, highlighting, and bulk triage remain PUNCH-005C.

## Failure, restart, concurrency, authorization, and migration behavior

- Scheduling requires current project write authority and resolves the exact
  active transcript plus current keyword-set version transactionally. Missing
  active evidence returns `waiting_for_transcript`; an empty approved alias set
  may finalize a genuine zero-match result without reading transcript text.
- Exact input identity is project, project video, active transcript version,
  keyword-set version, and scanner schema version. Duplicate scheduling or
  queue delivery reuses one row. A new input leaves old completed evidence
  readable as stale and queues one replacement.
- Claims use bounded expiring leases and monotonic attempts. Heartbeats require
  the owning worker/attempt; expiry permits recovery; stale workers cannot
  finalize or fail a replacement attempt.
- Finalize validates the exact job inputs, artifact SHA-256/size/schema,
  aggregate bounds, and worker lease, then atomically records one immutable
  result and current summary pointer. Exact finalize replay returns the same
  result; divergent or concurrent finalize conflicts without duplicate rows.
- Fail records only a bounded sanitized code/message. It does not erase a prior
  completed result and never converts failure into zero matches.
- Only current project members may read summaries or artifact descriptors.
  Worker commands require current project write authority in this local pilot
  slice; removed members and cross-project identities fail closed.
- Historical projects/videos migrate without fabricated scans, actors,
  artifacts, or zero-match claims.

## Deterministic matching rules

- Normalize text and aliases with NFKC plus locale-independent case folding.
  Literal phrase boundaries use Unicode letter/number/mark awareness so a
  phrase does not match inside a longer word; punctuation and whitespace runs
  between alias terms normalize deterministically.
- Match only aliases whose exact normalized BCP-47 tag equals the track
  language. No stemming, fuzzy matching, transliteration, primary-language
  fallback, exclusions, Boolean logic, or semantic inference is allowed.
- Fully timed token spans use exact token bounds. Untimed/cue-only text maps to
  the containing segment's honest cue/estimated bounds and precision.
- Evidence from linked tracks for the same canonical keyword is one occurrence
  when source-time intervals overlap. The canonical bounds are the union of the
  overlapping component and its precision is the least precise supporting
  evidence. Nonoverlapping repeats remain distinct.
- Artifact context is bounded around the matched segment and catalog summaries
  contain no transcript excerpts.

## Explicit non-goals

- Worklist grouping/filtering, timestamp context UI, click-to-seek/highlight,
  fifty-video rendering, newly-completed badges, or bulk priority/dismissal;
  those belong to PUNCH-005C.
- Direct keyword maintenance, suggestion withdrawal, Project Settings redesign,
  clip tags/topics/comments, or broader notifications.
- Transcript acquisition, transcription, translation, activation, mutation, or
  republication; scans consume an existing exact active version.
- Live providers/media, production cloud, deployment, external services,
  PUNCH-009, commit, or push.

## Acceptance criteria

1. Unicode-aware literal matching is deterministic across case, composed/
   decomposed text, punctuation/whitespace, and word-boundary fixtures while
   rejecting substring, language-mismatch, fuzzy, and transliterated matches.
2. Exact token timing and cue/estimated timing remain honest in artifact
   evidence and bounded context.
3. Linked-track overlapping matches deduplicate to one canonical occurrence
   while preserving every supporting alias/track identity; nonoverlapping
   repeats remain separate.
4. Migration 0034 passes clean and populated gates without fabricated evidence.
5. Schedule/claim/heartbeat/finalize/fail survives restart, duplicate delivery,
   expired lease, stale worker, exact replay, divergent reuse, and concurrent
   finalize without duplicate results or partial current pointers.
6. Active-transcript or keyword-set changes produce one queued replacement and
   a stale prior result without retranscription or transcript mutation.
7. Authorized bounded summary/artifact reads work from a second catalog/client;
   nonmember, removed-member, and cross-project reads fail closed.
8. Contracts, matcher, catalog/API, migration, typecheck, aggregate tests,
   scoped formatting, build, and `git diff --check` pass network-free.

## Narrow tests first

1. Matcher fixtures for normalization, language, timing, overlap dedupe, and
   deterministic artifact serialization/checksum.
2. Strict contracts and clean/populated migration 0034 tests.
3. Catalog lifecycle tests for authorization, lease expiry, duplicate schedule,
   stale/current transitions, exact/concurrent finalize, and bounded reads.
4. Strict cloud API forwarding tests and a storage-backed second-client reuse
   integration test.
5. Typecheck, affected suites, migration CLIs, aggregate Vitest, build, scoped
   Prettier, and `git diff --check` before closure.

## Completion record — 2026-08-24

### Decisions and delivered behavior

- Added strict scanner, alias-input, per-track evidence, canonical occurrence,
  private artifact, immutable object-version descriptor, lifecycle summary,
  lease, exact-input, finalize/fail, and upload/download contracts.
- Added deterministic network-free matching in `@research-video/transcript`:
  NFKC/case-normalized Unicode letter/number/mark terms, exact normalized
  language tags, punctuation/whitespace phrase equivalence, honest timed-token
  versus cue/estimated bounds, byte-stable JSON/SHA-256, linked-track overlap
  dedupe, and preservation of repeated same-cue literals.
- Added cloud migration 0034 with exact scan-input uniqueness, composite
  project/video/transcript isolation, monotonic attempts, lifecycle checks,
  expiring leases, pinned private artifact versions/checksums, aggregate bounds,
  and no fabricated historical scan evidence.
- Added automatic queueing after keyword approval and both transcript activation
  paths, global and project-scoped authorized claim, exact lease-bound alias and
  transcript snapshots, heartbeat/reclaim, immutable upload, checksum/schema/
  input/aggregate-verified finalization, exact replay, bounded failure, and
  authorized pinned artifact download.
- Added the real continuous worker lane. It downloads and verifies the exact
  manifest and normalized tracks, bounds gzip expansion, runs the deterministic
  matcher, requires an immutable upload version, and isolates sibling failures.
- Finalization accepts only the exact scan-owned `matches.json` key. Unexpected
  or API-origin failure text is collapsed before persistence so private paths,
  object keys, credentials, and presigned URLs cannot leak through scan status.
- Added a second-client integration proof covering checksum/schema/input reuse,
  pinned old object versions, active-transcript replacement without
  retranscription, prior-artifact readability, removed-member denial, and exact
  versus divergent failure replay.

### Principal files

- `packages/contracts/src/index.ts` and `index.test.ts`
- `packages/transcript/src/index.ts` and `index.test.ts`
- `packages/db-cloud/migrations/0034_project_keyword_scans.sql`
- `packages/db-cloud/src/index.test.ts`
- `packages/catalog/src/index.ts` and `index.test.ts`
- `apps/cloud-api/src/app.ts` and `app.test.ts`
- `apps/worker/src/keyword-scan.ts` and `keyword-scan.test.ts`
- `apps/worker/src/main.ts`
- `tests/integration/shared-transcript-store.test.ts`

### Verification evidence

- Focused post-review worker/catalog gate: 2 files passed; 9 tests passed, 51
  skipped.
- Full affected matrix across contracts, transcript, catalog, cloud DB, API,
  worker, pipeline, and shared-store integration: 9 files passed; 215 tests
  passed, 2 skipped.
- `npm run typecheck`: passed.
- `npm run db:migrate:cloud:test`: passed; 34 migrations newly applied.
- `npm run db:migrate:local:test`: passed; 30 migrations newly applied.
- `npm run build:desktop`: passed, including the production web and desktop
  service bundles. Vite retained its pre-existing advisory for a chunk over
  500 kB; it did not fail the build.
- `npm test`: 54 files passed, 1 skipped; 604 tests passed, 4 skipped; duration
  184.47 seconds.
- Scoped Prettier check over every touched PUNCH-005B TypeScript/spec file:
  passed. The known unrelated full-repository formatting failure in
  `docs/Script-to-Resolve Product Spec.md` was not invoked.
- `git diff --check`: passed.
- Playwright/manual UI verification was not run because this slice changed no
  user interface; the visible evidence/grouping/seek workflow is PUNCH-005C.
- No independent Terra review was available in this environment. Root review
  covered authorization, stale leases, exact artifact identity, replay,
  failure privacy, gzip/output bounds, and second-client reuse.

### Remaining risks and follow-ups

- Production S3/cloud and live-media evidence remain deliberately unexercised;
  all acceptance here is deterministic and network-free.
- A lease may expire after an immutable upload but before finalization, leaving
  a private unreferenced object version for normal storage lifecycle cleanup;
  it cannot become current without exact finalization.
- Worklist grouping, filters, context expansion, click-to-seek/highlight,
  newly-completed presentation, and deliberate bulk triage remain PUNCH-005C.
- Commit IDs: none. The implementation remains uncommitted because no commit
  was requested.
