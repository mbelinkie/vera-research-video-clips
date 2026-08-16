# M5-07 — Verified final clip-package promotion

- Status: active
- Task/thread: M5-07 only

## User-visible outcome

After M5-01–M5-06 have acquired, rendered, validated, and staged the exact
language-policy clip package in an attempt-private directory, the local export
worker atomically promotes only that validated MP4 and required sidecars to a
deterministic, sanitized local final-artifact package. It verifies the promoted
package, stores safe final-artifact provenance, then retains the established
source-cleanup gate: a cleanup failure is still `needs_user_action`, never a
reported completed export.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, and completed M5-01 through M5-06 before
editing. Limit work to the immutable export request/read contract, local final
artifact boundary, local SQLite provenance/migration, deterministic package
promotion, and focused tests. Reuse the M5-01 scratch lifecycle, M5-02 resolved
bounds, M5-03 MP4 validation, and M5-04–M5-06 subtitle-policy results.

## In scope

1. Determine one deterministic, sanitized, collision-safe package identity
   below the configured local data/output boundary. It must never be derived
   from an arbitrary path or unsanitized source title.
2. Promote only the already validated temporary MP4 and exactly the staged
   sidecar set selected by M5-04–M5-06: MP4 alone for confirmed-English
   omission; MP4 plus exact English SRT for confirmed English without
   omission; MP4 plus exact original and translated-English SRTs for
   foreign/mixed/unknown.
3. Validate staged-package completeness, regular/nonempty files, expected
   fixed roles/names, policy match, and no extra artifacts before promotion.
   Do not read transcript data, derive subtitles, or substitute tracks.
4. Use package-level atomic promotion with rollback: no final artifact can be
   visible as a partial package. Promotion failure or cancellation removes all
   attempted final artifacts, then continues M5-01 source/staging cleanup.
5. Re-verify promoted files as regular/nonempty and policy-complete before
   persisting safe final-artifact provenance: role/type, package identity,
   bytes, SHA-256, source attempt, and validation time only.
6. Keep logged export versus export-only ownership and persistence separation
   unchanged. Add a local migration only where durable final-artifact
   provenance requires one.

## Explicit non-goals

- Reacquiring source media; rerendering; transcript lookup; subtitle derivation,
  replacement, embedding, or burn-in; mutation of any request, bounds, or
  provenance snapshot.
- Manifests/metadata JSON, thumbnails, UI/preset work, retries, grouping,
  cloud clip storage, or scratch sweeping.
- Persisting transcript text, source/staging/final absolute paths, URLs,
  commands, credentials, raw tool output, or source media.

## Failure states

- Incomplete, extra, malformed, nonregular, empty, or policy-mismatched staged
  packages fail closed without promotion and enter existing cleanup.
- Any promotion failure or cancellation rolls back every attempted final
  artifact and cleans source plus temporary MP4/SRT staging.
- Promoted-file verification or final-provenance persistence failures roll back
  the final package and run established cleanup.
- A verified cleanup failure remains the M5-01 actionable
  `needs_user_action` outcome, even after otherwise valid promotion.

## Acceptance criteria

- Deterministic tests prove atomic promotion for omission, English-sidecar, and
  bilingual policies with exactly the required files and no partial visibility.
- Promotion performs no transcript lookup or subtitle substitution and consumes
  only existing validated artifacts plus immutable/persisted policy inputs.
- Invalid, incomplete, extra, malformed, or policy-mismatched staging is
  rejected before finalization.
- Failure/cancellation rollback leaves no retained source, temporary MP4/SRT,
  or partial final package.
- Durable final provenance contains only safe role/type, identity, hashes,
  byte sizes, source attempt, and validation-time facts; logged/export-only
  separation remains intact.

## Verification plan

1. Run focused local-agent/local-DB fixtures first for all three policies,
   staged-package rejection, no lookup/substitution, promotion rollback,
   cancellation, cleanup-failure actionability, provenance, and export-mode
   separation.
2. Run relevant transcript, media, local-agent, local-DB, cloud-DB, catalog,
   and worker tests.
3. Run formatting, typecheck, migration validation, broader checks, and
   `git diff --check`.
4. Review the complete diff for snapshot mutation, path/text/tool leakage,
   partial-package exposure, cleanup omissions, and export-mode regressions.

## Completion record

- Decisions made: Final package identity is `clip-<export-request-UUID>` and is
  rooted below the local data root's `exports/` boundary. The worker copies only
  fixed validated staging names into a private sibling directory and atomically
  renames that directory into place. It validates policy-complete staging using
  persisted M5-03–M5-06 provenance without transcript access during promotion,
  then re-verifies final regular/nonempty artifacts before persisting only safe
  package identity, role, byte size, SHA-256, source attempt, and validation
  time. Cleanup success marks a promoted job complete; cleanup failure remains
  `needs_user_action` and preserves the existing final package for recovery.
- Files changed: local export processor and deterministic lifecycle fixtures;
  shared final-artifact provenance contract; local provenance read/write model;
  local migration `0011_export_final_artifact_provenance`; `PROJECT_GUIDE.md`;
  and `outline.md`.
- Checks run and actual results: focused local-agent/local-DB/contracts suite:
  25 passed; relevant transcript/media/local-agent/local-DB/cloud-DB/catalog/
  worker suite: 68 passed; `npm run check`: passed with 129 tests passed and 1
  skipped, web production build passed, and local/cloud migrations validated
  with 11/8 newly applied; `git diff --check`: passed.
- Remaining risks/follow-ups: No live authorized source/FFmpeg smoke test ran;
  deterministic fakes cover the lifecycle. Manifests/metadata JSON, thumbnails,
  subtitle embedding/burn-in, UI/preset changes, retries, grouping, cloud clip
  storage, and scratch sweeping remain intentionally deferred.
- Commit ID(s): Not committed in this task.
