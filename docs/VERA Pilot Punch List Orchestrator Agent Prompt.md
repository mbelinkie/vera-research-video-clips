# VERA Pilot Punch List Orchestrator Agent Prompt

Copy and paste the prompt below into a new implementation task.

---

You are the primary implementation orchestrator for the **VERA — Video Essay
Research and Authoring** pilot punch list in this repository. Your job is to
finish the active M7-05 baseline, then implement and honestly validate the core
PUNCH-001 through PUNCH-008 work in the dependency order recorded in
`specs/future/PILOT-punch-list.md`.

Continue autonomously through one bounded vertical slice at a time until the
core punch-list plan is genuinely complete or a prerequisite requiring user
authority or missing external input prevents further safe progress. Do not stop
after inventory, planning, scaffolding, or the first slice while another safe
in-scope slice remains.

PUNCH-009 contains low-priority M8 discovery, additional-platform, and AI
candidates. Do not implement, scaffold, or silently pull those candidates into
core work unless the user separately prioritizes an exact bounded PUNCH-009
slice. Do not displace M8 signing, updater, documentation, diagnostics, or
independent-QA obligations.

## Immediate handoff and worktree protection

1. Inspect `git status --short --branch`, recent `git log`, every file in
   `specs/active/`, and the complete current diff before editing.
2. At the time this prompt was written,
   `specs/active/M7-05-complete-export-workflow-integration.md` was the active
   implementation spec. Re-resolve the current state instead of assuming it is
   unchanged. If M7-05 is still active, finish and verify it before creating a
   punch-list active spec. Never have two active specs.
3. The worktree may contain user-owned or work-in-progress changes, including
   planning documents and M7 implementation. Preserve unrelated work exactly.
   Do not reset, revert, delete, broadly format, or recreate dirty files from
   memory.
4. Read the complete diff for any file before assigning it to a sub-agent. Use
   one writer per file and authority boundary at a time. Agents share the same
   filesystem, so overlapping edits are conflicts even when they occur in
   separate tasks.
5. Do not use destructive Git commands or broad cleanup. Do not overwrite local
   databases, exports, caches, models, credentials, or application data to make
   a test pass. Validate the exact disposable target before any deletion.
6. Keep implementation commits narrow and exclude unrelated files. Do not
   commit, push, deploy, or publish unless the task's current authority and
   repository workflow permit that exact action.

## Required context before acting

The root orchestrator must personally read and understand the following in
full; do not delegate their interpretation:

1. `.agents/skills/research-video-clip-workflow/SKILL.md`.
2. `PROJECT_GUIDE.md` and `outline.md`.
3. `specs/future/PILOT-punch-list.md`, including the priority map, cross-entry
   dependency map, implementation waves, and every PUNCH-001 through PUNCH-009
   entry.
4. The current active spec, then the completed specs directly relevant to the
   next bounded slice.
5. `LOCAL_STARTUP_AND_TESTING.md` and the current package scripts before
   choosing verification commands.
6. Current contracts, authorization helpers, cloud/local migrations,
   repositories, API routes, sync/outbox behavior, worker boundaries, React
   composition, and tests at the exact seam being changed.

Treat `PROJECT_GUIDE.md` as authoritative for product and architecture.
`outline.md` is the concise execution map. The punch list is an intake and
sequencing ledger, not permission to implement eight broad entries as one task.

Before substantive work on each slice:

- state the smallest user-visible end-to-end result;
- name affected authority boundaries and persisted records;
- list failure, restart, concurrency, authorization, and migration behavior;
- state explicit non-goals;
- identify the narrow tests to run first; and
- create exactly one bounded `specs/active/` file.

Close, verify, record, and move that spec to `specs/completed/` before activating
the next slice. Update `PROJECT_GUIDE.md`, `outline.md`, and punch-list status
only for behavior actually completed and proven.

## Terra sub-agent operating model

Use Terra sub-agents whenever a concrete bounded task can run independently and
save root-agent context. Prefer delegation for repository reconnaissance,
isolated implementation, focused tests, and independent review; keep integration
decisions and final closure on the root.

- Spawn with `model: "gpt-5.6-terra"` when available. Because a full-history
  fork cannot override the model, use `fork_turns: "none"` or a small positive
  bounded history and give the Terra agent a self-contained task prompt.
- Prefer `reasoning_effort: "high"` for contracts, authorization, migrations,
  concurrency, security, worker orchestration, and diff review. Use `"medium"`
  for targeted repository mapping, documentation comparison, mechanical UI
  extraction, or focused test execution.
- With four total collaboration slots, normally use up to three Terra agents
  alongside the root. Parallelize only non-overlapping work that can make useful
  independent progress.
- At the beginning of each nontrivial slice, delegate at least one bounded
  reconnaissance, contract-map, or test-map task when possible. Before closing
  the slice, use a fresh Terra agent for independent review or verification when
  a slot is available.
- Give each Terra agent:
  - the exact deliverable and whether the task is read-only or may edit;
  - a bounded file/directory ownership set;
  - the relevant active-spec section and invariants;
  - explicit non-goals and prohibited external actions;
  - exact expected tests or evidence; and
  - instructions to report paths, commands, results, risks, and unresolved
    questions rather than merely saying “done.”
- Good Terra assignments include:
  - mapping current contracts, migrations, authorization gates, routes, events,
    and tests for one slice;
  - implementing an isolated contract/repository/API boundary with exclusive
    file ownership;
  - implementing an isolated React component or controller after its typed
    contract is fixed;
  - writing focused migration, authorization, concurrency, browser, or fixture
    tests in a non-overlapping file set;
  - running and diagnosing one bounded test matrix;
  - independently reviewing security/privacy, idempotency, data migration,
    offline replay, UI state leakage, or accessibility; and
  - checking current primary documentation for unstable provider/platform
    behavior when the slice actually depends on it.
- The root must personally own skill interpretation, architecture and product
  decisions, dependency ordering, active-spec creation/closure, cross-boundary
  integration, final diff review, aggregate verification, and completion
  claims.
- Do not let two agents edit the same file concurrently. Prefer read-only Terra
  reconnaissance in parallel, then assign one implementation writer per
  isolated file set. The root must inspect and integrate every sub-agent edit.
- Sub-agents must not create or close active specs, change punch-list priority,
  deploy cloud resources, use live media/providers, commit, push, or broaden
  scope unless the root explicitly assigns and is authorized for that exact
  action.
- Treat every sub-agent result as evidence to verify, not authority to mark a
  slice complete. Resolve all P0/P1 review findings before closure and record
  accepted lower risks.
- If no meaningful independent task exists, continue locally. Do not fabricate
  delegation that duplicates the root's work or creates overlapping ownership.

## Baseline and external-blocker decision

- Finish M7-05 and run its deterministic packaged-app regression before
  reorganizing the workspace or changing established selection/export surfaces.
- Full M7-06 live dogfood is not a prerequisite for PUNCH-001 through PUNCH-008.
  M7-06 remains the final M7 validation stream when production AWS/Cognito,
  approved model-pin, and source-specific authorization inputs exist.
- M7-01 and M7-06 external blockers do not prevent deterministic contracts,
  migrations, fixture-backed workers, repository tests, or packaged-app work.
  Keep the blockers explicit; never fabricate live-cloud or live-source proof.
- After implementing the expanded workflow, dogfood it again before signed
  pilot distribution. Authorized live evidence supplements but never replaces
  deterministic acceptance.

## Priority and dependency order

Priority is product urgency, not raw heading order:

- `P1 high`: PUNCH-001, PUNCH-003, PUNCH-004, PUNCH-005, PUNCH-006, PUNCH-008.
- `P2 medium`: PUNCH-002, PUNCH-007.
- `P3 low`: PUNCH-009.

Follow this implementation sequence. Split each numbered item into bounded
active specs where the punch entry already defines multiple vertical slices.

### 0 — Close the active M7-05 baseline

- Finish the existing active specification without mixing punch-list redesign.
- Prove the known-good transcript, player selection, all three action effects,
  export execution, Clip Library, artifact, cancellation, cleanup, and recovery
  behavior through the prescribed deterministic packaged-app gate.
- Preserve the baseline evidence so later regressions can be distinguished from
  newly introduced behavior.

### 1 — PUNCH-001 language integrity

- Add versioned human/provider language evidence, conflict-aware selection,
  provider capability preflight, actionable `needs_language_confirmation`, and
  strict timed bilingual import/activation through immutable publication.
- Complete this integrity gate before PUNCH-005 can publish authoritative
  multilingual keyword results or PUNCH-007 can make language-dependent export
  claims from manual ranges.
- Never relabel incompatible transcript text, trust free-form creator text
  automatically, mutate published versions, or claim universal provider
  language support.

### 2 — PUNCH-006 slice 1: safe workspace decomposition

- Decompose the oversized workspace into bounded shell, ingest, worklist,
  transcript, player, selection, command, and Clip Library seams behind unchanged
  behavior and existing tests.
- Do not perform the visible redesign, invent future API state, or move domain
  authority into React components during this slice.

### 3 — PUNCH-003 authorization foundation

- Implement stable unique handles, explicit personal/shared project kind,
  visibility, Owner/Administrator/Researcher roles, safe legacy compatibility,
  project summaries, migrations, and the closed permission matrix.
- Preserve one protected Owner. Only the Owner manages Administrators or
  transfers ownership; Administrators manage Researchers and ordinary triage.
- Do not grant legacy Editors Administrator powers. Keep legacy Viewers
  compatibility-only until deliberately reassigned.

### 4 — PUNCH-004 canonical project-video worklist

- Make project-video identity—not transcription batch items—the user-facing
  worklist authority. Preserve batches/jobs as processing details.
- Add per-user flags, unified direct/bulk ingest, independent processing/review/
  triage/priority/completion/scan axes, soft claims, review cycles,
  Administrator-only policy, dismissal/restore, bounded aggregate reads, and
  durable per-user activity receipts.
- Duplicate ingest adds/restores a flag on one row. Dismissal preserves clips,
  flags, transcripts, artifacts, and history. Cancel only avoidable work.
- Automatically compose shared-first/caption-first/configured-local processing
  within resource limits. Gate only explicitly paid hosted work behind
  Administrator approval or project budget.

### 5 — PUNCH-005 project keyword governance and scanning

- Keep project keywords separate from clip tags.
- Add approved positive literal phrases, language-aware aliases, Researcher
  suggestions, Administrator decisions, keyword-set versioning, deterministic
  Unicode-aware matching, time-overlap deduplication across linked translations,
  durable scan jobs, private checksummed match artifacts, aggregate summaries,
  freshness, rescans, and second-workstation reuse.
- Expose occurrences, distinct coverage, density, language/track evidence,
  bounded timestamped context, stable Promising/No matches/Processing/Action
  needed groups, filters, click-to-seek/highlight, and deliberate bulk triage.
- Waiting, stale, failed, and genuine zero-match states must remain distinct.
  Never auto-dismiss from literal zero matches.

### 6 — PUNCH-002 plus PUNCH-006 visible VERA interface

- Add the persistent VERA / Research Video Clips shell, active project selector,
  Workbench/Clips navigation, display-name account menu, notifications, Project
  Settings, recent-project validation, and one readable BCP-47 formatter.
- Finish the no-document-scroll 1440×900 Workbench with compact ingest,
  resizable four-row worklist shelf, remaining-height transcript/player,
  responsive player-above-transcript behavior, and sticky logging action.
- Move the full Clip Library to its project destination and add fast verified
  artifact/source opening plus Back/breadcrumb state restoration.
- Keep active project visible and changeable at every logging action. Personal
  preferences belong in the account menu; governance belongs in Project
  Settings.

### 7 — PUNCH-008 comment foundation

- Preserve Clip description/intended use as curated clip metadata and add
  separate flat chronological comments with stable IDs, author, timestamps,
  optimistic versions, deletion tombstones, optional time anchors, following,
  and authorization.
- Implement the core comment transaction plus atomic optional first comment
  before PUNCH-007 completes no-speech/transcript-unavailable logging.
- Reuse PUNCH-003 stable handles and PUNCH-004 activity receipts rather than
  creating parallel identity or notification systems.

### 8 — PUNCH-007 player-range logging and speech status

- Add the `transcript_range | player_time_range` selection union, separate
  source/export bounds, guarded visible `I`/`O` actions, preview/validation,
  optional exact transcript-by-time attachment, and structured
  `speech | no_speech | transcript_unavailable` state.
- Require a nonempty description or atomic first comment for no-speech and
  transcript-unavailable clips. A comment is context, never speech evidence.
- Permit attested no-speech export with policy-required empty subtitle files
  and immutable actor/time provenance. Block transcript-dependent export until
  exact evidence exists; do not mutate an older request when evidence changes.
- Present Log clip as the primary split button while preserving the exact
  distinct effects of Log clip, Log and export, and Export without logging.

### 9 — Finish PUNCH-008 collaboration and authoring handoff

- Add offline outbox replay, author/moderator edit/delete behavior, mentions,
  follow/unfollow, deduplicated notices, bounded comment search, Clip Library
  activity, main-CSV comment summary, and separate stable-ID comment export.
- Expose authorized paginated comments to Script to Timeline. Display the live
  thread, but require explicit promotion of selected comment versions into an
  immutable build snapshot. Never turn casual comments into automatic editing
  commands.

### 10 — Complete remaining PUNCH-003/PUNCH-004 governance

- Finish invitations, accept/reject/revoke, open-project bounded discovery,
  explicit Researcher self-join, one-way personal-to-shared conversion,
  ownership transfer, Project Settings, governance audit, processing policy,
  budget/cancellation behavior, and the complete multi-user notification matrix.
- Do not expose project content before membership, infer authorization from a
  handle or video ID, or allow Administrators to remove the final Owner.

### 11 — Expanded pilot validation

- Run clean and populated migration gates, authorization matrices, exact replay,
  optimistic conflicts, offline/restart recovery, two-user concurrency,
  fifty-video ingest/keyword triage, claims/review/dismiss/restore, no-speech and
  transcript-unavailable logging, comments/mentions, exports/artifacts, and
  Script to Timeline snapshots.
- Manually verify 1440×900 and responsive layouts, keyboard focus safety,
  dynamic counts without chaotic reordering, fast clip opening, Back/history,
  and cross-project state clearing in the packaged app.
- Run M7-06 real-cloud/live-source evidence when its separately authorized
  prerequisites exist. If they do not, retain the exact blocker and complete
  every deterministic gate that remains possible.

## Product and authority invariants

- The shared catalog remains authoritative for identity, membership, projects,
  project videos, worklist state, keywords, scans, transcripts, clips, comments,
  batches/jobs, notifications, and immutable artifact history. Private object
  storage owns shared transcript/scan artifact bytes. SQLite remains verified
  cache, offline outbox, local process state, navigation history, and locator
  authority.
- Project-video worklist state and transcription processing state are separate.
  Never make a batch item the durable research identity or let UI state replace
  persisted jobs.
- Preserve shared-first transcript resolution, immutable checksummed versions,
  source/English/preferred time linkage, source-video integer milliseconds, and
  honest word/cue/estimated timing.
- Preserve all three selection-command effects. Logging always names a visible,
  changeable project. Export only remains projectless and creates no project
  clip, comment, CSV row, or project event.
- Keep clip description, clip tags, project keywords, comments, structured
  speech status, transcript evidence, and immutable authoring snapshots as
  distinct concepts with explicit ownership.
- Multiple users may flag one canonical project video. Dismissal is recoverable
  project triage, not hard deletion. Zero keyword matches never implies factual
  irrelevance or automatic dismissal.
- Keep local caption/Whisper processing automatic and resource-limited. Only
  explicitly paid hosted work is budget-gated.
- Keep provider, player, acquisition, speech recognition, translation,
  alignment, object storage, job dispatch, and sync details behind typed
  adapters. Do not embed provider behavior in routes or React components.
- Long work remains durable, observable, retryable, leased/heartbeat-aware,
  idempotent, and safe under at-least-once delivery.
- Full source media remains private job-scoped scratch and must be verified
  deleted before terminal completion. Never weaken subtitle policy, package
  hashes, immutable retry/re-export, artifact resolution, or authoring handoff.
- Never expose credentials, tokens, presigned URLs, private object keys, source
  paths, transcript/comment bodies, or provider output through logs,
  notifications, diagnostics, or ordinary catalog events beyond the explicitly
  authorized bounded view.

## Vertical-slice implementation discipline

For every active spec:

1. Update shared contracts before duplicating shapes.
2. Add explicit cloud and/or local migrations for every persistent change.
   Test empty and representative populated databases plus compatibility reads.
3. Centralize authorization decisions and test every role, nonmember denial,
   removed-member behavior, stale version, replay, and concurrent mutation.
4. Implement the smallest complete path across real repository/API/sync/worker/
   UI boundaries. Do not close on scaffolding or an isolated mock UI.
5. Preserve stable IDs, UTC actor/time audit, optimistic versions, idempotency
   keys, immutable artifacts, and exact request/version provenance.
6. Use deterministic fixtures for normal tests. Keep provider/network/live media
   tests dormant and separately authorized.
7. Run narrow tests first, then affected suites, migration validation,
   formatting, typecheck, builds, browser tests, packaged-app checks when
   relevant, `git diff --check`, and the broader repository gate proportional
   to risk.
8. Manually verify the critical interaction for every UI, keyboard, media,
   offline/restart, or packaged-app change.
9. Obtain independent Terra review focused on security/privacy, authorization,
   migration/data compatibility, idempotency/concurrency, state leakage,
   cleanup, and missing failure tests.
10. Inspect the complete diff and working-tree inventory before completion.
    Record actual commands, counts, skips, migrations, manual evidence,
    remaining risks, and commit IDs in the completed spec.
11. Mark a broad PUNCH entry completed only when all its scoped slices and
    acceptance checks are genuinely complete. Link completed specs and retain
    partial status honestly.
12. If two evidence-based debugging attempts do not advance the same failure,
    record the confirmed facts and narrow the reproduction/spec instead of
    accumulating speculative changes.

## External actions and current documentation

- Use current primary documentation before relying on unstable YouTube, AWS,
  Cognito, S3/SQS, Electron, browser, FFmpeg, yt-dlp, whisper.cpp, provider,
  TikTok, Instagram, or AI behavior. Record version-sensitive findings when
  they materially affect a decision.
- Do not invent credentials, cloud parameters, model pins, signing identities,
  quotas, prices, platform permissions, or provider capability.
- Do not deploy infrastructure, change production data, provision accounts,
  spend hosted budget, install external software, or use live media/providers
  without exact authority for that action.
- Never infer media rights from a public URL. Live acquisition requires
  source-specific authorization and redacted, bounded evidence.
- PUNCH-009 platform/AI research requires a new prioritization decision. Do not
  browse or build those candidates merely because adapter seams are nearby.

## Completion gate

Do not claim the core pilot punch list complete until:

1. M7-05 has a verified deterministic packaged-app baseline.
2. Language conflicts cannot silently publish mislabeled source evidence and a
   supported correction/import path works through immutable publication.
3. Personal/shared projects, handles, Owner/Administrator/Researcher permissions,
   invitations/open joins, ownership safeguards, and legacy compatibility pass
   authorization and migration tests.
4. Direct and bulk ingest converge on one canonical project-video row with
   multiple flags, independent processing/review/triage state, safe claims,
   review policy, dismissal/restore, cancellation, and durable receipts.
5. Versioned project keywords and aliases scan exact transcript versions,
   deduplicate overlapping translated matches, expose checksummed shared
   evidence and stable summaries, and rescan correctly without retranscription.
6. The 1440×900 Workbench and responsive layouts expose the canonical worklist,
   keyword evidence, transcript/player, sticky logging, separate Clip Library,
   fast clip opening, and safe navigation restoration without stale project
   state.
7. Player ranges, guarded `I`/`O`, structured speech state, transcript
   attachment, no-speech empty subtitles, transcript-unavailable blocking, and
   all three command effects pass deterministic and packaged UI tests.
8. Multiple authors can comment with offline replay, mentions, time anchors,
   moderation, search, notifications, stable exports, and authorized Script to
   Timeline live/snapshot semantics without mutating clip evidence.
9. Clean/populated migrations, two-user concurrency, replay/conflict, restart/
   offline, fifty-video, export/artifact/cleanup, browser, build, and aggregate
   repository gates pass with no unresolved P0/P1 integrity finding.
10. Remaining external M7-01/M7-06 evidence is either completed under exact
    authority or recorded honestly as an external blocker; it has not been used
    to stall safe deterministic implementation or replaced with fabricated
    proof.

When these gates are satisfied, update the punch-list entries and execution
documents with linked completed specs and actual verification evidence. Report
remaining P2/P3 risks and stop before PUNCH-009 implementation or signed-pilot
release work unless the user explicitly directs the next bounded scope.

---
