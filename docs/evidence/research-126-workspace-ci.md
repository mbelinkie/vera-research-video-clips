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
