# Project Library sources and logged items

Research #76 implements the accepted Research Sources spec sections 2 and 4. It had no dependencies. The project Library supports seven kinds of source and four kinds of logged item. Each source holds its bibliography and each item carries its logger, notes and project Topics. The authenticated endpoints and payloads are documented in PROJECT_GUIDE.md §9.5.

Migration `0053_project_library` keeps existing video and clip UUIDs. Linked videos expose their existing evidence. If a project previously unlinked a video while retaining a clip, its Library recovers the source from the project's saved clip snapshot. Legacy clip records, transcript selections, export evidence and comment foreign keys stay in place. Per-project citation edits preserve untouched fields and keep unknown bibliographic values absent.

## Verification on November 18, 2026

- The generated Cloud API fixtures exercised source and item creation, reads, updates, search and filters, project isolation, stale writes, safe retries and exact quote text. Both routes resolved a transcript-backed clip to the same Timeline UUID. Migration fixtures retained a pilot-style comment, a provider-specific video, an existing export, its snapshots and its Topic assignments.
- The normal migrator also upgraded an empty generated database built from the 52 migrations in the published pilot checkpoint at `0499666`. Running it again applied zero migrations.
- A disposable PostgreSQL 16 instance passed the repository's concurrent migration test. Six simultaneous retries created one source and one item. Competing edits against one version yielded one success and one conflict.
- A generated PGlite Library with a quote and a linked video passed synthetic import, PostgreSQL backup and restore. The restored API returned the original source and item records, including IDs, exact text, logger and Topic.
- Research's `npm run check` passed using Node 22.23.2 and a physical temporary directory on macOS. It covered formatting, TypeScript, the test suite, the web build and local/cloud migrations. All data rehearsals used generated fixtures.
- Opus reviewed the migration design. The implementation protects dependent rows on unlink, preserves citation fields during corrections, reuses provider identities, enforces same-project Topic assignments and guards the item UUID namespace.

The contracts, shared catalog, Cloud API routes, migration and pilot data verification shipped on the issue branch in `4b33233`. The empty-object import fix is `4dde1f8`. Producer-facing Library screens, detailed quote authoring and web ingestion are covered by their own roadmap issues.
