# Research Video Transcript & Clip Extraction Tool

## Project guide and implementation plan

Status: Milestones 1–5 and M6-01 complete; M6-02 local locator verification is implemented and macOS-verified with a declared real-Windows physical-containment release gate; Milestone 6 continues through bounded slices M6-03–M6-07
Last updated: 2026-08-22

This document is the source of truth for product scope, architecture, sequencing, and acceptance criteria. Update it when a deliberate product or architectural decision changes. Use `outline.md` as the shorter execution checklist.

## 0. Delivery workflow and durable records

Every implementation task begins with exactly one bounded Markdown spec in
`specs/active/`. Use one task/thread for that spec; do not combine unrelated
implementation, debugging, review, or product-design work in the same task.
The spec must name the user-visible outcome, affected boundaries, focused
context, explicit non-goals, failure states, acceptance criteria, and the
narrow tests to run first.

Keep the task context to the active spec, this guide, the relevant contracts and
implementation boundaries, and concrete evidence such as a failing test or
reproduction. Start verification with the narrowest relevant test, then run
broader checks proportional to the risk. Before committing, review the complete
diff and retain the actual command output rather than recording that checks
“should pass.”

If two evidence-based debugging attempts do not make progress, stop extending
that task. Record the confirmed facts and open a fresh task/thread with a
focused reproduction and a new bounded spec or an explicit update to the active
one.

Move a spec to `specs/completed/` only after the work is complete. Its completion
record must include the decision(s), files changed, checks and their actual
results, remaining risks/follow-ups, and commit ID(s). Update `PROJECT_GUIDE.md`,
`outline.md`, or `README.md` to describe work only after it is completed and
verified; an active spec is the sole place for planned implementation details.

Keep external findings and source links in `docs/research/`. Add a short record
in `docs/decisions/` only for a durable architectural decision that needs its
own rationale; do not create decision records for routine implementation notes.

## 1. Product promise

Turn a YouTube video in any supported language into a searchable transcript in
the user's preferred language, let the user navigate the video from that
transcript, and make any selected passage actionable in one step:

- **Queue / log only:** save a potential clip to an explicitly chosen project without rendering media.
- **Export + log:** save it to an explicitly chosen project, then create its editing-ready clip package.
- **Export only:** create the clip package without adding it to a project research log or spreadsheet.

The application is a shared-project research workstation with a fast local cache for video essays, documentary work, and journalism. It should feel precise enough to use while actively watching a video while also supporting unattended batch preparation before a review session.

Every foreign-language clip export includes two separate subtitle files covering only that exported clip: the original-language SRT and its English-translation SRT. For example, a 30-second export from a 40-minute source produces 30-second media and matching clip-relative subtitle files; it never attaches full-source subtitles. English-language clips include a matching English SRT by default, with an explicit setting to omit subtitle sidecar files when they are not needed.

## 2. Non-negotiable core loop

1. Open or create a shared project.
2. Paste one YouTube URL for immediate review, or submit many URLs as a transcription batch.
3. Load video metadata and resolve the source-language and English transcripts,
   then resolve the requesting user's preferred-language view from the source,
   verified local cache, or the project's shared store before translating it.
4. Publish a newly completed transcript version to the project so other authorized members can reuse it.
5. Click transcript text to seek the player.
6. Search, highlight, and adjust a transcript range.
7. Choose `Queue / log only`, `Export + log`, or `Export only`.
8. For either logging action, explicitly indicate the destination project.
9. Optionally add reusable tags (topic, person, theme, or any project-defined label) and a note describing context or intended use.
10. Preserve the native-language and English text, plus preferred-language text
    when it is a distinct third language, together with selection timing,
    provenance, tags, note, and status atomically with the logged clip.
11. Generate and verify the language-policy subtitle set: both original and English SRTs for foreign-language clips; an English SRT for English clips unless explicitly omitted.
12. Export logged clips later individually or in a batch.

The core implementation sequence through Milestone 5 is not complete until this loop works end to end.

## 3. Product principles

### 3.1 Transcript first

Treat the transcript as the primary navigation and selection surface. The video player validates context; the transcript drives research.

### 3.2 Queueing is a complete outcome

Saving a potential clip must be instant and must not start a media render. A queued selection remains useful even when the source media is not downloaded yet or an export later fails.

### 3.3 Logging always names its project

Do not silently add research to a last-used or hidden default project. `Queue / log only` and `Export + log` require a visible target project. A project may be preselected from the current workspace context, but its name must be shown beside the action and the user must be able to change or create it before confirming. `Export only` does not require a project.

### 3.4 Shared project state has explicit ownership

The cloud project catalog is authoritative for project membership, project videos, published transcript manifests/active versions, shared transcription batches, and synchronized project records. Private object storage is authoritative for transcript bundle bytes. Local SQLite is a durable cache, local job store, and offline outbox—not a competing master for already-synchronized records. CSV and optional external catalog integrations remain projections, never job-control surfaces or alternate sources of truth.

Every synchronized record needs a stable ID, server version, update timestamp, and sync state. Local work must remain usable offline and reconcile through idempotent commands when connectivity returns.

### 3.5 Never regenerate silently

Cache source metadata, transcripts, translations, thumbnails, and generated subtitle artifacts locally. Publish completed transcript bundles as immutable cloud versions. A newer or different transcription is a new version; move the project's active-version pointer only through a successful finalize operation or an explicit user choice. Never overwrite the only good transcript object.

Full source video/audio may be downloaded behind the scenes when needed, but it is ephemeral input rather than a durable cache. Keep it in isolated job-scoped scratch storage, reuse it for all active dependent work from that source where practical, and delete it after the resulting transcripts/clips have been verified or the job is failed/canceled. Persist finished clip packages, transcripts, and provenance—not the full source media.

### 3.6 Timing quality is visible

Preserve whether timestamps are word-exact, caption-cue-level, or estimated. Do not present interpolated word timing as exact. Allow the user to preview and manually adjust clip bounds.

### 3.7 Translation never destroys the source

Preserve original-language text and English text as separate, linked tracks.
Additional translated tracks are supplemental, language-addressed derivatives
linked to the same original track by source-video time. Keep language,
provider, model, source-track identity, and generation metadata. A user's
current preference never changes the language or identity of an existing
track.

### 3.8 Long work is resumable

Transcript generation, media acquisition, translation, upload, and clip export are persisted jobs with progress, errors, retry controls, leases/heartbeats, and idempotent output paths. Queue delivery may repeat, so workers must treat every job as at-least-once.

### 3.9 Batch preparation is first-class

Allow a user to submit many videos to one project before review. Deduplicate the submission, control concurrency/cost, preserve per-video failure details, and place completed transcripts in a `Ready for review` inbox. A failed item must not block the rest of the batch.

### 3.10 Rights and platform limits are explicit

Only process media the user is authorized to use. “Any YouTube video” means any accessible, supported video for which playback and authorized processing are available; private, deleted, age/region-restricted, live, members-only, or protected media can fail. The official YouTube Data API cannot download arbitrary public caption tracks: its caption download method requires permission to edit the video. Caption acquisition therefore needs an adapter with a generated-transcript fallback, and failures must be understandable rather than hidden.

### 3.11 Foreign-language clips always carry both subtitle versions

For a foreign-language source, separate original-language and English-translation SRT sidecars are required artifacts of every successful clip export, including `Export + log`, `Export only`, later exports of logged candidates, and batch exports. Both must be derived from the exact transcript versions in the export snapshot, restricted to the exported media bounds, and shifted to clip-relative time. Embedded or burned-in subtitles may be selected in addition, but never replace either required sidecar.

For a confidently English-language source, create the clip-specific English SRT by default. Expose an `Omit subtitle files for English-language clips` checkbox in conversion settings; when explicitly checked, a successful English clip may have no subtitle sidecar files. Treat mixed or unknown source language as non-English for this safety rule so uncertain detection cannot silently suppress subtitles.

### 3.12 Research context travels with every logged clip

Both logging actions must let the researcher add an optional multiline note and zero or more free-form tags before committing the clip. Notes capture context or intended use; tags can represent a topic, person, organization, argument, visual motif, or any other project-specific taxonomy.

Tags are reusable project-scoped labels: match them case-insensitively for uniqueness and filtering while preserving a display form. Offer existing project tags as suggestions without preventing a new tag. Persist the note and tag assignments in the same transaction as the clip so a queued candidate can never appear without the context entered for it. Allow authorized collaborators to edit them later using optimistic versions, and make both fields searchable/filterable and available to CSV and optional external catalog projections.

`Export only` is not a project research log and therefore does not acquire project tags or a clip note. If the user later chooses `Add to project`, collect or confirm those fields as part of creating the logged clip.

### 3.13 Prefer established, replaceable building blocks

Prefer mature, actively maintained libraries and official vendor SDKs for standard infrastructure concerns. Put each external tool, library-specific data shape, and hosted service behind a narrow typed adapter so the application model, worker orchestration, and UI do not depend on that choice. Keep deterministic fakes for normal tests and make live-provider checks optional. Pin compatible dependency ranges and record provider/model/tool provenance on durable outputs so an implementation can be upgraded or replaced without silently changing existing work.

### 3.14 Preferred language is personal; logged language evidence is durable

Each user may set one account-level preferred transcript language, defaulting
to English. Use normalized BCP-47 language tags and treat tags with the same
primary language as equivalent for the initial translation policy (for example,
`en-US` satisfies English). The preference controls transcript display and
search; it does not replace the shared English track, mutate a project's active
base transcript, or become project-wide state.

Resolve the display track in this order: the original track when the source
already matches the preference, the canonical English track when the preference
is English, otherwise a verified translation derived directly from the original
track. Reuse a verified local or project-shared derived translation before
requesting provider work. If the configured provider cannot produce the target,
show an actionable unsupported/unavailable state rather than silently falling
back to an unrelated language or translating English a second time.

Every logged clip keeps native-language text and English text. When the user's
preferred language is non-English and differs from the native and English
languages, also snapshot `preferred_language`, `preferred_text`, and its exact
track/version provenance. Those preferred fields are an optional all-or-none
group and are absent in every other case. Changing the user's preference never
rewrites an existing logged clip.

## 4. MVP definition

### 4.1 Included in the first usable release

- Sign in and open/create a shared project with membership-based access.
- Mirror shared project/transcript metadata into a local SQLite cache.
- Accept common YouTube URL forms and normalize them to a video ID.
- Submit many URLs to one project as a named transcription batch.
- Deduplicate batch items and show aggregate plus per-video progress/retry state.
- Place completed items into a `Ready for review` project inbox.
- Embed and control the YouTube player.
- Fetch basic metadata and cache it.
- Check the project's online transcript catalog before acquiring/transcribing.
- Acquire an existing transcript when the configured source permits it.
- Generate a transcript when no usable transcript exists.
- Detect the spoken language and produce English when necessary.
- Preserve original and English transcript tracks.
- Let each user set a preferred transcript language and display/search verified
  source, English, or supplemental translated tracks accordingly.
- Reuse project-shared, immutable preferred-language translations before
  generating them, without changing the active source-plus-English transcript.
- Normalize all transcript sources into one segment/token model.
- Upload an immutable, checksummed transcript bundle to private online storage and finalize its shared manifest.
- Download and verify a shared transcript on another authorized workstation without regeneration.
- Render timestamps and a virtualized transcript.
- Click a segment or timed token to seek.
- Highlight the currently spoken segment and auto-scroll without fighting manual scrolling.
- Search exact/partial text and jump between matches.
- Select an arbitrary contiguous text range.
- Preview and adjust start/end time.
- Select a clip-conversion preset and override supported settings before rendering.
- Save reusable global or project conversion presets.
- Queue/log a selection to a chosen project without exporting.
- Export and log a selection to a chosen project.
- Add optional usage notes and reusable project-scoped tags while performing either logging action, then edit/search/filter them later.
- Log native and English text for every candidate, plus preferred-language text
  and provenance only when it is a distinct third language.
- Export a selection without adding it to a project log.
- Export a previously logged selection.
- When conversion requires it, download the full authorized source behind the scenes into private job-scoped scratch storage, reuse it for all requested ranges in that active source job, and verify its deletion after outputs finalize.
- Produce required clip-relative original-language and English-translation SRTs for every foreign-language clip; produce an English SRT by default for English clips, with an explicit English-only omission setting.
- Show queue status and retry failed jobs.
- Export the clip log as CSV.
- Provide settings for tool paths, output paths, local/cloud worker choice, transcription/translation provider, and optional credentials.
- Distribute one supported pilot build that a nontechnical collaborator can
  install, update, launch, diagnose, and uninstall without a source checkout,
  package manager, terminal, or cloud console.
- Provide version-matched quick-start, operator, privacy/rights, troubleshooting,
  and issue-reporting documentation suitable for sharing outside the development
  team.

### 4.2 Deferred until the core loop is stable

- Optional one-way Google Sheets publishing, followed by selective metadata sync only if real collaboration usage justifies its conflict and authorization cost.
- Bookmarks and timeline overlays.
- Notes attached to individual transcript segments.
- Fuzzy, regex, semantic, and cross-video search.
- AI summaries, quote suggestions, argument detection, and B-roll suggestions.
- Real-time multi-user editing, comments/presence, and conflict-rich collaboration beyond shared transcripts/project records.
- Automatic scaling of hosted GPU transcription compute; the first release may use registered local workers with cloud upload.
- Hover previews and a full nonlinear-editor timeline.
- Airtable and other external catalog integrations.

### 4.3 Explicit non-goals for MVP

- Replacing a full video editor.
- Editing transcript text to rewrite or overdub the video.
- Frame-by-frame timeline editing.
- Automatic publishing to social platforms.
- Treating Google Sheets as a job runner capable of rendering media itself.

## 5. UX specification

### 5.1 Main workspace

Use a resizable split layout:

```text
+-----------------------------------------------------------------------+
| URL / project | Search | display language | queue | settings          |
+-------------------------------+---------------------------------------+
| Transcript (about 40%)        | YouTube player (about 60%)            |
|                               |                                       |
| Search results + filters      | Selection preview / start / end       |
| Virtualized transcript        |                                       |
| Current segment highlighted   +---------------------------------------+
| Selected range highlighted    | Queue / export panel                  |
|                               | Job status and recent clips           |
+-------------------------------+---------------------------------------+
```

On a narrow window, stack the player above the transcript. Keep the selection action bar sticky.

### 5.2 Load states

Show distinct, recoverable states:

- Validating URL
- Loading metadata
- Checking cache
- Checking shared project transcripts
- Downloading/verifying a shared transcript
- Discovering captions
- Downloading/extracting audio
- Transcribing
- Translating
- Aligning timestamps
- Uploading transcript bundle
- Finalizing shared transcript version
- Cleaning temporary source media
- Waiting for a worker
- Ready
- Needs user action
- Failed with retry/details

Do not show a single indefinite spinner for the entire pipeline.

### 5.3 Transcript behavior

- Render segments as the virtualization unit and tokens inside each segment.
- Show a readable timestamp per segment.
- Make tokens clickable when token timing exists; otherwise seek to the segment start.
- Poll player time while playing and use a binary search over sorted segments/tokens.
- Highlight the active segment and optionally the active word.
- Auto-scroll only while follow mode is enabled.
- Temporarily suspend follow mode when the user manually scrolls; expose a `Resume follow` control.
- Keep text selection stable while the active playback highlight changes.
- Default to the current user's preferred-language track. Allow `Preferred`,
  `English`, `Original`, and paired views for the tracks that exist without
  losing the selected source-video time range. When preferred English or the
  source already matches the preference, do not show a duplicate track/view.

### 5.4 Selection behavior

Map browser text selection to stable token IDs, not character offsets in rendered DOM alone.

A selection stores:

- first and last token/segment IDs
- unpadded transcript time range
- user-adjusted export time range
- selected original text, when available
- selected English text
- selected preferred-language text and language only when it is a distinct
  third language
- exact original, English, and optional preferred track/version provenance
- timing precision and transcript version

After selection, show:

- a visible project picker or active-project indicator for logging actions
- an optional multiline `Notes / intended use` field for logging actions
- a tag picker that suggests existing project tags and accepts new free-form tags
- the selected clip-conversion preset for both export actions
- an `Export settings` control for per-export overrides
- `Queue / log only`
- `Export + log`
- `Export only`
- `Copy`
- start/end handles or numeric fields
- a short looping preview

Disable the two logging actions until a project is selected. Allow quick project creation in the picker. A remembered project may be offered, but never conceal the destination. `Export only` bypasses project logging and every external catalog projection.

Notes and tags belong to the logged clip rather than its render job. Commit them atomically with `Queue / log only` or the clip-creation phase of `Export + log`; a later render failure must not lose them. Let authorized collaborators edit them from the queue/review surface. Tag matching and suggestions are project-scoped and case-insensitive, while the chosen display capitalization remains visible.

Default bounds should use the first selected token start and last selected token end. For cue-level timing, use cue boundaries. Apply configurable handle padding only to export bounds, never by mutating the recorded transcript bounds.

### 5.5 Keyboard baseline

Finalize exact keys during usability testing, but reserve commands for:

- play/pause
- seek backward/forward
- focus search
- next/previous search match
- queue/log selection to the indicated project
- export + log selection
- export-only selection
- set selection start/end from playhead
- toggle follow mode
- toggle original/English transcript

Avoid overriding browser/operating-system shortcuts and provide a shortcut reference.

### 5.6 Project behavior

A project is a named, access-controlled research collection, not merely a tag. Let the user create a project with a required name and optional description, members/roles, output directory override, and optional external catalog bindings.

- Show the current target project in the workspace toolbar and again in the selection action bar.
- Permit browsing a video without choosing a project.
- Require a project before `Queue / log only` or `Export + log` can complete.
- Let the user change or quick-create the project without discarding the selection.
- Store a logged clip in exactly one project initially; add cross-project linking only if later usage proves it necessary.
- Use the project's export directory/settings for logged exports and global defaults for `Export only`.
- External catalog publishing is asynchronous and subordinate to the shared project record. Do not fail or roll back a local/shared clip command when an optional integration is offline.

### 5.7 Batch transcription and review inbox

Provide a dedicated `Transcription queue` surface:

1. Require a target project.
2. Accept newline-separated URLs and CSV import initially; playlist import can follow.
3. Show a preflight table with normalized video ID, title/duration when resolvable, existing shared transcript, duplicate/unsupported status, and estimated processing need.
4. Let the user name the batch and choose source policy, transcription profile,
   execution location (`local` or available hosted worker), and priority. The
   canonical shared target remains English; snapshot the submitting user's
   non-English preferred display language as a supplemental translation request
   without making it part of base-transcript deduplication.
5. Submit valid unique items in one action.
6. Show aggregate counts and per-item stage/progress/error/retry controls.
7. Put successful project videos in `Ready for review`; keep failed items visible without blocking siblings.

Support `pause pending`, `resume`, `cancel unstarted`, `retry failed`, and `open ready video`. Pausing affects undispatched work; a running external process is only canceled when the provider supports safe cancellation. Bound concurrency globally and per project/provider. Warn before expensive hosted work when duration/cost can be estimated.

Use these high-level item states:

```text
draft -> preflight -> queued -> resolving -> acquiring -> transcribing
                                      -> translating -> aligning -> uploading
                                      -> ready_for_review
                    -> blocked | failed | canceled
```

Track processing state separately from `review_status = unreviewed | reviewing | reviewed | skipped`.

### 5.8 Clip conversion settings

Let the user choose how a clip is converted before `Export + log`, `Export only`, or a later export of a logged candidate. Provide named presets plus an advanced settings panel; do not require the user to edit raw FFmpeg arguments.

Resolve settings in this order:

1. application editing-friendly default
2. project default preset for logged exports, or the global default for export-only
3. explicitly selected named preset
4. per-export overrides

Show the resolved preset/settings summary before submission. `Queue / log only` starts no conversion and may optionally remember a preferred preset for later; the user can still change it when export is requested.

Expose supported settings through capability-aware controls:

- preset name and description
- output container and video codec/profile/pixel format
- quality mode and value, such as constant quality or target bitrate
- resolution/scaling, aspect handling, and source-or-fixed frame-rate policy
- audio codec, bitrate, sample rate, and channel policy
- precise re-encode versus a clearly labeled fast/keyframe-limited mode when supported
- `Omit subtitle files for English-language clips` checkbox, default off
- required original-language plus English-translation SRT sidecars for foreign/mixed/unknown-language sources
- optional WebVTT, embedded soft subtitles, and optional burned-in subtitles
- start/end handle padding
- thumbnail and metadata generation
- output directory and filename template
- supported hardware-acceleration choice as an advanced option

Keep H.264/AAC MP4 plus language-policy SRT sidecars as the editing-friendly default. Model the checkbox as `omit_subtitle_sidecars_when_source_is_english`, so applying the same preset to a foreign-language source still generates both required files. Enable the checkbox only when the canonical original track is confidently English; for foreign, mixed, or unknown language, disable it and explain that both original and translated English files are required. Embedding or burning subtitles is a separate setting and does not satisfy or alter the sidecar rule. Expose only combinations the installed worker can actually produce; disable or explain incompatible choices such as a subtitle codec unsupported by the selected container.

Allow personal/global presets and project presets. Project presets are shared, versioned project records; changing a preset creates a new version for future jobs rather than mutating queued or completed exports. Every export job stores the fully resolved conversion-settings snapshot, preset ID/version when applicable, and relevant encoder/tool versions. Retrying a job uses that snapshot unless the user explicitly creates a new export request.

### 5.9 Project Clip Library

Provide a dedicated project-level `Clips` surface for work that happens after
transcript review. Do not force researchers to reopen the original transcript
selection or use a spreadsheet to request a later export.

- List logged clips by project with search across transcript text, video title,
  notes, tags, research status, export status, and artifact availability.
- Keep the transcript selection action bar optimized for the current selection;
  put later individual and batch export controls in the Clip Library.
- Let the user select one or many clips, choose a resolved conversion preset,
  request exports, and observe independent progress, errors, retry, and safe
  cancellation.
- Reuse one source acquisition for compatible same-video work where practical,
  without letting one failed clip block its siblings.
- Show every completed immutable package version and whether its bytes are
  currently verified and reachable. An `export_status = complete` catalog row
  is not proof that a local locator still resolves.
- Offer `Reveal/Open artifact`, `Verify`, and explicit `Re-export` actions.
  Re-export creates a new immutable artifact version; it never overwrites or
  silently regenerates the package used by an earlier consumer.
- Expose the same authorized clip search, artifact-resolution, and durable
  export-request capabilities to the separate scriptwriting product. Record the
  request origin for observability, but use one export pipeline and one artifact
  identity model for direct and script-driven work.

The research project owns the canonical clip record and verified reusable clip
packages. A script build may copy or clone a verified package into its own
project workspace, but it must not move or mutate the canonical package.

## 6. Transcript acquisition and normalization

### 6.1 Resolution order

For each video, resolve a transcript deterministically:

1. Read the project's active transcript manifest for the video.
2. Return the matching verified local cache when present.
3. Otherwise download the active shared bundle, verify its checksum/schema, and cache it locally.
4. If no shared version exists, discover available caption tracks through the configured caption adapter.
5. Prefer human-authored English.
6. Prefer auto-generated English.
7. Prefer a human-authored original-language track and translate it.
8. Prefer an auto-generated original-language track and translate it.
9. Acquire audio and run multilingual speech recognition.
10. Translate the resulting original transcript to English when needed.
11. Align or estimate timing and mark its precision.
12. Upload/finalize the new immutable source-plus-English transcript bundle,
    then mark it active for the project.
13. Resolve the requesting user's preferred language: use original or English
    when equivalent; otherwise check a verified local derived-translation cache,
    then the project's shared derived-translation catalog, then request one
    provider translation directly from the original track.
14. Publish a newly completed preferred-language translation as an immutable,
    checksummed derivative of the exact base transcript version. Do not replace
    or mutate the active base transcript.

Let the user override track choice and explicitly request regeneration.

### 6.2 Provider boundaries

Define adapters instead of mixing vendor/command details into routes or UI components:

```ts
interface VideoMetadataProvider {}
interface CaptionDiscoveryProvider {}
interface MediaAcquisitionProvider {}
interface SpeechToTextProvider {}
interface TranslationProvider {}
interface AlignmentProvider {}
interface TranscriptObjectStore {}
interface SharedProjectCatalog {}
interface TranscriptionJobDispatcher {}
```

Initial local processing implementations may invoke installed command-line tools. Shared transcript storage is an explicit project capability and therefore uploads transcript text/metadata. Remote transcription/translation or source-media upload remains separately opt-in and must clearly identify what leaves the machine.

### 6.3 Canonical transcript model

Normalize every source to versioned tracks:

```ts
type TimingPrecision = "word" | "cue" | "estimated";

type TranscriptTrack = {
  id: string;
  videoId: string;
  language: string;          // BCP-47 when known
  kind: "original" | "english" | "translation";
  source: "youtube-manual" | "youtube-auto" | "generated" | "translated";
  provider: string;
  model?: string;
  sourceTrackId?: string;
  timingPrecision: TimingPrecision;
  schemaVersion: number;
  contentSha256: string;
  version: number;
  status: "pending" | "ready" | "failed";
};

type TranscriptSegment = {
  id: string;
  trackId: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
};

type TranscriptToken = {
  id: string;
  segmentId: string;
  ordinal: number;
  text: string;
  startMs?: number;
  endMs?: number;
  timingConfidence?: number;
};
```

Store time as integer milliseconds relative to the original video. `english`
remains an explicit compatibility/collaboration role; any non-English derived
track uses `translation`, because whether it is "preferred" depends on the
viewer. Every derived track has `sourceTrackId` pointing to the original track
and copies its honest source-video cue boundaries. Keep raw provider responses
in the cache for debugging/reprocessing, but do not make UI code depend on them.

### 6.4 Timing policy

- Use true word timestamps when the source/provider supplies them.
- When only cues exist, keep cue timing and optionally distribute estimated token times for navigation.
- Label interpolated token times as `estimated`.
- Never use estimated word bounds for a supposedly frame-accurate export without allowing preview/adjustment.
- Consider on-demand forced alignment for a selected range before export as a later precision upgrade.
- Keep segment sizes readable; re-segment long cues without pretending the new text chunks have independent timing unless alignment supports it.

### 6.5 Cache identity

Build transcript cache keys from at least:

- project ID and active shared manifest/version
- video ID
- source caption track or media fingerprint
- source language
- target language
- provider/model/version
- normalization schema version

Partial jobs must not be treated as ready cache hits.

Base transcript identity and preferred-translation identity are separate. A
user preference must not cause the source-plus-English transcription job to be
regenerated or create a competing active base version. Key a derived
translation by the exact base transcript version, original track/content
identity, normalized target language, provider/model, and normalization schema.

### 6.6 Shared transcript bundle

Store large transcript data as compressed private objects, not database rows alone. Keep the searchable/local normalized form in SQLite after download.

Recommended immutable bundle layout:

```text
projects/<project-id>/videos/<video-id>/transcripts/<lineage-id>/v<version>/
  manifest.json
  source-provider-response.json.gz
  original.normalized.json.gz
  english.normalized.json.gz
  original.srt
  english.srt
  translations/<target-language>/v<translation-version>/
    manifest.json
    translated.normalized.json.gz
    translated.srt
```

The base manifest records project/video/track IDs, source and English target
languages, provenance, model/provider versions, timing precision, normalization
schema, object keys/version IDs, byte sizes, SHA-256 checksums, job ID, creator,
and created time. Each supplemental translation has its own manifest linked to
the exact base transcript version and original track. Do not use a user ID,
preference label, title, or other mutable text as translation identity.

Use a private S3 bucket with versioning, encryption, blocked public access, least-privilege service roles, and lifecycle rules for abandoned staging objects/old versions. The application receives short-lived presigned upload/download URLs from the authenticated project API; do not ship general AWS credentials to clients.

### 6.7 Publish and download protocol

Publish atomically at the catalog level:

1. Worker asks the API for job-scoped staging upload URLs.
2. Worker uploads the bundle with checksums.
3. Worker calls `finalize` with object version IDs and checksums.
4. API verifies job ownership/state and expected objects.
5. One database transaction creates the immutable transcript version, links it to the project video, and moves the active pointer when policy allows.
6. API marks the job ready and emits a project update.

Another workstation reads the active manifest through the API, downloads with a short-lived URL, verifies checksum/schema, and atomically promotes the local cache entry. It must never expose a half-uploaded transcript as ready.

Use the same staging-upload plus transactional-finalize protocol for a derived
translation. Finalization may advance only the active pointer for that base
version and target-language lineage; it must not change the project's active
base transcript pointer. Concurrent equivalent preferred-language work adopts
or supersedes the canonical finalized derivative instead of publishing
duplicate active results.

Use a unique idempotency key over project, video, source/target languages, source fingerprint, provider/model, and normalization schema. Concurrent equivalent jobs may both compute, but only one canonical finalized version should win; the other adopts the completed version or becomes `superseded` without overwriting it. Cross-project reuse is opt-in because project access boundaries must not leak transcript existence or content.

## 7. Queue and export model

### 7.1 Three selection outcomes

Implement the actions as distinct commands with explicit effects:

| Action | Project required | Create project clip record | Request render | Eligible for external catalog projection |
|---|---:|---:|---:|---:|
| Queue / log only | Yes | Yes | No | Yes |
| Export + log | Yes | Yes, before render | Yes | Yes |
| Export only | No | No | Yes | No |

An export-only operation still creates a persisted technical job and artifact history so it can survive restart, report failure, and be retried. That job is not a research-log entry, does not appear in a project's clip catalog, and must not be sent to CSV or any external catalog projection unless the user later chooses `Add to project`.

### 7.2 Logged clip lifecycle

Use separate research and rendering states:

```text
research_status: candidate -> approved -> rejected
export_status:   not_requested -> queued -> processing -> complete
                                      |          |
                                      +-> failed <-+
```

`Queue / log only` creates the candidate and sets `export_status = not_requested`. `Export + log` creates the same durable candidate first, then requests an export. This ensures a render failure never loses the research selection.

### 7.3 Logged clip fields

At minimum persist:

- stable clip ID
- required project ID
- source video ID and URL
- source video title/channel/thumbnail snapshot
- transcript track/version IDs
- transcript start/end milliseconds
- export start/end milliseconds
- English text plus exact English track/version provenance
- native/original text, language, and exact track/version provenance when the
  English track is not itself the native track
- optional preferred-language text, normalized language, and exact
  track/version provenance only when the user's non-English preference differs
  from both native and English
- notes and tags
- research status
- export status and latest error
- optional preferred export preset ID/version for later conversion
- created/updated/exported timestamps
- optional external integration binding/record ID when projected
- export manifest path when complete

### 7.4 Export request snapshot

Every export job stores an immutable request snapshot containing the video,
transcript version, selected text, source bounds, export bounds, language
tracks, fully resolved conversion settings, preset ID/version when applicable,
and optional logged clip ID. The clip ID is required for `Export + log` or
exporting a previously logged clip and absent for `Export only`. Later edits to
project/global presets must not change an existing request or retry. A
preferred-language logging snapshot does not change the export subtitle policy:
original and English remain the required foreign-language sidecars; a preferred
subtitle sidecar is outside this feature unless separately requested later.

### 7.5 Export pipeline

1. Validate the logged clip or export-only request snapshot and source authorization.
2. Create an isolated job-scoped scratch directory and acquire the source media there. Downloading the full authorized source is permitted even when only a short range will be exported.
3. Validate duration and clamp bounds.
4. Validate the resolved conversion-settings snapshot against worker capabilities.
5. Extract and encode the requested range according to that snapshot; use precise H.264/AAC MP4 as the default.
6. Resolve the subtitle artifact policy from the snapshotted source language and `omit_subtitle_sidecars_when_source_is_english` setting: foreign/mixed/unknown requires original plus English; confirmed English requires English unless omission is true.
7. Derive required cues from the corresponding transcript versions in the request snapshot, trim/clamp them to the actual exported media bounds, and include padding coverage when export padding is used.
8. Shift subtitle timestamps so the clip begins at `00:00:00,000`; no cue may begin before zero or end after the verified clip duration.
9. Write and validate every subtitle sidecar required by the resolved language policy.
10. Embed or burn subtitles only as requested and supported by the selected container/codec; this remains independent of sidecar omission.
11. Generate a thumbnail.
12. Write JSON metadata and a manifest containing hashes/tool versions.
13. Atomically move completed artifacts into the final output directory.
14. Verify the finalized output artifacts against the resolved language-policy subtitle set.
15. Delete the downloaded source and any other unneeded scratch media, verify that it is gone, and record `deleted_at` plus the cleanup result.
16. Mark the job complete and update external logs only after required cleanup succeeds.

Group queued exports for the same source into one source-processing job where practical so the worker downloads once, creates every requested clip, and then deletes the shared scratch source. A later export may require a fresh download; preventing unintended source retention takes precedence over avoiding that download.

Use a staging directory per job. Run cleanup after success, failure, or cancellation. A crash-safe sweeper and storage lifecycle policy must remove abandoned scratch assets after a short configured TTL, but they are backstops rather than substitutes for immediate application cleanup. Model cleanup explicitly, for example:

```text
queued -> acquiring -> rendering -> finalizing -> deleting_source -> complete
             |            |             |               |
             +------------+-------------+-> failed/canceled -> deleting_source
                                                     deleting_source -> cleanup_failed
```

Never report `complete` while a source scratch asset is still present. Retry cleanup independently without re-rendering verified outputs, surface `cleanup_failed` to operators, and avoid duplicate final artifacts on job retry.

### 7.6 Clip subtitle sidecar guarantee

Every export request snapshots `source_language`, its detection/provenance, the original and English transcript versions, and `omit_subtitle_sidecars_when_source_is_english`. Resolve the required sidecar set as follows:

| Source-language classification | Omission setting | Required SRT sidecars |
|---|---:|---|
| Confidently English | Off | English |
| Confidently English | On | None |
| Foreign language | Either value | Original language + English translation |
| Mixed or unknown | Either value | Original language + English translation; resolve/confirm language tracks if needed |

The English-only omission is independent of container choice, subtitle embedding, subtitle burning, and other conversion-preset settings. Applying a saved omission preference to a non-English source never removes its required sidecars.

Generate it as follows:

1. Use the original and/or English transcript tracks and immutable versions required by the resolved language policy.
2. Use the actual export bounds, including configured handle padding, rather than the highlighted-text bounds alone.
3. Select timed English tokens/cues that overlap those bounds. Prefer true word timing; otherwise retain honest cue-level or estimated timing precision.
4. Clamp cues to the clip boundaries and shift them by `-export_start_ms` so the first possible subtitle time is zero and the final cue cannot exceed the clip duration.
5. Preserve readable cue text and ordering without inserting lines from elsewhere in the source.
6. Validate SRT structure, monotonic nonnegative timing, maximum cue end, language, transcript version, clip ID, and content hash before finalization.

For a foreign-language source, `.<bcp47-language>.srt` contains the original speech and `.en.srt` contains its time-linked English translation. Both use the same clip basename and both are mandatory.

If a required timed track does not exist, do not silently export a clip with missing or unrelated subtitles. Put the job in a recoverable `needs_transcript`, `needs_translation`, `needs_language_confirmation`, or `needs_alignment` state and offer the relevant action. A verified speech-free range still receives valid empty files for its required sidecar set and a manifest flag distinguishing intentional no-speech output from a processing failure. A confirmed-English export with omission enabled needs no empty placeholder file.

The manifest records source-language classification/provenance, the snapshotted omission setting, the resolved required-sidecar set, and for each generated file its name, language, transcript track/version, timing precision, export bounds, cue count, and SHA-256 hash. When English omission is used, record `subtitle_sidecars_omitted_reason = confirmed_english_user_setting`. Retrying from the same immutable request must reproduce the same subtitle decision and derivation inputs.

### 7.7 Export package

```text
exports/
  2026-08-01_video-title_<clip-id>/
    2026-08-01_video-title_<clip-id>.<selected-container-extension>
    2026-08-01_video-title_<clip-id>.en.srt
    2026-08-01_video-title_<clip-id>.<source-lang>.srt
    2026-08-01_video-title_<clip-id>.json
    2026-08-01_video-title_<clip-id>.jpg
    manifest.json
```

The example shows the two-file package required for a foreign-language clip. An English clip normally has only `.en.srt`; when English omission is explicitly enabled, it has no SRT sidecar. Sanitize filenames, keep the stable clip ID in the name, and resolve collisions deterministically.

### 7.8 Reusable artifact identity and resolution

A completed export record means that a verified package version once finalized;
it does not guarantee that its bytes are still reachable from the current
workstation. Treat the immutable artifact ID, package manifest, and content
hashes as identity. Treat local paths, object keys, download grants, and
authoring-project copies as replaceable locators.

When the Clip Library or an authorized authoring client asks to resolve media:

1. Match the exact logged clip snapshot, export bounds, required handles,
   language-policy artifacts, and conversion requirements.
2. Prefer an already finalized compatible artifact version.
3. Verify its manifest and every required byte before returning it as reusable.
4. If its recorded locator is missing, search only configured artifact roots or
   accept an explicit user-located package; verify identity and hashes before
   relinking it.
5. If no verified compatible package is reachable, return an explicit
   `missing`, `invalid`, `remote_only`, or `incompatible` result. Never claim a
   cache hit from catalog state alone.
6. Let the caller request a new immutable export through the ordinary durable
   export boundary. A forced re-export creates a new version and never replaces
   an earlier package silently.

An authoring build may materialize a verified package into its project media
folder by copy or filesystem-supported copy-on-write clone. Moving the canonical
package is prohibited. Script-specific trim, crop, layer, speed, audio, and
timeline placement remain authoring usage choices and do not mutate the logged
clip or reusable package.

## 8. Spreadsheet and external logging

### 8.1 MVP: CSV

Export a consistent CSV view of project-logged clips and their completed artifacts. Include clip ID and project ID/name so rows can be reconciled after edits or reimports. Exclude export-only jobs unless the user explicitly adds them to a project.

### 8.2 Google Sheets: optional catalog projection

Google Sheets is not an export control surface and is not on the critical path
for the research or scriptwriting workflows. The Project Clip Library and the
authorized API own individual/batch export requests, status, retries, and
artifact resolution.

If collaboration usage justifies it after the core workflow is stable:

1. Bind a project to a spreadsheet and sheet/tab; allow multiple projects to
   share a destination only when project IDs remain explicit.
2. Publish or upsert project-logged clip rows using stable clip IDs.
3. Start with a one-way projection of catalog-owned fields and reachable
   artifact links; a failed publish never rolls back or changes the project.
4. Add selective sheet-to-project metadata sync only for clearly owned fields
   such as notes or tags, with optimistic versions and conflict logs.
5. Do not add `Request Export` checkboxes, Apps Script job triggers, local
   polling, or hosted relay work unless repeated real usage demonstrates that
   users must initiate exports from outside the product.

CSV remains the immediate portable interchange format. A one-way Sheets publish
may improve familiar sorting and sharing, but it must not become the bridge used
by the scriptwriting product.

Recommended sheet columns:

```text
Project ID | Project | Clip ID | Clip Name | Source Video | YouTube URL | Channel | Start | End |
Length | Topic | Notes | Tags | English Transcript | Original Transcript |
Preferred Language | Preferred Transcript |
Export Preset | Preset Version | Status | Error | English Subtitle File |
Original Subtitle File | Video File | Export Date
```

Conflict policy:

- The shared project catalog owns synchronized timing, transcript provenance, active versions, and shared job state; SQLite mirrors them and owns unsynced offline commands.
- User-editable sheet fields such as topic, notes, and tags may sync back only after their ownership and conflict policy are explicitly enabled.
- Use clip ID plus update timestamps/version numbers; never reconcile by row number alone.
- Log sync errors and never discard a local change silently.

## 9. Proposed architecture

### 9.1 Runtime shape

Build a hybrid application with four clear roles:

- **Web client:** React + TypeScript + Vite, using the YouTube IFrame API.
- **Local agent:** loopback Node.js service for filesystem access, local cache, installed tools, local transcription, and FFmpeg export.
- **Shared control plane:** authenticated project API for membership, project videos, transcript manifests, batches/jobs, sync commands, and presigned object access.
- **Workers:** registered local agents initially and optional hosted containers for unattended transcription at scale.

A browser-only design cannot provide the required filesystem, transcription, and FFmpeg workflow reliably. A purely local design cannot share transcripts or queues across workstations. Keep local/cloud contracts explicit and shared so processing location can change without changing transcript semantics.

### 9.2 Suggested implementation choices

- React and TypeScript for the UI.
- Vite for the client build.
- npm workspaces for the initial monorepo; Node.js 22 or newer is the supported runtime baseline.
- TanStack Query for server state.
- A transcript virtualization library such as React Virtuoso.
- Fastify for a small typed local API.
- Zod schemas shared across client/server boundaries.
- Node's SQLite API with explicit SQL migrations for local cache, FTS, job history, and sync outbox.
- Managed PostgreSQL for the shared catalog, memberships, batches, jobs, manifests, and synchronized project records; use embedded PGlite only for deterministic local migration tests.
- SQLite FTS5 for transcript/notes search once basic in-memory search is proven.
- A database-backed job model plus SQS Standard queue/DLQ as cloud delivery transport; never treat queue delivery as exactly-once.
- Private versioned Amazon S3 storage for compressed transcript bundles, accessed through short-lived presigned URLs.
- Plain AWS CloudFormation as the initial infrastructure-as-code format, with separate development and production parameters.
- An authenticated AWS API surface and project-scoped authorization; choose Cognito or an equivalent OIDC provider during the infrastructure spike.
- Registered local workers first; make the worker container compatible with AWS Batch GPU jobs for optional hosted capacity.
- FFmpeg/FFprobe for media inspection and export.
- A configurable media acquisition adapter and a multilingual speech-to-text adapter.
- `yt-dlp` for opt-in authorized audio acquisition and `whisper.cpp` for the first opt-in local multilingual speech-recognition implementation; keep both behind typed adapters.
- Amazon Translate through the official AWS SDK as the first opt-in text-translation adapter; keep the canonical translation contract vendor-neutral.
- Vitest for units/integration tests and Playwright for the critical browser flow.

Confirm versions and operating-system packaging during bootstrap rather than pinning them in this planning document.

### 9.3 Repository shape

```text
apps/
  web/                    # React UI
  local-agent/            # loopback API, local cache/tools/exports
  cloud-api/              # authenticated shared-project control plane
  worker/                 # local or hosted durable background jobs
packages/
  contracts/              # Zod schemas and shared types
  db-local/               # SQLite schema, migrations, repositories
  db-cloud/               # PostgreSQL schema, migrations, repositories
  transcript/             # normalization, selection, search, subtitle logic
  media/                  # acquisition and FFmpeg adapters
  providers/              # captions, ASR, translation, alignment
  sync/                   # outbox, versions, reconciliation, object manifests
  storage/                # S3/local object-store adapters
  config/                 # validated configuration
infra/
  aws/                    # infrastructure as code, policies, queues, storage
tests/
  fixtures/               # small licensed/local transcript and media fixtures
  e2e/
data/                     # runtime only; gitignored
  db/
  cache/
  jobs/
exports/                  # runtime only; gitignored
PROJECT_GUIDE.md
outline.md
```

Keep the deployable set minimal: one cloud API, one worker image, and the local agent/web client. Package boundaries are for testability and shared semantics, not unnecessary network hops.

### 9.4 Core APIs

The exact paths may evolve, but preserve these capabilities:

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id/members
POST   /api/projects/:id/members
GET    /api/projects/:id/videos
POST   /api/projects/:id/videos/preflight
POST   /api/projects/:id/transcription-batches
GET    /api/projects/:id/transcription-batches/:batchId
POST   /api/transcription-batches/:id/pause
POST   /api/transcription-batches/:id/resume
POST   /api/transcription-batches/:id/retry-failed
GET    /api/projects/:id/review-inbox
POST   /api/transcription-jobs/claim
POST   /api/transcription-jobs/:id/heartbeat
POST   /api/transcription-jobs/:id/fail
POST   /api/videos/resolve
GET    /api/videos/:id
POST   /api/projects/:projectId/videos/:videoId/transcripts/resolve
GET    /api/projects/:projectId/videos/:videoId/transcripts
POST   /api/transcription-jobs/:id/uploads
POST   /api/transcription-jobs/:id/finalize
POST   /api/projects/:projectId/videos/:videoId/transcripts/:versionId/activate
GET    /api/search
POST   /api/projects/:projectId/clips
GET    /api/projects/:projectId/clips
PATCH  /api/projects/:projectId/clips/:id
POST   /api/projects/:projectId/clips/:id/export
POST   /api/projects/:projectId/clips/exports/batch
GET    /api/projects/:projectId/clips/:id/artifacts
POST   /api/projects/:projectId/clip-artifacts/resolve
GET    /api/export-presets
POST   /api/export-presets
GET    /api/projects/:projectId/export-presets
POST   /api/projects/:projectId/export-presets
PATCH  /api/projects/:projectId/export-presets/:id
POST   /api/exports
POST   /api/exports/batch
GET    /api/jobs/:id
POST   /api/jobs/:id/retry
GET    /api/settings
PATCH  /api/settings
POST   /api/integrations/csv/export
```

Return job IDs for long operations. Stream progress via server-sent events or poll initially; choose the simpler reliable implementation before adding WebSockets.

Registered local workers claim eligible `execution_location = local` jobs through the authenticated API and heartbeat their lease; they do not receive broad SQS or S3 credentials. Hosted workers consume SQS using a narrow service role and use the same executor/finalize contracts. The database remains authoritative for state in both modes.

## 10. Persistence model

Separate shared control-plane data from the local working cache.

Shared PostgreSQL tables or equivalent aggregates:

- `users`
- `projects`
- `project_members`
- `videos`
- `project_videos`
- `transcript_lineages`
- `transcript_versions`
- `transcript_artifacts`
- `transcript_translation_lineages` and immutable translation versions/artifacts
  keyed to one base transcript version and target language
- `transcription_batches`
- `transcription_jobs`
- `worker_leases`
- `clips` (project-logged research candidates; `project_id` is required)
- `tags` (reusable project-scoped labels with a normalized unique name)
- `clip_tags`
- `bookmarks` (can precede UI)
- `export_jobs` (may reference a logged clip or contain an export-only request snapshot)
- `logged_export_deliveries` and mutually exclusive immutable sanitized success
  or failure results bound to one accepted request, delivery generation, worker,
  and epoch
- `export_presets` and immutable preset versions
- `export_artifacts` (immutable package identity/provenance; no
  workstation-private path as identity)
- `integration_bindings`
- `sync_events`

Local SQLite tables mirror required shared records and add:

- normalized `transcript_tracks`, `transcript_segments`, and `transcript_tokens`
- local `video_assets` and cache manifests
- job-scoped `source_scratch_assets` lifecycle records without permanent media retention
- local job/process history
- `export_artifact_locators` with independently verified availability keyed to
  an immutable artifact/package ID; keep workstation-private paths local
- configured artifact roots used for bounded locate/relink checks
- `sync_outbox` and `sync_cursors`
- local settings/credential references
- FTS indexes

Important constraints:

- Unique normalized YouTube video ID.
- Unique project/video/transcription-profile idempotency key for active equivalent work.
- Unique transcript version within a project video/track lineage.
- Immutable finalized transcript manifests and object checksums/version IDs.
- Ordered segment/token ordinals.
- `start_ms >= 0`, `end_ms > start_ms`.
- Clip export bounds contain or deliberately document deviation from transcript bounds.
- A clip note and all clip-tag assignments are committed atomically with clip creation; tag names are unique by project after case/Unicode normalization.
- A user's preferred language is a normalized account preference with English
  as the default. Only that authenticated user may change it.
- Clip native/English text provenance is frozen at creation. Optional preferred
  language, text, track ID, and track version are either all present or all
  absent, and may be present only for a non-English language distinct from the
  clip's native and English languages.
- A derived translation is immutable, checksummed, and uniquely/idempotently
  linked to one exact base transcript version, original track/content identity,
  normalized target language, provider/model, and schema version. It never
  changes the active base transcript pointer.
- Every export job contains a validated, immutable resolved-settings snapshot.
- A first logged-export success may transition only its exact accepted queued
  request/job/clip; canonical replay of the same immutable result is a no-op,
  while divergent bytes or provenance conflict without another event/version.
- A first logged-export failure may transition only its exact accepted queued
  request/job/clip after local evidence proves source work never started or the
  exact attempt's scratch was deleted. Success and failure are mutually
  exclusive; canonical failure replay is a no-op.
- Jobs have an idempotency key and attempt count.
- Worker claims have an expiring lease/heartbeat and safe reassignment policy.
- Artifacts record path, type, size, and content hash.
- Export artifact identity is the immutable artifact/package ID plus its manifest
  and content hashes. Local paths, object keys, grants, and consumer copies are
  locators with independently verified availability; a completed catalog row is
  never sufficient proof that the bytes are reachable.
- An artifact relink or user-located package is accepted only after its manifest,
  clip/export snapshot, required artifact set, and hashes verify. Missing or
  invalid locators do not erase the completed provenance record.
- Every completed export satisfies its snapshotted language-policy artifact set: foreign/mixed/unknown sources have original and English SRT artifacts; confirmed-English sources have an English SRT unless the explicit omission setting is recorded. Generated cues are clip-relative and cannot exceed the verified media duration.
- Every acquired source scratch asset records its owning job/source group, size, lifecycle state (`acquiring`, `ready`, `deleting`, `deleted`, or `cleanup_failed`), expiry, and `deleted_at`; clear any usable source locator after verified deletion.
- An export job cannot transition to `complete` until every associated source scratch asset is `deleted`.
- Use migrations for every schema change; never edit a user database ad hoc.

Use stable UUIDs, UTC timestamps, actor IDs, and optimistic versions now. Enforce project membership on every shared read/write and object URL grant. Require `project_id` on logged clips, but allow export jobs to have no clip/project when their explicit mode is `export_only` and remains local. Never infer access from possession of a video ID alone.

## 11. Search plan

### MVP

- Normalize case and Unicode consistently.
- Search the displayed preferred-language track, English, and the active
  original-language track without presenting duplicate results for equivalent
  tracks.
- Highlight all visible matches.
- Jump next/previous and seek to the matching segment.
- Keep query state per video.

### Next

- SQLite FTS5 across segments, clips, notes, and tags.
- Prefix/partial matching with clear behavior.
- Fuzzy search with a bounded edit-distance strategy.
- Regex behind an advanced toggle with timeouts/safety limits.
- Cross-video search returning video, timestamp, and context.
- Semantic search as a separate indexed capability, never a replacement for literal search.

## 12. Reliability, security, and privacy

- Bind the local API to loopback by default.
- Protect mutating endpoints against cross-origin requests; use an app session token and strict CORS.
- Require authenticated project membership and role checks for every shared API/object operation.
- Keep S3 buckets private with blocked public access, encryption, versioning, narrowly scoped service roles, and audited lifecycle/deletion behavior.
- Issue short-lived, object-specific presigned URLs only after authorization; never put general AWS credentials in the client.
- Store local secrets/refresh tokens in the operating-system credential store when feasible, not in source control or SQLite plaintext.
- Validate URL/video IDs, filenames, paths, subtitle text, and external process arguments.
- Invoke processes with argument arrays, never constructed shell strings.
- Set concurrency limits for downloads, transcription, and FFmpeg jobs.
- Check available disk space before large downloads/exports.
- Allow cache inspection and safe cleanup without deleting the database.
- Redact credentials, tokens, presigned URLs, and private object keys from logs.
- Upload transcript bundles for shared projects; make remote transcription/translation and source-media upload separate opt-ins that identify what is uploaded and retained.
- Do not retain full source media after its active dependent work finishes. Local workers use isolated private temporary directories; hosted workers use encrypted private job-scoped scratch storage. Delete the source immediately after verified finalization, failure, or cancellation, and record the cleanup result without logging a reusable source URL/path.
- Treat lifecycle expiration and a periodic abandoned-scratch sweeper as crash-recovery backstops. Alert/retry when cleanup fails, and never mark a job complete until its source deletion is verified.
- Rate-limit batch submission and cap project/user/provider concurrency and spend.
- Record tool exit code and a useful, sanitized error excerpt.

## 13. Testing strategy

### 13.1 Test fixtures

Keep small, redistributable fixtures that cover:

- English caption cues
- non-English original plus English translation
- non-English original plus English and a distinct preferred-language translation
- word-timed generated transcript
- cue-only transcript
- missing captions
- malformed/overlapping cues
- punctuation and non-Latin scripts
- a valid and tampered transcript bundle manifest
- a multi-video batch with duplicates, an existing shared transcript, and a failing item
- a tiny locally owned media sample for deterministic FFmpeg tests

Do not make the normal test suite depend on live YouTube availability. Keep live-provider checks optional and clearly marked.

### 13.2 Unit tests

- URL normalization
- caption-source precedence
- transcript normalization and re-segmentation
- BCP-47 preference normalization/equivalence and display-track resolution
- derived-translation cache and idempotency identity
- token/segment time lookup
- selection-to-time mapping
- subtitle selection, boundary clamping, and zero-based time shifting
- English-source omission setting defaults, preset/override precedence, and immutable snapshot behavior
- enforcement that omission applies only to confidently English sources
- foreign-language source to clip-relative original plus English-translation SRT derivation
- empty-SRT handling for a verified speech-free range versus missing-transcript failure
- conversion-preset precedence and capability validation
- preset-version and export-settings snapshot immutability
- filename sanitization
- three-action command effects and queue/export state transitions
- note validation and project-scoped tag normalization/deduplication
- logged-language matrix: source equals English, source equals preference, and
  source/English/preference all differ; reject partial or redundant preferred
  field groups
- cache keys and idempotency keys
- transcript manifest/checksum verification
- batch/item/review state transitions
- worker lease/heartbeat expiration
- project-role authorization decisions
- optional external catalog field mapping/conflict rules
- artifact compatibility, locator availability, manifest/hash verification, and
  authoring-consumer resolution decisions

### 13.3 Integration tests

- empty-database migration checks for local and cloud stores
- local and shared transcript resolution
- staged upload/finalize with a fake object store
- download/verify/cache from a second simulated workstation
- generated transcript job with a fake provider
- preferred-language resolution reuses local/shared derivatives before one
  direct-from-original provider request and never changes the active base version
- batch preflight deduplication and sibling failure isolation
- duplicate queue delivery and expired worker lease recovery
- project selection enforcement for both logging actions
- queue item creation independent of export
- atomic note/tag persistence for both logging actions, including offline outbox replay and collaborator edits
- atomic native/English/optional-preferred text and track provenance for both
  logging actions, CSV projection, reload, and offline outbox replay
- export-only job creation without a clip/project log record
- FFmpeg exports from the local fixture using representative conversion presets
- confirmed-English export produces an English SRT by default and produces no sidecar files when omission is explicitly enabled
- every foreign/mixed/unknown-language export mode produces both original and English SRTs even when an omission-enabled preset is selected
- a 30-second foreign-language fixture range produces only in-range original and translated English cues between zero and the verified clip duration
- export finalization is rejected when any policy-required SRT is missing, malformed, from the wrong transcript version, or extends beyond the clip
- one acquisition reused across multiple clips from the same source-processing job
- verified source-scratch deletion after success, render failure, and cancellation
- abandoned-scratch recovery after a simulated worker crash, including a visible `cleanup_failed` path
- retry after a simulated job failure
- CSV export and stable clip IDs
- project Clip Library individual/batch request idempotency, sibling failure
  isolation, same-source grouping, artifact verification, and re-export
- simulated authoring-client search and compatible-artifact resolution, including
  missing-locator relink and durable re-export fallback

### 13.4 End-to-end acceptance path

1. Sign in and open a shared test project.
2. Submit a batch containing multiple fixture URLs, a duplicate, and one failing item.
3. Verify unique items proceed independently and completed items enter `Ready for review`.
4. On workstation A, finalize/upload an English transcript.
5. On simulated workstation B, open the same project/video and download the verified transcript without generation.
6. Click transcript text and verify player seek intent.
7. Search and navigate a match.
8. Select a phrase, indicate a project, and queue it.
9. Add person/topic tags and an intended-use note, reload the app, and verify the candidate plus its research context remain and can be filtered.
10. Select a 30-second range from a foreign-language fixture, choose a conversion preset plus an override, export, and verify the requested codecs/dimensions and completed status.
11. Verify that the export has both original-language and translated-English SRTs, contains only cues for that clip, starts at or after zero, ends within the verified clip duration, and records the expected transcript versions/timing precision.
12. Verify that the completed export has no retained source scratch media.
13. Select an English-language phrase, use `Export + log`, leave omission off, and verify the project record exists before the render completes and its package has a matching English SRT.
14. Select another English-language phrase, enable `Omit subtitle files for English-language clips`, use `Export only`, and verify no project clip/CSV/external catalog record or SRT sidecar is created while the intentional omission is recorded in the manifest.
15. Set the test user preference to Spanish, open a Romanian fixture, and verify
    the displayed/searchable transcript is Spanish while the active shared base
    transcript remains Romanian plus English.
16. Log a Romanian selection and verify its native Romanian text, mandatory
    English text, and optional Spanish preferred text carry exact time-linked
    track/version provenance through reload and CSV export. Then change the
    user's preference and verify the existing clip is unchanged.

Use a thin manual smoke test with an authorized real YouTube video before a release.

## 14. Delivery milestones and exit criteria

### Milestone 0 — Foundation

Deliver:

- monorepo/tooling bootstrap
- validated configuration
- local-agent and cloud-API health endpoints
- shared contracts for projects, transcript manifests, batches, jobs, and errors
- SQLite plus test-PostgreSQL migrations
- fake object-store/queue adapters and worker skeleton
- infrastructure-as-code skeleton with separate development/production configuration
- test fixtures and CI commands

Exit when a clean checkout can install, migrate both stores, run local services/fakes, test, and open the empty workspace without AWS credentials.

### Milestone 1 — Shared projects and transcript store

Deliver:

- sign-in/session boundary and project membership roles
- create/open project and project-video catalog
- private versioned S3 bucket/policies and object-store adapter
- immutable transcript bundle/manifest schema
- presigned staging upload and transactional finalize
- active transcript version lookup/change
- verified download into local SQLite/file cache
- offline outbox and basic sync status

Exit when workstation A can publish a fixture transcript and an authorized workstation B can load and verify it from the same project, while a non-member is denied.

Completed 2026-08-01. The development CloudFormation stack provisions a private, encrypted, versioned S3 transcript bucket with public access blocked plus encrypted SQS job and dead-letter queues. The AWS acceptance test passed against `research-video-transcripts-dev-521180198930-us-east-1`, including presigned staged upload, immutable object version capture, authorized pinned download, checksum verification, second-workstation cache promotion, non-member denial, and test-object cleanup.

### Milestone 2 — Video and shared transcript reader

Deliver:

- URL normalization and metadata record
- IFrame player wrapper
- canonical transcript schema
- fixture/import and shared-store adapters
- virtualized transcript
- segment click-to-seek
- active-segment tracking and follow mode
- literal search

Exit when a local or shared preexisting transcript can drive navigation on a long video without UI slowdown or unnecessary regeneration.

Completed 2026-08-01. Common YouTube URL forms normalize to canonical identities; metadata is isolated behind a provider and project videos persist through the cloud API. Validated canonical tracks, segments, and tokens now pass from the authorized active-version lookup through checksum-verified local caching, compressed-artifact parsing, and transactional SQLite indexing to the local-agent transcript endpoint. The player wrapper supports playback polling and cue seeking; the workspace adds bounded segment windowing, exact timed-word seeking with honest cue fallback, active segment/token state, follow suspension/resume, and literal search with next/previous navigation. A 10,000-segment window test verifies bounded rendering calculations, the shared-store integration verifies that a second resolution reuses the verified cache without regeneration, and browser checks cover the navigation interactions. The standalone browser demo remains deliberately fixture-backed and labeled until the authenticated project shell supplies its session and project context; arbitrary videos never receive fabricated transcript text.

### Milestone 3 — Batch transcript acquisition and review inbox

Deliver:

- multi-URL/CSV batch creation with required project
- preflight, deduplication, existing-shared-version detection, and batch summary
- caption discovery adapter
- deterministic source selection
- media/audio adapter
- speech-to-text adapter
- translation adapter
- persisted item stages, attempts, lease/heartbeat, and idempotency keys
- controlled local-worker concurrency and containerized worker entrypoint
- upload/finalize of completed bundles
- aggregate/per-item progress, pause pending, retry failed, and cancel unstarted
- `Ready for review` inbox and review status
- versioned local/shared cache and language toggle

Exit when a mixed batch containing English, non-English-captioned, no-caption, duplicate, existing, and failing fixtures completes independently, publishes reusable English transcripts while preserving source text, and populates the review inbox.

First slice completed 2026-08-01. The authenticated project API now accepts bounded multi-URL preflight and batch-creation requests with source policy, transcription profile, execution location, priority, and target language. Preflight normalizes YouTube identities, reports duplicates/unsupported inputs/metadata failures, and identifies reusable active project transcripts. Cloud migration `0003_transcription_batches` adds durable item-level preflight, processing, review, attempt, error, active-version, and job-link fields. Batch creation stores every input outcome, moves shared-transcript hits directly to `ready_for_review`, creates one idempotent job for each unique unresolved video, reuses an equivalent job across repeated batches, and transactionally rechecks the active transcript before queuing so a version finalized after preflight is adopted rather than regenerated. CSV parsing/UI, provider resolution, workers, control actions, and the full review inbox remain.

Second slice completed 2026-08-01. Caption discovery now has a validated provider-neutral candidate contract that records language, manual/automatic authorship, translation capability, and whether the configured adapter can actually acquire the track. A deterministic resolver selects manual target-language, automatic target-language, manual original-language, or automatic original-language captions in that order, preserving non-target source text for translation; it falls back to multilingual speech recognition with an explicit reason when generation is forced, no tracks exist, or discovered tracks are inaccessible. This boundary deliberately does not claim arbitrary public-caption support: the current official YouTube Data API requires OAuth to list tracks and edit permission to download them. A configured authorized acquisition implementation and worker integration remain.

Third slice completed 2026-08-01. The shared catalog is now authoritative for worker ownership through authenticated atomic claims, bounded expiring leases, attempt numbers, and heartbeat-driven item stages. Duplicate delivery cannot claim an active lease; after expiry, the same job can be reassigned with a higher attempt, and stale or non-owning workers cannot extend the lease or write results. Cloud migration `0004_worker_resolution_leases` adds source-plan persistence and claim/expiry indexes. The winning worker can persist the validated caption-versus-speech-recognition plan on the job and every linked batch item. This follows SQS's at-least-once/visibility-timeout model while keeping queue delivery subordinate to database state. The local worker runtime still needs to call these endpoints, renew both catalog and queue visibility, execute providers with controlled concurrency, and report completion/failure.

Fourth slice completed 2026-08-01. A transport-neutral worker control-plane client now performs authenticated local/hosted claims, stage heartbeats, and source-plan writes through validated shared contracts. The claiming runtime renews the authoritative catalog lease on a bounded interval, can renew an optional queue delivery lease at the same time, exposes an abort signal when catalog ownership is lost, and reports sanitized executor failures against the exact active attempt. The cloud failure endpoint transactionally marks every linked nonterminal batch item failed, retains an actionable error, records the last error on the job, and removes the worker lease; stale/non-owning attempts are rejected. The generic queue worker also extends message visibility during long execution and only acknowledges after the executor returns. Provider composition, a durable batch-job completion transition tied to a finalized transcript version, controlled concurrency, and the production worker entrypoint remain.

Fifth slice completed 2026-08-01. Caption discovery and acquisition now have a combined provider boundary plus an opt-in local `yt-dlp` implementation configured by `CAPTION_PROVIDER` and `YT_DLP_PATH`; caption access remains disabled by default. Discovery runs without downloading media, normalizes manual and automatic tracks, and excludes automatic translated aliases when it cannot honestly identify them as original speech. Source resolution then applies the shared deterministic precedence and downloads only the winning VTT track into an isolated job scratch directory, using argument-array process invocation, disabled ambient tool configuration, bounded output/time, cooperative abort, stable idempotent filenames, and actionable sanitized failures. Forced generation and honest no-caption fallbacks do not download a caption. This adapter does not change the official YouTube API limitation and does not promise access to every public video; automatic recovery from a caption-provider acquisition failure into speech recognition remains to be composed. VTT normalization, translation/generation providers, publication, the durable batch-job completion transition, and continuous worker composition remain.

Sixth slice completed 2026-08-01. Acquired UTF-8 WebVTT captions now normalize into validated canonical tracks, segments, and untimed tokens using integer source-video milliseconds. The bounded parser verifies the WebVTT header and cue timing grammar, ignores `NOTE`, `STYLE`, and `REGION` metadata blocks, accepts cue identifiers/settings and legal overlapping cues, removes presentation markup, decodes cue entities, and rejects missing text, malformed timestamps, backward/zero-duration cues, oversized inputs, and empty results with a non-retryable normalization error. Caption tracks remain honestly `timing_precision = cue`; token records intentionally have no fabricated word bounds. Normalized cue content receives a SHA-256 identity and deterministic UUIDv8 track/segment/token IDs, so line-ending differences and repeat delivery produce the same canonical output. The worker-only file bridge reads the acquired VTT and preserves its language, manual/automatic source, and provider provenance. Translation/generation providers, caption-acquisition-to-ASR recovery, publication, completion, and continuous worker composition remain.

Seventh slice completed 2026-08-01. Translation now uses a typed provider-neutral segment contract and deterministic canonical-track normalizer. The first production adapter is opt-in Amazon Translate through the official AWS SDK, with SDK retry behavior, bounded request sizes and concurrency, cooperative cancellation, regional AWS credential resolution, and optional project terminology. It sends transcript segment text only when `TRANSLATION_PROVIDER=aws-translate`; the default remains disabled. The normalized English track never overwrites the original, records the source-track link and provider, copies source-video cue boundaries exactly, deliberately leaves translated tokens untimed, and rejects missing, duplicate, or empty segment results. Deterministic fakes cover normal tests without AWS calls or charges. Worker composition, speech recognition, publication, and durable completion remain.

Eighth slice completed 2026-08-01. Authorized audio acquisition and local multilingual speech recognition are now separate opt-in typed adapters. The `yt-dlp` audio adapter disables ambient configuration and playlists, extracts FLAC into caller-owned isolated job scratch storage, streams a SHA-256 fingerprint without loading long audio into memory, supports cooperative cancellation, and reuses only a finalized nonempty output. The `whisper.cpp` adapter uses the maintained `whisper-cli` full-JSON interface, preserves detected source language, records an explicit model name, normalizes source-video segment offsets into a deterministic generated track, and deliberately leaves word timing unset rather than treating model tokens as aligned words. Malformed results fail closed and all normal tests use injected command runners. These adapters do not yet compose the durable job lifecycle: scratch deletion, caption-acquisition fallback, conditional translation, bundle publication/finalize, and completion remain required before continuous processing is enabled.

Ninth slice completed 2026-08-01. The configured one-shot local worker now composes the real provider boundaries without enabling unattended polling prematurely. It resolves and normalizes captions first, records an explicit `caption-acquisition-failed` source-plan transition when a selected caption disappears, acquires authorized audio and runs multilingual ASR as fallback, translates non-English originals into a separate time-linked English track, serializes canonical JSON and source-video SRT artifacts, and uploads them through job-owned grants. It deletes and verifies the entire job scratch directory before calling finalize; a cleanup failure therefore prevents completion and leaves only expiring staged objects. Claimed-worker finalization rechecks the exact active lease inside the transaction, activates the immutable version, completes the original job, moves linked items to `ready_for_review` with the active version, and deletes the lease atomically. The entrypoint is dormant until explicit worker authentication and provider settings are present. Controlled polling/concurrency, container packaging, batch controls, and the review UI remain.

Tenth slice completed 2026-08-01. The same configured entrypoint now supports bounded continuous service operation without changing provider contracts. One to eight fixed lanes each claim and execute no more than one job at a time; idle responses poll on a configured interval, unexpected control-plane failures use a separate bounded backoff, and shutdown signals stop new claims while allowing owned jobs to finish and finalize. Execution location and lease duration are explicit, with heartbeat cadence derived from the lease. A non-root Node 22 container packages FFmpeg and a pinned yt-dlp release while leaving credentials, whisper.cpp binaries/libraries, and GGML models injectable and replaceable. Batch controls and the review UI remain.

Eleventh slice completed 2026-08-01. Durable batch dispatch control now lives in the authorized shared catalog rather than in worker memory. Batch reads include aggregate processing/review counts while retaining exact per-item stages and errors. Optimistic-versioned commands can pause new claims, resume dispatch, cancel queued-but-unstarted items, and retry only failures the worker marked retryable. Claim selection requires active dispatch for queued items, while previously started stages remain eligible for safe lease-expiry recovery after a later pause or cancellation. Migration `0005_batch_controls` persists dispatch state and failure retryability. The browser-facing batch list/control surface and review-status workflow remain.

Twelfth slice completed 2026-08-01. Authorized project batch discovery and a cross-batch ready-for-review inbox now expose the shared catalog to the browser. Review status is independently optimistic-versioned and can change only after transcript readiness. The queue surface keeps the development bearer credential in memory, lists only that identity's projects, shows the selected destination explicitly, preflights and creates newline-separated submissions, polls aggregate and per-item progress, offers all four durable batch controls, updates review status, and opens ready videos in the existing player workspace. Development uses a same-origin Vite proxy rather than broad CORS; production must supply the equivalent authenticated reverse-proxy/session boundary. Browser and API tests cover the connected interaction. CSV import remains before the batch-creation UI item is complete.

Thirteenth slice completed 2026-08-01. CSV batch input now uses Papa Parse behind a bounded browser helper rather than custom delimiter logic. Import is limited to 2 MB, 50 columns, and 500 selected nonempty values. It recognizes common URL headers, requires an explicit selection for ambiguous files, supports headerless one-column lists, reports ignored empty rows, and rejects malformed quoting or oversized input without partially applying it. Imported values replace only the editable input list and invalidate stale preflight; submission still requires the ordinary authorized server preflight, where duplicates and unsupported sources remain visible. Unit and Playwright coverage verify parser edge cases and the real UI handoff. The core Milestone 3 batch workflow is complete; optional forced alignment remains evidence-driven rather than a blocker for honest cue-timed review.

Fourteenth slice completed 2026-08-01. Browser drag selection now resolves from stable segment/token data attributes into a validated transcript-selection snapshot independent of transient DOM character offsets or drag direction. Selectable tokens remain click- and keyboard-seekable without relying on button text selection behavior. Fully timed boundary tokens yield exact word bounds; otherwise the model falls back honestly to source cue bounds and never invents timing. Immutable transcript bounds, transcript version, timing precision, stable boundary IDs, and normalized selected text are stored separately from adjustable export bounds. The workspace preserves the stable highlight after the native browser selection changes and exposes numeric export bounds plus additive handles without mutating the research selection. Unit and Playwright coverage exercise reverse selection, cue fallback, padding/clamping, bound validation, and the real drag-selection interaction. Looping preview and the project-aware action bar remain next.

Fifteenth slice completed 2026-08-01. The YouTube wrapper now exposes explicit seek, play, and pause commands so a selected export range can start at its adjusted bound, loop when playback reaches the adjusted end, and stop deliberately. Numeric and playhead-based controls update only export bounds and refuse ranges that exclude the immutable transcript selection. The authenticated project session is lifted to the research workspace: the same visible target project drives batch review and appears beside the selected passage, can be changed without losing the selection, and can be quick-created through the real authorized project API. Browser coverage verifies preview seek/play/pause, preserved transcript bounds after padding, shared project selection, and successful quick-create without selection loss. Durable selection action commands and note/tag persistence remain next.

Sixteenth slice completed 2026-08-01. `Queue / log only` now crosses the real project-authorized API and atomically creates a durable research candidate without creating a render job. Cloud migration `0006_clip_candidates` stores immutable video and transcript snapshots, separate transcript/export bounds, provenance, lifecycle states, notes, project-scoped case-insensitive reusable tags, creator/version timestamps, and a project-scoped idempotency key; the same transaction links the video, attaches deduplicated tags, and emits one sync event. Replaying the same command returns the original candidate without overwriting its research or video snapshot, while nonmembers are denied. The selection panel accepts multiline intended-use notes and comma-separated tags, requires the visible project, freezes the submitted fields after success, and states explicitly that no export was requested. API coverage verifies atomic notes/tags, idempotency, authorization, reload listing, one sync event, and zero export jobs; Playwright covers the connected logging interaction. Export request snapshots, the two export actions, collaborator editing, and the queue surface remain next.

Seventeenth slice completed 2026-08-01. All three selection outcomes now cross distinct durable command boundaries. `Export + log` first reuses or creates the project candidate with the same atomic notes/tags path, then cloud migration `0007_logged_export_requests` links an immutable video, selection, source-language policy, and fully resolved conversion-settings snapshot to a queued project export job and advances the clip's independent export status. A failed second step therefore cannot erase the research log. `Export only` bypasses the cloud project catalog entirely: local migration `0004_export_only_requests` writes a projectless technical job and immutable snapshot to loopback-owned SQLite, with no clip, notes, tags, sync event, or spreadsheet-eligible record. Both paths are idempotent and preserve their original settings on retry. The action panel exposes the established editing preset plus bounded container, codec, CRF, dimensions, frame-rate, audio, subtitle-sidecar omission, and embedded-subtitle overrides; incompatible ProRes/PCM MP4 combinations fail validation. `Copy` remains a browser-only action. Tests cover cloud/local persistence separation, settings validation, idempotency, and all four browser actions. The actual media worker intentionally remains separate, so export requests stay queued until Milestone 5 processing is implemented.

Eighteenth slice completed 2026-08-13. The shared project workspace now loads its durable clip queue from the authorized catalog rather than relying on the transient selection action panel. Project members can search selected text, source-video title, intended-use notes, and tags; filter by reusable project-scoped tags or independent export status; open a logged source video; and edit notes/tags through an optimistic-versioned API. A stale collaborator edit returns a conflict rather than overwriting the newer candidate. Tag updates replace only that clip's associations while retaining the project tag vocabulary for future suggestions, and every accepted edit emits a versioned project sync event. The queue reloads its durable list/tags after an explicit refresh or project change, so candidates survive browser reloads. API and browser coverage exercise authorized edits, stale conflicts, tag suggestion retention, reload, and note/tag filters.

Nineteenth slice completed 2026-08-13. The authorized project queue now downloads a CSV catalog keyed by stable project and clip IDs. Each record carries research/export status, video and transcript provenance, transcript and render boundaries, timing precision, English and original text, notes, tags, and timestamps. The endpoint is scoped by the same project membership checks as the queue, emits an attachment with RFC 4180 quoting and CRLF rows, and hardens spreadsheet-formula-looking cells before download. Projectless export-only jobs are deliberately excluded: this export represents the shared research log, not local technical work. API and browser tests cover the content, attachment response, authorization failure, and visible queue control.

PL-01 completed 2026-08-20. A normalized self-only account preference now
resolves an equivalent native or English track before any supplemental work,
then reuses a checksum-verified local/project derivative or requests one direct
from the immutable original track. Non-English derivatives are shared,
project-authorized, versioned artifacts keyed to the exact base/original and
provider identity; they never advance the source-plus-English base pointer.
New clip writes atomically freeze strict schema-version-2 native, English, and
when distinct, preferred evidence by the same source-video time range. Queue
display/search, offline replay, API reload, and CSV preserve those snapshots
after later preference changes, while legacy schema-version-1 clips remain
readable without invented provenance. The Romanian-to-Spanish browser path is a
deterministic fixture proof only; production language contracts and provider
resolution accept normalized BCP-47 targets generally. Preferred translations
remain display/logging evidence and never add a preferred subtitle artifact.

Twentieth slice completed 2026-08-14. Full export-source acquisition is now a separate opt-in `EXPORT_SOURCE_PROVIDER` boundary, distinct from transcription audio. The local export boundary requires caller-confirmed authorization before any tool call, uses a no-config argument-array `yt-dlp` invocation in a private `0700` attempt directory, validates a single regular nonempty output, and records only provider, source identity, size, checksum, lifecycle state, expiry, and deletion timestamp. Local migration `0005_export_source_scratch_lifecycle` makes acquisition, deletion, cleanup failure, and actionable retry state durable without retaining a usable source path. Every acquisition, provider failure, cancellation, and downstream handoff runs verified cleanup; cleanup failure transitions the request to `needs_user_action` and never permits export completion. Rendering, FFprobe, same-source grouping, cleanup retry/sweeping, and the user-facing export controls remain subsequent Milestone 5 slices.

Twenty-first slice completed 2026-08-14. The local source handoff now validates the regular nonempty source inside its private attempt scratch directory and sends it through an injectable FFprobe adapter before any future renderer receives it. FFprobe invokes only argument arrays, bounds/sanitizes inspected data, supports cancellation, and records duration, container, video/audio codec, and optional tool version without retaining paths, URLs, commands, credentials, or raw output. Local migration `0006_export_probe_resolution` stores this safe provenance with the source attempt and stores the duration-clamped resolved export range separately from immutable transcript-selection and requested export-bound snapshots. Empty/invalid resolved ranges, malformed inspection, inspection failure, and cancellation are actionable and still run the established cleanup path; M5-01 cleanup failures remain terminal `needs_user_action` states. FFmpeg rendering, subtitle work, staging/finalization, presets/UI, source grouping, and scratch sweeping remain deferred.

Twenty-second slice completed 2026-08-14. The local export boundary now renders one M5-02 resolved range through an injectable FFmpeg adapter using only the existing editing-friendly H.264/AAC MP4 snapshot. Both the source and attempt-owned temporary MP4 stay in the private scratch directory; the source is not deleted until FFprobe re-inspects and verifies the temporary output's duration (within 250 ms), MP4 container, H.264 video, and AAC audio. Local migration `0007_export_render_validation` persists only this safe output provenance, linked to the source attempt, while immutable selection and requested bounds remain untouched. Unsupported settings, missing source streams, FFmpeg errors, cancellation, and output validation mismatches are retry-safe and clean scratch; M5-01 cleanup failures continue to win as `needs_user_action`. The temporary validated output is deliberately not promoted or marked complete yet: subtitles, final artifact staging/promotion, manifests, retries, grouping, and sweeping remain future slices.

Twenty-third slice completed 2026-08-15. Foreign, mixed, and unknown source-language snapshots now require immutable original and translated-English track identities even when the snapshot carries the English-only omission preference. The local export worker resolves only those exact verified local track versions, confirms the English track is English and linked to the exact original as a translation, trims and zero-bases each independently against M5-02 resolved bounds, and re-parses/revalidates both staged SRTs against M5-03's verified temporary MP4 duration. Local migration `0009_export_bilingual_sidecar_validation` records only role/language, track/version identity, cue count, bytes, checksum, timing bounds, attempt, and validation time; no subtitle text or file locator is durable. Every missing, malformed, wrong-version, non-English, mismatched, or nonintersecting required track fails safely without substitution, and the established cleanup gate removes source, temporary MP4, and both SRTs on failure/cancellation; cleanup failure remains `needs_user_action`. Cloud migration `0008_export_subtitle_track_snapshots` preserves the immutable bilingual track identities for logged requests. Final promotion, manifests, thumbnails, embedding/burn-in, UI/preset work, retries/grouping, and sweeping remain deferred.

Twenty-fourth slice completed 2026-08-15. After M5-01–M5-06 private staging validates the exact language-policy package, the local worker now atomically promotes only that MP4 and its required SRT set into a deterministic sanitized local package directory rooted at the configured data boundary. Promotion validates that staging has no missing, malformed, changed, or extra artifacts; it never reacquires, rerenders, rederives subtitles, substitutes tracks, or records file locators. A rename exposes the final directory only after the complete package is copied, then the worker rechecks every promoted regular nonempty artifact and records only role, deterministic package identity, byte size, SHA-256, source attempt, and validation time through local migration `0011_export_final_artifact_provenance`. Promotion persistence failures, failures, and cancellation remove attempted final packages and retain M5-01 scratch cleanup; source-cleanup failure still wins as actionable `needs_user_action`, so only cleanup-successful packages become complete. Manifests/metadata JSON, thumbnails, embedding/burn-in, UI/preset changes, retries/grouping, cloud clip storage, and sweeping remain deferred.

### Milestone 4 — Selection and durable clip queue

Deliver:

- stable token-range selection
- contextual action bar
- preview/adjust bounds
- required, visible project choice for logging
- create/update/list queue items
- export-only request path without a project record
- notes/tags
- project-scoped tag suggestions plus queue search/filter by tags and notes
- queue persistence across reloads
- CSV log export

Exit when logging a candidate takes one deliberate action after a visible project choice, atomically preserves optional notes/tags, and never starts a render, while export-only creates no project log record or project research metadata.

### Milestone 5 — Export worker

Deliver:

- isolated job-scoped source acquisition; full authorized-source download is allowed behind the scenes
- same-source export grouping so an active batch can download once and cut many ranges
- verified source deletion on success, failure, and cancellation, plus an abandoned-scratch sweeper/lifecycle backstop
- FFprobe validation
- named personal/project presets and preset versioning
- project/global defaults plus per-export overrides
- capability-aware conversion settings UI and validation
- immutable resolved-settings snapshots on export jobs/retries
- accurate editing-friendly H.264/AAC default render plus supported alternative settings
- language-aware `Omit subtitle files for English-language clips` setting in global/project presets and per-export overrides
- default clip-specific English SRT generation for English clips, with snapshotted explicit omission
- mandatory original-language plus translated-English SRT generation for foreign/mixed/unknown-language clips
- clip-boundary clamp, zero-based timing, validation, and manifest provenance for subtitles
- thumbnail/metadata/manifest
- progress, cancellation where safe, retry, and batch export

Exit when representative presets/overrides produce the requested media properties, queued jobs are unaffected by later preset edits, English clips include a validated clip-relative English SRT by default but can explicitly omit sidecars, every foreign/mixed/unknown-language clip has validated original and translated-English SRTs from the expected transcript versions, a 30-second foreign-language clip has accurate cues only within its 30-second duration, a real authorized video succeeds in a smoke test, and no full source media remains after any terminal job path.

M5-10 through M5-14B completed 2026-08-20. Every newly promoted package now
includes a verified descriptive `clip-<id>.json` metadata sidecar and a
midpoint-derived, independently probed JPEG thumbnail; both are staged, hashed,
named by the manifest, and required by atomic finalization while legacy package
schemas remain readable. Personal and project conversion presets now use
authorized append-only immutable versions, fixed-version defaults, optimistic
updates, and idempotent commands. The export UI resolves a preset/default plus
bounded per-export overrides through an authoritative preview, snapshots the
complete effective settings and deterministic fingerprint on the request and
job, and revalidates that immutable snapshot before transcript lookup, source
acquisition, or rendering. The renderer now supports exactly three
software-only families—H.264 High/AAC in MP4, HEVC Main/AAC in MKV, and ProRes
422/PCM in MOV—through fixed argument mappings, installed-capability discovery,
dynamic package roles/extensions, and normalized FFprobe conformance. Manifest
and metadata schema version 2 records remain backward-readable with version 1.
An immutable export may additionally include exactly one selectable English soft
subtitle stream, while required SRT sidecars remain independent. The renderer
uses only `mov_text` for MP4/MOV and SubRip for MKV, snapshots the exact English
track independently of the preferred display track, and verifies stream codec,
language, disposition, count, and normalized observed-media provenance before
promotion.
The latest aggregate verification passed 173 tests with one declared skip, the
web build, 17 local and 11 cloud migrations, four Playwright flows, and real
FFmpeg/FFprobe renders for all three families. Commits `2323a0f`, `fe1efed`,
`38047c4`, `9c8d8c6`, and `75def13` contain the completed slices.

These slices do not complete Milestone 5. Later M5-15 through M5-21 slices add
worker registration, accepted logged-export delivery and reconciliation,
cleanup recovery, immutable retry, and safe cancellation as described below.
Durable progress, batch and same-source group execution, the 30-second foreign
fixture gate, and the user-authorized live YouTube smoke test remain open.

M5-15 completed 2026-08-20. A local workstation now persists one stable worker
ID and capability-registration epoch in SQLite, discovers the existing fixed
FFmpeg support matrix, and advertises only the current immutable renderer
profile plus a normalized, fingerprinted installed summary. The summary is
conservative: a renderer is available only when its base encoder/muxer, scale,
FPS, and fixed container-specific English soft-subtitle encoder are all
installed. Registration is actor-owned and epoch-safe; equal epochs may replay
only an identical advertisement, while a higher epoch replaces it. Independent
owner-only heartbeats have a fixed 60-second expiry, revocation requires a
higher epoch to return, and project reads report only a compatible worker count
after joining the worker owner to project membership. This is availability
advertisement only—no export delivery, claims, source acquisition, rendering,
results, progress, retries, cancellation, grouping, or cleanup sweep is added.

M5-16 completed 2026-08-20. An authenticated registered local worker can now
claim one compatible queued logged export from a project where its owner remains
a member, import the exact immutable cloud request into the existing SQLite
export queue, and acknowledge durable acceptance without starting the processor.
The cloud uses one stable delivery ID per request plus an increasing reservation
generation and fresh token. Atomic `FOR UPDATE SKIP LOCKED` selection excludes
active or accepted assignments, requires the exact snapshotted capability
profile and conservative installed renderer, and leaves incompatible work
queued. SQLite imports in a non-runnable `pending_acceptance` phase; only an
idempotent cloud acceptance activates the request. A lost acceptance response is
recovered from local pending provenance before claiming new work, while expiry
and reassignment make stale acceptance conflict and remove the stale local copy.
Cloud and local migrations `0013` and `0019` add the durable state. No owner
identity, path, source-media acquisition credential, private source URL, source
acquisition, rendering, execution lease/result, progress, retry/cancel,
grouping, or cleanup behavior is added; the opaque reservation token remains
part of the typed handoff.

M5-17 completed 2026-08-20. The owning current registered worker can now run one
already accepted logged request through the existing one-shot
`LocalExportSourceProcessor` boundary with explicit source authorization. A
verified cleanup-complete local package projects one deterministic sanitized
success result; the authenticated cloud catalog rechecks the exact accepted
delivery generation/token, actor-owned worker/epoch/live registration, current
project membership, immutable request/settings/media/bounds/subtitle
provenance, and sorted artifact roles before one transaction inserts the
immutable result, changes only the exact queued export job and clip to
`complete`, increments the clip once, and emits one completion event. Local
completion followed by a cloud-call failure retries without rendering, while a
lost cloud response replays the exact fingerprint without a second row, event,
or version; divergent replay conflicts. Cloud migration `0014` and local
migration `0020` add the immutable success row and exact acceptance timestamp.
The result row/event/response omit local paths/locators, acquisition identity,
private URLs, credentials, raw tool arguments/output, owner identity, and the
reservation token used only for verification. This slice remains successful
completion only; M5-18 below adds the separate failure boundary.

M5-18 completed 2026-08-20. An accepted logged request that durably reaches
local `needs_user_action` without a complete package can now project one strict,
sanitized failure from persisted SQLite state. Attempt zero requires no scratch
rows; a positive attempt requires exactly one matching scratch row already
verified `deleted`. `cleanup_failed` and every incomplete lifecycle remain local
actionable work and cannot falsely mark the cloud request terminal. The cloud
catalog binds the current authenticated original worker owner and project
membership to the exact accepted delivery ID/generation/token/worker/epoch, but
correctly treats registration expiry, revocation, or a later registered epoch as
a scheduling stop rather than a reason to strand already persisted terminal
evidence. One transaction inserts one immutable failure, marks only the exact
queued job and clip `failed`, increments the clip once, and emits one sanitized
event. Exact replay is a no-op; divergent replay conflicts; database triggers
and the delivery lock prevent success/failure coexistence. Cloud migration
`0015` adds the immutable failure record. Errors are re-sanitized at the shared
contract and local repository boundaries, including URL, Unix/Windows/UNC path,
identifier/digest, key-value secret, and bearer-token redaction.

M5-19 completed 2026-08-20. An explicit bounded local maintenance command now
claims `cleanup_failed` or expired abandoned deterministic source-scratch rows
with a SQLite lease, deletes only the exact validated
`<job UUID>/<positive attempt>` child under the configured scratch root, and
durably records deletion. Missing exact children are idempotent cleanup success;
symlinks, files, invalid roots, and containment failures fail closed with
sanitized local evidence. Migration `0021` marks every preexisting random
`mkdtemp` layout row manual/actionable rather than inferring a new directory;
any corresponding processing job moves to `needs_user_action`. Verified exact
package provenance can restore `complete` without media work, while absent or
untrusted packages become only terminal-safe local failure evidence for M5-18.
The sweeper has no cloud mutation, polling, scheduler, retry/rerender, or UI.
Legacy random-layout bytes still require manual recovery; expiry remains the
abandonment boundary until a future execution heartbeat/control slice, and
M5-18 intentionally still rejects multi-attempt failure projection rather than
guessing attempt ownership.

M5-20 completed 2026-08-21. A current write-capable project member can now
retry one exact terminal failed logged export without mutating its request,
job, accepted delivery, immutable failure, or historical events. The cloud
transaction verifies and locks the persisted parent evidence, creates a new
queued job/request with new IDs, explicit parent provenance, and a monotonic
retry ordinal, and copies the exact immutable video, selection, language,
subtitle, preset, resolved-settings, capability, and fingerprint snapshots.
Only the shared clip moves from `failed` to `queued`, with one version increment
and one sanitized retry event. A project-scoped idempotency identity, one-child
lineage constraint, database snapshot/immutability triggers, and serialized
single-connection transactions make exact replay and concurrency return one
child while divergent branching conflicts and leaves no orphan jobs. The child
uses the existing M5-16 delivery and M5-17/M5-18 result paths unchanged. This
slice adds retry only: safe cancellation still requires durable execution
start/lease/heartbeat state, cancel intent, cooperative local abort and child
process termination, verified scratch cleanup, and immutable canceled-result
reconciliation mutually exclusive with success and failure.

M5-21 completed 2026-08-21. Accepted logged work now starts only after the
cloud creates or exactly replays one durable execution identity bound to its
accepted delivery generation, pinned worker epoch, positive attempt, opaque
lease, and bounded heartbeat. SQLite persists that exact identity before source
acquisition and refuses logged processor entry without it. A current
write-capable project member can record one immutable cancel intent for queued,
accepted-not-started, or executing work. Never-accepted work closes atomically
with attempt-zero evidence; accepted work observes intent at execution start or
heartbeat and aborts the existing processor through one `AbortSignal` spanning
acquisition, FFprobe, FFmpeg, subtitle, thumbnail, staging, and promotion.
Active child processes receive `SIGTERM`, escalate to `SIGKILL` when necessary,
and settle only after close. Cancellation becomes terminal only after no-start
proof or verified exact-attempt scratch deletion. A locally promoted package is
removed only through its validated deterministic request-owned directory when
cancellation wins the cloud commit race. Cloud migration `0017` and local
migration `0022` add execution, intent, and immutable canceled evidence;
success, failure, and canceled results serialize under the same request/delivery
lock and are mutually exclusive through catalog checks and database triggers.
Persisted canceled evidence replays directly after restart or cloud response
loss without rerendering or extending a lost lease. Durable progress, batch and
same-source group execution, the foreign fixture, authorized live smoke, and
the final Milestone 5 matrix remain open.

M5-22 completed 2026-08-22. Every accepted logged export can now persist one
strict, bounded progress snapshot against the exact M5-21 execution ID and
attempt. The local processor advances a fixed ordered vocabulary from
preparation and source acquisition through inspection, rendering, validation,
thumbnail/subtitle construction, packaging, cleanup, and local completion;
SQLite records every step before publication and enforces exact stage/rank,
sequence, and basis-point monotonicity. Execution heartbeats carry only the
latest sanitized snapshot. The cloud verifies the still-live delivery,
generation, worker epoch, execution attempt, and opaque lease before atomically
inserting or advancing progress; exact replay is a no-op and divergent or
regressive evidence conflicts. Start replay returns the latest cloud snapshot,
which the local repository reconciles only for the same durable execution while
retaining newer local evidence. Current project members can read request/job
state and the sanitized snapshot through a project-authorized endpoint; worker
identity, leases, reservation tokens, local paths, source identity, artifact
locators, URLs, transcript text, and errors never cross that read boundary.
Progress remains nonterminal and does not weaken cancellation, verified source
cleanup, or immutable success/failure/canceled exclusion. Cloud migration
`0018` and local migration `0023` preserve populated databases. The aggregate
gate passes 247 tests with one declared skip, the web build, 23 local
migrations, and 18 cloud migrations. Batch/sibling isolation, same-source group
execution, the foreign fixture, authorized live smoke, and the final Milestone
5 matrix remain open.

M5-23 completed 2026-08-22. A project editor can now submit two through twenty-
five eligible logged clips as one durable idempotent batch. Cloud migration
`0019` adds immutable batch identity and ordered item membership, binds every
root export request and all M5-20 retry descendants to the same item, and
rejects divergent project/clip/lineage relationships at the database boundary.
Creation locks and validates every clip, language/subtitle snapshot, settings
selection, resolution fingerprint, and worker compatibility before writing,
then persists the batch, items, independent jobs/requests, clip status changes,
and sanitized sync events in one transaction. Any invalid sibling rolls the
whole command back; exact and concurrent replay returns the original batch,
while divergent reuse conflicts without orphan jobs. A batch owns no delivery,
execution, cancellation, source, package, or terminal result. Aggregate reads
follow each item's newest linear retry leaf and derive exact queued, claimed,
processing, actionable, complete, failed, and canceled counts; only all-success
is batch-complete, while mixed terminal outcomes remain explicit. Project reads
expose only item/request/job state plus optional M5-22 progress—never worker or
lease credentials, source identity, paths, URLs, transcript text, raw errors, or
artifact locators. A narrow web panel selects eligible project clips, resolves
each immutable settings snapshot, queues the batch, and polls its summary. The
aggregate gate passes 250 tests with one declared skip, the web build, 23 local
and 19 cloud migrations, plus four Playwright flows. Same-source group execution,
the foreign fixture, authorized live smoke, and the final Milestone 5 matrix
remain open.

M5-24 completed 2026-08-22. Compatible active logged children from one M5-23
batch, project, canonical YouTube source, worker epoch, and configured provider
profile can now share one private full-source acquisition and inspection. The
cloud adds no group queue, executor, lease, result, or project read model; only
delivery-private immutable batch identity crosses to the assigned worker. Local
migration `0024` records one compatibility-bound group, exact execution/member
attempts, per-member outcomes, logical source evidence, final release, cleanup
claims, and deleted/actionable state without persisting a usable path. One
process-local coordinator surrounds the existing per-request processor: member
ranges retain independent settings, progress, abort signals, staging, render,
subtitles, thumbnail, metadata, manifest, package, and terminal reconciliation.
One member failure or cancellation releases only that member. No job becomes
complete from partial artifacts or before the shared root is verified absent;
cleanup failure blocks every dependent with redacted actionable evidence.
Ordinary sweeping cannot delete beneath a live exact execution, while bounded
startup recovery safely treats a prior process's joined members as orphaned and
deletes only the deterministic group root. Durable prior-group evidence makes
late and retry work fall back to a fresh request-owned acquisition instead of
reviving deleted media. A real FFmpeg/FFprobe repository-fixture test proves one
acquisition, two isolated packages, two deleted member rows, and no remaining
group scratch. The aggregate gate passes 258 tests with one declared skip, the
web build, 24 local and 19 cloud migrations, plus four Playwright flows. The
approximately 30-second foreign fixture, explicitly authorized live YouTube
smoke, and final Milestone 5 matrix remain open.

M5-25 completed 2026-08-22. A checked-in 32-second H.264/AAC source is generated
solely from FFmpeg color and sine inputs and paired with repository-authored
Spanish/English tracks under documented CC0 provenance. Its machine-readable
record pins the committed source SHA-256, expected FFprobe properties, exact
1,000–31,000 ms gate bounds, and paired transcript fixture. The existing
persisted one-shot processor renders that exact 30-second range with real
FFmpeg/FFprobe; no fixture executor, live provider, migration, or contract was
added. Boundary-crossing cues prove clipping to 0 and 30,000 ms, while cues
outside the range are excluded. Both mandatory foreign-language sidecars remain
present even when the preset carries the confirmed-English omission setting.
The gate verifies exact track IDs/versions, metadata/manifest policy and bounds,
observed H.264/AAC media, the six-file package, and recomputed byte size/SHA-256
for every promoted artifact including `manifest.json`. It also proves one
acquisition/render, six persisted final records, deleted source evidence, empty
source scratch, and replay without reacquisition. The aggregate gate passes 259
tests with one declared skip, the web build, 24 local and 19 cloud migrations,
plus four Playwright flows. The explicitly user-authorized live YouTube smoke
and final Milestone 5 matrix remain open; synthetic media is not live-provider
or acoustic-language proof.

M5-26 completed 2026-08-22. A dormant `export:live-smoke` command now wraps the
existing persisted one-shot processor and refuses provider access unless every
invocation supplies both explicit authorization flags, an external strict
rights-cleared descriptor, the configured yt-dlp provider, and working yt-dlp,
FFmpeg, and FFprobe tools. The descriptor binds one non-English original track
to one English derivative with exact versions, segment linkage, cue coverage,
and a one-to-thirty-second range; it admits no credentials, cookies, tokens, or
local paths. The command creates one private workspace, delegates once to the
existing executor, verifies real media, exact descriptor-derived SRT cues,
metadata/manifest provenance, every promoted byte hash, persisted terminal
state, and source-scratch absence, then deletes the entire workspace before
emitting only bounded sanitized evidence. Abort propagation and signal handling
await source/process cleanup, and the network-free suite covers direct-call
authorization, deep descriptor rejection, containment, real offline
verification, tamper detection, and interruption cleanup. After separate user
authorization, the installed yt-dlp was upgraded from `2025.04.30` to official
stable `2026.08.19`, and one exact 15-second live foreign-language export passed:
H.264/AAC at 852x480, six original plus six English cues clamped to 0–15,000 ms,
six hashed final artifacts, verified absent source scratch, and verified removed
temporary workspace. The external descriptor and caption inputs were deleted
after the run and no source identity, URL, transcript text, raw provider output,
or credential was retained. The aggregate implementation gate passes 268 tests
with one declared skip, the web build, 24 local and 19 cloud migrations, plus
four Playwright flows. Only the final recorded Milestone 5 matrix remains open.

M5-27 completed 2026-08-22 and closes Milestone 5. The final release matrix now
directly proves all three installed renderer profiles with real FFmpeg/FFprobe,
immutable queued settings after the originating project preset/default advances,
confirmed-English default SRT and explicit omission through the real one-shot
runtime, mandatory original-plus-English policy for foreign/mixed/unknown,
the exact 30-second foreign fixture, individual and batch replay/failure/cancel
behavior, same-source sibling isolation and last-release deletion, and cleanup
before every terminal claim. M5-23 batch execution evidence remains deliberately
compositional: a batch owns atomic creation, immutable membership, retry-leaf
association, and aggregate reads, while every child uses the single established
delivery/execution/result/cancel/source lifecycle. Three independent audits found
two missing direct tests and no product integrity defect; the new real
confirmed-English test and preset-v1-to-v2 queued-snapshot regression close both
gaps without production, contract, migration, or UI changes. In a clean detached
verification worktree containing exactly the final M5 code, `npm run check`
passed formatting, typecheck, 270 tests with one declared optional AWS skip, the
web build, 24 local migrations, and 19 cloud migrations; all four Playwright
flows and `git diff --check` also passed. The shared worktree's protected
pre-existing `docs/Script-to-Resolve Product Spec.md` formatting change remains
untouched and excluded from milestone commits. The known pre-M5-19 manual legacy
scratch recovery and M5-18 refusal to infer multi-attempt failure ownership
remain intentional fail-closed limitations. No unresolved Milestone 5 integrity
blocker remains, and this task stops before M6 Clip Library or M7 distribution.

M5-09 completed 2026-08-19. Every promoted clip package now also contains one
`manifest.json`, written into attempt-private staging and promoted through the
same copy-then-atomic-rename path, so it is never added to a visible package. It
records schema version 1, the export request/job identity, package identity and
source attempt, the request's video snapshot and source-language classification,
resolved export bounds, the verified rendered duration, the resolved
required-sidecar set plus `subtitleSidecarsOmittedReason` when a confirmed-English
omission applied, the captured FFprobe and FFmpeg versions, and for every other
promoted file its role, filename, byte size, and SHA-256 — with each SRT's
language, transcript track ID/version, snapshotted timing precision, cue count,
and clip-relative bounds. Every value comes from the immutable request snapshot,
already-persisted provenance, or the staged bytes it names; timestamps come from
persisted `validatedAt` provenance so a replay reproduces the same file. The MP4
is hashed before promotion and re-verified after it, and any manifest write
failure, policy mismatch, or promoted-byte mismatch aborts promotion, removes the
package, and continues into the established cleanup path. Local migration `0012`
rebuilds `export_final_artifacts` for the new `manifest_json` role and adds the
rendered FFmpeg version column. The descriptive `clip-<id>.json` metadata sidecar
and the `.jpg` thumbnail remain separate later slices.

M5-08 completed 2026-08-15. `npm run export:run-once -- --request-id <uuid> --authorization-confirmed` now opens the configured local SQLite data root, composes exactly one existing `LocalExportSourceProcessor` attempt with the configured full-source provider and real FFprobe/FFmpeg adapters, then prints only a sanitized request state, package identity, and artifact hashes/sizes. The command has no server, polling, concurrency, or background work; confirmation is required on every run, and an already-complete request is reported without rerendering. A deterministic repository-owned four-second fixture smoke copied the source only into attempt-private scratch and verified a completed foreign-language H.264/AAC package with both clip-relative SRTs, persisted final provenance, atomic package visibility, and verified scratch deletion. This proves local `export_only` runtime composition only: execution of delivered logged work, cloud result reconciliation, live authorized YouTube acquisition, retry/grouping, and the full Milestone 5 exit criteria remain separate.

### Milestone 6 — Project Clip Library and authoring handoff

Deliver:

- dedicated project-level Clip Library with search/filter and artifact availability
- Clip Library composition over Milestone 5's individual/batch export,
  immutable settings, progress, sibling isolation, retry, safe cancellation,
  and same-source grouping primitives; do not build a second executor
- completed package version history plus reveal/open, verify, and explicit
  re-export actions
- stable authorized clip search and exact artifact-resolution API for the
  separate scriptwriting product
- manifest/hash verification that distinguishes a completed record from
  reachable compatible bytes
- missing/relocated/invalid artifact states plus verified relink and durable
  re-export recovery
- request-origin provenance without separate direct-versus-script export engines

Exit when a researcher can select several logged clips across multiple source
videos, export them as one durable batch with independent recovery, and reuse the
verified packages from a simulated authoring client. A missing locator must
produce an explicit relink/re-export path, and duplicate direct or authoring
requests must not create duplicate renders.

Google Sheets is no longer this milestone's control surface. Keep CSV, and add
optional one-way Sheets catalog publishing only after core usage demonstrates a
collaboration need; two-way metadata sync remains a later evidence-driven
integration.

### Milestone 7 — Pilot distribution, independent QA, and operator documentation

Deliver:

- one explicitly supported pilot platform and a versioned release artifact with
  checksum/build identity and the platform's normal trust/signing requirements
- installation, update, rollback/recovery, and uninstall flows that do not
  require a source checkout, package manager, terminal, or cloud console
- automatic launch/supervision of the web client and loopback local agent, with
  bundled or guided acquisition of required runtimes/tools
- first-run sign-in and setup for projects, output/cache locations, provider
  choices, credentials, authorized-source acknowledgement, and a complete
  readiness check before real work begins
- operating-system credential storage or an equivalently protected secret
  boundary; never place credentials in documentation, logs, support bundles, or
  ordinary application data
- safe database migration and data-directory handling across update/reinstall,
  with explicit backup/recovery and preserve-versus-remove choices on uninstall
- understandable health, disk, permissions, network, provider, worker, and tool
  diagnostics plus a user-triggered redacted support bundle carrying build ID
  and bounded logs
- version-matched shareable documentation: system requirements, install/update/
  uninstall, quick start, the three selection actions, batch preparation, Clip
  Library use, provider/tool setup, storage/privacy/rights behavior,
  troubleshooting/recovery, known limitations, and issue reporting
- a release-candidate QA kit containing rights-cleared fixtures, dedicated test
  accounts/projects, an acceptance matrix, severity definitions, issue template,
  expected evidence, and reset instructions
- independent human QA of clean install, upgrade, first run, the core workflows,
  restart/resume, offline/provider/permission/disk failure recovery, artifact
  opening, diagnostics, and uninstall/reinstall; automated CI alone cannot close
  this milestone
- a triaged release report with all release-blocking defects fixed and lesser
  known issues documented

Exit when a nontechnical collaborator on the supported clean machine can use
only the release artifact and supplied documentation to install, sign in,
complete readiness checks, run the fixture-backed core workflow and one
authorized real-source workflow, restart/update without losing durable work,
find the completed artifacts, recover from one seeded failure, create a useful
redacted support bundle, and uninstall or preserve their data deliberately.
They must not need live developer coaching, a terminal, source code, package
manager, AWS console, or production secrets. A separate outsourced QA pass must
complete the published matrix; all critical/high defects are closed, and every
accepted lower-severity issue is recorded in the release notes or known-issues
guide.

The first pilot may support one operating system and one documented provider/
worker profile. App-store publication, unattended enterprise deployment,
multi-platform parity, 24/7 operations, public marketing documentation, and new
research features are separate work unless a bounded M7 slice explicitly adds
them.

### Milestone 8 — Research and capacity enhancements

Deliver in small vertical slices:

- bookmarks/timeline markers
- searchable segment notes
- advanced and cross-video search
- project organization
- optional AI analysis behind provider interfaces
- AWS Batch GPU worker deployment, autoscaling/cost controls, and notifications when sustained workload justifies hosted capacity

Add real-time presence/editing, rich conflict resolution, cloud clip storage, and broader collaboration only after shared transcripts, batch jobs, and the local review loop have stable usage evidence.

## 15. Definition of done for every implementation slice

A slice is done only when:

- behavior matches this guide or the guide is deliberately updated
- boundaries and failure states are represented in types/contracts
- local and cloud database changes have migrations
- shared reads/writes have project authorization tests
- durable jobs tolerate duplicate delivery, are idempotent/retryable, and have lease recovery
- published objects are checksummed, immutable, and invisible until catalog finalization
- temporary source media is isolated, deleted on every terminal path, and covered by crash-recovery cleanup
- every completed clip satisfies the snapshotted language-aware subtitle policy with transcript/timing provenance or a recorded confirmed-English omission
- every logged clip contains time-linked native and English text provenance and,
  only when required, a complete distinct preferred-language snapshot
- relevant unit/integration tests pass
- the critical UI state is manually verified
- errors are actionable and logs do not leak secrets
- user data/cache compatibility is considered
- documentation and `outline.md` status are updated
- the active spec has been moved to `specs/completed/` with its completion
  record, including decisions, checks/results, risks, and commit IDs

## 16. Known risks and mitigation

| Risk | Consequence | Mitigation |
|---|---|---|
| Public caption access is inconsistent | Existing transcript path fails | Adapter boundary, generated transcript fallback, cache raw responses |
| YouTube/player/platform changes | Load or seek behavior regresses | Isolate player/provider wrappers and maintain smoke tests |
| Source-media acquisition is blocked | Export cannot run | Keep queue useful independently; show authorization/remediation path |
| Temporary source media survives a crash or cleanup error | Storage, privacy, or rights exposure | Job-scoped scratch, explicit deletion state, finally-path cleanup, retries/alerts, and short-TTL sweeper/lifecycle backstop |
| Cue-only captions are imprecise | Word selection implies false accuracy | Track timing precision, use cue bounds, preview/adjust, later align on demand |
| Translation changes segment lengths | English/original selections drift | Link tracks by time rather than array index; preserve both tracks |
| Personal language changes fragment shared transcripts or overwrite logs | Duplicate translation cost, inconsistent collaboration data, or historical clip drift | Keep source-plus-English as the active base, store target-language derivatives separately, deduplicate by base/version/target, and snapshot optional preferred clip text immutably |
| A preferred language is unsupported or its provider is disabled | The user cannot review the requested translation | Preserve the setting, expose an actionable translation-unavailable state, keep native/English data intact, and never silently pivot through English or display a mislabeled track |
| Long videos exhaust memory | UI/worker instability | Stream files, virtualize UI, paginate APIs, bound job concurrency |
| Concurrent/duplicate transcription jobs | Wasted compute or competing versions | Unique idempotency keys, at-least-once-safe workers, transactional finalize, supersede/adopt policy |
| Cloud/API outage | Another workstation cannot fetch new work | Verified local cache, offline outbox, clear sync state, retry without regeneration |
| S3 object or permission misconfiguration | Transcript exposure or loss | Block public access, least privilege, encryption, versioning, authorization tests, backup/restore drills |
| Versioning/stale staging raises storage cost | Unexpected AWS bill | Compressed bundles, lifecycle rules, staging cleanup, usage/cost dashboards |
| Long job exceeds queue lease | Duplicate processing | Worker heartbeats/lease extension, checkpointed stages, idempotent outputs, DLQ |
| Hosted media acquisition is unavailable or disallowed | Cloud worker cannot transcribe | Keep execution-location adapter and authorized local-worker path; never upload media silently |
| Invalid or mutable conversion settings | Failed or irreproducible exports | Capability-aware validation, versioned presets, immutable resolved job snapshots, FFprobe assertions |
| FFmpeg cut/subtitle edge cases | Bad edit or subtitle sync | Re-encode for precision, inspect outputs, test time-shifting thoroughly |
| Clip subtitle is missing, uses full-source timing, or comes from the wrong transcript version | Foreign-language footage is unusable or misleading during editing | Require original plus English SRTs for foreign/uncertain language, snapshot language/transcript identity, restrict omission to confirmed English, clamp/zero-base cues, validate against media duration, and block finalization on mismatch |
| Artifact catalog says complete but bytes were moved, deleted, or corrupted | A direct or script build cannot reuse expected media | Separate identity from locators, verify manifests/hashes on resolution, support bounded root search and explicit relink, then request a new immutable export when needed |
| Authoring build moves or mutates a reusable research package | Other projects or prior builds lose their media | Keep research packages immutable; copy or copy-on-write clone into the authoring project and snapshot hashes |
| Optional Sheets projection and shared catalog diverge | Stale external metadata or confusing links | Keep Sheets subordinate and one-way initially; stable IDs, field ownership, versions, and explicit sync logs before any selective write-back |
| Local artifact links do not work remotely | External projections cannot open package bytes | Report locator availability honestly; add an authorized storage/download provider later rather than treating a local path as portable |
| Cache consumes excessive disk | Workstation fills | Size reporting, configurable root, LRU/manual cleanup with protected records |
| A pilot requires developer tools or undocumented setup | A nontechnical collaborator cannot begin or recover independently | One supported packaged release, first-run readiness checks, version-matched documentation, and an independent clean-machine acceptance gate |
| Outsourced QA receives secrets or personal media | Credential or rights exposure | Dedicated least-privilege test accounts/projects, rights-cleared fixtures, redacted support bundles, reset instructions, and no production credentials |
| An update or uninstall damages durable work | Lost projects, jobs, caches, or exports | Preflighted migrations, backup/recovery instructions, versioned release identity, tested update/rollback, and explicit preserve/remove choices |

## 17. Decisions intentionally left configurable

Resolve these during the relevant milestone with a small spike, not before:

- local speech-to-text engine versus remote provider default
- managed PostgreSQL deployment choice and development substitute
- identity provider/OIDC implementation and project invitation UX
- registered local worker versus AWS Batch as the default execution location
- hosted worker instance/model profiles and cost/priority policy
- forced-alignment provider for cue-only sources
- packaged desktop wrapper versus browser + local service
- exact editing bitrate/preset defaults
- whether real collaboration usage justifies one-way Sheets publishing or later
  selective notes/tags sync; export requests remain in the product/API
- cloud storage for exported clips; transcript bundles already use the object-store adapter with S3 as the AWS baseline
- fuzzy/semantic search engine

The provider interfaces, canonical transcript bundle/manifest, stable IDs, sync outbox, and shared job state should keep these choices replaceable.

## 18. Platform references

- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) — embedded playback and programmatic seek behavior.
- [YouTube caption download API](https://developers.google.com/youtube/v3/docs/captions/download) — official download requires permission to edit the video, so it is not the arbitrary-public-video transcript path.
- [yt-dlp subtitle options](https://github.com/yt-dlp/yt-dlp/blob/master/README.md#subtitle-options) — optional local subtitle discovery/acquisition adapter; availability can still vary by video, authentication, region, and platform changes.
- [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/tree/master/examples/cli) — maintained local multilingual speech-recognition executable and full JSON/timestamp output used behind the speech adapter.
- [W3C WebVTT specification](https://www.w3.org/TR/webvtt1/) — UTF-8 container, metadata blocks, cue timing/settings, cue text, and legal overlapping cue behavior used by the canonical caption parser.
- [Google Sheets values API](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update) — optional stable-ID catalog projection after the core workflow is reliable.
- [Amazon S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html) — preserves object versions instead of overwriting the only transcript copy.
- [Amazon S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — short-lived object-specific upload/download access without client AWS credentials.
- [Amazon SQS visibility timeouts](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) — leases, heartbeat extension, retry behavior, and dead-letter handling for long jobs.
- [AWS Batch GPU jobs](https://docs.aws.amazon.com/batch/latest/userguide/gpu-jobs.html) — optional hosted GPU capacity for containerized transcription workers.
