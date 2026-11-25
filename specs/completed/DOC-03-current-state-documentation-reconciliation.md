# DOC-03 — Current-state documentation reconciliation

## User-visible outcome

Living repository documentation accurately identifies the completed core pilot
punch list, the bounded PLATFORM-001 YouTube-search/source foundation, the
remaining PUNCH-009 and external release gates, the verified local package, and
the correct restart/dogfood workflow.

## Boundaries

- `README.md`
- `PROJECT_GUIDE.md`
- `outline.md`
- `specs/future/PILOT-punch-list.md`
- `docs/VERA Pilot Punch List Orchestrator Agent Prompt.md`

Historical completed specifications and milestone prompts remain historical
evidence. `docs/Script-to-Resolve Product Spec.md` is unrelated dirty user work
and must not be edited.

## Non-goals

- Product code, contracts, migrations, tests, packaging, deployment, or live
  provider/media changes.
- Rewriting historical completion records to remove statements that were true
  at their recorded completion time.
- Completing PUNCH-009, M7-06 live-cloud/source proof, or M8 distribution.

## Acceptance

1. The README summarizes the completed punch scope, remaining gates, validation
   totals, and commands/path for the unsigned Intel macOS package.
2. The VERA prompt is a current restart/dogfood prompt rather than an obsolete
   instruction to reimplement completed punch items.
3. The guide, outline, and punch ledger agree that PUNCH-001 through PUNCH-008
   and PUNCH-010 are complete; PUNCH-009 remains proposed except for the
   completed platform-neutral identity and YouTube-search foundation.
4. This documentation spec moves to `specs/completed/`; any later/concurrent
   active implementation spec is preserved and identified accurately.
5. Changed Markdown passes scoped Prettier and `git diff --check`.

## Verification plan

- Search living docs for stale M7-05-active and incomplete-core-punch claims.
- Run scoped Prettier checks only on the files changed by this task.
- Run `git diff --check` and inspect the final documentation diff/status.

## Completion record

Completed on 2026-08-24 without a dedicated implementation commit.

- Reconciled the living README, project guide, outline, punch-list ledger, and
  restart/dogfood prompt with the completed deterministic core punch scope and
  the remaining PUNCH-009 and external release gates.
- Recorded the current unsigned Intel macOS package workflow and verification
  evidence without changing historical completion records or unrelated product
  work.
- Scoped Prettier checks passed for all six documentation/specification files.
- Scoped `git diff --check` passed.
- This documentation specification moved to `specs/completed/`. During final
  validation, the separately owned
  `specs/active/FEATURE-001-keyword-alias-maintenance.md` appeared as the next
  bounded feature; it was preserved and the living status references were
  reconciled rather than overwritten.
