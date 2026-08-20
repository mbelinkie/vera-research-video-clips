# Project outline

This is the short execution map. `PROJECT_GUIDE.md` contains the authoritative product, architecture, data, security, and acceptance details.

## Delivery workflow

- Create one bounded spec in `specs/active/` for each implementation task and
  use one task/thread for that spec.
- Give the task focused context: the active spec, relevant guide sections,
  affected contracts/boundaries, and concrete failure evidence. State explicit
  non-goals before editing.
- Run narrow tests first, then broader checks appropriate to the change. Review
  the complete diff and preserve actual test output before committing.
- After two unsuccessful evidence-based debugging attempts, start a fresh task
  with the confirmed facts and a focused reproduction.
- Move only verified, completed specs to `specs/completed/`, including decisions,
  checks/results, risks, and commit IDs. Update this outline and other durable
  product documentation only for completed work.

## Product sentence

In a shared project, load or batch-submit YouTube videos, reuse an online English transcript when available, transcribe and translate when necessary, navigate by transcript, and turn a highlighted passage into a project-logged candidate, a logged-and-exported clip, or an unlogged export.

## Core invariants

- Transcript selection is the main review interaction.
- Completed shared transcripts are immutable, versioned, checksummed project artifacts.
- Check the project's shared transcript catalog before doing acquisition or transcription work.
- Another authorized workstation can download, verify, and locally cache a shared transcript without regenerating it.
- Cloud project metadata is authoritative for membership, shared transcript manifests, batches, and synchronized records; private object storage owns transcript bytes; SQLite is a cache/offline outbox/local job store.
- A transcription batch belongs to one explicit project, deduplicates items, isolates failures, and feeds a `Ready for review` inbox.
- Queue delivery is at-least-once; leases, idempotency keys, and transactional finalization prevent duplicate canonical results.
- `Queue / log only` requires a visible project and never starts export work.
- `Export + log` requires a visible project, creates the durable log entry first, then requests a job.
- `Export only` creates a durable local technical job but no project clip/log/spreadsheet entry.
- Both logging actions accept optional multiline usage notes and reusable project-scoped free-form tags, committed atomically with the clip and available to search/filter, CSV, and optional external catalog projections.
- A completed export record is not sufficient proof that package bytes are still reachable; reusable artifacts are resolved by immutable manifest/hash identity and verified locators.
- Direct Clip Library exports and script-driven exports use the same durable request, worker, and immutable artifact boundaries.
- Export actions use selectable named conversion presets and supported per-export overrides.
- Every render job stores an immutable resolved-settings snapshot so later preset edits cannot change queued work or retries.
- Foreign/mixed/unknown-language clips always get clip-relative original and English-translation SRTs; confirmed-English clips get an English SRT by default and may explicitly omit sidecar files.
- A full authorized source may be downloaded behind the scenes, but only into isolated job-scoped scratch storage; reuse it for active dependent work and verify deletion before the job is complete.
- Never log to a hidden or implicit project; a preselected project must remain visible and changeable.
- Preserve original and English tracks, provenance, version, and timing precision.
- Treat transcript language preference as personal account state. Resolve
  equivalent native/English tracks first, then verified immutable translations
  derived directly from the original track for any supported BCP-47 target.
- Every new logged clip freezes schema-version-2 native and English language
  evidence plus a distinct preferred-language role when required; preference
  changes never rewrite existing clips.
- Use stable IDs and integer source-video milliseconds.
- Never regenerate or replace a completed version silently.
- Keep platform, media, transcription, translation, alignment, object storage, dispatch, and sync details behind adapters.

## Main workflows

### Immediate review

```text
Sign in -> open project -> paste YouTube URL
  -> read project transcript manifest
       -> verified local cache? use it
       -> shared transcript? download + verify + cache
       -> none? create transcription job
  -> acquire captions/audio -> transcribe -> translate -> align
  -> upload immutable bundle -> finalize shared version
  -> searchable bilingual transcript -> click text to seek
  -> select range and preview bounds
       -> Queue / log only -> choose/confirm project + optional notes/tags
       -> Export + log     -> choose/confirm project + optional notes/tags + conversion settings -> clip + language-policy SRTs
       -> Export only      -> conversion settings, no project log -> clip + language-policy SRTs
```

### Batch preparation

```text
Open project -> create named batch -> paste URLs/import CSV
  -> preflight metadata + shared transcript lookup + dedupe
  -> submit valid unique items
  -> controlled workers process items independently
  -> upload/finalize shared transcript versions
  -> ready items enter Ready for review
  -> failed/blocked items retain useful remediation + retry
```

### Later clip export and authoring handoff

```text
Open project -> Clips -> search/filter logged clips -> select one or many
  -> choose resolved preset -> request durable export batch
  -> verify immutable packages and independent status
  -> reveal/retry/re-export as needed
  -> scriptwriting client searches by stable clip ID
       -> compatible reachable package? verify + reuse
       -> locator missing? relink and verify, or request durable re-export
```

## Build order

### 0. Foundation

- [x] Bootstrap TypeScript monorepo.
- [x] Add web, local-agent, cloud-API, and worker apps plus shared packages.
- [x] Add validated local/cloud configuration and loopback-only local defaults.
- [x] Define project, manifest, batch, job, lease, and error contracts.
- [x] Add SQLite and test-PostgreSQL migrations.
- [x] Add fake object-store/queue adapters and worker skeleton.
- [x] Add infrastructure-as-code skeleton with isolated environments.
- [x] Add licensed transcript/media/batch fixtures.
- [x] Establish format, typecheck, unit, integration, and e2e commands.

Gate: clean checkout installs, migrates both stores, runs against local fakes, and tests without AWS credentials.

### 1. Shared projects + transcript store

- [x] Add sign-in/session boundary and project membership roles.
- [x] Create/open projects and project-video records.
- [x] Provision private encrypted versioned S3 storage.
- [x] Define immutable transcript bundle/manifest schema.
- [x] Add project-authorized presigned staging upload.
- [x] Add transactional finalize and active-version pointer.
- [x] Add verified download and atomic local-cache promotion.
- [x] Add offline outbox, sync state, and retries.

Gate: workstation A publishes a fixture transcript; authorized workstation B loads/verifies it; a non-member is denied.

Milestone 1 completed 2026-08-01. The development CloudFormation stack provisioned the private encrypted versioned bucket and encrypted SQS queues in `us-east-1`. The live AWS gate passed: presigned staged upload, immutable version capture, authorized pinned download, checksum verification, second-workstation cache promotion, non-member denial, and test-object cleanup all succeeded.

### 2. Video + shared transcript reader

- [x] Normalize YouTube URLs and persist video metadata.
- [x] Wrap the YouTube IFrame API.
- [x] Implement canonical track/segment/token types.
- [x] Load fixture, local-cache, and shared-store transcripts.
- [x] Render a virtualized transcript.
- [x] Click segment/token to seek.
- [x] Track playback and active segment.
- [x] Add follow-mode pause/resume behavior.
- [x] Add literal/partial search and match navigation.

Gate: a long local/shared transcript is fast and drives navigation without regeneration.

Milestone 2 completed 2026-08-01. URL normalization, provider-backed metadata persistence/listing, canonical transcript validation, shared-first verified-cache reuse, compressed artifact parsing, and transactional SQLite indexing are implemented behind the local-agent boundary. The workspace uses a windowed segment renderer, exact timed-word seeking with honest cue fallback, playback-driven active segment/token state, follow controls, and literal search with next/previous navigation. The labeled fixture drives the real player wrapper, arbitrary videos never receive fabricated transcript text, a 10,000-segment window test stays bounded, and a second shared resolution reuses the verified cache without downloading again.

### 3. Batch transcript resolution

- [x] Add required-project multi-URL preflight and batch-creation APIs.
- [x] Add CSV import and the batch creation/preflight UI.
- [x] Preflight metadata, duplicates, unsupported items, and shared transcript hits.
- [x] Add the caption-discovery candidate contract and deterministic source precedence.
- [x] Add an opt-in configured caption discovery/acquisition implementation with honest automatic-translation filtering and isolated VTT output.
- [x] Normalize acquired WebVTT into deterministic canonical cue-timed tracks without inventing word timing.
- [x] Add a provider-neutral, time-linked translation adapter with an opt-in Amazon Translate implementation.
- [x] Add opt-in authorized audio acquisition and multilingual speech-to-text adapters.
- [ ] Add an alignment adapter for sources requiring timing refinement.
- [x] Persist item preflight/stage/review state, attempts, errors, options, idempotency keys, and shared job links.
- [x] Add authenticated atomic claim, expiring lease, heartbeat stages, stale-attempt rejection, and expiry recovery in the shared catalog/API.
- [x] Persist the winning worker's validated transcript source plan on jobs and batch items.
- [x] Add the authenticated worker control-plane client, automatic catalog heartbeats, queue-visibility renewal, abort-on-lease-loss, and durable failure reporting.
- [x] Compose the one-shot local worker entrypoint with real providers and a completion transition tied to a finalized transcript version.
- [x] Add controlled local-worker concurrency and a containerized worker entrypoint.
- [x] Publish completed transcript bundles with canonical JSON and language-appropriate SRT artifacts.
- [x] Add aggregate/per-item progress, pause pending, resume, cancel unstarted, and retry failed.
- [x] Add `Ready for review` plus review status.

Gate: a mixed batch processes items independently, deduplicates work, publishes reusable bilingual transcripts, and populates the review inbox.

First slice completed 2026-08-01. The project-authorized API normalizes and preflights bounded multi-URL submissions, reports duplicate/unsupported/metadata-failed rows, detects active shared transcripts, and persists every batch item through cloud migration `0003_transcription_batches`. Shared hits enter `ready_for_review` without a job; unique unresolved videos get idempotent linked jobs; repeated batches reuse equivalent work; and batch creation rechecks the active transcript transactionally so a version finalized after preflight is not regenerated.

Second slice completed 2026-08-01. Caption candidates now carry language, manual/automatic kind, translation capability, and honest acquisition access. The provider-neutral resolver deterministically prefers manual target-language, automatic target-language, manual original-language, then automatic original-language captions; non-target selections require translation and preserve their source language. Forced generation, no captions, and inaccessible/owner-only captions fall back to speech recognition with distinct reasons. The production caption acquisition implementation remains deliberately configurable because the official YouTube API cannot download arbitrary public captions.

Third slice completed 2026-08-01. Authenticated workers now claim eligible project jobs atomically with bounded expiring leases and monotonically increasing attempts. Heartbeats renew ownership and persist item stages; duplicate delivery sees no claimable job; expiry permits reassignment; and stale/non-owning workers cannot heartbeat or record results. Migration `0004_worker_resolution_leases` stores the validated source plan and indexes lease expiry/claim selection. The local worker process still needs to consume these endpoints and renew its queue visibility while running providers.

Fourth slice completed 2026-08-01. The worker package now has a validated HTTP control-plane client and a claiming runtime that automatically heartbeats the current stage, renews an optional queue visibility lease, aborts cooperative provider work after catalog lease loss, and reports sanitized failures against the owning attempt. The failure API atomically records the per-item error, fails the shared job, and removes its lease; stale attempts cannot overwrite the result. The queue adapter contract now supports visibility extension, and the generic consumer renews long-running deliveries before acknowledgement. Actual caption/media/transcription provider composition and finalized-transcript completion remain deliberately open rather than allowing the skeleton to claim unfinished work.

Fifth slice completed 2026-08-01. Caption processing is now opt-in through validated `CAPTION_PROVIDER`/`YT_DLP_PATH` settings. The local `yt-dlp` adapter discovers manual and automatic tracks without media download, avoids presenting translated automatic aliases as original speech, selects through the existing deterministic resolver, and acquires only the winning VTT into private job scratch storage. It invokes the tool without a shell or ambient configuration, supports lease-loss cancellation, reuses an already acquired nonempty result, and returns actionable bounded errors. Normal tests use a fake command runner; live YouTube access remains an optional authorized smoke test.

Sixth slice completed 2026-08-01. The transcript package now parses bounded UTF-8 WebVTT input into canonical cue-precision tracks, time-ordered segments, and deliberately untimed tokens. Metadata blocks and presentation markup do not leak into transcript text; entities, cue identifiers/settings, hour timestamps, and legal overlaps are handled, while malformed/empty inputs fail explicitly. SHA-256 content identity and deterministic track/segment/token IDs make equivalent retries stable. The worker-only provider bridge carries an acquired VTT through this parser with its language and manual/automatic provenance intact.

Seventh slice completed 2026-08-01. A typed translation boundary now maps source segment IDs and text to provider results, and the canonical normalizer builds a separate English track linked to the original by `sourceTrackId` and exact source-video cue times. The initial opt-in adapter uses the official AWS SDK for Amazon Translate, bounds request size/concurrency, supports lease-loss cancellation and optional custom terminology, and remains disabled unless explicitly configured. Translated tokens stay honestly untimed, malformed partial provider results fail closed, and deterministic tests use a fake sender without AWS calls.

Eighth slice completed 2026-08-01. The generated-transcript fallback now has separately configurable adapters for authorized source-audio acquisition with `yt-dlp` and local multilingual recognition with `whisper.cpp`. Audio is written only to caller-supplied job scratch storage as FLAC, receives a streaming SHA-256 fingerprint, reuses only a finalized nonempty result, and remains explicitly subject to later worker cleanup. The speech adapter invokes `whisper-cli` with argument arrays and full JSON output, records detected language plus configured model provenance, supports cancellation and idempotent result reuse, and normalizes provider segments into a deterministic generated original track with honest cue timing and untimed tokens. Malformed timing or missing language fails closed; normal tests use fake command runners and make no media or model calls.

Ninth slice completed 2026-08-01. The one-shot configured worker now composes deterministic caption resolution, caption-acquisition-to-ASR fallback, conditional translation, canonical JSON plus SRT artifact generation, job-owned staging uploads, verified scratch deletion, and transactional finalization. A claimed job owns its upload grant; the same finalization transaction activates the immutable transcript version, marks the original job complete, moves every linked noncanceled item to `ready_for_review`, records the active version, and removes the worker lease. Foreign sources publish separate original and time-linked English JSON/SRT artifacts; English sources publish English JSON/SRT. The worker remains dormant without explicit authentication and provider settings, and continuous polling/concurrency is still disabled.

Tenth slice completed 2026-08-01. The configured worker can now run as either a safe one-shot process or a bounded continuous service with one to eight complete claim/execution lanes, explicit idle polling and transient-error backoff, and signal-driven graceful draining that stops new claims without abandoning active leases. Lease duration and execution location are configurable, heartbeat cadence is derived from the lease, and deterministic supervisor tests cover concurrency, backoff, and shutdown. The worker container uses Node 22, FFmpeg, and pinned yt-dlp, runs non-root under an init process, keeps credentials and speech models outside the image, and preserves the provider-neutral whisper.cpp mount contract for local CPU/GPU or later hosted capacity.

Eleventh slice completed 2026-08-01. The shared batch control plane now returns aggregate operational and review progress alongside each item's exact stage. Migration `0005_batch_controls` adds durable active/paused/canceled dispatch state and preserves worker-declared failure retryability. Project-authorized, optimistic-versioned commands pause pending claims, resume dispatch, cancel only unstarted items, and requeue only retryable failures; the claim query honors batch dispatch state while allowing already-started work to drain or recover after lease expiry. Stale commands conflict, nonmembers are denied, nonretryable failures remain visible, and canceling queued siblings does not abandon active leases. Batch discovery, browser controls, and review-status actions remain before the combined checklist item is complete.

Twelfth slice completed 2026-08-01. Projects now have authorized batch discovery and a `Ready for review` inbox across completed batches. Review-status edits are optimistic-versioned and restricted to ready items. The browser connects through an explicit in-memory development session credential, requires a visible target project, supports newline batch preflight/creation and local/hosted policy choices, polls aggregate and exact per-item progress, exposes pause/resume/cancel-unstarted/retry-failed controls, and opens a ready video directly in the research workspace. Same-origin development proxying avoids storing credentials or enabling broad CORS. API integration tests cover membership and stale edits, while Playwright covers the connected queue/review interaction. CSV import remains before the combined creation-UI checklist item is complete.

Thirteenth slice completed 2026-08-01. The batch creation surface now imports CSV through the established Papa Parse library behind a bounded helper. Files are limited to 2 MB, 50 columns, and the existing 500-item batch ceiling; malformed quoting fails closed, recognized URL headers are suggested, ambiguous multi-column files require an explicit column choice, and headerless one-column lists work. Applying an import only replaces the editable URL list and invalidates stale preflight—nothing is submitted until the researcher runs the normal authorized preflight. Empty rows are reported, duplicates remain for server-side labeling, and unit plus browser tests cover quoted fields, embedded newlines, malformed files, bounds, explicit application, and preflight handoff.

### 4. Selection + clip queue

- [x] Map DOM selection to stable token ranges.
- [x] Derive transcript bounds and separate padded export bounds.
- [x] Add looping preview and manual bound adjustment.
- [x] Add a visible project picker with quick-create for logging actions.
- [x] Add `Queue / log only`, `Export + log`, `Export only`, and `Copy`.
- [x] Add optional multiline usage notes and reusable project-scoped tag entry to both logging actions.
- [x] Add authorized note/tag editing plus queue search/filter by notes and tags.
- [x] Persist logged candidates independently of render jobs.
- [x] Persist export-only snapshots without creating project clip records.
- [x] Add queue filters/status and reload persistence.
- [x] Add CSV export with project and stable clip IDs.

Gate: logging requires a visible project and atomically preserves entered notes/tags; queue-only starts no media work; export-only creates no project/shared log entry or project research metadata.

PL-01 completed 2026-08-20. Account language preferences normalize general
BCP-47 tags and default to English. Exact verified non-English derivatives are
reused local-first, then from the authorized project store, before one
direct-from-original provider request; publication leaves the active
source-plus-English transcript unchanged. A deterministic Romanian/English/
Spanish proof exercises time-stable language views and search, strict
three-role logging through API/database/reload/CSV, second-workstation reuse,
offline evidence replay, and later preference changes without historical
mutation. New clip writes use strict language-evidence schema version 2 while
legacy version-1 reads remain conservative. Preferred display/logging does not
produce preferred SRT artifacts.

### 5. Clip export

- [x] M5-01: authorized full-source acquisition and verified job-scoped scratch lifecycle (`specs/completed/M5-01-authorized-source-acquisition-and-scratch-lifecycle.md`).
- [x] Acquire the full authorized source when needed into isolated job-scoped scratch storage.
- [ ] Group active same-source exports where practical so one download can cut many requested ranges.
- [x] Delete and verify source cleanup after success, failure, or cancellation.
- [ ] Add cleanup retries plus an abandoned-scratch sweeper/lifecycle backstop for worker crashes.
- [x] M5-02: inspect verified local source with provider-neutral FFprobe and
  persist duration-clamped resolved bounds (`specs/completed/M5-02-ffprobe-inspection-and-resolved-export-bounds.md`).
- [x] Validate bounds and inspect input with FFprobe.
- [x] M5-03: render and FFprobe-verify one resolved H.264/AAC MP4 range in
  private attempt staging (`specs/completed/M5-03-ffmpeg-adapter-and-verified-single-range-render.md`).
- [x] M5-04: derive, re-parse, and pair-validate one confirmed-English
  clip-relative SRT in private attempt staging
  (`specs/completed/M5-04-verified-confirmed-english-subtitle-sidecar-staging.md`).
- [x] M5-05: derive, re-parse, and pair-validate required clip-relative
  original-language and translated-English SRTs for foreign/mixed/unknown
  snapshots in private attempt staging
  (`specs/completed/M5-05-verified-foreign-language-bilingual-subtitle-sidecar-staging.md`).
- [x] M5-06: honor a confirmed-English snapshot's explicit sidecar omission
  after verified temporary-MP4 staging, without transcript lookup or staged SRT,
  and retain only safe omission provenance
  (`specs/completed/M5-06-verified-confirmed-english-subtitle-omission-staging.md`).
- [x] M5-07: atomically promote only the already validated MP4 plus exact
  language-policy sidecars into a deterministic sanitized local package,
  re-verify safe artifact provenance, and complete only after source cleanup
  succeeds (`specs/completed/M5-07-verified-final-clip-package-promotion.md`).
- [x] M5-08: compose the existing local export lifecycle into one explicit,
  authorization-confirmed `export:run-once` command and prove the complete
  export-only media/package path with repository-owned fixture media plus real
  FFmpeg/FFprobe (`specs/completed/M5-08-local-export-runtime-composition-and-real-tool-smoke.md`).
- [x] M5-09: promote one verified `manifest.json` provenance record inside every
  clip package before it becomes visible, recording source identity, subtitle
  policy, resolved bounds, FFprobe/FFmpeg versions, and each artifact's size and
  SHA-256 (`specs/completed/M5-09-verified-clip-package-manifest.md`).
- [x] M5-10: stage and verify a descriptive `clip-<id>.json` metadata sidecar,
  include its hash in the manifest, and retain legacy manifest readers
  (`specs/completed/M5-10-verified-clip-metadata-sidecar.md`).
- [x] M5-11: derive a bounded midpoint JPEG from the verified rendered clip,
  independently inspect it, and require it during atomic package finalization
  (`specs/completed/M5-11-verified-clip-thumbnail-artifact.md`).
- [x] M5-12: add authorized personal/project conversion preset catalogs with
  append-only immutable versions, fixed-version defaults, optimistic updates,
  idempotent commands, and exact saved-snapshot selection
  (`specs/completed/M5-12-versioned-conversion-preset-catalogs.md`).
- [x] M5-13: resolve application/default/preset/override settings through an
  authoritative preview, snapshot deterministic fingerprints on requests and
  jobs, and reject stale, changed, unsupported, or unavailable settings before
  acquisition (`specs/completed/M5-13-resolved-export-settings-and-capability-validation.md`).
- [x] M5-14A: render and FFprobe-verify the bounded software matrix of H.264
  High/AAC MP4, HEVC Main/AAC MKV, and ProRes 422/PCM MOV, with installed
  capability discovery, dynamic package roles, and backward-readable manifest/
  metadata v2 (`specs/completed/M5-14A-capability-driven-alternative-rendering-and-ffprobe-conformance.md`).
- [x] Add `Omit subtitle files for English-language clips`, default off;
  snapshot it in presets/jobs and apply it only when source language is
  confidently English.
- [x] Store the fully resolved settings snapshot on every export job and retry.
- [x] Re-encode using an editing-friendly H.264/AAC MP4 default plus the two
  verified alternative families.
- [x] Generate and validate a clip-specific English SRT by default for
  confirmed-English exports; an explicit immutable confirmed-English omission
  snapshot stages no SRT, while foreign/mixed/unknown requests continue to use
  the mandatory bilingual path.
- [x] For foreign/mixed/unknown-language clips, always derive both original-language and translated-English SRTs even if the selected preset carries the English-only omission preference.
- [x] Trim/clamp required sidecar cues to actual padded export bounds, zero-base timestamps, and block this staging lifecycle when required subtitles are missing or mismatched.
- [ ] M5-14B: add one optional embedded English soft subtitle track without
  replacing any language-policy sidecar.
- [x] Generate and verify thumbnail, metadata JSON, and manifest.
- [x] Use private staging plus exact-artifact validation and atomic completion.
- [ ] Deliver logged/cloud export requests to an authorized local worker and
  reconcile immutable results with the shared catalog.
- [ ] Add durable progress, retry, safe cancellation, sibling isolation, and
  batch export.

Gate: representative presets produce the requested FFprobe properties, queued jobs survive preset edits unchanged, English clips get an SRT by default and can explicitly omit it, foreign/mixed/unknown clips always get original plus translated-English SRTs, a 30-second foreign-language range produces only cues within that 30-second clip, a real authorized smoke test succeeds, and no full source media remains after any terminal path. M5-08 proves the local export-only composition path with authorized repository fixture media, not a live YouTube source or logged/cloud export delivery.

### 6. Project Clip Library + authoring handoff

- [ ] Promote logged clips into a dedicated project-level Clips surface.
- [ ] Search/filter by transcript, video, notes, tags, research/export status,
      and verified artifact availability.
- [ ] Compose the Clip Library over Milestone 5's individual/batch request,
      immutable settings, progress, sibling isolation, retry, safe cancellation,
      and same-source grouping primitives; do not create a second executor.
- [ ] List completed package versions with reveal/open, verify, and explicit
      re-export actions.
- [ ] Separate immutable artifact identity from local/cloud/consumer locators.
- [ ] Add verified relink for relocated packages and explicit missing/invalid/
      incompatible states.
- [ ] Expose authorized clip search, exact artifact resolution, and durable
      export requests to the separate scriptwriting client.
- [ ] Record direct versus authoring request origin without creating separate
      rendering paths.

Gate: several clips across multiple videos export as one durable batch with
independent recovery; a simulated authoring client reuses verified compatible
packages, while a missing locator produces relink or idempotent re-export rather
than a false cache hit.

Google Sheets is optional later catalog publishing, not an export control
surface. Keep CSV; begin with one-way stable-ID publishing only if collaboration
usage justifies it, and defer selective notes/tags sync until field ownership and
conflict behavior are proven.

### 7. Research + capacity expansion

- [ ] Bookmarks, timeline markers, and segment notes.
- [ ] Fuzzy/regex/cross-video/semantic search.
- [ ] Optional AI summaries, quotes, arguments, and B-roll suggestions.
- [ ] Deploy AWS Batch GPU workers when hosted capacity is justified.
- [ ] Add autoscaling, priorities, spend controls, and completion notifications.
- [ ] Add cloud clip storage and richer real-time collaboration only after shared transcripts/batches stabilize.

## Canonical domains

```text
Project
  -> ProjectMember
  -> ProjectVideo
       -> TranscriptLineage
            -> TranscriptVersion
                 -> TranscriptArtifact (private object)
       -> ReviewStatus
  -> TranscriptionBatch
       -> TranscriptionJob
            -> WorkerLease
  -> ClipCandidate
       -> ExportJob (optional)
            -> ExportArtifact
                 -> ArtifactLocator (verified availability, not identity)
  -> ExportPreset
       -> ExportPresetVersion
  -> IntegrationBinding
       -> SyncEvent

LocalWorkspace
  -> VerifiedTranscriptCache
  -> SyncOutbox
  -> LocalProcessHistory

SelectionSnapshot
  -> ExportJob (logged clip optional)
       -> SourceScratchAsset (must be deleted before completion)
       -> ExportArtifact
```

## First-pass package boundaries

```text
apps/web         UI, player, transcript/batch/review interaction
apps/local-agent loopback API, local cache/tools/exports
apps/cloud-api   auth, projects, manifests, batches, presigning/finalize
apps/worker      local or hosted acquisition/transcription pipeline
packages/contracts shared Zod schemas/types/errors
packages/db-local SQLite schema, migrations, repositories, FTS
packages/db-cloud PostgreSQL schema, migrations, repositories
packages/transcript normalization, timing, selection, subtitles, search
packages/media   acquisition and FFmpeg/FFprobe
packages/providers captions, ASR, translation, alignment
packages/storage local/S3 object-store adapters and manifests
packages/sync    outbox, optimistic versions, reconciliation
packages/config  validated settings
infra/aws        storage, API, database, queues, identity, monitoring
```

## Critical tests to keep green

- Project membership enforcement for API calls and object grants.
- Transcript bundle checksum/schema validation and atomic finalization.
- Second-workstation download/cache without regeneration.
- URL normalization and caption-source precedence.
- Batch preflight dedupe, sibling failure isolation, pause/retry, and review transitions.
- Duplicate queue delivery and expired worker-lease recovery.
- Word/cue/estimated timing lookup and bilingual preservation.
- Transcript selection to source/export bounds.
- Queue creation without export side effects.
- Project enforcement for both logging actions.
- Preferred-language resolution reuses verified local/shared derivatives before
  one direct-from-original provider request, remains target-language-generic,
  and exposes provider capability failures without a mislabeled fallback.
- New clip logs atomically preserve exact native/English/optional-preferred
  evidence across reload, offline replay, queue search, and CSV; legacy reads do
  not invent track provenance.
- Atomic note/tag persistence for both logging actions, project-scoped tag deduplication, offline replay, and collaborator edits.
- Export-only creation without a project clip or spreadsheet row.
- Conversion-preset precedence, capability validation, and immutable job snapshots.
- Representative preset outputs verified with FFprobe.
- Confirmed-English exports produce an English SRT by default and no sidecars only when explicit omission is snapshotted.
- A 30-second foreign-language clip produces both original and translated-English cues only within `00:00:00,000` and its verified duration.
- An omission-enabled preset cannot suppress sidecars for foreign/mixed/unknown language.
- Missing, malformed, wrong-version, or out-of-bounds policy-required SRT blocks export completion.
- One source acquisition can serve multiple active clip ranges, then is deleted.
- Source scratch is absent after success, failure, and cancellation; crash recovery retries and exposes cleanup failure.
- SRT trim/clip-relative shift and FFmpeg fixture validation.
- CSV/optional catalog projection reconciliation by project and stable clip ID.
- Artifact resolution verifies the exact clip/export snapshot, package manifest,
  required files, hashes, compatibility, and current locator availability.
- Relocated artifacts are accepted only after verified relink; missing or invalid
  locators fall back to a new immutable export request without overwriting history.
- Direct and simulated authoring requests deduplicate through the same export
  boundary and reuse compatible verified packages.
- End-to-end batch -> shared transcript -> second workstation -> review -> select -> log/export.

## Next action

Continue Milestone 5 with one bounded optional embedded-English soft-subtitle
slice. Keep registered-agent logged/cloud delivery, result reconciliation,
progress/retry/cancel, same-source grouping, cleanup sweeping, and the final
30-second plus authorized-live release gate as separate slices.
