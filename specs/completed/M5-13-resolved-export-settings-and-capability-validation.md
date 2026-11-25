# M5-13 — Resolved export settings and capability validation

- Status: completed
- Task/thread: M5-13 only
- Dependency: completed M5-12 preset catalogs

## User-visible outcome

Before `Export + log` or `Export only`, the selection panel shows the exact
application/default/selected-preset/override resolution, effective media and
subtitle policy, and whether the current worker can execute it. Only a current,
capability-valid preview may be submitted. The resulting job stores one fully
resolved immutable settings snapshot that later preset/default changes and
retries cannot alter. `Queue / log only` remains available independently and
starts no media work.

## Resolution and capability decisions

1. Resolve complete settings in this order: versioned application Editing MP4
   default; fixed project default for logged exports or fixed personal default
   for export-only; exact explicitly selected authorized preset; field-wise
   per-export overrides. Complete presets replace the prior complete settings;
   only overrides merge, and explicit `null` clears optional width/audio-bitrate
   fields.
2. Logged exports may explicitly select a project or caller-personal preset;
   export-only may select only caller-personal presets. A personal default is
   never an implicit logged default.
3. The current capability profile truthfully permits only MP4/H.264/CRF/source
   frame rate/no scaling/AAC adapter default/no embedding/software processing.
   Broader contract values remain valid but return field-specific unsupported
   reasons. M5-14 owns their implementation.
4. English sidecar omission defaults off. It may affect output only for
   confidently English sources. A true saved preference remains immutable but
   inert for foreign/mixed/unknown sources, whose preview and worker policy
   always require original plus English SRTs.
5. Preview and create use deterministic resolution/capability fingerprints that
   exclude `resolvedAt`. Create reloads authoritative fixed versions/defaults,
   resolves again, and rejects a stale fingerprint. Processing verifies the
   stored fingerprint/profile before source acquisition and never falls back.

## In scope

1. Add strict contracts for preset references, settings selections and
   overrides, capability profiles/issues, resolved snapshots, preview responses,
   and catalog-based create requests while retaining legacy inline compatibility.
2. Add one pure shared resolver module/package with the versioned application
   default, complete-layer replacement, override clearing, deterministic
   canonical fingerprints, field capability errors, and source-language-aware
   subtitle summaries.
3. Add local capability plus export-only preview routes and a project-authorized
   logged preview route using existing route conventions. New catalog-based
   create requests carry selection plus expected fingerprint; the server
   re-resolves rather than trusting client-authored settings.
4. Add cloud migration `0011_resolved_export_settings_snapshots.sql` and local
   migration `0016_resolved_export_settings_snapshots.sql`. Backfill legacy
   requests deterministically from their exact preset snapshot and creation
   timestamp without inventing catalog identity. Persist byte-equivalent
   snapshots in each new request and job payload transactionally.
5. Make all local processing, omission provenance, rendering, metadata, and
   package policy consume `resolvedSettingsSnapshot.settings`. Validate stored
   fingerprint/capability before provider or FFmpeg work.
6. Replace the ad hoc advanced settings submission UI with catalog selection,
   supported overrides, provenance/badges/reset, effective summaries,
   loading/resolving/ready/stale/missing/unsupported/capability-unavailable
   states, and export-action gating. Keep unsupported controls explanatory and
   keep queue-only independent.
7. Prove precedence, authorization/scope, stale preview, migration/backfill,
   idempotent snapshot reuse, pre-acquisition validation, all subtitle policies,
   browser states, and the real default fixture regression.

## Failure states

- Missing, inaccessible, wrong-scope, malformed, or capability-invalid exact
  preset/default versions fail visibly; no silent default or current-version
  substitution is allowed.
- A changed default, selection, override, language class, or capability profile
  makes the preview stale and blocks creation until refreshed.
- Snapshot/fingerprint/profile mismatch before an attempt records actionable
  `needs_user_action` without provider, acquisition, FFprobe, or FFmpeg calls.
- Export request persistence failure rolls back the job/request and logged
  clip export-status update; the already-created research clip remains.
- Idempotent replay returns the original request and immutable snapshot even if
  current defaults/preset revisions now differ.
- Foreign/mixed/unknown exports remain blocked by the existing missing bilingual
  track rules and can never use English-only omission.

## Compatibility and migrations

- Preserve `preset_snapshot` columns and legacy API fixtures as display/input
  compatibility. They stop being processor authority after backfill.
- Backfilled snapshots use legacy/unvalidated provenance, exact prior settings,
  the row's `created_at`, the current capability profile reference, and a
  deterministic fingerprint; no preset ID/default/owner is invented.
- New request and job payload snapshots must serialize from the same parsed
  object in one transaction. No update path may rewrite them.
- Existing package artifacts, M5-10 metadata, M5-11 thumbnails, manifests,
  subtitle rules, bounds, and cleanup behavior remain unchanged except that
  metadata's resolved preset display is derived from the stored resolved
  settings compatibility snapshot.

## Explicit non-goals

- Preset CRUD/history UI or changes to M5-12 version/default semantics.
- Alternative codecs/containers, scaling, fixed frame rates, explicit audio
  bitrate, hardware acceleration, embedded/burned subtitles, or raw FFmpeg.
- Logged delivery, batch/grouping, retry UI, scratch sweeping, Sheets, M6 Clip
  Library, metadata/thumbnail changes, cloud clip storage, or provider changes.
- Editing or committing `PROJECT_GUIDE.md`, `outline.md`, M6 future docs,
  scriptwriting specs, `CLAUDE.md`, Recorded Performance, or `mistakes.md`.

## Acceptance criteria

1. Resolution tests cover application-only, correct context default, exact
   explicit project/personal version, full preset replacement, override wins,
   and explicit-null clearing.
2. The current default passes capability validation; every currently
   unimplemented setting returns a stable field reason before acquisition.
3. Preview/create fingerprints are deterministic and stale-safe; source-language
   summaries enforce English/default/omission and bilingual rules exactly.
4. Local/cloud migrations apply from current and empty stores, preserve legacy
   rows, and every new job/request contains an equal immutable snapshot.
5. Preset/default edits and idempotent retry cannot alter an existing request;
   processing never queries the preset catalog.
6. UI identifies scope/version/default/selection/overrides, explains disabled
   capabilities and omission ineligibility, and gates only export actions.
7. Existing local real-fixture export succeeds with the application default and
   retains MP4, exact sidecars, metadata, thumbnail, manifest, hashes, and
   verified scratch cleanup.

## Verification plan

Run focused resolver/contracts/media tests first; then cloud/local migrations,
catalog/API/database/processor/runtime tests, web unit/build and Playwright,
`npm run check`, `git diff --check`, and complete staged-diff inspection. Move
this file to `specs/completed/` only after recording actual results and commit
only M5-13-owned files. Guide/outline reconciliation remains deferred to their
owning documentation task.

## Completion record

- Completed the shared resolver and strict contracts, authoritative personal
  and project preview boundaries, atomic catalog/local creation persistence,
  processor preflight, and preview-driven web workflow as one bounded vertical
  slice. No M5-14 renderer alternatives were added.
- Added cloud migration
  `0011_resolved_export_settings_snapshots.sql` and local migration
  `0016_resolved_export_settings_snapshots.sql`. Both backfill the exact legacy
  preset settings and creation timestamp with `legacy_unvalidated` provenance
  and deterministic fingerprints, copy the same snapshot into the associated
  job payload, and prevent request-snapshot mutation. Migration tests cover
  upgrading populated 0010/0014-era stores as well as empty stores.
- Catalog creation reloads fixed defaults and exact authorized preset versions
  inside the request/job transaction, validates the current capability profile,
  and compares the preview fingerprint. Local catalog creation refreshes the
  authoritative personal preview immediately before its local transaction.
  Both idempotency paths return the original snapshot before consulting a
  default or preset again.
- The processor rejects missing, changed, unsupported, or unavailable resolved
  snapshots before subtitle lookup, provider checks, source acquisition, probe,
  or FFmpeg work. All rendering and omission decisions read only
  `resolvedSettingsSnapshot.settings`; legacy `preset_snapshot` remains for
  compatibility/display.
- Verified with `npm run check` (24 test files passed, 1 skipped; 167 tests
  passed, 1 skipped; typecheck, production web build, formatting, and both
  empty-store migration checks passed), populated local/cloud migration tests,
  focused resolver/catalog/API/database/processor tests (43 passing at the
  focused checkpoint), and `npm run test:e2e` (4 Chromium tests passed).
- `PROJECT_GUIDE.md`, `outline.md`, the Script-to-Resolve and Recorded
  Performance specs, M6 future specs, `CLAUDE.md`, and `mistakes.md` were
  intentionally left untouched and excluded from this change. Their guide and
  outline reconciliation remains deferred to the owning documentation task.
