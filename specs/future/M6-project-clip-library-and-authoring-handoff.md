# M6 — Project Clip Library and authoring handoff

Status: future milestone specification. Milestone 5 is complete and unchanged.
When M6 is authorized, execute the seven slices below sequentially with exactly
one bounded specification in `specs/active/` at a time.

## User-visible outcome

A researcher can open one project's Clip Library, find clips logged during
review, export one or many without reopening a transcript, follow independent
job status across restarts, and verify, reveal, relink, or re-export completed
packages. The future scriptwriting product can use the same authorized cloud
records to find clips and either reuse an exact verified package on the same
workstation or request the same durable export when compatible bytes are not
available.

Google Sheets is not required for either path.

## Product and authority decisions

M6 composes Milestone 5's request, delivery, worker, progress, retry,
cancellation, same-source grouping, immutable package, and success-result
primitives. It does not create a second renderer or job system.

- The immutable logged-export success-result ID is `artifactVersionId`. Do not
  create a competing artifact-version identity.
- The cloud project catalog remains authoritative for clip records, immutable
  request/success lineage, and completed artifact-version history.
- A workstation's SQLite catalog is authoritative only for its configured local
  roots, artifact locators, verification state, and cached authorized reads.
- `export_status = complete` proves historical export success; it never proves
  that package bytes are currently reachable on a workstation.
- Re-export always creates a new request, package identity, success result, and
  `artifactVersionId`. It never overwrites or repairs an earlier version.
- `requestOrigin = selection_action | clip_library | authoring_build` records
  diagnostic provenance only. It is excluded from export compatibility,
  idempotent deduplication, renderer selection, package identity, and artifact
  identity.

The research product owns clip identity, transcript/version provenance,
selection and export bounds, notes/tags, rights context, durable exports,
immutable settings snapshots, artifact-version history, and authorized
resolution. The scriptwriting product owns destination selection, copy or clone
policy, narrative use, timeline placement, and build history. It must not scrape
a sheet, duplicate acquisition/conversion logic, or mutate a canonical research
package.

## Sequential bounded slices

### 1. Artifact identity and project history

- Expose `ArtifactVersionSummary` records derived from immutable
  request/success lineage on authorized project and clip reads.
- Add bounded completed-version history for a project clip. A history entry
  identifies the success result, request and package identity, immutable clip
  and settings snapshot, artifact roles, manifest hash/schema, completion time,
  and sanitized provenance needed for compatibility decisions.
- Extend new individual/batch export requests and retries with
  `ExportRequestOrigin`. Preserve the originating surface through retry lineage
  for diagnostics while excluding it from compatibility and deduplication.
- Preserve all older completed versions when a package is missing, invalid, or
  superseded by a re-export.
- Prove that existing M5 success results remain the only source of
  `artifactVersionId`; do not backfill a parallel identity table.

### 2. Local roots, locators, and verification

- Add local migrations for configured artifact roots and
  `export_artifact_locators`.
- Store a root ID plus a validated relative package path, platform,
  `artifactVersionId`, manifest hash, availability state, verification time,
  and bounded failure class. Absolute paths remain local implementation detail
  and never enter shared/cloud forms, cloud events, or support diagnostics.
- Backfill an existing M5 package only after its manifest, required artifact
  roles, byte sizes, SHA-256 hashes, request snapshot, and package identity all
  match its immutable success lineage.
- Bound automatic lookup to configured roots. Validate containment across macOS
  and Windows path syntax, case behavior, Unicode normalization, symlinks,
  junctions, reserved names, and non-regular files; fail closed on uncertainty.
- Keep locator verification idempotent and reconstructable after restart.

### 3. Restart-safe Clip Library

- Add a dedicated project-level `Clips` surface with bounded pagination and
  search/filter over transcript text, video title, notes, tags, research status,
  export status, completed-version presence, and local availability.
- Merge cloud-authoritative clip/artifact history with workstation-local locator
  availability. Label the facts separately and never infer reachability from a
  completed cloud record.
- Cache the last authorized Clip Library snapshot in SQLite with server
  versions and a sync cursor. Offline mode may browse clearly stale cached
  records and reveal or verify previously verified local packages.
- Require connectivity for cloud mutations. Preserve their idempotency keys and
  explicit pending state so a retry does not duplicate work.
- Reconstruct selections, current retry leaves, durable progress, terminal
  state, artifact history, and local availability after browser or local-agent
  restart instead of relying on React memory.

### 4. Individual and batch export operations

- Reuse M5's individual/batch request, immutable settings resolution, delivery,
  progress, retry, cancellation, execution, and same-source grouping paths.
- Resolve and display one immutable settings snapshot per selected clip before
  submission.
- Run an `ExportStoragePreflight` before submission. Estimate unique source
  acquisition, output packages, active update/checkpoint reserve, and a 2 GB
  safety margin without double-counting compatible same-source siblings.
- The supported-system baseline recommends 10 GB free, but it is not a global
  gate. Browsing, transcript review, clip logging, and other unaffected work
  remain available below it.
- If a source size is unknown, warn before acquisition, continue only with user
  confirmation, and recheck using the acquired byte size before rendering.
  Block only the acquisition/render or other operation whose preflight fails.
- One sibling's failure or cancellation must not block others. Duplicate direct
  or authoring requests adopt an existing compatible request or artifact rather
  than creating duplicate work.

### 5. Artifact actions and recovery

- Implement local-only `Verify`, `Reveal`, `Open`, and `Relink` commands using
  locator IDs. Never execute an arbitrary path supplied by a cloud response.
- Return `reusable_local`, `missing`, `invalid`, `incompatible`, `remote_only`,
  or `needs_export` through `ArtifactResolutionResult`.
- Accept an explicitly selected relink package only after verifying identity,
  manifest/schema, required roles, byte sizes, hashes, clip bounds,
  transcript/version provenance, subtitle policy, package identity, and settings
  compatibility.
- Preserve completed provenance when a locator is missing or invalid. A
  re-export creates a new immutable version and leaves the older availability
  record intact.
- Return `remote_only` only when an authorized remote artifact provider really
  exists. Without cloud clip storage, bytes unavailable on this workstation are
  `missing`, not remote.

### 6. Authoring-client handoff

- Offer authorized project clip search, artifact history, compatibility
  resolution, and idempotent export requests through the same cloud APIs used
  by the Clip Library.
- On the same workstation, the loopback local agent may return a verified local
  package descriptor to an authenticated, online-authorized authoring client.
  Paths remain local-only and must never enter cloud events, logs, telemetry, or
  support diagnostics.
- Check exact clip snapshot, export bounds/handles, required artifact roles,
  subtitle policy, accepted manifest schemas, settings fingerprint or accepted
  renderer profiles, and verified hashes before reuse.
- Leave destination choice, copy/clone behavior, timeline placement, and build
  history to the scriptwriting product. M6 adds no script editor, cloud clip
  storage, remote authoring reuse, or second rendering pipeline.

### 7. M7 operational handoff and exit gate

- Add `LocalRuntimeQuiescence` and a local `drain` command. Draining stops new
  claims, reports active durable work, lets safe work finish or checkpoint, and
  declares `safeToStop` only when no child process or source-scratch lifecycle
  remains active.
- Expose stable, sanitized operation/failure classes plus opaque correlation IDs
  for Clip Library, artifact, and export actions.
- Never place transcript/subtitle text, notes/tags, video URLs, local paths,
  filenames, credentials, headers, tokens, object keys, commands, or command
  output in diagnostic fields.
- Prove shutdown/restart recovery for queued, accepted, executing, completed,
  failed, and canceled work so M7's desktop supervisor and M8's updater can
  consume the boundary without changing export semantics.
- Close M6 only after the browser workflow and simulated same-workstation
  authoring client pass the revised gate below.

## Shared contracts

Add or extend schemas for:

- `ExportRequestOrigin`
- `ArtifactVersionSummary`
- `ArtifactCompatibilityRequirements`
- `ArtifactAvailabilityState`
- `ArtifactResolutionResult`
- `ArtifactLocatorSummary`, with no absolute path in shared/cloud forms
- `ExportStoragePreflight`
- `LocalRuntimeQuiescence`
- sanitized `OperationFailure` and opaque correlation metadata

Compatibility requirements include the exact clip snapshot, transcript/track
versions, export bounds and handles, required artifact roles, subtitle policy,
accepted manifest schemas, and either an exact settings fingerprint or explicit
accepted renderer profiles.

## Cloud capabilities

- Extend project clip listing with bounded search, filters, and pagination.
- Add completed artifact-version history for a project clip.
- Add compatibility resolution that returns immutable candidates without any
  workstation locator.
- Reuse individual/batch export, retry, cancel, and progress routes with
  `requestOrigin`.
- Require current project membership for all shared reads and mutations and
  preserve idempotency across retries.

## Local-agent capabilities

- List configured roots and locally known availability.
- Resolve, verify, relink, reveal, or open an artifact version by validated
  local IDs.
- Run individual or batch storage preflight.
- Begin drain and read quiescence state.
- Return a verified local descriptor to an online-authorized same-workstation
  authoring client.

When online, local artifact commands validate the matching cloud artifact
identity and current project authorization. Offline access is limited to
previously verified local packages already present on that workstation and is
clearly labeled stale; it cannot create a shared mutation or widen membership.

## Failure states

- Completed history exists but no local locator resolves: return `missing` and
  offer relink or re-export without rewriting completed provenance.
- Located bytes fail manifest, snapshot, role, size, or hash verification:
  return `invalid`; never adopt by filename or location alone.
- A verified package does not meet the caller's compatibility requirements:
  return `incompatible` and offer a new export.
- No compatible version exists: return `needs_export`.
- A package exists only behind a configured and authorized remote provider:
  return `remote_only`; otherwise use `missing`.
- One batch sibling fails, cancels, or runs out of operation-specific space:
  preserve its actionable state and let siblings continue.
- A duplicate request is delivered or submitted: adopt the same compatible
  request/artifact through the existing idempotency boundary.
- Authorization expires while offline: allow only previously verified local
  reads/actions and require renewed authorization before cloud mutation or
  authoring handoff.
- Drain finds live child/source work: report the blocker and remain unsafe to
  stop until it completes, checkpoints safely, or reaches a durable terminal
  state with scratch cleanup.

## Revised M6 acceptance gate

1. Three clips from two source videos can be searched, selected,
   storage-preflighted, and submitted as one batch.
2. Compatible same-source siblings share acquisition while progress, failure,
   retry, and cancellation remain independent.
3. Restart during queued and active work reconstructs the Clip Library and
   durable job state without duplicate requests or lost packages.
4. Completed artifact versions show immutable history separately from current
   workstation availability.
5. Reveal/open accepts only a verified local locator.
6. Moving a package yields `missing`; verified relink restores
   `reusable_local`; tampered or incompatible packages are rejected.
7. Re-export creates a new immutable artifact version while preserving the
   missing older version and locator state.
8. A simulated same-workstation authoring client can search, resolve, reuse, and
   request a missing compatible artifact without Google Sheets or a second
   executor.
9. Cloud responses, project events, and sanitized diagnostics contain no local
   paths or prohibited sensitive content.
10. Low disk blocks only the affected acquisition, render, update, model, or
    tool operation; transcript review and clip logging remain available.
11. Drain/restart evidence covers queued, accepted, executing, completed,
    failed, and canceled work and never reports safe stop while child or source
    scratch activity remains.

## Verification plan when activated

- Contract tests for request-origin and resolution/availability unions plus
  compatibility decisions.
- Cloud membership, bounded listing, artifact-history, authorization,
  idempotency, retry, and duplicate-delivery tests.
- Local migration and verified M5 backfill tests.
- macOS/Windows containment fixtures covering case, Unicode, symlinks,
  junctions, reserved names, and non-regular files.
- Manifest, artifact-role, byte-size, hash, missing-locator, relink, tamper, and
  incompatible-package tests.
- Storage-estimation tests for unique sources, same-source batching, outputs,
  active update/checkpoint reserve, the 2 GB margin, and unknown-size recheck.
- Restart and drain tests across every durable lifecycle state.
- Browser Clip Library flows for search/filter, pagination, selection, batch
  request, progress, retry/cancel, offline stale state, and artifact actions.
- Simulated same-workstation authoring-client integration covering search,
  resolution, reuse, and idempotent re-export fallback.
- One small, explicitly authorized real-source smoke before closing M6.

## Explicit non-goals and assumptions

- M5 remains complete and unchanged; M6 composes its existing primitives.
- Cloud clip storage and remote authoring reuse are outside M6.
- Google Sheets remains an optional later one-way catalog projection and is not
  job control.
- The Electron shell and cloud production deployment belong to M7. Installers,
  the automatic updater, in-app reporting delivery, and independent pilot QA
  belong to M8.
- No M6 slice may begin until it has its own bounded active specification.
