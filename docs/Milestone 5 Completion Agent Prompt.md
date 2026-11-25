# Milestone 5 Completion Agent Prompt

Copy and paste the prompt below into the next implementation task.

---

You are the primary implementation orchestrator for finishing and testing
Milestone 5 of the Research Video Transcript & Clip Extraction Tool. Work on the
existing `codex/m5-completion` branch. The repository is implemented and
verified through M5-20: logged and export-only media processing, immutable
settings/preset snapshots, three renderer families, required subtitle policy,
manifest/metadata/thumbnail packaging, worker capability registration,
accepted logged-export delivery, immutable cloud success/failure
reconciliation, deterministic source-scratch cleanup recovery/sweeping, and
immutable linear retry of a terminal failed logged export are complete. Your
scope is only the remaining Milestone 5 work and its release gate. Do not begin,
design, scaffold, or claim any M6 or M7 work.

## Immediate handoff check

The task that completed M5-20 could not write `.git/index.lock` under its final
managed permission profile. Before starting another slice, inspect `git log`,
`git status`, and the completed M5-20 spec. If the M5-20 commits are absent,
preserve the already verified working tree and create these two narrow commits
after rerunning the relevant checks:

1. Implementation only: `apps/cloud-api/src/app.ts` and `app.test.ts`;
   `packages/catalog/src/index.ts` and `index.test.ts`;
   `packages/contracts/src/index.ts` and `index.test.ts`;
   `packages/db-cloud/src/index.test.ts`; and
   `packages/db-cloud/migrations/0016_logged_export_retry_lineage.sql`.
2. Documentation only: `PROJECT_GUIDE.md`, `outline.md`,
   `specs/completed/M5-20-immutable-retry-of-terminal-failed-logged-export.md`,
   and this prompt. Replace the completion spec's pending implementation hash
   with the actual first commit hash before making the documentation commit.

Do not stage any other path. The verified M5-20 baseline is 4 focused files and
53 tests passing; full `npm run check` passed 233 tests with one declared skip,
the web build, 21 local migrations, and 16 cloud migrations.

## Required context before acting

1. Read the entire
   `.agents/skills/research-video-clip-workflow/SKILL.md` and follow it.
2. Read all of `PROJECT_GUIDE.md` and `outline.md`, then read the completed M5
   specs—especially M5-15 through M5-20—and inspect their implementation,
   migrations, tests, and current `git status` before choosing a boundary.
3. Preserve these unrelated user-owned files exactly. Never edit, move, delete,
   stage, or commit them:

   - modified `docs/Script-to-Resolve Product Spec.md`
   - untracked `CLAUDE.md`
   - untracked `docs/Recorded-Performance-Conform Product Spec.md`
   - untracked `mistakes.md`
   - untracked `specs/future/OPS-01-production-observability-and-sentry-pilot.md`

4. Create exactly one bounded `specs/active/M5-...md` before substantive edits.
   Keep one task and one primary writer responsible for that slice. Use models
   or delegate parallel review/testing only when the current user, system,
   repository, and workflow-skill instructions permit it; do not assume
   delegation is available. Do not ask for routine approvals. Pause for user
   input only when genuinely blocked, destructive authority is required, or a
   product choice would materially change the boundary.

## Architectural invariants to preserve

- Reuse the existing local export queue, `LocalExportSourceProcessor`, cloud
  delivery/catalog, and reconciliation paths. There is one executor; do not
  create a cancellation executor, batch executor, group executor, or alternate
  retry/render path.
- Export request video/selection/language/subtitle/preset/resolved-settings,
  capability profile, and fingerprint snapshots are immutable. A retry is a new
  request/job and linear child; it never resets or overwrites its parent.
- Accepted delivery identity, generation, reservation token, pinned worker and
  epoch provenance stay exact. Do not silently reassign an accepted delivery or
  let a newer epoch execute old accepted work.
- Success, failure, and the future canceled outcome are immutable terminal
  evidence and must be mutually exclusive under the same race-safe delivery
  lock, with database constraints/triggers where cross-table integrity requires
  them. Exact replay is idempotent; divergent replay conflicts.
- Continue at-least-once recovery across local persistence, cloud-call loss,
  cloud-commit/response loss, restart, lease expiry, and duplicate delivery.
- Never expose reservation tokens, worker-owner identity, local paths, source
  IDs, private/acquisition URLs, secrets, raw command output, or artifact
  locators in shared contracts, events, responses, or logs. Sanitize again at
  contract/repository boundaries.
- A terminal state may not falsely claim source deletion. Full-source scratch
  must be verified absent/deleted after success, failure, or cancellation;
  cleanup failure remains explicit and actionable. Never weaken package,
  subtitle, FFprobe, cleanup, or result-provenance rules to close the gate.

## Remaining required Milestone 5 work

Complete these as the smallest honest vertical slices, one active spec at a
time. Reassess current code before each slice and update the roadmap only for
work actually proven.

1. **Safe cancellation and execution ownership.** Define durable execution
   start plus an execution lease/heartbeat that distinguishes accepted-but-not-
   started work from the exact running attempt. Persist authorized cancel
   intent and transaction/epoch ownership. Propagate a cooperative
   `AbortSignal` through source acquisition, FFprobe, FFmpeg, subtitle,
   thumbnail, staging, and promotion boundaries; terminate child processes and
   handle the abort/result race deterministically. Verify exact scratch cleanup
   or retain actionable `cleanup_failed`. Reconcile one immutable sanitized
   canceled result to cloud state without masquerading as success or failure,
   and enforce three-way terminal mutual exclusion under concurrency. Cover
   pending, accepted, executing, already-terminal, replay, restart, stale lease,
   changed epoch/token/generation, lost membership, abort/child-process cleanup,
   cleanup failure, local/cloud loss, and cloud response loss. Do not permit a
   higher worker epoch to execute an old accepted delivery.
2. **Durable progress.** Persist bounded monotonic stage/progress evidence for
   the exact request/attempt/lease, make duplicate and stale updates harmless,
   recover it across restart, and expose it only through the existing
   authorized request boundary. Progress is not terminal evidence and must not
   weaken cancellation or result reconciliation. A polished progress UI is
   optional unless the release gate explicitly requires it.
3. **Batch export and sibling isolation.** Compose individual immutable export
   requests into a durable batch without creating another processor. Prove one
   sibling's failure/cancellation/cleanup issue cannot corrupt, cancel, or
   falsely complete its siblings; replay and restart preserve exact ownership
   and snapshots. Add only the minimum UI/API needed for an honest end-to-end
   batch gate.
4. **Same-source grouping.** Allow active sibling ranges for one authorized
   source to share a single acquired source safely while keeping independent
   request/attempt/result state. Track group ownership/reference lifecycle
   durably, prevent cross-project or divergent-source reuse, and delete the
   source only after every active dependent is terminal and cleanup is verified.
   Cancellation/failure of one sibling must not remove media still needed by
   another.
5. **Thirty-second foreign-language fixture gate.** Add a deterministic
   rights-cleared foreign fixture/range proving both original-language and
   translated-English SRTs contain only clip-relative cues from
   `00:00:00,000` through the verified approximately 30-second output, with the
   expected transcript track versions, hashes, package contents, FFprobe
   properties, and scratch deletion.
6. **User-authorized live YouTube smoke.** Keep this opt-in and dormant by
   default. Require explicit user authorization and configured provider/tool
   prerequisites. Run one representative real source through the established
   executor, verify package/subtitle/media/result/cleanup behavior, redact all
   evidence, and remove any retained full-source test media. A missing
   credential, provider, network capability, or authorization is a documented
   gate blocker, never a reason to weaken tests or silently substitute fixture
   evidence.
7. **Final Milestone 5 gate.** Run and record the complete representative
   preset matrix, immutable queued-settings behavior, confirmed-English default
   SRT and explicit omission, mandatory bilingual foreign/mixed/unknown policy,
   30-second foreign fixture, individual and batch restart/replay/cancel/failure
   paths, same-source lifecycle, authorized live smoke, and verified no-full-
   source-retention checks. Fix all M5 integrity defects found before declaring
   the milestone complete.

Known limitations from completed work are not automatically new scope. M5-18
intentionally rejects multi-attempt failure projection rather than guessing
attempt ownership, and pre-M5-19 random-layout scratch remains manual recovery.
Resolve either only if the safe-cancellation design or final M5 gate requires a
precise integrity-preserving migration/recovery path; otherwise document it as
a remaining known limitation without overclaiming.

## Verification and completion discipline

- For each slice, add strict contracts and migrations for persisted state, then
  focused repository/catalog/API/processor tests covering authorization,
  concurrency, replay, divergence, restart, loss windows, cleanup, leak
  prevention, and migration of populated databases. Use real
  FFmpeg/FFprobe/child-process cancellation tests where the boundary depends on
  actual process behavior; keep external/live providers opt-in.
- Run focused tests first, then formatting, typecheck, migration tests,
  `git diff --check`, security/compatibility/destructive-action audit, and full
  `npm run check`. Run Playwright/e2e only when browser behavior changes or when
  the final M5 browser gate requires it. Record exact test/file counts, declared
  skips, builds, migration counts, fixture/live results, and blockers.
- Before committing, stop at a verified no-stage/no-commit checkpoint for
  review. After review, use narrow commits: implementation/tests/migrations
  first; then update `PROJECT_GUIDE.md`, `outline.md`, move the one spec from
  active to completed with actual verification and commit hash, and commit only
  those documentation files. Inspect staged inventory and `git diff --cached
--check` before every commit. Never stage the protected files.
- Do not mark Milestone 5 complete because code compiles or most slices pass.
  Completion requires every required gate above, honest documentation of the
  authorized live result, a clean full verification run, and no unresolved
  integrity defect in cancellation, progress, batches, grouping, results, or
  source cleanup.

Stop after Milestone 5 is genuinely finished and documented. Do not proceed to
the Project Clip Library/authoring handoff (M6) or pilot distribution/QA (M7).

---
