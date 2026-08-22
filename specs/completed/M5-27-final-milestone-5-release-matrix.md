# M5-27 — Final Milestone 5 release matrix

- Status: completed 2026-08-22
- Task/thread: M5-27 only
- Dependencies: completed M5-01 through M5-26

## User-visible outcome

Milestone 5 is declared complete only after one clean, recorded verification
matrix proves its entire export-worker promise: immutable settings, supported
media profiles, exact language-policy subtitles, individual and batch recovery,
same-source lifecycle, the deterministic foreign fixture, the separately
authorized real-source smoke, and no retained full source after terminal paths.

## Smallest end-to-end proof

Audit the completed M5 tests against every final gate row. Add only a narrowly
missing deterministic assertion when existing evidence does not prove a row.
Run focused real-tool checks first, then the repository's complete verification
and browser matrix from the current committed implementation. Record exact
counts, declared skips, tool/migration results, and the already sanitized M5-26
live result. Do not repeat the live download.

## Decisions and invariants

1. This is a release-evidence slice, not a new executor, provider, feature,
   schema, migration, UI, or milestone expansion.
2. Existing tests count only when their assertions directly prove the named
   gate. Missing evidence is fixed with the smallest deterministic test before
   the matrix can pass.
3. The final matrix covers all three supported software render profiles,
   immutable queued settings across preset edits, confirmed-English default SRT
   and explicit omission, mandatory foreign/mixed/unknown bilingual policy,
   exact 30-second foreign fixture, individual and batch restart/replay/cancel/
   failure behavior, same-source acquisition/release/cleanup, and source absence
   after success/failure/cancellation/recovery.
4. The M5-26 sanitized passed result is referenced as the authorized external
   provider gate. No source ID, URL, descriptor, transcript text, package,
   provider output, or full source is recreated or retained here.
5. Protected user files remain unmodified, unstaged, and outside every commit.
6. No M6 Clip Library or M7 distribution work begins.

## Affected boundaries

- Existing M5 contracts, catalog/API, local database, media, processor,
  grouping, one-shot, fixture, and browser tests as evidence.
- Only narrowly missing deterministic tests, if the audit finds a real gap.
- `PROJECT_GUIDE.md`, `outline.md`, and this spec after the matrix is green.

## Explicit non-goals

- Another live YouTube run, translation-quality comparison, provider/cookie
  work, arbitrary public-source compatibility, or persistent live fixtures.
- New product behavior, migrations, deployment, Clip Library, artifact locator,
  pilot packaging, or broad refactoring.
- Treating an optional AWS integration test as live-YouTube or normal-suite
  evidence.

## Acceptance criteria

1. Each final gate row names a direct automated or separately authorized live
   proof, its command/test, and its actual result.
2. Focused real FFmpeg/FFprobe evidence covers H.264/AAC MP4, HEVC/AAC MKV, and
   ProRes/PCM MOV plus confirmed-English default/omission and foreign policy.
3. Restart, replay, failure, cancellation, sibling isolation, group release,
   cleanup failure, and last-reference deletion remain directly asserted.
4. The 30-second offline foreign gate and the recorded 15-second authorized
   live smoke both pass their distinct roles without substituting for one
   another.
5. `npm run format:check`, `npm run typecheck`, `npm run test`,
   `npm run build:web`, both migration tests, aggregate `npm run check`, final
   Playwright, and `git diff --check` all pass from the final worktree.
6. No unresolved integrity defect remains in results, cancellation, progress,
   batches, grouping, or source cleanup. Known legacy limitations remain
   bounded and truthfully documented.

## Verification plan

Map the final prompt rows to exact tests; run any narrowly relevant focused
tests first. Then run formatting, typecheck, full tests, web build, local/cloud
migration CLIs, aggregate `npm run check`, Playwright, and `git diff --check`.
Inspect status/staged inventory so only M5-27 changes are recorded. Move this
spec to completed and mark Milestone 5 complete only after every row is green.

## Completion record

### Decisions and final matrix

| Gate                                     | Direct evidence                                                                                                                                                                                                   | Final result                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Three supported renderer profiles        | Real `export-run-once` FFmpeg/FFprobe conformance matrix for H.264/AAC MP4, HEVC/AAC MKV, and ProRes/PCM MOV                                                                                                      | 3/3 profiles executed; no capability skip                                                                 |
| Immutable queued settings                | Catalog regression queues from project-default v1, advances the preset/default to v2, and verifies replay plus request/job payload remain exactly v1                                                              | Passed                                                                                                    |
| Confirmed-English subtitle policy        | New real one-shot fixture test renders default English SRT and explicit omission as two independent H.264/AAC packages                                                                                            | Passed; both source attempts deleted                                                                      |
| Foreign/mixed/unknown policy             | Processor policy matrix requires original plus English even when the English-only omission flag is set                                                                                                            | Passed for all three classes                                                                              |
| Thirty-second foreign fixture            | M5-25 real FFmpeg/FFprobe fixture command verifies exact bilingual cues, hashes, replay, and scratch absence                                                                                                      | Passed, 30,000 ms                                                                                         |
| Individual restart/replay/failure/cancel | Catalog, local database, local-agent, and real child-termination tests verify exact ownership, terminal exclusion, response-loss replay, and cleanup-first reconciliation                                         | Passed                                                                                                    |
| Batch and sibling isolation              | Catalog tests verify atomic batch replay, mixed complete/failed/canceled status, and retry-leaf membership; per-item execution tests verify independent recovery                                                  | Passed                                                                                                    |
| Same-source lifecycle                    | Real two-child fixture plus coordinator/database/sweeper tests verify one acquisition, isolated packages/failure/cancel, restart fallback, cleanup-failure blocking, last-release deletion, and absent group root | Passed                                                                                                    |
| Authorized live provider                 | M5-26 separately authorized, redacted real-source result through the existing executor                                                                                                                            | Passed, 15,000 ms H.264/AAC, six original plus six English cues, absent source scratch, removed workspace |
| No full-source retention                 | Success/failure/cancel/recovery tests plus M5-25 and M5-26 assert deleted rows/roots before terminal proof                                                                                                        | Passed                                                                                                    |

Batch execution evidence is intentionally compositional. An M5-23 batch owns
creation, immutable membership, retry-leaf association, and aggregate reads; it
does not own a second executor, cancel state machine, or source lifecycle. Each
child uses the same independently proven M5-16 through M5-24 boundaries.

### Evidence additions

- `apps/local-agent/src/export-run-once.test.ts` now runs two confirmed-English
  requests through the real one-shot executor and real FFmpeg/FFprobe. It
  verifies the default `.en.srt`, explicit omission with exact manifest reason,
  media duration/codecs, manifest artifact hashes, completed request state,
  deleted source attempts, and empty scratch.
- `packages/catalog/src/index.test.ts` now queues an export from project-default
  preset v1, revises the preset/default to v2 with a different fingerprint, and
  proves idempotent replay plus persisted request and job snapshots remain
  byte-equal to v1.
- No production file, contract, migration, or browser behavior changed.

### Actual verification

- Focused M5 behavior set: 115 passed across processor, one-shot, grouping,
  settings, media, local/cloud catalog, and API tests.
- Real renderer-profile one-shot suite: 8 passed; all three profile cases ran.
- New confirmed-English real-tool gate: one passed, eight filtered.
- New queued-settings revision gate: one passed, 24 filtered.
- Thirty-second foreign fixture gate: one passed, seven filtered.
- Grouping plus cleanup-sweeper focus: 14 passed.
- One concurrent auditor run caused an unrelated existing PGlite test to exceed
  its 15-second limit. With competing database workloads stopped, the exact
  timed test passed alone in 4.03 seconds. It did not reproduce in the clean
  aggregate run.
- Clean detached verification worktree with exactly the M5-27 code changes:
  `npm run check` passed formatting, typecheck, 27 test files plus one skipped
  integration file, 270 tests plus one declared optional AWS skip, web build,
  24 local migrations, and 19 cloud migrations.
- `npm run test:e2e`: four Chromium flows passed.
- `git diff --check`: passed.
- Direct `npm run check` in the shared worktree stopped at Prettier only because
  the protected pre-existing user change in
  `docs/Script-to-Resolve Product Spec.md` is not formatted. The file was not
  modified, staged, hidden, or used in the clean verification worktree.

### Integrity audit

Three independent Terra audits found the two evidence gaps above and no product
integrity defect. Both gaps were closed with deterministic tests and re-audited.
No unresolved release blocker remains in results, cancellation, progress,
batches, grouping, replay, terminal exclusion, or source cleanup. The known
pre-M5-19 random-layout manual-recovery boundary and M5-18 multi-attempt failure
projection refusal remain bounded, documented safety behavior rather than an
unverified completion claim.

### Commits

- Final deterministic evidence: `fe23eaf`
- Completion documentation: recorded by the documentation commit that moves
  this spec to `specs/completed/`.
