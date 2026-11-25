---
name: vera-roadmap-coordination
description: Coordinate VERA Research work through its GitHub Project, including issue creation, exact model routing, claims, escalation, review, acceptance, dependencies, and steward maintenance.
---

# VERA Research roadmap coordination

Use the GitHub Project configured in `.github/vera-roadmap.json` as the sole live roadmap and work-ownership authority. Use `PROJECT_GUIDE.md` for product and architecture truth; use completed specs and linked issue evidence for history.

## Required flow

1. Inspect the issue with `npm run roadmap -- inspect <issue>`.
2. Begin only when Status is `Ready`, dependencies are resolved, acceptance criteria are complete, and exactly one supported `model:*` plus one `effort:*` label exists.
3. Claim with the exact running profile, task identity, and dedicated branch: `npm run roadmap -- claim <issue> --model <exact-model> --effort <effort> --task <task> --branch <branch>`.
4. Keep work inside issue scope. File new discoveries in Inbox and do not start them.
5. Move implementation to review with recorded evidence. Manual media, visual, dogfood, or external-system checks remain `In review` until accepted.
6. Complete only with named acceptance authority and retained evidence.

## Routing

- Luna low/medium: mechanical docs, formatting, deterministic fixtures, small tests, renames, generated output, narrow low-risk corrections.
- Terra medium/high: bounded multi-file features, ordinary debugging, UI, established adapters, integration tests.
- Sol high/xhigh/max: architecture, shared contracts, migrations, auth/privacy, concurrency/idempotency, recovery, destructive changes, ambiguous cross-boundary debugging, release decisions.

Exact matching is mandatory. If scope exceeds the profile, stop, record confirmed evidence, mark Blocked with `needs:model-escalation`, release the claim, and recommend a new profile. The steward approves label changes before work resumes.

## Steward boundary

Scheduled or autonomous steward passes may refine scope, verify routing/readiness, maintain parents/dependencies, and detect stale or conflicting claims. They do not reprioritize goals, implement code, close implementation issues, or dispatch tasks. A direct user invocation of the personal `$vera-roadmap-dispatch` skill is the sole dispatch exception: it may start exactly one validated Ready issue and must not alter scheduled steward behavior or auto-chain. Stay quiet when no meaningful board change is needed.
