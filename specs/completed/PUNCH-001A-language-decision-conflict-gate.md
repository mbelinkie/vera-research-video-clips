# PUNCH-001A — Versioned language decision and conflict gate

- Status: completed 2026-08-24
- Parent entry: `PUNCH-001`
- Priority: P1 high
- Dependencies: M7-04 verified transcript integration, M7-05 deterministic
  export baseline, and PL-01 multilingual track/evidence preservation are
  complete. M7-01/M7-06 live-cloud and live-source inputs remain external.

## User-visible outcome

When caption/provider language evidence is unknown or conflicts with a
write-authorized researcher's confirmed spoken language, the project video and
its pending transcription work enter an explicit, actionable
`needs_language_confirmation` state before translation, media acquisition, or
immutable publication. An authorized researcher can record a versioned
confirmation/correction, see both the provider claim and resolved language,
and continue only when the selected caption or configured speech/translation
providers can honestly support the decision.

## Smallest end-to-end proof

Use a deterministic project fixture whose automatic caption provider reports
Korean while a write-authorized user confirms Dzongkha. Persist both claims,
snapshot the decision onto the affected batch item/job, and prove the worker
performs no translation, media acquisition, or publication while the evidence
is conflicting. Then use a supported-language fixture to confirm a corrected
decision, re-run preflight/source resolution, and prove the accepted original
track keeps its provider identity/hash while the durable decision/version and
resolved language flow into the immutable transcription identity. Reload the
browser and a second catalog client and observe the same state and remediation.

## Affected authority boundaries and persisted records

- Shared contracts own closed language-decision status/basis, provider and
  resolved language evidence, provider capability results, actionable batch
  states, and sanitized renderer responses.
- The shared catalog remains authoritative for append-only project-video
  language decisions, optimistic versions, actor/time audit, batch/job
  snapshots, authorization, and idempotency.
- Forward-only cloud migration(s) add the durable records/constraints and must
  preserve empty and representative populated databases plus legacy reads.
- Caption, speech-recognition, and translation adapters advertise or validate
  bounded language support behind typed provider interfaces.
- The worker applies the snapshotted decision before provider work and retains
  the established immutable publication/finalize boundary.
- The web worklist/review path presents provider and resolved evidence plus
  bounded confirmation/remediation commands; it never manufactures language
  authority in component state.
- Existing local SQLite transcript/cache authority is unchanged unless exact
  restart-safe decision mirroring proves necessary; any such change requires a
  forward-only local migration and compatibility tests.

## Failure, restart, concurrency, authorization, and migration behavior

- Missing/unknown/conflicting evidence stays actionable and starts no dependent
  provider or acquisition work.
- Correcting a label cannot repair caption text incompatible with the confirmed
  language; such a caption remains rejected and requires supported speech work
  or the later timed-import slice.
- Unsupported speech or translation language fails during capability preflight,
  before acquisition, with no mislabeled fallback.
- Only current project members with ordinary write/research authority may add a
  decision. Nonmembers and read-only legacy viewers are denied.
- Exact idempotent replay returns the existing decision. Divergent key reuse or
  stale optimistic version conflicts. Concurrent decisions preserve append-only
  history and expose one current project-video decision without overwriting a
  prior audit row.
- Worker retry/reassignment consumes the exact snapshotted decision/version;
  a newer project decision does not silently mutate an already claimed attempt.
- Clean and populated migration validation must preserve existing projects,
  batches, jobs, transcript versions, clips, and legacy language reads.
- Responses, events, readiness, and diagnostics omit transcript text, provider
  raw output, URLs, local paths, credentials, object keys, and tokens.

## In-scope behavior

1. Add versioned language-evidence and decision contracts separating provider
   reported language from resolved language, with closed status and basis.
2. Persist append-only project-video decisions with authorization,
   idempotency, optimistic concurrency, and safe audit projections.
3. Snapshot the current decision/version onto newly queued or retried
   transcription work and include it in work identity.
4. Make caption selection conflict-aware without relabeling provider bytes or
   accepting incompatible automatic captions.
5. Add typed speech/translation capability preflight and pass supported
   confirmed language hints only when valid.
6. Expose `needs_language_confirmation` and bounded confirm/correct/remediation
   UI through the real catalog/API/worklist path.
7. Preserve existing original/English/preferred clip evidence and export
   safety; unresolved language behaves as unknown for subtitle omission.

## Explicit non-goals

- Timed VTT/SRT/canonical bilingual import, side-by-side import approval, or
  corrected-version activation; those are later PUNCH-001 slices.
- Editing or relabeling immutable published transcript bundles.
- Trusting free-form creator descriptions automatically or promising universal
  Whisper/Amazon Translate language coverage.
- New media/provider execution, live YouTube access, AWS deployment, Cognito
  acceptance, hosted spending, or M7-06 dogfood.
- PUNCH-002 through PUNCH-009 UI, governance, worklist, keyword, range, comment,
  additional-platform, or AI work.

## Acceptance criteria

1. Provider Korean plus confirmed Dzongkha creates a durable conflict and no
   translation, acquisition, or publication call.
2. Caption bytes/provider identity remain unchanged; incompatible text cannot
   be adopted merely by setting its language to `dz`.
3. Authorized exact replay is idempotent, stale/concurrent mutation conflicts
   safely, and nonmembers/read-only memberships cannot decide.
4. Newly queued/retried work snapshots the exact decision/version and includes
   it in idempotency; active attempts never change underneath a later decision.
5. Unsupported speech/translation capability is known before media acquisition
   and produces an actionable bounded state.
6. Browser reload and a second authorized client show the same provider claim,
   resolved language, status, decision basis/version, and remediation choices.
7. Unresolved/conflicting language cannot enable confirmed-English subtitle
   omission or produce mislabeled clip/export evidence.
8. Clean/populated migrations, duplicate delivery, restart, authorization,
   provider-no-call, API, and browser tests pass without prohibited data leaks.

## Narrow tests first

- Shared contracts: language tags, decision status/basis, provider/resolved
  separation, capability result, actionable state, and strict redaction.
- Cloud migration/catalog: clean/populated migration, authorization, append-only
  history, current-pointer/version, exact replay, stale/concurrent conflict, and
  batch/job snapshot identity.
- Providers/worker: conflict before selection/publication; speech and
  translation capability no-call before acquisition; supported confirmed hint;
  retry uses the snapshotted version.
- Cloud API/web: authorized read/decide route, reload, provider-versus-resolved
  presentation, remediation state, project/video clearing, and nonmember denial.
- Existing transcript publication, PL-01, export language-policy, workspace,
  packaged-app, and aggregate gates proportional to the changed boundaries.

## Completion requirements

Run the narrow tests first, then formatting, typecheck, clean/populated
migrations, affected suites, web/desktop builds, browser tests, packaged-app
proof when relevant, aggregate checks, and `git diff --check`. Obtain fresh
independent Terra review for authorization, migration/data compatibility,
idempotency/concurrency, privacy, worker no-call ordering, and missing failure
tests. Record actual evidence and remaining risks before moving this file to
`specs/completed/` and updating `PROJECT_GUIDE.md`, `outline.md`, or the punch
ledger.

## Completion evidence

- Cloud migration `0024_project_video_language_decisions.sql` passed clean and
  representative populated PGlite coverage, including legacy batch/job
  preservation, append-only decision constraints, and cross-video decision-FK
  rejection. The standalone cloud gate applied all 24 migrations; the unchanged
  local gate applied all 30 migrations.
- Shared contract, migration, catalog/API, provider, and worker focused suites
  passed. The final bounded repository suite passed 52 files with 524 tests and
  four intentional skips; no test failed.
- Four focused Chromium flows passed: conflict presentation and correction,
  unsupported remediation, reload/second-client state, cross-project clearing,
  same-project delayed selection, and confirmation-versus-selection races.
- `npm run typecheck`, `npm run build:web`, changed-file Prettier checks, and
  `git diff --check` passed. The repository-wide format command remains blocked
  only by the unrelated, unchanged `docs/Script-to-Resolve Product Spec.md`.
- Deterministic tests prove Korean provider evidence versus confirmed Dzongkha
  performs no caption acquisition, media acquisition, speech recognition,
  translation, upload, or finalize; unknown/unsupported capabilities release
  the lease into an actionable state; confirmed and creator-metadata snapshots
  are immutable job/manifest identity; stale attempts cannot replace a newer
  project decision; and confirmed manifests cannot publish a mismatched source
  language.
- Fresh independent Terra review covered authorization, migration/data
  compatibility, replay/concurrency, privacy, lease races, no-call ordering,
  manifest binding, and renderer state leakage. All reported P1/P2 findings were
  fixed and regression-tested; final re-review reported no remaining P0/P1/P2.
- Primary capability references were recorded in
  `docs/research/PUNCH-001-provider-language-capabilities-2026-08-23.md`.
  Live media/providers, AWS deployment, production Cognito, and M7-06 dogfood
  were not invoked.
- No commit was created by this task. Detailed unsupported-capability state is
  durable on the affected batch item; the project-video row retains the current
  status/evidence/decision pointers. Timed bilingual import and explicit
  corrected-version approval/activation remain the next PUNCH-001 slices.
