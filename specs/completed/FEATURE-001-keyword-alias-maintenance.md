# FEATURE-001 — Keyword and alias maintenance

## User-visible outcome

Project Owners and Administrators can edit, retire, and restore project
keywords and aliases without deleting historical vocabulary or scan evidence.
Researchers can withdraw only their own pending suggestions. Every effective
catalog mutation clearly invalidates current scan summaries and queues the
existing idempotent replacement scans.

## Authority and persisted evidence

- Cloud migration extends suggestion lifecycle evidence with explicit
  withdrawal actor/time/reason and expands keyword command receipts to
  `withdraw`, `keyword_update`, and `alias_update`.
- Shared contracts add strict withdrawal and optimistic keyword/alias update
  commands and responses.
- Catalog commands recheck current project membership and Owner/Administrator
  authority under the project lock, preserve normalized uniqueness across all
  records, and serialize against suggestion review and competing maintenance.
- Existing keyword, alias, suggestion, scan, activity, transcript, clip,
  export, and authoring records remain readable and are never hard-deleted.

## Required behavior and failure states

- A proposer may withdraw only their own pending suggestion; review and
  withdrawal races have one winner and exact idempotent replay.
- Keyword label/description/enabled and alias language/phrase/enabled updates
  require both the record version and project keyword-set version.
- Every effective maintenance update advances the record and keyword-set
  versions once and invokes the existing replacement-scan scheduler once,
  including description-only edits.
- Disabled records still reserve normalized labels and language/phrase pairs.
- An enabled keyword always has an enabled alias. Its final enabled alias
  cannot be disabled until the keyword itself is disabled.
- Approval against a disabled target does not enable that keyword.
- Stale, divergent-idempotency, invalid normalization, authorization, and
  cross-project requests fail without partial mutation or scan scheduling.
- Project Settings reloads authoritative records after conflicts while keeping
  the user's inline draft values visible.

## Non-goals

- Hard deletion, bulk vocabulary editing, taxonomy/topic changes, historical
  scan rewriting, or changing transcript/clip/export/authoring evidence.
- Bookmarks or desktop notifications; each follows in its own bounded spec.

## Acceptance gate

1. Contract, migration, catalog, and API tests cover authorization, exact and
   divergent replay, stale/concurrent commands, normalization collisions,
   withdrawal/review serialization, last-alias enforcement, disabled targets,
   and one keyword-set advance/replacement schedule per successful mutation.
2. Project Settings exposes active and disabled vocabulary, role-correct inline
   maintenance, own-pending withdrawal, stale-scan explanation, and retained
   drafts after conflict reload.
3. Existing scan artifacts remain readable while current summaries become
   stale and replacement rows use the new keyword-set version.
4. Empty and populated cloud migration checks, focused Playwright coverage,
   typecheck, web build, scoped formatting, and `git diff --check` pass before
   this spec moves to `specs/completed/`.

## Completion record

Completed on 2026-08-24 without a dedicated implementation commit.

- Cloud migration `0041_keyword_alias_maintenance.sql` adds explicit
  withdrawal evidence and expands durable command kinds without fabricating or
  deleting historical records.
- Strict shared contracts, catalog transactions, and cloud routes now support
  own-pending withdrawal plus optimistic keyword and alias updates. Exact
  replay, divergent keys, review/withdrawal races, disabled-target approval,
  role denial, last-enabled-alias protection, and version advancement have
  focused deterministic coverage.
- Project Settings shows enabled/disabled vocabulary, role-scoped inline edit
  and enable/disable controls, own-suggestion withdrawal, and the scan-staleness
  consequence. Conflict refreshes leave component draft state intact.
- Focused contracts/catalog/API tests passed (`5` selected tests plus the prior
  full `150`-test overlap); focused cloud migration tests passed (`3` selected),
  and the cloud migration CLI applied all `41` migrations.
- The existing end-to-end project/batch/keyword browser flow passed with edit,
  disable/restore, alias disable, and withdrawal coverage. Typecheck and the web
  production build passed; the existing Vite chunk-size warning remains
  informational.
- Scoped Prettier and `git diff --check` passed. No unrelated dirty worktree
  content was reset or removed.
