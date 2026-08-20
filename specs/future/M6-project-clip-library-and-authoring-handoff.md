# M6 — Project Clip Library and authoring handoff

Status: future milestone specification. Promote to `specs/active/` and split
into bounded vertical slices before implementation.

## User-visible outcome

A researcher can open one project's Clip Library, find clips logged during
review, export one or many without entering a script, follow independent job
status, and open or re-export completed packages. The future scriptwriting
product can search the same authorized records and reuse an exact verified
package or request the same durable export when compatible bytes are unavailable.

Google Sheets is not required for either path.

## Product decision

Milestone 6 is no longer a Google Sheets job-control surface. The shared project
catalog remains authoritative for clip records and export state; the research
export boundary remains authoritative for reusable editing packages. CSV and any
later Sheets integration are subordinate projections.

The research product owns:

- clip identity, transcript/version provenance, selected and export bounds,
  notes/tags, and rights/provenance context;
- durable export requests, resolved conversion snapshots, status, retries, and
  immutable verified package versions;
- artifact identity and authorized resolution.

The scriptwriting product owns narrative use, build policy, project-local media
materialization, timeline placement, and build history. It must not scrape a
sheet, duplicate source acquisition/conversion logic, or move/mutate a canonical
research package.

## Smallest end-to-end proof

1. Log three fixture clips from two source videos to one project.
2. In the Clip Library, select all three and request one batch using a resolved
   editing preset.
3. Process siblings independently and reuse one acquisition for the two
   same-source clips where practical.
4. Finalize immutable packages with verified manifests/hashes and expose their
   availability.
5. From a simulated authorized authoring client, resolve and reuse one exact
   compatible package.
6. Remove another package from its recorded locator. Resolution must report
   `missing`, accept a verified relink when the exact package is supplied, or
   create one idempotent re-export request.

## In scope

### Project Clip Library

- A dedicated project-level `Clips` surface rather than additional controls in
  the transcript selection panel.
- Search/filter across transcript text, video title, notes, tags, research
  status, export status, and verified artifact availability.
- Per-clip export plus multi-select `Export selected`, composed over the
  Milestone 5 request/worker boundary rather than a new executor.
- Project/default preset resolution with an immutable settings summary before
  submission.
- Independent progress, actionable errors, retry, safe cancellation, and
  sibling failure isolation.
- Surface Milestone 5 same-source grouping where compatible and practical.
- Completed package history with artifact identity, settings/version summary,
  verification/availability state, and `Reveal/Open`, `Verify`, and explicit
  `Re-export` actions.

### Artifact resolution

- Treat artifact/package ID plus immutable manifest and hashes as identity.
- Treat local paths, object keys, download grants, and consumer copies as
  replaceable locators with separately verified availability.
- Match the exact clip snapshot, transcript/track versions, export bounds,
  required handles, language-policy sidecars, and conversion requirements.
- Verify the manifest and required bytes before returning `reusable`.
- Return explicit `missing`, `invalid`, `remote_only`, or `incompatible` results
  instead of inferring availability from `export_status = complete`.
- Search only configured artifact roots automatically. An explicit user-located
  package must pass full manifest/hash/snapshot verification before relink.
- Preserve completed provenance when bytes disappear; locator failure does not
  rewrite history into a render failure.

### Authoring boundary

- Authorized clip search by project, tags, notes, video metadata, and transcript
  text with stable clip IDs.
- Exact artifact-resolution capability with compatibility requirements supplied
  by the caller.
- Idempotent durable export request when no compatible reachable package exists.
- Request-origin provenance such as `clip_library` or `authoring_build` for
  diagnostics only; origin does not fork export semantics or artifact identity.
- Consumer materialization metadata sufficient for the authoring product to
  copy or copy-on-write clone verified bytes into its own project workspace.

### Optional external catalog projection

- Keep the existing stable-ID CSV export.
- Define one-way Sheets publishing only as later optional integration work.
- Do not include a Sheets export checkbox, Apps Script trigger, polling worker,
  or hosted job relay in this milestone.

## Explicit non-goals

- Building the script editor or Resolve compiler in this repository.
- Packaging a nontechnical pilot installer, first-run operator experience,
  shareable support documentation, or outsourced release QA; Milestone 7 owns
  that handoff after this product workflow passes.
- Moving canonical research packages into an authoring project.
- Mutating or overwriting a package used by an earlier build.
- Treating a filesystem path as artifact identity.
- Automatically scanning the entire workstation for missing media.
- Cloud clip storage unless a separate bounded specification authorizes it.
- Two-way Google Sheets sync or spreadsheet-driven job requests.
- Silent regeneration when a completed artifact cannot be found.

## Affected boundaries

- Shared contracts: batch export commands, artifact summaries, compatibility
  requirements, resolution results, availability states, and request origin.
- Cloud catalog/API: authorized clip search/list, request idempotency, package
  version history, resolution metadata, and logged export status.
- Local agent/database: locator availability, manifest/hash verification,
  configured-root lookup, verified relink, and local package reveal.
- Worker/media: consume Milestone 5 logged-request delivery, same-source
  grouping, sibling isolation, immutable re-export, progress, retry, and
  cancellation; extend it only through a separate bounded slice when the
  artifact-resolution contract proves a missing primitive.
- Web UI: project Clip Library, selection, batch settings, status, artifact
  actions, relink, and remediation.
- Sync: stable project/clip/artifact IDs and offline-safe commands; external
  projections remain downstream.

Every persistent schema change requires a local and/or cloud migration as
appropriate. Do not overload the existing export-status field to represent
current local byte availability; these are separate facts.

## Failure states

- Catalog record is complete but no locator resolves: report `missing`; offer
  relink or re-export.
- Located package has the wrong manifest, clip snapshot, settings, or hash:
  reject it as `invalid`; never adopt by filename alone.
- Existing package lacks required handles or build-compatible settings: report
  `incompatible` and offer a new export.
- Package exists only behind an authorized remote provider: report `remote_only`
  and request/download through that provider when available.
- One batch sibling fails acquisition/render/subtitle verification: keep its
  error and let other siblings continue.
- Duplicate direct or authoring request: return/adopt the same eligible job or
  verified package through a stable idempotency key.
- Re-export succeeds but an older locator remains missing: retain both versions
  and their independent availability history.
- Source reacquisition is unavailable or no longer authorized: preserve the
  clip/transcript record and return actionable remediation; never substitute
  unrelated footage.

## Acceptance criteria

1. Project membership is enforced for clip search, artifact history,
   resolution, export, relink, and any download/reveal capability.
2. A researcher can search/filter and export one logged clip without reopening
   its source transcript.
3. A multi-select batch snapshots resolved settings once per requested clip,
   isolates sibling failures, and groups compatible same-source work where
   practical.
4. Duplicate submission cannot create duplicate active renders or packages.
5. Completed packages expose immutable IDs, manifest/hash provenance, and a
   distinct current availability state.
6. Resolution returns `reusable` only after exact snapshot, compatibility,
   manifest, required-file, hash, and locator verification.
7. A moved exact package can be relinked only after full verification.
8. A missing/invalid/incompatible package can create a new immutable export;
   no prior package or build snapshot is overwritten.
9. A simulated authoring client can search a clip, reuse a compatible package,
   and request one idempotent export when none is reachable.
10. Direct and authoring origins use the same worker/finalization pipeline and
    yield the same artifact identity for equivalent requests.
11. The milestone requires no Google OAuth, spreadsheet, Apps Script, polling
    relay, or two-way integration.

## Verification plan when activated

- Contract tests for resolution/availability unions and idempotency identity.
- Cloud authorization and batch-command integration tests.
- Local manifest/hash, missing-locator, configured-root, and relink tests.
- Worker fixture tests for grouping, sibling isolation, retry, and immutable
  re-export.
- Browser tests for Clip Library search/filter, selection, batch request,
  progress, failure, artifact actions, and remediation.
- A simulated authoring-consumer integration test covering reuse, relink, and
  re-export fallback.
- One small authorized real-source smoke test before the milestone exit gate.
