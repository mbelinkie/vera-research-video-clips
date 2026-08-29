# Repository agent instructions

The public [VERA Research Roadmap](https://github.com/users/mbelinkie/projects) is the authority for actionable work, priority, status, dependencies, ownership, and model routing. `PROJECT_GUIDE.md` remains authoritative for product behavior, architecture, security, contracts, and acceptance. Markdown specs and `outline.md` preserve design and historical evidence; they are not a live queue.

## Context and usage efficiency

- Keep each task within its assigned issue and acceptance criteria. Route unrelated discoveries to separate Inbox issues.
- Search before reading. Inspect only relevant ranges; do not dump large files, binaries, databases, generated artifacts, lockfiles, logs, or broad directory listings into context.
- Use the inherited RTK wrapper. If RTK cannot safely bound potentially large output, filter or byte-cap it and expand only when truncated output is insufficient.
- Start with the narrowest relevant verification, then run broader required gates once the change is stable or when risk or acceptance demands them. Never weaken acceptance to save usage.
- On resume, handoff, or compaction recovery, reconstruct state from the issue or spec, `git status` or diff, and recorded test evidence instead of replaying the conversation.

Before implementation, inspect the assigned GitHub issue and confirm it is `Ready`, has exactly one `model:*` label and one `effort:*` label, complete acceptance criteria, and resolved dependencies. Use one Ready issue, one task, and one dedicated `codex/<issue>-<slug>` branch/worktree. Claim only an exact model-class and effort match with `npm run roadmap -- claim ...`; stronger models do not consume cheaper work without steward-approved relabeling.

Out-of-scope discoveries become bounded Inbox issues and are not started automatically. If work exceeds its profile, stop before expanding scope, run the escalation command with confirmed evidence and a recommended profile, release the claim, and wait for steward routing approval. Preserve verified work on the issue branch.

Merged code is not completion. Use `In review` until every automated and required listening, visual, dogfood, Resolve, or producer acceptance gate passes. Only then may the issue move to `Done` and close. Use the repository commands for `inspect`, `create`, `claim`, `block`, `escalate`, `review`, and `complete`.

Read `.agents/skills/vera-roadmap-coordination/SKILL.md` and `.agents/skills/research-video-clip-workflow/SKILL.md` before coordinating or implementing roadmap work. Preserve all pre-existing modifications and follow `/Users/matthewbelinkie/.codex/RTK.md` for shell commands.
