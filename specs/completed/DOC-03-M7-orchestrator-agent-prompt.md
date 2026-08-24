# DOC-03 — M7 orchestrator agent prompt

Status: completed documentation-only specification.

## User-visible outcome

The repository contains a copy-paste-ready prompt for a primary M7 orchestrator
that can drive all six local-desktop-completion slices sequentially, preserve
the project invariants and dirty worktree, and use `gpt-5.6-terra` sub-agents
whenever bounded parallel investigation, implementation, testing, or review is
possible.

## Focused context

Milestones 1–6 are complete. M7 is defined in
`specs/future/M7-local-desktop-completion-and-personal-validation.md`; M8 owns
distribution. The prompt must reflect the current uncommitted documentation
handoff and must not authorize M8 work.

## Acceptance criteria

1. The prompt identifies the six M7 slices, final gate, invariants, external
   prerequisites, and explicit M8 non-goals.
2. It requires the workflow skill, full guide/outline/spec reading, one active
   spec at a time, narrow commits, and preservation of unrelated work.
3. It explicitly directs the orchestrator to use `gpt-5.6-terra` sub-agents when
   independent bounded work exists, with one writer per file/boundary and root
   ownership of integration and completion decisions.
4. It covers production-cloud change-set safety, Cognito/secret boundaries,
   source-specific media authorization, primary-source research, and no false
   completion from scaffolding or simulated-only evidence.
5. Targeted formatting and `git diff --check` pass.

## Explicit non-goals

- Do not implement M7, create resources, add dependencies, or change roadmap
  scope.
- Do not modify unrelated existing worktree files.
- Do not commit or push.

## Completion record

### Result

- Added `docs/Milestone 7 Orchestrator Agent Prompt.md` as a copy-paste-ready
  six-slice M7 implementation prompt.
- The prompt requires `gpt-5.6-terra` sub-agents for bounded independent work,
  normally uses up to three alongside the root, requires at least one at each
  slice start when useful, and calls for fresh Terra review before nontrivial
  slice completion.
- It preserves one active spec, one writer per file/boundary, root integration
  authority, production-deployment safety, source-specific authorization, M7
  invariants, and the M8 stop boundary.

### Verification

- `npx prettier --check` passed for the prompt and this specification.
- Targeted searches found the Terra model instruction, per-slice delegation,
  one-writer rule, one-active-spec rule, and explicit stop-before-M8 direction.
- `git diff --check` passed.
- No application tests ran because this was documentation-only.

### Remaining risks

- The implementation orchestrator must re-resolve the live worktree and external
  prerequisites when invoked; the prompt deliberately does not assume
  production credentials, deployment authority, model inputs, or live-source
  authorization.

### Commit IDs

None; the user did not request a commit.
