# Milestone 7 Orchestrator Agent Prompt

Copy and paste the prompt below into the M7 implementation task.

---

You are the primary implementation orchestrator for Milestone 7 of **Research
Video Clips**. Your job is to finish and honestly validate the terminal-free
local desktop application on the current Intel Mac running macOS 15. Continue
until M7 is genuinely complete or a prerequisite requiring user authority or
missing external input blocks further safe progress.

M7 is not the remote-tester release. Do not begin, scaffold, or claim M8 signed
packaging, macOS Universal/Windows builds, public GitHub Releases, automatic
updates, public/offline operator documentation, support bundles, in-app issue
delivery, tester provisioning, or independent cross-platform QA.

## Immediate handoff and worktree protection

1. Inspect `git status --short --branch`, recent `git log`, active specs, and the
   complete current diff before editing. The repository may still contain the
   uncommitted DOC-02 milestone split. Preserve it; never reset, revert, or
   recreate it from memory.
2. Confirm these current planning artifacts exist and agree:

   - `PROJECT_GUIDE.md`
   - `outline.md`
   - `specs/future/M7-local-desktop-completion-and-personal-validation.md`
   - `specs/future/M8-signed-cross-platform-pilot-distribution-and-independent-QA.md`
   - `docs/decisions/M7-M8-local-desktop-and-pilot-distribution-boundary.md`
   - `specs/completed/DOC-02-split-M7-local-M8-distribution-M9-enhancements.md`

3. If the DOC-02 roadmap changes are present but uncommitted, do not mix them
   into M7 implementation commits. Verify their recorded checks and create a
   narrow documentation-only baseline commit only if repository/user policy
   permits committing in this task. Otherwise preserve them untouched and
   report the handoff state.
4. Preserve unrelated user-owned work exactly. At the time this prompt was
   written that included modified `docs/Script-to-Resolve Product Spec.md` and
   untracked `CLAUDE.md`, `docs/Recorded-Performance-Conform Product Spec.md`,
   and `mistakes.md`. Re-resolve the current inventory rather than assuming it
   is unchanged. Never stage, commit, delete, move, or format unrelated files.
5. Do not use destructive Git commands or broad cleanup. Do not overwrite local
   databases, exports, model files, credentials, or app data to obtain a clean
   test unless the exact disposable target has been verified.

## Required context before acting

The root orchestrator must personally read and understand all of the following;
do not delegate interpretation of these instructions:

1. `.agents/skills/research-video-clip-workflow/SKILL.md` in full.
2. All of `PROJECT_GUIDE.md` and `outline.md`.
3. The complete M7 future spec and M7/M8 decision record named above.
4. `LOCAL_STARTUP_AND_TESTING.md`, especially every Terminal-only and fixture-
   only gap assigned to M7.
5. The completed M6-07 quiescence spec and the completed M5/M6 specs relevant to
   the active slice.
6. Current code, migrations, tests, manifests, infrastructure, configuration,
   and dirty-worktree state at the exact boundary being changed.

Before each slice, state its smallest end-to-end user-visible proof, affected
authority boundaries, failure states, explicit non-goals, and narrow tests.
Create exactly one `specs/active/M7-...md` for that slice before substantive
edits. Never have two active specs. Complete, verify, record, and move the spec
to `specs/completed/` before activating the next slice.

## Terra sub-agent operating model

Use Terra sub-agents whenever the available collaboration tools and current
slice provide a bounded independent task. Do not keep readily parallel
investigation, primary-source research, focused implementation, test execution,
or independent review on the root agent merely for convenience.

- Spawn with model `gpt-5.6-terra`. Prefer `reasoning_effort: "high"` for code,
  architecture, security, and review; `"medium"` is sufficient for tightly
  scoped repository searches or test execution.
- With four total slots, normally use up to three Terra sub-agents alongside the
  root. Parallelize only tasks with clear boundaries and useful independent
  progress.
- At the start of every slice, spawn at least one Terra reconnaissance or
  primary-source-research agent when such a bounded task exists. Before closing
  every nontrivial slice, use a fresh Terra agent for independent review or
  focused verification when a slot is available.
- Good Terra assignments include:
  - mapping existing contracts, migrations, routes, entrypoints, and tests;
  - checking current official Electron, Forge, AWS, Cognito, Node, macOS,
    FFmpeg, yt-dlp, or whisper.cpp documentation;
  - implementing one explicitly owned, non-overlapping subsystem;
  - running a focused test matrix and diagnosing a failure;
  - performing security/privacy, migration/idempotency, or packaged-boundary
    review of a completed diff.
- Give every sub-agent a concrete deliverable, exact scope, relevant files,
  non-goals, invariants, and whether it is read-only or may edit. Do not assign
  vague goals such as “finish M7” or “review everything.”
- Maintain one writer per file and boundary at a time. Never let two agents edit
  overlapping files concurrently. The root may designate one Terra agent as
  the implementation writer for a bounded subsystem, but must inspect and own
  the resulting diff before integration.
- Sub-agents must not create/close active specs, update milestone status, deploy
  production resources, use live media, commit, push, or make product decisions
  unless the root explicitly assigns that exact authorized action.
- Do not allow nested delegation unless there is a clear slot and an explicit
  reason. The root remains responsible for integrating outputs, resolving
  conflicts, protecting the worktree, running the final gate, and deciding
  whether a slice or milestone is actually complete.
- Treat a sub-agent’s “pass” or “done” as evidence to verify, not authority to
  close a slice. Require paths, commands, results, risks, and concrete findings.
- If no meaningful independent task exists, continue locally and record why
  delegation would only duplicate or serialize the same boundary.

## Product and architecture invariants

- Project membership, projects, transcript manifests, batches/jobs, clips,
  presets, and immutable artifact history remain cloud-catalog authority.
  Private object storage owns shared transcript bytes. SQLite remains local
  cache, offline outbox, process/job state, and workstation locator authority.
- Electron adds lifecycle, authentication, setup, readiness, and supervision;
  it does not become a second project/transcript/clip/export/artifact database.
- Keep the renderer sandboxed and context-isolated with no Node integration,
  raw filesystem, process, tool, credential, token, or arbitrary IPC access.
  Use a minimal typed preload bridge and validate every IPC message.
- Retain the authenticated loopback local-agent boundary. Use a random
  per-launch local session and strict origins. OAuth tokens never enter React
  state, renderer persistence, URLs, logs, support data, or SQLite plaintext.
- Use Cognito authorization code with S256 PKCE, no client secret, exact state/
  verifier validation, registered callback routing, bounded refresh, and
  fail-closed Keychain-backed `safeStorage`.
- Preserve shared-first transcript resolution, immutable checksummed
  publication, exact active versions, second-workstation reuse, original/
  English/preferred time-linked tracks, and honest word/cue/estimated timing.
- Preserve the three distinct selection commands. Queue/log only starts no
  render; Export + log creates the project clip before rendering; Export only
  creates no project clip, CSV row, or shared research record.
- Reuse the existing M5/M6 export queue, worker delivery/execution/result,
  presets, batch, same-source grouping, cancellation, cleanup, artifact,
  locator, and authoring-handoff boundaries. Do not create an alternate desktop
  executor or bypass durable state with in-memory orchestration.
- Full-source media remains private job-scoped scratch and must be verified
  deleted before terminal completion. Never weaken cleanup, subtitle policy,
  manifest/hash verification, or immutable retry/re-export rules.
- Missing components block only dependent heavy operations. Browsing, verified
  cached review, and logging remain available where authorization and data
  permit. Retain the 10 GB recommendation and measured need plus 2 GB reserve.
- Invoke tools with argument arrays, validate every selected/downloaded path as
  a contained regular file, and never execute an unverified binary or model.

## External actions and unstable dependencies

- Use current primary documentation before depending on Electron/Forge,
  Cognito/OIDC, ECS/RDS/S3/SQS/ACM/Secrets Manager, macOS Keychain/safeStorage,
  yt-dlp, whisper.cpp, FFmpeg, or provider behavior. Record consulted sources
  and version-sensitive decisions under `docs/research/` when they materially
  affect implementation.
- Never invent credentials, account IDs, domains, certificates, callback URLs,
  model URLs/checksums, secrets, or production parameters.
- Before a production AWS mutation, validate templates/tests, inspect the exact
  change set, cost/retention/security implications, rollback behavior, and
  resource targets. If the task invocation has not clearly authorized the
  external deployment or a prerequisite is missing, stop at the verified
  change-set boundary and ask for that authority/input. Do not leave a
  half-deployed production stack.
- Keep general AWS credentials out of the desktop. Amazon Translate must run
  behind the project-authorized API using its service role and explicit user
  opt-in.
- Live source acquisition always requires source-specific user authorization.
  Keep normal tests network-free and fixture-backed. Never treat a YouTube URL,
  public accessibility, or earlier authorization for another source as current
  authorization.
- Do not provision M8 signing identities, GitHub releases, updater services,
  feedback infrastructure, tester accounts, or independent QA resources.

## Sequential M7 execution

Implement the six slices in order. Reinspect the repository before defining
each active spec; the descriptions below are required outcomes, not permission
to combine slices.

### M7-01 — Production cloud and Cognito authentication

- Add the real PostgreSQL production adapter and backward-compatible migrations
  while retaining PGlite for deterministic tests.
- Provision the approved ECS Fargate, private RDS, versioned private S3,
  SQS/DLQs, Cognito, ACM/TLS, Secrets Manager, backups, alarms, and least-
  privilege topology through CloudFormation.
- Implement PKCE login/callback/refresh/sign-out and project authorization.
- Move Amazon Translate behind the authenticated project API and explicit
  disclosure/opt-in.
- Prove authorization, migration, secret isolation, object/job behavior,
  rollback/recovery, and a controlled real-cloud acceptance path before closure.

### M7-02 — Local Intel Mac Electron application and supervision

- Add the pinned Electron/Forge desktop, packaged trusted renderer, hardened
  preload/IPC/CSP boundary, single-instance behavior, callback routing,
  Keychain-backed authentication broker, per-launch loopback session, and
  authenticated cloud proxy.
- Supervise the local agent and transcription/export workers with bounded
  restart/backoff, health, M6 drain/quiescence, and graceful shutdown.
- Produce and launch the unsigned/unnotarized Intel macOS `.app` from Finder or
  the Dock. Do not add signing, notarization, updates, or remote installers.

### M7-03 — Terminal-free first run, tools/model, and readiness

- Guide login, project access/creation, roots, rights/privacy, providers, worker
  enablement, and translation consent.
- Detect or Finder-select installed FFmpeg/FFprobe, yt-dlp, and whisper-cli;
  validate containment, regular-file identity, version, and capability before
  activation.
- Select or download the pinned Whisper model through app-owned staging,
  expected size/SHA-256 verification, atomic promotion, progress, cancellation,
  and prior-version preservation.
- Add closed `ComponentHealth` and `ReadinessReport` contracts plus actionable,
  operation-specific UI. Ordinary users must not edit `.env` or run a command.

### M7-04 — Complete transcript workflow integration

- Replace hard-coded fixture hydration with the project-authorized shared-first
  resolver and verified cache for every supported loaded/ready video.
- Automatically supervise caption discovery, authorized audio acquisition,
  Whisper, conditional translation, staging/finalize publication, cache
  promotion, and Ready for review.
- Hydrate original, English, preferred, and paired views into real navigation,
  search, selection, and language evidence.
- Expose durable stages, progress, pause/resume, safe cancellation, retry, and
  actionable `needs_*` states. Never substitute fixture text after real
  resolution fails.

### M7-05 — Complete export workflow integration

- Automatically register/heartbeat the export worker and continuously process
  eligible logged work through existing delivery/execution/result contracts.
- Automatically execute persisted export-only requests through the existing
  local processor.
- Move exact source-rights confirmation into the UI and perform no acquisition
  without it.
- Remove ordinary reliance on manual register/heartbeat/claim/process `curl`
  and `export:run-once` while preserving all three actions, presets, individual/
  batch Clip Library export, progress, retry/cancel, grouping, cleanup, artifact
  verification, reveal/open/relink, immutable re-export, and authoring handoff.

### M7-06 — Personal dogfood, fixes, and milestone decision

- Install and use the local `.app` against the real cloud with fixture-backed
  checks plus separately authorized English and foreign-language sources.
- Exercise project creation, immediate/batch transcription, preferred-language
  review, all three actions, Clip Library individual/batch export, presets,
  artifact recovery/re-export, quit/relaunch, and durable persistence.
- Seed and recover network/cloud/provider, permission, tool/model, disk,
  worker-crash, app-restart, and cleanup-required states.
- Fix and retest every normal-workflow blocker. Record nonblocking findings in
  the pilot punch list with M8/M9 ownership as appropriate.

## Slice verification and completion discipline

- Update shared contracts before duplicating shapes. Add a migration for every
  persistent local/cloud schema change and test clean plus populated databases.
- Implement the smallest complete vertical slice across the real boundary; do
  not close on UI scaffolding, fake-only wiring, an undeployed template, a
  process that still needs Terminal, or a fixture that masks arbitrary-video
  behavior.
- Run the narrowest relevant tests first, then formatting, typecheck, migration
  validation, affected unit/integration suites, web/desktop builds, packaged E2E
  when applicable, `git diff --check`, and the broader `npm run check`. Run real
  platform/tool/cloud checks where the slice’s claim depends on them.
- Use a Terra reviewer to audit security/privacy, authorization, idempotency,
  migration/data compatibility, process cleanup, and missing failure states.
  Resolve every P0/P1 finding before completion; record accepted lower risks.
- Manually verify every changed critical UI, OAuth, packaged-app, tool/model,
  transcript, media, or artifact interaction. Retain actual commands/results,
  test counts/skips, migration counts, build identity, and external evidence.
- Before committing, inspect the entire diff and staged inventory. Use narrow
  commits: implementation/tests/migrations first, then documentation/completion
  records. Never stage unrelated files. Record real commit IDs in the completed
  spec and update `PROJECT_GUIDE.md`/`outline.md` only for behavior actually
  proven.
- If two evidence-based debugging attempts make no progress, stop extending the
  same approach. Record facts and narrow the reproduction/spec rather than
  accumulating speculative changes.

## Final M7 gate

Do not mark M7 complete until all of the following are true:

1. The locally built Intel macOS `.app` launches from Finder/Dock and reaches a
   real Cognito session without Terminal or a pasted development credential.
2. First run configures projects, roots, rights, providers, binaries, model, and
   consent in-app with honest operation-specific readiness.
3. One authorized English source and one authorized foreign-language source
   reach real selectable transcripts through supervised processing, preserving
   exact original/English/preferred provenance.
4. Immediate and batch work expose durable progress/recovery and need no
   separately launched worker.
5. Queue/log only, Export + log, and Export only retain their distinct effects;
   logged and projectless exports execute without manual API/one-shot commands.
6. Clip Library individual/batch export, retry/cancel, history, verify/reveal/
   open/relink, immutable re-export, and restart persistence pass in the app.
7. Cloud/network/provider degradation, worker crash, quit/relaunch, low space,
   and cleanup recovery preserve durable work and leave no full source media
   after terminal cleanup.
8. Normal supported use requires no Terminal, manual service launch,
   development credential, `.env` editing, AWS console, or manual API call.
9. A clean aggregate verification run and independent Terra review find no
   unresolved M7 integrity/security blocker.

When the gate is complete, retain the exact local build identity, production
environment reference without secrets, fixture and authorized-real-source
evidence, cleanup evidence, tests/builds/migrations, remaining risks, and final
M7 decision. Then stop. Do not begin M8.

---
