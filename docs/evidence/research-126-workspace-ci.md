# Research #126 — Workspace browser baseline

## Phase 1 — baseline (2026-11-25)

Freshly fetched `origin/main`: `6f1f75e3c377ea2292a779b7b2172cb359ccae96`.
The worktree started clean. `git merge-base --is-ancestor 50197d50fcc3f7ca5a126307b3ca635dbab55ea7 HEAD` returned 0, confirming #124 / PR #134 integration ancestry.

### Execution

Linux Zodex, system Node 24.19.0, npm 11.17.0; Playwright 1.62.1,
locked Chromium 1234 (headless shell available). No live backend or provider
was started. Ports 43110, 43111 and 43112 were unoccupied before launch.
The Vite server was started by the unchanged Playwright config in ordinary
development mode with VITE_BROWSER_AUTH=false and VITE_MANAGED_RESEARCH=false,
and VERA_RUNTIME_MODE and NODE_ENV unset.

Normal `npm ci --include=optional` failed in the nested Node lifecycle
script because the parent Mac checkout's Node binary was selected.
A second locked `npm ci --include=optional --ignore-scripts` succeeded.
For local testing only, the untracked worktree node_modules/.bin/node was
linked to the system Linux Node. No lockfile or product code was changed.
The lifecycle workaround is not evidence that a clean Ubuntu CI install fails.

Commands:

- `node node_modules/@playwright/test/cli.js test tests/e2e/workspace.spec.ts --project=chromium --list`
- `npm run test:e2e -- tests/e2e/workspace.spec.ts --project=chromium --workers=3 --reporter=line`
  (with the environment above and output directed to the ticket's trace folder).

**Actual list: 17 tests. Actual baseline: 15 passed, 2 failed, 0 skipped,
26.1 seconds, exit 1.** Both failures have retained trace ZIPs and error
context in the ticket's workspace-baseline-traces folder; full list and
line reporter output are retained in workspace-list.log and
workspace-baseline.log. Generated artifacts are not committed.

| Line | Retained test                                                                                            | Result |
| ---: | -------------------------------------------------------------------------------------------------------- | ------ |
|  137 | a normal launch never substitutes the API demo transcript                                                | Pass   |
|  148 | immediate caption workflow uses the exact batch and verified local transcript                            | Pass   |
|  148 | immediate asr workflow uses the exact batch and verified local transcript                                | Pass   |
|  148 | immediate failed workflow uses the exact batch and verified local transcript                             | Pass   |
|  296 | switching project and video discards late transcript responses                                           | Pass   |
|  384 | rejects a mismatched immutable version without showing any transcript                                    | Pass   |
|  424 | refuses a project identity mismatch before reading local transcript                                      | Pass   |
|  424 | refuses a video identity mismatch before reading local transcript                                        | Pass   |
|  424 | refuses a batch identity mismatch before reading local transcript                                        | Pass   |
|  544 | loads a canonical YouTube video and seeks from its transcript                                            | Fail   |
|  571 | onboards a first Cognito desktop user, creates a project, and persists setup                             | Pass   |
|  888 | desktop player waits for readiness and plays from a transcript word                                      | Pass   |
|  960 | rejects a non-YouTube URL without replacing the workspace                                                | Pass   |
|  975 | timed auto-caption fixture seeks exact starts and retains derived-end selection through queue and export | Fail   |
| 1202 | updates a running preview when the selected passage changes                                              | Pass   |
| 1274 | maps transcript text selection to stable source and export bounds                                        | Pass   |
| 1570 | connects an explicit project, controls a batch, and updates review state                                 | Pass   |

### Failure classification

- Line 544: line 560 polls __lastSeekSeconds for 2.2; undefined after
  5 seconds. Fixture contract/readiness drift: trace
  workspace-loads-a-canonica-6cebf-d-seeks-from-its-transcript-chromium/trace.zip
  records `TypeError: playerRef.current.getDuration is not a function`
  in the hosted player's onReady callback.
- Line 975: line 1095 polls __lastSeekSeconds for 11.84; undefined after
  5 seconds. Same classification and exact exception in
  workspace-timed-auto-capti-c7658-on-through-queue-and-export-chromium/trace.zip.
  This failure prevented later selection/queue/export assertions from running.

Both traces confirm the fake is incompatible with the current player
contract: MockPlayer (workspace.spec.ts:477–542) implements getCurrentTime
but not getDuration. BrowserYouTubePlayer
(apps/web/src/hosted-youtube-player.tsx:23–59, 197–202) requires getDuration
and calls it before forwarding onReady. The user click can also precede
lazy player mounting: hosted-main.tsx:925–935 calls playerRef.current
optionally and updates the UI's requested time independently. Therefore
the trace exception is confirmed fixture drift and the missing seek is
consistent with readiness timing; the exact ordering and sufficiency of
the fix must be verified in phase 2, not assumed. No product bug has yet
been demonstrated. The desktop iframe handshake passed and is a separate
contract. Do not weaken the 2.2 or 11.84 assertions.

### Historical count and coverage

The issue quotes a Desktop audit with 27 scenarios and eight failures.
The original report, exact audit SHA, failure titles and per-case results
were not recovered in the inspected local audit records or repository
Markdown/history; they cannot be classified individually. The known
checkpoint `c5c55db0f2148388e63437c89679fd76cf91e634` has 26 direct
test declarations (static inspection, not executed list). The merge
`5aac92af6e2e1e7415c3a65d3340fb13928cabb5` already contains the retained
17-case suite: 13 declaration sites, with two three-variant loops. Its
first parent is the prior hosted mainline. The large file difference
from checkpoint to current main (1,216 added / 7,122 removed lines)
predates this ticket. No explanation for the one-case audit/checkpoint
difference or evidence of intentional deletion is available.

The #134 description, as copied into the #126 prep brief, claims 31/37
hosted cases failed before reconciliation and 35/35 mocked cases passed
afterward, plus 2/2 browser-auth. These are historical combined-suite
counts, not fresh Workspace measurements.

Checkpoint inventory and tentative semantic mapping (not equivalence
proof; missing means no directly named retained Workspace test):

| Checkpoint line / behavior                            | Retained mapping or gap                                    |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| 316 arbitrary projectless URL never hydrates fixture  | 137 normal launch; partial                                 |
| 335 reject non-YouTube URL                            | 960                                                        |
| 531 first Cognito desktop setup                       | 571                                                        |
| 848 YouTube search capability/preflight               | Missing                                                    |
| 1180 unknown URL immediate review and keyboard tabs   | 148 immediate workflows, partial; keyboard tabs not mapped |
| 1394 immediate resolve failure actionable             | 148 failed variant, partial                                |
| 1787 player readiness acknowledgement                 | 888                                                        |
| 1843 exact word timestamp                             | 544 and 975                                                |
| 1895 estimated cue word positions and selection       | 148 ASR, 1274; partial                                     |
| 1973 project bookmarks/sync                           | Missing                                                    |
| 2182 Add, Review and Logged destinations              | Missing                                                    |
| 2325 recency removal and role-gated settings          | Missing                                                    |
| 2370 project access/roles/invitations/ownership       | Missing                                                    |
| 2627 verified artifacts and bounded navigation        | Missing                                                    |
| 2834 removed navigation identities                    | Missing                                                    |
| 2890 offline cache read-only review                   | Missing                                                    |
| 2938 preferred translation unavailable                | Missing                                                    |
| 2993 guarded manual range/overlap/no-speech           | Missing                                                    |
| 3136 stable source/export selection bounds            | 1274, 975, 1202; partial                                   |
| 4523 project batch controls and review state          | 1570                                                       |
| 5844 explicit language when evidence unknown          | Missing                                                    |
| 6041 confirm language-gated batch item                | Missing                                                    |
| 6344 delayed language gate across projects            | 296 tests transcript response, not language gate           |
| 6588 older delayed batch selection                    | Missing                                                    |
| 6774 newer batch survives older language confirmation | Missing                                                    |
| 6974 two-track import and delayed finalizer takeover  | Missing                                                    |

These are gaps in the named retained browser inventory, not claims that
product features or all their unit tests vanished. The checkpoint is a
desktop-oriented spec and the retained file is primarily hosted; assess
current settled requirements and adjacent tests before restoring a
narrow equivalent against the correct renderer. The current suite also
adds explicit immutable-version and project/video/batch identity
mismatch cases (384, 424); preserve them. Do not conflate the historical
eight with today's two.

### Phase 2 handoff

- Repair the fake player contract with deterministic duration and proper
  ready/error callback shape. Observe actual player readiness before seek;
  retain exact timestamps, range and loop assertions. Capture unexpected
  page errors, including in otherwise passing tests. Reproduce focused
  cases and run all 17 before deciding whether product changes are needed.
- Inspect current clip and export schemas in packages/contracts/src/index.ts,
  hosted-main.tsx and clip-request.ts before changing the mock response:
  workspace.spec.ts:1001–1025 and 1315–1340 currently echo legacy englishText;
  current request uses languageEvidence. This is static drift evidence,
  not a reproduced failure. Assert actual V2 evidence, source rights and
  independent selection bounds without fabricating response fields.
- Assess missing settled historical cases against adjacent specs/unit
  coverage and the correct desktop/hosted contracts; do not delete any
  retained tests. Keep fake services isolated.
- Phase 3 will add locked Chromium installation and the exact focused
  Workspace command to .github/workflows/test.yml's existing Check job,
  keeping all current checks and ensuring server isolation.

### Baseline local gate

`npm run check` on the unchanged baseline exited 1. Format and typecheck
passed; Vitest ran 1,201 tests: 1,186 passed, 7 failed, 8 skipped across
126 files (118 passed, 4 failed, 4 skipped). The failed cases were:

- Three cloud API lease/control/advertisement cases in
  `apps/cloud-api/src/app.test.ts` (15-second timeouts).
- Two language decision cases in `packages/catalog/src/index.test.ts`
  (15-second timeouts).
- Two cleanup failure assertions in `apps/local-agent/src/export-source.test.ts`
  and `packages/media/src/index.test.ts` (expected rejection, received
  a resolved promise).

Full log: ticket's check-baseline.log. Vitest took 1,254.84 seconds.
These failures occurred before any test or product edits; their root
causes are not established. The environment uses the local installation
workaround described above. The subsequent issue-policy, build and migration
steps were not reached. Do not claim a green aggregate check; phase 4 must
recheck and report the actual final gate, without weakening tests.

## Phase 2 — incomplete repair attempt

The worktree contains uncommitted test-only changes: deterministic fake player
duration (4,000 seconds, covering the final caption cue), readiness waits before
hosted player actions, unexpected page-error assertions, current V2 clip
language-evidence and export command parsing, source-rights response echoes,
and removal of the invented logged-export selection fallback. No product code
was changed. No tests were removed or skipped; retries remain unchanged.

The attempted 17-case parallel run used the phase 1 environment and Chromium,
with output in the ticket's workspace-phase2.log and workspace-phase2-traces.
The first three tests timed out before initial Workspace controls appeared;
the recorded trace shows unusually delayed Vite startup/module loading.
The broader catch-all browser request route has now been narrowed to backend
and non-local-origin requests to avoid intercepting Vite module fetches.
This revised change is **unverified**. The first run's command handle
B2vJYb97 stopped responding to polling; its exit code could not be retrieved.
A Vite process remains on port 43112; ownership/cleanup must be verified before
a new isolated run. Do not reuse that server or terminate another agent's
process. No final browser count, focused unit/type result, coverage restoration,
or phase-2 acceptance is claimed. Historical mapping remains as in phase 1.

Recovery: inspect the uncommitted diff and command-session.json, resolve the
stale server/handle, run the two baseline failures and all 17 tests with the
narrowed route, review missing settled coverage against current renderer and
unit tests, run focused checks, and commit only verified repairs.

## Phase 2 recovery — verified retained Workspace repair

The previous interrupted run left an orphaned Vite process on port 43112.
Verified the process's working directory was this exact worktree and the
launch shell was reparented to PID 1; stopped only that orphan tree. Ports
43110, 43111 and 43112 were free before both fresh test runs and after
completion. Node 24.19.0, locked Playwright 1.62.1 / Chromium were used.
The revised route filters intercept only backend and non-local requests,
not Vite module loads; test-specific routes retain precedence.

- Focused Chromium, one worker, grep canonical YouTube/timed auto-caption:
  **2 passed, 29.7s, exit 0** (workspace-recovery-focused.log).
- Complete Workspace Chromium, one worker: **17 passed, 1.4m, exit 0**
  (workspace-recovery-full.log). All original assertions retained, no
  Workspace skips or retries, no product change, no live backend/provider.
  Unexpected page-error assertions passed in every case.
- `npm run typecheck` and Prettier check of the changed spec passed.
- Eight focused unit files (contracts, transcript, immediate transcript,
  desktop auth, batch actions, spoken language, notification navigation,
  YouTube source view): 172 passed, one timed out at its existing 30s limit
  (workspace-recovery-checks.log). The unmodified batch test
  `poll-before-cleanup` passed on isolated rerun in 8.3s with the existing
  limit (workspace-recovery-unit-retry.log; 16 nonmatching cases filtered).
  No retry policy or timeout was changed; the initial aggregate failure
  remains part of the evidence.
- Retained count remains 17. The earlier checkpoint mapping is historical,
  not a confirmed list of missing current regressions; no historical tests
  were blindly transplanted into the hosted/desktop split. Current focused
  unit coverage includes exact language gate selection, retry races, and
  notification navigation. The original audit's eight identities and
  historical browser-only equivalence remain unverified.
- No full `npm run check` rerun or CI result is claimed in phase 2; phase 1
  baseline failures remain documented. Phase 3 must wire the required Check;
  phase 4 must repeat the broader gates and review historical coverage gaps.

## Phase 3 — required Check integration

The existing `Check` job, npm ci, FFmpeg setup, and `npm run check` are
unchanged. Two steps now install the lockfile-selected Chromium with
`npx --no-install playwright install --with-deps chromium` and run
`npm run test:e2e -- tests/e2e/workspace.spec.ts --project=chromium`.
The CI step explicitly disables browser authentication and managed Research.
CI uses one worker to reduce contention, retains zero retries, and refuses to
reuse an existing Vite server; non-CI parallelism is unchanged. The existing
20-minute job timeout is unchanged.

Local Linux verification with locked Playwright/Chromium and
`CI=true VITE_BROWSER_AUTH=false VITE_MANAGED_RESEARCH=false`:

- Exact browser command with `--list`: 17 tests in one file, exit 0.
- Exact browser command without filters: 17 passed (1.3m), exit 0;
  output retained in `workspace-phase3-ci.log` in the pipeline folder.
- Temporary synthetic `expect(1).toBe(2)` test in the same spec, selected
  with `--grep 'synthetic CI exit status proof'`: one failed, exit 1.
  Output retained in `workspace-phase3-negative.log`; original spec restored
  byte-for-byte and verified against git. No synthetic test is committed.
- Prettier and git diff --check pass. Actual GitHub execution and the full
  existing gate remain for phase 4; the Ubuntu dependency installation step
  was not executed locally because locked Chromium was already installed.

## Phase 4 — browser verification complete; aggregate gate blocked

On `bf155e9`, using the locked Chromium and the same isolated CI settings:

- Exact required Workspace command, one worker: **17 passed, 1.4m,
  exit 0** (`workspace-phase4-serial.log`).
- Combined Workspace, Stills and Typed Quotes specs with `--workers=2`:
  **37 passed, 1 failed, 3.3m, exit 1**. All 21 adjacent cases passed;
  the long Workspace case `maps transcript text selection to stable source
and export bounds` exceeded its existing 30-second whole-test budget
  while filling the project description. The failure snapshot shows the
  field present, with the project name already filled. Trace timings show
  multiple preceding ordinary actions took approximately 1–4 seconds each.
  This is consistent with resource contention, not evidence that the field
  is missing; the same case passed in the serial run. The failure and trace
  are retained in the ticket folder. No retries, timeouts or assertions were
  loosened to conceal it.
- Independent complete Workspace run with `--workers=2`: **17 passed,
  1.4m, exit 0** (`workspace-phase4-parallel-only.log`). This repeats the
  timed-out case successfully without any test or timeout change; the
  initial combined-run failure remains recorded.
- Whole code diff reviewed: only test fixtures/assertions and Playwright/CI
  configuration changed. There is no changed product data-integrity guard
  to mutate. The phase 3 synthetic failing assertion is the negative test
  for the added CI step; it was restored before committing. No product
  code, auth configuration, or live service was changed.
- A disposable Ubuntu checkout of the committed tree was prepared using
  locked offline dependencies with lifecycle scripts omitted and system
  Node 24.19.0. The full `CI=true npm run check` was started as an
  unprivileged user because two baseline cleanup tests deliberately remove
  directory write permissions (root bypasses that condition). The earlier
  redundant root gate was interrupted after the browser results. The
  unprivileged gate passed formatting and typecheck. Vitest reported
  `packages/catalog/src/index.test.ts (83 tests | 11 failed) 894155ms`.
  The cloud API file and the two permission-sensitive cleanup cases that
  failed at baseline passed in this run. The catalog, cloud API, local-agent
  and media sources/tests are unchanged relative to the pinned baseline.
  After the configured 25-minute budget was exceeded, the verified own
  Vitest process tree was terminated; the exact command session exited 143
  after 1,538.6 seconds. The partial output is retained in
  `check-phase4-nonroot.log`. No final Vitest totals were produced, and the
  subsequent build and migration steps were not reached. This is not a
  green aggregate gate; additional catalog failures are not individually
  classified without the final failure summaries.

The actual GitHub Check on the published final SHA is not verified locally;
the Conductor owns publishing and observing the required check. The original
audit's exact eight failures and the historical desktop-only coverage gaps
remain limitations, as recorded above. No production/live-app verification
is claimed. Delivery remains blocked until a clean full gate and the actual
required GitHub Check are recorded.

## Phase 4 recovery — aggregate gate completed, one unrelated-file timeout

The unchanged pinned main catalog suite was rechecked as an unprivileged user:
83/83 passed in 244.90 seconds, including all 11 failures from the interrupted
aggregate run. The prior failures did not reproduce in isolation.

The clean branch at `3784b86` was copied into the retained disposable Linux
checkout (tracked files compared and the evidence document synchronized).
With Node 24.19.0, locked offline dependencies, no concurrent browser runs,
and the existing single-worker setting, `CI=true npm run check` completed
with exit 1 in 856.5 seconds. Format and typecheck passed. Catalog passed
83/83 in 292.977 seconds. Vitest reported 121 files passed, one failed, four
skipped; 1,192 tests passed, one failed, eight skipped (1,201 total).

The sole failure was the existing `apps/web/src/transcription-action-batch.test.ts`
case `handles 'automatic' processing (retryable=true, race='poll')`: the
30-second test budget expired (39.468 seconds reported). This file and all
product code are unchanged by #126. The pinned baseline aggregate had passed
the same case. A focused rerun of the three polling variants passed 3/3 on
both the recovered branch (24.51 seconds total; exact case 8.333 seconds)
and pinned unchanged main (19.59 seconds total; exact case 7.048 seconds).
This establishes non-reproduction in isolation, not a proven baseline
failure or a green aggregate gate. No timeout, retry, or assertion changed.

The steps short-circuited by Vitest's failure were run separately, without
altering their commands: issue policy 8/8, web build passed, local migrations
39 applied, cloud migrations 62 applied; all exited 0. Retained logs:
`check-phase4-recovery.log`, `recovery-branch-poll.log`,
`recovery-main-poll.log`, and `recovery-remaining-gate.log`.

All Workspace and adjacent evidence above remains valid (no test or CI code
changed in this recovery). The complete aggregate gate and actual GitHub
Check on the final published SHA still need a green run. No production or
live-app verification is claimed. The next step is a clean required CI run
under Conductor ownership, not speculative edits to an unrelated test.
