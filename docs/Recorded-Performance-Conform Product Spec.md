# Part 3 — Recorded Performance Ingest and Conform

Product and technical discovery outline — working draft

Status: discovery / scope. Prepared 20 August 2026.

Companion to [Script-to-Resolve Product Spec.md](./Script-to-Resolve%20Product%20Spec.md).

## 1. Product position

The software suite has three connected parts:

1. The research tool logs transcript-backed YouTube clips and creates reusable
   editing artifacts.
2. The authoring platform turns a structured two-column script into a DaVinci
   Resolve rough cut using temporary computer-generated narration, research
   clips, B-roll, stills, graphics, and a prompter export.
3. This phase ingests one or more long line-shoot recordings made from that
   prompter script, finds candidate performances for each spoken script range,
   lets the user approve the takes, and compiles a new Resolve timeline whose
   narration spine uses the approved camera/audio recordings instead of the
   temporary voice.

Part 3 is part of the authoring-to-Resolve product and uses its document,
artifact, build, and local-agent boundaries. It is a separate delivery phase
because media ingest, proxy generation, speech alignment, take review, audio
processing, color preparation, and duration-changing reconform create a second
substantial workflow.

## 2. Product promise

A user selects a frozen prompter/script revision and adds the authorized master
files from its shoot. The system prepares review media, transcribes and aligns
the performances to stable script ranges, presents all plausible takes beside
the relevant script text, and explains why a take was suggested or flagged.
The user approves one take, several acceptable alternates, a temporary-voice
fallback, or a pickup requirement for each range.

Clicking **Build recorded version** creates a new immutable build. It replaces
the temporary narration spine with approved presenter footage and production
audio, recomputes every text-anchored visual boundary from the chosen
performance, and reflows script-managed B-roll, stills, graphics, music, and
markers. It never silently overwrites the only generated or manually edited
Resolve timeline.

The result can approach a finished program when the shoot and processing
profiles are consistent, but the product must describe it as a
**final-candidate conform** until picture, audio, color, graphics, rights, and
delivery checks pass.

## 3. Foundational decisions

### 3.1 Timestamps are audit data, not change identity

Every script edit must have a UTC timestamp, but a timestamp alone cannot tell
**Update video** what changed. Two edits can share a timestamp, clocks can
disagree, and a changed paragraph does not reveal which downstream artifacts
depend on the changed words.

Use all of the following:

- stable document, narration-block, token/range, visual-event, and asset IDs;
- immutable, monotonically ordered document revisions;
- `createdAt`, `updatedAt`, actor, and operation timestamps for audit/history;
- an append-only edit operation or equivalent revision delta;
- normalized content hashes for narration and dependency inputs; and
- an immutable build snapshot that names the exact revision and dependency
  versions it compiled.

Illustrative audit record:

```text
ScriptEditOperation {
  id, documentId, actorId, occurredAtUtc,
  baseRevision, resultingRevision,
  operationType, affectedBlockIds,
  patchHash, clientOperationId
}
```

The incremental compiler compares build snapshots and dependency hashes. The
operation log explains how the document arrived there; it is not the sole
rebuild algorithm.

### 3.2 Match and approve semantic performance beats

A narration paragraph is a writing unit, not necessarily a recording or edit
unit. Part 3 introduces a `PerformanceBeat`: a stable text-anchor range that is
useful to perform, review, replace, and pick up. A beat may be a sentence,
several sentences, or a deliberate phrase inside a paragraph. Creating beats
must not split or visibly pollute the authoring prose.

The prompter export freezes:

- its source document revision;
- the ordered performance-beat IDs and exact expected text;
- OC/VO state and any non-spoken navigation cues;
- pronunciation/performance notes included by policy; and
- an export hash and creation timestamp.

The visible prompter text remains natural. A machine-readable sidecar carries
the beat map; optional visible beat numbers may be enabled for slate/pickup
workflows.

### 3.3 Human approval remains authoritative

Speech matching can determine that a recording likely covers a script range.
Automated checks can detect objective problems such as missing words, clipping,
long interruptions, severe noise, or focus loss. They cannot reliably decide
comic timing, warmth, emphasis, eye line, facial expression, or which
intentional ad-lib is best.

AI output is therefore a ranked, explainable suggestion. Only a user's explicit
approval creates the active `TakeAssignment`. Reprocessing with a new model or
profile may create new suggestions but never changes an approved assignment.

### 3.4 Recorded speech becomes the new timing spine

Temporary narration establishes the draft timing. Once a recorded take is
approved, the chosen performance and its verified word alignment establish the
timing for that beat. Text-anchored events move with the corresponding words;
they are not proportionally stretched against the old synthetic clip.

### 3.5 Originals and decisions are immutable

Master media, generated proxies, extracted/processed audio, transcripts,
alignment results, analysis results, approvals, processing profiles, and
conform builds are separately versioned. Derived work never replaces the only
master or the artifact used by an earlier build.

## 4. Primary workflow

1. Freeze or select the exact prompter/script revision used during the shoot.
2. Create a named `ShootSession` and choose a processing profile.
3. Add authorized camera masters and, optionally, separately recorded audio.
4. Hash and inspect every source before accepting it. Record timecode, start
   time, duration, streams, codecs, frame rate, resolution, orientation, color
   metadata, audio layout, and source filename as provenance rather than
   identity.
5. Generate review proxies and waveform/audio derivatives when the configured
   thresholds require them. Preserve a verified proxy-to-master mapping.
6. Synchronize dual-system audio or multiple cameras when present. Surface
   uncertain sync for review.
7. Transcribe the production audio with word timing and confidence where the
   provider can supply it.
8. Align the transcript to the frozen performance-beat map. Detect repeated
   reads, restarts, partial takes, ad-libs, pickups, and uncovered script spans.
9. Run optional, profile-selected audio/video quality analysis and create
   explainable candidate scores and warnings.
10. Show candidate takes from the script editor. The user previews, compares,
    approves, rejects, locks, or marks a beat `needs pickup`.
11. Preview the duration and downstream edit impact against the last build.
12. Freeze a `RecordedConformSnapshot` containing every assignment and
    processing choice.
13. Build a new Resolve timeline from masters or master-linked media, replace
    temporary narration, and recompile all managed visual/audio events against
    the recorded word timings.
14. Verify the timeline against the manifest, then optionally render a review
    MP4. A later finishing gate may promote it to a final-candidate artifact.

## 5. Ingest, proxy, and media lifecycle

### 5.1 Source registration

Local master files remain authoritative media unless the user explicitly opts
into managed storage. Register each file by content hash plus inspected stream
metadata. Detect a moved file through its hash and allow relinking without
creating a new source identity.

Do not upload raw shoot media to a hosted transcription, vision, or enhancement
provider without a per-project policy that names the provider, transmitted
content, retention assumptions, and cost implications.

### 5.2 Proxy policy

Proxy generation is adjustable by project, shoot, camera, and source. A
practical initial profile should support:

- `never`, `automatic above threshold`, and `always`;
- maximum review resolution and bitrate;
- proxy codec/container supported by the workstation and browser;
- audio inclusion policy;
- local cache location and space requirement;
- immutable proxy hash and generator/tool version; and
- verified duration/time-base correspondence with the master.

The browser reviews proxies, but conform source in/out values remain in master
source time. Before final render, the bridge verifies that every proxy-backed
edit relinks to the expected master hash.

### 5.3 Multiple files and recording discontinuities

A shoot may span camera cards, files, audio recorders, breaks, and settings
changes. Model sources independently inside one session. Do not assume filename
order, identical timecode, a single camera, or one continuous recording.

## 6. Transcript alignment and candidate generation

### 6.1 Provider boundaries

Keep replaceable contracts for:

```text
ShootTranscriptionProvider
ScriptAlignmentProvider
TakeBoundaryDetector
AudioQualityAnalyzer
VideoQualityAnalyzer
AudioEnhancementProvider
ColorPreparationProvider
```

One implementation may satisfy several contracts, but stored results use
provider-neutral schemas and record provider/model/profile versions.

### 6.2 Matching behavior

The matcher compares the shoot transcript to expected performance beats while
allowing bounded insertions, deletions, paraphrases, restarts, and repetition.
It returns candidate source ranges with handles, a word-to-token alignment,
coverage metrics, transcript differences, timing precision, and ambiguity.

It must not:

- force every spoken passage onto a script beat;
- treat an approximate semantic match as an exact word alignment;
- hide an uncovered or multiply ambiguous beat;
- split a word or phoneme simply to make a boundary fit; or
- discard off-script material that may be useful for review.

Candidate boundaries should prefer natural silence/breath/edit points around a
complete read. Handles are retained for later trims and transitions.

### 6.3 Explainable ranking

Keep the score as separate evidence, not one mysterious number:

- script coverage and omitted/substituted/added words;
- alignment confidence and boundary confidence;
- complete read versus restart/partial read;
- audio clipping, noise, echo, plosives, dropouts, and interruption warnings;
- visual focus/exposure/occlusion/eye-line warnings when enabled;
- duration, pace, and pause outliers relative to the other takes; and
- user flags, slate metadata, or camera good-take metadata when present.

Performance quality remains unscored or explicitly labeled experimental until
validated against the user's own approvals. Store the component evidence so a
user can understand and override every suggestion.

### 6.4 Resolve IntelliScript discovery path

DaVinci Resolve Studio 20's IntelliScript is a strong first capability spike:
it transcribes selected clips, matches dialogue to a plain-text script, lays a
preferred result on track 1, and places alternative takes on disabled tracks.
Blackmagic documents that its preferred-take choice is based only on dialogue
matching, not good-take metadata or broader performance judgment.

Evaluate whether its results and metadata can be read or correlated through
supported Resolve interfaces. Even if IntelliScript performs initial assembly,
the suite still needs its own script-revision identity, beat mapping, review and
approval records, stale-state behavior, processing profiles, dependency diff,
and B-roll reconform. If supported automation cannot expose enough structured
evidence, keep it as an optional operator-assisted path and implement matching
behind the provider interfaces above.

## 7. Take review in the script editor

Each performance beat or selected left-column range shows a compact state:

- no source found;
- analyzing;
- candidates available, with count;
- approved;
- approved with alternates;
- temporary voice fallback;
- needs pickup;
- ambiguous;
- stale after script or source change; or
- failed with an actionable reason.

Selecting the badge opens a takes drawer rather than turning the document into
a full editor. The drawer provides:

- proxy playback with master timecode and candidate handles;
- rapid sequential playback of every candidate for that beat;
- A/B comparison and keyboard approval/rejection;
- expected script beside the recognized words and highlighted differences;
- objective score components and warnings;
- waveform, audio meters, and optional focus/exposure indicators;
- trim handles that cannot escape the registered master range;
- selection of one active take plus zero or more approved alternates; and
- `Use temp voice`, `Needs pickup`, and `No spoken line` outcomes where valid.

The document must also support **Play approved performance**, which previews
the selected takes in script order using proxies and makes gaps or abrupt joins
obvious before a Resolve build.

Approval writes a versioned `TakeAssignment`. Candidate generation and manual
trimming never mutate the script text or the source media.

## 8. Replacing temporary narration and reflowing the edit

### 8.1 Conform rules

For every performance beat, the compiler chooses exactly one allowed timing
source:

- approved recorded take;
- explicitly locked temporary narration;
- explicit silence/non-spoken duration; or
- a blocking `needs pickup`/unresolved state.

The build diff reports old duration, new duration, cumulative timeline shift,
changed assignments, events moved, events whose source media became too short,
and manual/protected regions needing reconciliation.

### 8.2 Visual duration policies

Every visual event must declare how it behaves when narration duration changes:

| Policy                         | Rebuild behavior                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `follow_text_anchors`          | Recompute record in/out from aligned words; use available source handles without changing semantic anchors. |
| `stretchable_still_or_graphic` | Recompute duration and stretch only the explicitly stretchable still/template hold.                         |
| `fixed_source_excerpt`         | Preserve source in/out and report a coverage gap/overlap if the new narration no longer fits.               |
| `clip_led`                     | Keep the clip's duration as the local timing spine according to the existing authoring policy.              |
| `protected_manual_timing`      | Do not move automatically; require reconciliation when upstream timing changes.                             |

Ordinary video B-roll is trimmed or extended only within verified handles. It is
not speed-changed, looped, frozen, or generatively extended unless the user
chooses a separate explicit policy. Still images and template hold sections may
be duration-adjusted when their definition permits it.

### 8.3 Resolve output safety

The first recorded conform and every materially changed conform create a new
generated timeline or branch. Preserve the temp-voice build and prior recorded
conforms. Put stable script, beat, take-assignment, visual-event, and build IDs
in marker custom data or the nearest supported metadata surface.

Manual Resolve work is handled by the authoring platform's existing
reconciliation policy. Part 3 does not gain permission to overwrite an editor's
only refined timeline merely because take assignments changed.

## 9. Audio processing

### 9.1 Pipeline

Always keep synchronized production audio and processed dialogue as separate
immutable artifacts. A profile may select:

1. source/channel choice and dual-system sync;
2. channel mapping and mono/stereo correction;
3. optional denoise, de-reverb, de-plosive, de-ess, hum removal, or voice
   isolation;
4. EQ or dialogue/room matching;
5. gain staging and dialogue leveling;
6. loudness normalization for the chosen review/delivery target; and
7. sample-rate/channel output policy.

Every processor records settings, provider/model/tool version, input/output
hashes, latency or timing offset, and measured output properties. Verify that
processing does not shift synchronization.

### 9.2 Provider strategy

DaVinci Resolve Studio 20 provides relevant optional tools including Voice
Isolation, Dialog Leveler, Dialogue Matcher, EQ Matcher, and AI Audio Assistant.
These should be tested as a non-destructive Resolve finishing adapter, not
assumed to be fully automatable through the scripting API.

Adobe Podcast Enhance Speech remains a useful manual/provider candidate, but
the public browser workflow uploads files and has plan/file limits. Do not
automate the website or make it a required dependency without an official,
authorized integration boundary. Support manual import of a processed result
as a versioned artifact, and compare at least one local/offline processing path
before choosing a default.

Audio enhancement is reviewable and adjustable per video. `More processed` is
not automatically `better`; the UI must make bypass and A/B comparison easy.

## 10. Color preparation

Color processing is a versioned, non-destructive preparation profile, not an
irreversible proxy bake. Capture or infer only metadata that can be verified:
camera/profile, color space/gamma, data levels, white-balance/exposure notes,
input transform or LUT, timeline color management, and output transform.

Allow defaults at project, shoot, camera, and source level, with more-specific
overrides winning. A first release may apply one reviewed transform/profile per
camera and flag shot outliers. Automatic shot matching, skin-tone analysis, and
creative grading are later assisted capabilities that require human review.

Final conform must use masters and reproduce the approved transform in Resolve.
Never treat the look baked into a lightweight review proxy as source truth.

## 11. Canonical records

```text
ShootSession {
  id, authoringProjectId, documentRevision, prompterExportId,
  name, shootDate, processingProfileVersion, status, createdAt
}

ShootSource {
  id, shootSessionId, mediaHash, originalPathLocator,
  inspectedStreams, sourceTimecode, cameraId, colorMetadata,
  authorization, relinkState, status
}

PerformanceBeat {
  id, documentId, anchorRange, expectedTextHash,
  prompterOrder, hostVisibility, version
}

ShootTranscript {
  id, shootSourceIds, provider, model, language,
  timingPrecision, transcriptHash, wordTimings, version
}

TakeCandidate {
  id, performanceBeatId, sourceId, sourceInMs, sourceOutMs,
  handleInMs, handleOutMs, alignmentVersion,
  transcriptDiff, evidenceComponents, warnings, status
}

TakeAssignment {
  id, performanceBeatId, candidateId?, outcome,
  approvedAlternates, manualBounds, actorId,
  createdAt, version, locked
}

ProcessingProfileVersion {
  id, parentScope, proxy, transcription, alignment,
  audio, videoAnalysis, color, toolVersions, createdAt
}

RecordedConformSnapshot {
  id, buildId, documentRevision, prompterExportId,
  shootSessionVersions, takeAssignmentVersions,
  processingProfileVersions, visualEventVersions,
  timelineSettings, manifestHash, createdAt
}
```

## 12. Script changes after a shoot

Incremental behavior must be explicit:

- An unchanged beat with the same expected-text hash retains its approved take.
- A punctuation-only or formatting edit may retain an assignment when the
  normalized spoken-text hash is unchanged.
- A wording change marks the affected match and assignment stale. It may be
  rematched to existing media, but the old approval is not silently transferred.
- A new spoken beat created after the shoot is `needs recording` by default; a
  user may explicitly permit temporary narration in that build.
- Deleting a beat removes it from the next conform but preserves prior builds
  and approval history.
- Splitting or merging beats proposes a mapping and requires confirmation.
- Moving an unchanged beat changes program order but not its source identity;
  the next build reports the move and recomputes downstream timing.
- Changing only a visual event reuses the narration take and rebuilds the
  affected visual dependency.

## 13. Durable job states and failure behavior

Suggested ingest/analyze states:

```text
queued -> registering -> probing -> proxying -> synchronizing_audio
       -> transcribing -> aligning -> analyzing -> ready_for_review
       -> waiting_for_source | needs_sync_review | failed | canceled
```

Suggested conform states:

```text
queued -> validating -> preparing_audio -> compiling -> building_timeline
       -> verifying_timeline -> rendering_review -> verifying_review -> complete
       -> needs_take_review | needs_media | needs_relink | needs_reconciliation
       -> failed | canceled
```

Long work is persisted, observable, retryable, restart-safe, and idempotent.
Verified proxies, transcripts, alignments, and processed audio are reused when
their full input/profile hashes match.

Important failure behavior:

- A missing or moved master blocks conform/final render but need not block proxy
  take review if a verified proxy exists.
- A proxy failure falls back to master review only when the file is safe and
  practical to stream locally.
- Unsupported or variable-frame-rate media receives an explicit normalization
  or transcode decision; timing is never guessed.
- Ambiguous script alignment presents all plausible ranges and requires review.
- No matching take creates `needs pickup` or an explicit temp-voice fallback.
- Audio enhancement failure retains clean synchronized source audio and allows
  bypass/retry; it does not invalidate take approval.
- Color metadata uncertainty uses a visible unverified transform state rather
  than silently applying a camera LUT.
- Insufficient B-roll handles create a reconciliation issue, not a hidden speed
  change or repeated frame.

## 14. MVP and deferred scope

### 14.1 First usable Part 3 release

- One frozen script/prompter revision and one named shoot session.
- Multiple long camera files from one camera, plus optional separate audio.
- Hash/probe registration, deterministic proxies, waveform/audio extraction,
  and reliable relink to masters.
- English transcription, repeated-take segmentation, script-beat alignment,
  and explainable text/audio evidence.
- Script-integrated take drawer with sequential preview, approve/reject,
  alternate, trim, temp-voice fallback, and needs-pickup outcomes.
- One versioned processing profile with project defaults and per-shoot/source
  overrides.
- New recorded conform timeline that replaces temp narration and recompiles
  text-anchored visuals with impact reporting.
- Basic reviewed audio cleanup/leveling path and one reviewed color-input
  transform per camera/source.
- Master relink verification and a review-render gate.

### 14.2 Deferred

- Fully autonomous keeper selection or performance-direction judgment.
- Multi-camera automatic switching, though the model must not preclude it.
- Automated creative grade, beauty work, reframing, background replacement, or
  generative repair.
- Automatic web automation of Adobe Podcast or any provider without a supported
  API and explicit authorization.
- Remote upload of all master footage by default.
- Overwriting manually refined Resolve timelines.
- Claiming a delivery master without human finishing/QC.

## 15. Delivery milestones

### P3-0 — Capability and corpus spike

- Build a small licensed fixture with a frozen script, several repeated reads,
  one intentional ad-lib, one flub, one partial take, and one missing line.
- Evaluate Resolve Studio 20 IntelliScript output, alternative-take layout,
  accessible metadata, and scripting limitations on the actual workstation.
- Compare at least one independent transcription/alignment route using the same
  fixture.
- Test whether Resolve audio tools can be applied and verified through supported
  automation; record which steps are operator-assisted.

Gate: choose a provider strategy based on measured alignment, inspectability,
automation, privacy, speed, and cost—not feature names.

### P3-1 — Source ingest and review derivatives

- Shoot sessions, master registration/relink, media inspection, proxy profiles,
  audio extraction/sync, checksums, resumable jobs, and cache management.

Gate: a multi-file shoot survives restart, reviews smoothly from proxies, and
relinks every reviewed source range to the expected master hash/time.

### P3-2 — Script alignment and candidate takes

- Performance-beat sidecar, word-timed transcript, repeated-read segmentation,
  candidate boundaries/handles, transcript differences, and explainable
  evidence components.

Gate: fixture candidates cover all actual reads, expose the intentional
ad-lib/flub/partial/missing line honestly, and never invent an exact match.

### P3-3 — Script-integrated take review

- Beat status, take drawer, rapid sequential/A-B review, approvals, alternates,
  manual trims, locks, pickup/temp outcomes, and approved-performance preview.

Gate: a user can select the intended take for every fixture beat without
opening Resolve, and those decisions survive reload and reanalysis.

### P3-4 — Recorded narration conform

- Immutable conform snapshot, impact preview, recorded A-roll/audio placement,
  temp-voice replacement, word-anchor recompilation, visual duration policies,
  new-timeline build, and manifest verification.

Gate: changing from temp narration to takes of different lengths moves each
managed B-roll boundary to the correct spoken word, flags insufficient handles,
preserves prior timelines, and matches the frame manifest.

### P3-5 — Adjustable audio and color preparation

- Versioned profiles, bypass/A-B, processed-audio provenance and sync checks,
  Resolve/local provider adapters, camera/source color transforms, outlier
  flags, and master-linked final-candidate render.

Gate: two intentionally different shoot profiles produce independently
reviewable, reproducible processing without modifying their masters or proxy
identity.

## 16. First vertical proof

Use a three-minute script section with five performance beats, one 15–30 minute
camera master containing two or three reads per beat, one flub, and one omitted
beat. Begin from an existing temp-voice timeline with at least three visual
events anchored inside spoken ranges.

The proof must:

1. freeze the prompter revision and machine-readable beat sidecar;
2. register/hash/probe the master and create one browser-friendly proxy;
3. transcribe and propose takes for all five beats;
4. let the user approve four beats and mark one `needs pickup` or temp fallback;
5. preview the old/new duration and moved visual boundaries;
6. build a new Resolve timeline with the four approved recorded takes;
7. recompile each visual event from real word timings;
8. verify proxy source ranges map to the correct master frames;
9. preserve the temp-voice timeline and previous build snapshot; and
10. render a review artifact with an audit report of every reuse, replacement,
    shift, warning, and unresolved item.

Do not include autonomous acting-quality selection, multi-camera switching,
cloud master upload, or automatic final delivery in this first proof.

## 17. Critical tests

- Timestamped edit operations remain ordered and idempotent, while snapshot
  diffing—not wall-clock comparison—selects rebuild dependencies.
- Unchanged spoken-text hashes retain approvals; wording changes make them
  stale; formatting-only changes do not.
- Proxy duration/time base and candidate ranges map exactly to master time.
- Repeated reads produce distinct candidates and partial takes are not scored
  as complete.
- Insertions, omissions, paraphrases, and ad-libs remain visible in transcript
  differences.
- Reanalysis cannot replace or unlock an approved take.
- Manual trims remain inside source bounds and retain configured handles.
- Recorded word timing moves text-anchored visual events to the intended words.
- Fixed/protected events create reconciliation issues when narration shifts.
- Ordinary B-roll is never silently stretched, looped, frozen, or speed-changed.
- Audio processing is time-aligned, bypassable, reproducible, and never mutates
  the source.
- Conform uses expected master hashes and blocks on wrong/missing relinks.
- A new conform never overwrites the only prior or manually edited timeline.
- Job retry reuses verified intermediates and creates no duplicate approvals,
  candidates, timelines, or artifacts.

## 18. Questions to resolve during discovery

- What exact material is the first target: on-camera presenter footage, off-
  camera voiceover recording, or both in one shoot?
- Does a normal shoot use one continuous camera, multiple cameras, separate
  audio, or a mixture?
- How are takes separated today: full-script runs, line-by-line repeats, slates,
  button presses, or natural pauses?
- What makes a take a keeper for this presenter beyond correct words?
- Should one active take be chosen per performance beat, or may the final edit
  combine phrases from multiple takes inside a beat?
- How much pre/post-roll is normally needed for breaths, jump-cut smoothing,
  and B-roll coverage?
- Which script edits after the shoot may intentionally keep an older take?
- Which visual events may stretch, which must preserve source duration, and
  which should block the build when narration timing changes?
- Is DaVinci Resolve Studio 20.3 available on every target workstation?
- Which codecs, frame rates, resolutions, camera log profiles, and audio channel
  layouts appear in actual shoots?
- Is master media local-only, on shared storage, or expected to move between
  workstations?
- Which enhancement is the current quality reference, and how much processing
  is acceptable before the voice sounds artificial?
- Is a reviewed Resolve timeline sufficient, or must Part 3 also create a
  delivery candidate with loudness, color, caption, and rights gates?

## 19. Current platform notes

- Blackmagic's DaVinci Resolve 20 New Features Guide documents Studio-only
  IntelliScript, including dialogue/script matching, preferred and alternative
  take tracks, and its dialogue-only limitation:
  <https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf>
- The same guide documents Voice Isolation, Dialog Leveler, Dialogue Matcher,
  EQ Matcher, and Studio-only AI Audio Assistant. Availability through the
  supported scripting API still requires a workstation capability spike.
- Adobe documents Enhance Speech as an upload/process/download browser workflow
  with video/bulk support and plan/file limits. Treat it as optional and
  replaceable rather than architectural infrastructure:
  <https://podcast.adobe.com/en/guides/enhance-speech-for-video>
