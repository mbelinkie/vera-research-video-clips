# M5-06 — Verified confirmed-English subtitle-omission staging

- Status: completed
- Task/thread: M5-06 only

## User-visible outcome

When a confirmed-English export request has the immutable English-sidecar
omission setting enabled, the local export worker renders and verifies its
temporary MP4 through the existing M5-01–M5-03 lifecycle, intentionally writes
no SRT in private attempt staging, stores only safe omission provenance, and
then follows the established cleanup gate.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, and completed M5-01 through M5-05
specifications before edits. Limit changes to the immutable export-request
policy, local export worker, local SQLite omission provenance/read model, and
deterministic tests. Reuse M5-03 MP4 validation and M5-04/M5-05 private
staging/cleanup behavior; no route, UI, preset, transcript provider, or final
artifact work belongs here.

## In scope

1. Resolve omission exclusively from the immutable snapshot: it is valid only
   for `confirmed_english` plus the snapshotted omission setting. It must use
   M5-02 bounds and M5-03 rendered provenance without any transcript lookup,
   derivation, substitution, or requirement.
2. Render and validate the temporary MP4 exactly as M5-03 requires, stage no
   SRT below the attempt-private directory, and retain M5-04/M5-05 cleanup on
   success, failure, and cancellation.
3. Persist only safe omission provenance: snapshotted policy, source attempt,
   and validation time. Never persist transcript text, paths, URLs, commands,
   credentials, raw tool output, or a fabricated empty sidecar.
4. Preserve M5-04 confirmed-English omission-disabled English-sidecar staging
   and M5-05 foreign/mixed/unknown mandatory bilingual staging unchanged.
5. Add a local migration only as needed, while retaining logged-export versus
   export-only separation.

## Explicit non-goals

- Final promotion, manifests, thumbnails, subtitle embedding/burn-in, UI or
  preset changes, retries, same-source grouping, and scratch sweeping.
- Transcript acquisition/publication, translation generation, authorization,
  logged-clip semantics, CSV/Sheets synchronization, or export-only
  projectlessness.
- Persisting any source media, transcript content, private paths, URLs,
  commands, credentials, raw tool output, or an empty sidecar placeholder.

## Failure states

- Invalid rendering or cancellation removes source, temporary MP4, and any
  staged SRT; omission never creates an SRT on its valid path.
- A verified cleanup failure supersedes ordinary reporting and remains the
  actionable M5-01 `needs_user_action` outcome.
- Confirmed-English omission-disabled requests still fail closed when their
  exact English sidecar cannot be staged; foreign/mixed/unknown requests still
  fail closed when either required bilingual sidecar cannot be staged.

## Acceptance criteria

- A confirmed-English omission snapshot produces a verified MP4 lifecycle with
  no staged SRT and safe durable omission provenance.
- The valid omission path makes no transcript lookup or track substitution.
- Omission-disabled confirmed-English and all foreign/mixed/unknown snapshots
  retain their exact existing sidecar policies, irrespective of the setting.
- Failure, cancellation, and cleanup-failure behavior remains safe and
  actionable; logged and export-only requests remain separated.

## Verification plan

1. Run focused deterministic local-agent/local-DB tests first: omission
   success/no SRT/no lookup; English regression; bilingual regressions;
   invalid-render/cancellation cleanup; cleanup failure; safe provenance and
   logged/export-only separation.
2. Run relevant transcript, media, local-agent, local-DB, cloud-DB, catalog,
   and worker tests.
3. Run formatting, typecheck, migration validation, broader checks, and `git
diff --check`.
4. Review the complete diff for snapshot mutation, transcript/path/tool leakage,
   missed cleanup, and language-policy or logged/export-only regressions.

## Completion record

- Decisions made: The worker resolves an omission policy before any transcript
  access. Only the immutable `confirmed_english` snapshot with its omission
  setting enabled takes that branch; after M5-03 MP4 validation it verifies no
  SRT exists in private staging and persists only the policy literal, source
  attempt, and validation time. Confirmed-English omission-disabled and every
  foreign/mixed/unknown snapshot retain their M5-04/M5-05 sidecar paths.
- Files changed: local export policy/worker and deterministic tests; shared
  export-request read schema; local SQLite omission-provenance read/write path
  and migration `0010_export_confirmed_english_subtitle_omission`; project
  guide and outline.
- Checks run and actual results: focused local-agent/local-DB suite: 14
  passed; relevant transcript/media/local-agent/local-DB/cloud-DB/catalog/
  worker suite: 50 passed; formatting and typecheck: passed; local migrations:
  10 newly applied; cloud migrations: 8 newly applied; `npm run check`: 126
  passed, 1 skipped, web production build passed, local/cloud migrations
  validated with 10/8 newly applied; `git diff --check`: passed.
- Remaining risks/follow-ups: Final artifact promotion, manifests, thumbnails,
  embedding/burn-in, UI/preset controls, retries, grouping, and scratch
  sweeping remain deferred. No live authorized source/FFmpeg smoke test ran;
  deterministic fixtures cover the private lifecycle.
- Commit ID(s): Not committed in this task.
