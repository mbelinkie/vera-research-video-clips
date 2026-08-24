# Claude Code operating guide

This repository is the durable source of truth for the Research Video
Transcript & Clip Extraction Tool. Work as a careful implementation partner:
complete one bounded, testable vertical slice at a time, preserve existing work,
and leave evidence that another engineer or coding agent can review.

## Start every session here

Before editing anything:

1. Confirm the repository root and run `git status --short --branch`.
2. Treat every existing modification and untracked file as user-owned. Do not
   discard, overwrite, stage, move, or reformat it unless it is explicitly in
   the assigned slice.
3. Read `PROJECT_GUIDE.md` completely before changing architecture, behavior,
   schemas, persistence, security, or milestone scope. It is authoritative.
4. Read `outline.md` for current status and build order, then read `README.md`.
5. Read the entire active spec in `specs/active/`. There must be exactly one
   bounded active spec for the implementation task.
6. Inspect the relevant contracts, implementation, migrations, tests, and
   recent Git history before proposing a change.
7. State the smallest user-visible end-to-end behavior the slice will prove and
   its important failure states.

If no active spec exists, do not begin broad implementation. Draft the smallest
useful next spec from the unchecked work in `outline.md`, using the repository's
spec template and existing completed specs as examples. Show the proposed scope
to the user before changing product code. Do not combine unrelated work in one
spec or session.

## Current handoff snapshot

As of 2026-08-16:

- Milestones 1–4 are substantially complete.
- Milestone 5's local `Export only` runtime is proven through M5-08 with
  repository-owned fixture media and real FFmpeg/FFprobe.
- Logged/cloud export delivery, conversion presets and broader settings,
  crash-recovery cleanup, optional package artifacts, queue controls, and the
  release gate still contain open work. Use `outline.md`, not this snapshot, as
  the current checklist.
- There was no active spec when this guide was written.
- `mistakes.md` and `specs/future/` were untracked user-owned work. Preserve them
  unless the user explicitly assigns them.

This snapshot will age. Always trust current files, Git history, tests, and the
user's latest instruction over it.

## One owner per slice and worktree

- Do not work in the same Git worktree concurrently with Codex or another agent.
  Ask the user whether the worktree is free if that is unclear.
- Prefer a dedicated worktree and a dedicated `claude/<spec-id>-<short-name>`
  branch created from a verified commit.
- One agent owns an implementation slice end to end. Parallel agents may review
  or investigate, but adjacent slices must not independently change the same
  contract, migration sequence, persistence model, or worker lifecycle.
- Re-run `git status --short` before editing, before formatting, before staging,
  and before committing. Stop and report unexpected changes rather than trying
  to reconcile them silently.
- Keep commits small and reviewable. Do not push, merge, rebase, force-push,
  create a pull request, or deploy unless the user explicitly asks.

Never use destructive Git or filesystem commands on user work. In particular,
do not use `git reset --hard`, `git clean`, broad checkout/restore commands,
recursive deletion, or an automatic stash. Never rewrite shared history.

## Slice workflow

Every implementation slice must have a Markdown spec in `specs/active/` that
defines:

- user-visible outcome and current evidence;
- in-scope and explicit non-goals;
- allowed packages, files, and architectural boundaries;
- contract, authorization, persistence, migration, storage, worker, sync, and UI
  impact where relevant;
- actionable failure states;
- acceptance criteria;
- narrow verification commands, broader checks, and manual verification.

Then:

1. Update a shared schema or contract before duplicating a data shape.
2. Add an ordered migration for every persistent local or cloud schema change.
3. Implement the smallest complete path through the real boundary. Do not build
   disconnected UI or embed provider-specific behavior in routes/components.
4. Add deterministic fixture-based tests. Keep live-provider and billable tests
   optional and disabled by default.
5. Run the narrowest tests first, then type checking/linting and broader checks
   proportional to risk.
6. Manually verify critical UI or media interactions when applicable.
7. Inspect the complete diff and retain actual command output. Never claim that
   tests "should pass."
8. Update `PROJECT_GUIDE.md`, `outline.md`, and other durable status documents
   only for completed, verified work.
9. Move the spec to `specs/completed/` only when the slice is genuinely done,
   with its decisions, files changed, actual checks/results, compatibility
   impact, remaining risks, and commit reference(s).

After two evidence-based debugging attempts without progress, stop patching.
Record confirmed facts and a focused reproduction, then start a fresh task/spec
or explicitly revise the active one.

## Product invariants that must not regress

- Resolve a project's active English transcript from verified local cache or
  private shared storage before generating another one.
- Publish completed transcript bundles as immutable, checksummed versions and
  expose them only through transactional finalization.
- Preserve original-language and English tracks separately and link them by
  source-video time, never by matching array indexes.
- Record transcript source/version and honest timing precision. Never present
  cue or estimated timing as word-exact.
- Long-running work is persisted, observable, retryable, lease-aware, and safe
  under duplicate delivery. Never silently regenerate verified work.
- `Queue / log only` requires a visible project, logs atomically, and starts no
  render.
- `Export + log` requires a visible project, logs first, then requests render.
- `Export only` creates a persisted technical export snapshot but no project
  clip, CSV/Sheets row, project tags, or research note.
- Logging actions persist the entered multiline note and project-scoped tags
  atomically with the clip and preserve them through search, filtering, and
  synchronization.
- Store transcript selection bounds separately from requested and resolved
  export bounds.
- Foreign, mixed, or unknown-language exports require separate clip-relative
  original and translated-English SRT sidecars from the exact snapshotted track
  versions. Confirmed-English exports receive an English SRT unless an explicit
  immutable omission setting says otherwise.
- Temporary source media and staging outputs stay in private job-scoped storage,
  are verified before promotion, and are deleted on every terminal path.
  Cleanup failure is actionable and must block false completion.
- Shared reads and writes require project authorization. Stable IDs,
  optimistic versions, idempotency keys, and explicit field ownership protect
  synchronized records.

## Security and permission boundaries

- Work only inside this repository unless the user explicitly authorizes
  another path. Do not inspect home-directory credentials, shell history,
  browser data, SSH material, cloud profiles, keychains, or unrelated projects.
- Do not read or print `.env` files, tokens, private keys, credentials, presigned
  URLs, or secret-bearing logs. `.env.example` is safe documentation.
- Keep normal Claude Code permission prompts enabled. Never use
  `--dangerously-skip-permissions` for this repository.
- Do not enable MCP servers, hooks, plugins, or additional directories without
  explicit approval.
- Do not install or upgrade dependencies, alter lockfiles, make network calls,
  or invoke live/billable providers without explicit approval and a reason tied
  to the active spec.
- Do not access live YouTube media, AWS, S3, queues, translation, transcription,
  Google services, Sentry, or other external systems during normal tests.
  Prefer repository fixtures and deterministic fakes.
- Never deploy infrastructure or applications, mutate remote data, push Git
  branches, or publish artifacts without explicit authorization.
- External executables such as FFmpeg, FFprobe, and yt-dlp must be invoked with
  argument arrays, validated paths/filenames, bounded output, cancellation, and
  no shell interpolation or ambient credentials/configuration.
- Bind development services to loopback. Do not broaden CORS or network exposure
  for convenience.

Ask before any destructive migration, data rewrite, deletion beyond isolated
task-owned scratch, dependency change, live-provider test, or operation whose
scope is uncertain.

## Review priorities

Review correctness before style. Report, in this order:

1. data loss, security, authorization, credential, or privacy risk;
2. violations of product invariants or cross-boundary contracts;
3. missing migrations, incompatible persisted data, or rollback problems;
4. broken idempotency, duplicate delivery, lease recovery, cancellation, or
   atomic finalization;
5. timing/subtitle inaccuracies and unsafe scratch cleanup;
6. untested failure states and misleading completion claims;
7. maintainability and style issues.

Do not deploy or merge code that the responsible reviewer cannot explain.

## Required handoff

End every task with a concise, evidence-backed handoff containing:

- user-visible outcome;
- spec and files changed;
- important decisions and preserved invariants;
- migrations and data-compatibility impact;
- exact commands run and their actual results;
- manual verification performed;
- failures or checks that could not run;
- remaining risks and the smallest sensible follow-up;
- commit ID if a verified local commit was requested and created.

Do not mark a checklist item complete for scaffolding, mocked-only wiring, or an
untested claim. When uncertain, leave the item open and state exactly what has
and has not been proven.
