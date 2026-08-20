# Script-to-Resolve Authoring Platform

Product and technical specification — working draft

Working title: Assembly. Status: discovery / scope. Prepared 13 August 2026;
updated 20 August 2026.

## 1. Executive summary

Build a web-based authoring system that feels as familiar as the current two-column Google Docs workflow, but stores enough structured information to compile a written script into a rough-cut DaVinci Resolve project. A script can begin as a per-script nested outline of research topics, questions, and ideas before any draft prose exists. As writing develops, the writer can promote those ideas into the active draft and move promising but currently unused script material into a separate **Extras** area instead of deleting it. The output should include generated voiceover, research clips, B-roll, stills, and versioned Fusion graphics placed at intentional points on a timeline. The document must also state whether the host is on camera or speaking in voiceover at every point, and every off-camera span must identify what the audience sees. The authored script remains readable by a human; the machine-readable behavior lives beneath visible blocks and cards rather than in fragile formatting conventions. A later recorded-performance phase can ingest long prompter line shoots, align repeated takes to stable script ranges, collect explicit keeper approvals, and compile a new timeline that replaces temporary narration while reflowing text-anchored visuals to the real performance.

The product should be a compiler, not a replacement nonlinear editor. The authoring project is the source of truth. A DaVinci Resolve project or timeline is a generated, inspectable deliverable that an editor can refine. Rebuilding should be deterministic, incremental where practical, and must never erase manual editorial work without an explicit reconciliation step.

Recommended first release: author narration plus structured visual cues, synthesize replaceable temporary narration at the narration-block level, resolve already-logged research clips from the existing clip project, use still-image placeholders for unresolved visuals, and generate one new Resolve timeline through a local bridge. A background draft-build action can also render a review MP4 and optionally upload the verified file to Google Drive. Defer automatic visual search/generation and a broad Fusion template library until the core script-to-timeline contract is proven.

### 1.1 Suite phases

1. The research tool logs transcript-backed source clips and prepares reusable
   editing artifacts.
2. This authoring platform compiles a structured script into a temp-narrated
   Resolve rough cut and exports the frozen prompter script used for a shoot.
3. The recorded-performance phase ingests the resulting long line-shoot media,
   presents matched takes beside the script, records keeper approvals, and
   creates a new recorded conform with B-roll retimed from verified word
   alignment. Its discovery outline is maintained in
   [Recorded-Performance-Conform Product Spec.md](./Recorded-Performance-Conform%20Product%20Spec.md).

Part 3 shares this product's document, artifact, build, and Resolve contracts,
but is intentionally a separate phase of work rather than an implied feature of
the narration-led MVP.

## 2. Product promise

A writer can collect and hierarchically organize research ideas before drafting, author a normal-looking two-column script, park unused passages without throwing them away, assign or request media beside each active passage, and click **Edit video** to receive a DaVinci Resolve timeline whose timing, media, graphics, and provenance can be understood and revised. **Update video** incrementally rebuilds from a later script revision. The same action can optionally render and upload a shareable review MP4, allowing the writer to leave the page and return to a completed artifact or an actionable failure. The narration remains the writer's primary surface: camera-state and visual events can begin or end inside a paragraph without forcing the writer to split that paragraph into edit-sized rows.

## 3. What the example script teaches us

The “OEV25 Finland” document is a useful real-world specimen. It is not simply a narration column and a link column. It mixes polished script, performance directions, section breaks, quoted clips, source URLs, time ranges, silent footage, still-image requests, named graphics, research citations, saved assets, alternates, and a long notes/drafts tail. The interface must support that messiness without forcing the writer to think like a database administrator.

- The left column usually holds narration, on-camera direction, jokes, pauses, pronunciations, and section structure.
- The right column may hold a clip, still, graphic, citation, URL, transcript excerpt, time range, instruction such as “clip with no audio,” or merely an unresolved idea.
- Some rows are left-only, right-only, or intentionally blank on one side.
- **One narration paragraph may continue across several picture cuts. Paragraph boundaries express writing structure, not edit boundaries.**
- **Host visibility is a continuous state independent of paragraph and row boundaries: on camera (OC) or off camera/voiceover (VO).**
- **When the host is off camera, visual coverage is required. The script must identify the clip, still, graphic, screen capture, or explicit unresolved placeholder visible for the entire VO span.**
- A clip reference may include a title, YouTube URL, in/out points, translated or quoted dialogue, desired audio policy, and commentary about the moment.
- Draft notes and abandoned material coexist with the active script. Build eligibility therefore cannot be inferred from document position alone.
- Early research often begins as topics, questions, and fragments with parent/child relationships rather than finished prose. That planning structure should remain useful before and during drafting without becoming accidental narration.
- Material removed from the current draft is not necessarily rejected. Writers need a deliberate holding area that preserves the full script fragment and makes restoration easy without relying on undo or revision-history archaeology.
- The script is optimized for humans collaborating on meaning. Machine semantics should appear progressively through cards, status, and an inspector—not through visible JSON, tags, or syntax.

## 4. Product principles

1. Human-readable first. A printed or exported script should still make sense without the application.
1. **Narration-first authoring. Paragraphs follow the flow of spoken language; camera changes and visual cuts attach to text ranges rather than dictating paragraph or row breaks.**
1. Structure beneath the surface. Every build-relevant row and asset has a stable ID and typed data even when it renders as ordinary text.
1. Active scope is explicit. The idea outline and Extras travel with the script but never enter narration, validation, prompter exports, duration estimates, voice generation, or video builds until the writer explicitly promotes or restores their content into the active draft.
1. The script is canonical; Resolve is compiled output. Editorial refinements can be preserved, but the Resolve timeline is not the only copy of authoring intent.
1. References before files. Reuse clip IDs, transcript versions, and asset identities. Do not duplicate downloads or silently create disconnected media.
1. Immutable builds. Each build snapshots the script revision, media versions, voice model, template versions, settings, and tool versions.
1. Honest incompleteness. Missing assets create visible placeholders or blocking issues; they do not disappear or receive invented substitutions.
1. Local media authority. Filesystem access, YouTube acquisition, FFmpeg, voice rendering, and Resolve automation run through a trusted local agent unless the user opts into a hosted provider.
1. Replaceable providers. Voice, image generation, stock search, media acquisition, and Resolve integration stay behind narrow adapters.

## 5. Scope

### 5.1 MVP

- Create/open an authoring project with timeline settings, a script, and a local output workspace.
- Create a script with no active draft yet and capture topics, questions, research leads, and writing tasks in a per-script outline with multi-level nesting, drag/reorder, indent/outdent, and open/incorporated state.
- Promote an outline item into the active draft at a chosen location while retaining its planning identity and marking/linking it as incorporated rather than silently deleting it.
- Move selected prose, complete rows, or structured script fragments from the active draft into a per-script **Extras** area; preserve rich text, typed cards, citations, and references, exclude the material from every build surface, and allow it to be restored at a chosen draft location.
- Edit a two-column document with section rows, narration rows, production-only rows, and media/graphic cards.
- **Mark narration ranges as on camera or voiceover without splitting the underlying paragraph; render on-camera words in a restrained semibold weight and voiceover words in normal weight.**
- **Attach multiple visual events to exact word ranges within one narration paragraph and reveal the relationship in both directions: hovering/selecting a visual highlights its covered words, and selecting words reveals covering visuals.**
- **Require complete visual coverage for VO spans, allowing an explicit unresolved placeholder while a shot is still undecided.**
- Accept common visual inputs as typed cards, including a logged research clip, a webpage URL, and a direct image URL/file. Resolve each into a verified immutable media artifact before timeline placement.
- Configure optional transition defaults independently for presenter→B-roll, B-roll→presenter, and B-roll→B-roll boundaries, with per-event overrides and an `Apply to everything` shortcut.
- **Export a narration-only plain-text prompter script with (OC) and (VO) inserted at every host-visibility transition.**
- Import a legacy two-column Google Doc into a review queue using heuristics; require confirmation of inferred row types and links.
- Insert clips already logged by the Research Video Transcript & Clip Extraction Tool and display their transcript text as the readable representation.
- Before each build, resolve every research clip to an exact verified compatible
  package; reuse reachable packages, offer verified relink for relocated media,
  and request durable re-export for missing or incompatible packages.
- Materialize research media into a persistent authoring-project media folder by
  copy or filesystem-supported copy-on-write clone by default. Never move or
  mutate the canonical research package.
- Accept direct media files and manually entered URL/time-range references, while clearly distinguishing resolved from unresolved assets.
- Generate computer voiceover for narration blocks with pronunciation and performance controls.
- Generate and cache replaceable temporary speech clips per narration block when a draft build is requested; unchanged blocks reuse verified audio.
- Place video clips, audio, stills, and explicit placeholders onto predictable Resolve tracks.
- Instantiate a small starter set of versioned graphics templates: lower third, quote, full-screen text, image-with-caption, and simple two-series chart.
- Build a new rough-cut Resolve timeline and a build report; rerun safely against changed script blocks.
- Optionally render a review-quality MP4 after timeline verification and upload the finalized file to a user-selected Google Drive folder.
- Run build, render, and upload as a durable background job that survives a closed browser tab, reports progress, and supports safe retry.

### 5.2 Not MVP

- A complete browser-based nonlinear editor, color suite, audio mixer, compositing environment, or final delivery system.
- Fully autonomous research, fact checking, rights clearance, or editorial judgment.
- Arbitrary natural-language interpretation of every legacy production note without human confirmation.
- A large Fusion design system; template design and QA is a parallel workstream with its own acceptance process.
- Real-time multiplayer editing, comments parity with Google Docs, mobile authoring, or perfect bidirectional Google Docs synchronization.
- Automatic modification of a manually refined Resolve timeline without a diff, branch, or explicit overwrite choice.

## 6. Authoring experience

### 6.1 Main document

The default view should look intentionally close to Google Docs: a white page, Arial typography, familiar text controls, page-like margins, section navigation, undo/redo, and unobtrusive status. The central content is a two-column grid with no spreadsheet chrome. Rows expand naturally and can contain ordinary paragraphs or structured cards. The left column is visually primary. On-camera text uses a subtle semibold treatment (target CSS font-weight 600; bold only as a fallback), while voiceover text stays normal weight. A small state control, accessible label, and inspector value accompany the styling so camera state is never communicated by weight alone.

| Left: spoken / performed                                    | Right: shown / heard / built                           |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Narration with inline OC/VO spans; OC words appear semibold | One or more visual cards anchored to exact word ranges |
| Stage direction or performance note                         | B-roll, still image, screen capture, or source link    |
| Section heading or beat                                     | Graphic template plus structured data                  |
| Blank                                                       | Production-only cue, music, transition, or clip        |
| Scratch / excluded draft                                    | Optional reference notes and unused alternatives       |

### 6.2 Idea outline and Extras

Each script has three explicit content surfaces: **Ideas**, **Draft**, and **Extras**. The Draft remains the primary page and the only build-eligible surface. Ideas and Extras are available from a collapsible side panel or focused full view so early research can lead naturally into writing without crowding the two-column document.

**Ideas is an outliner, not the document's section-navigation outline.** Every item can contain text and child items, and supports add-child/add-sibling, drag/reorder, indent/outdent, collapse/expand, and open/incorporated state. A script may exist with only Ideas populated. Promoting an item creates or inserts a chosen draft block, preserves a backlink to the originating idea, and marks the idea incorporated; the writer can reopen it or link it to a different block later. Incorporation state is informative and never controls build eligibility by itself.

**Extras is a loss-averse holding area for authored material that is not in the current draft.** `Move to Extras` is a first-class action for selected text, rows, or structured fragments. It preserves readable content, formatting, typed cards, citations, media references, provenance, and the source revision/location where practical. Moving a whole block preserves its stable identity. Restoring inserts the material at a writer-selected Draft location; duplicating it into the Draft creates new identities so the stored alternate remains available. References or text anchors that are no longer valid return visibly stale and require review rather than being silently discarded or rebound.

Ideas and Extras autosave and revision atomically with the Draft. Their counts and unresolved/stale state are visible, but they do not create host-visibility or visual-coverage errors. They are excluded from prompter/print exports by default, with an explicit appendix option for human-readable exports only. Ordinary delete still exists with undo and revision-history recovery; the application does not silently convert every deletion into an Extra.

### 6.3 Progressive controls

- Typing stays immediate. A blank right cell behaves like text until the writer types @, pastes a URL, drags an asset, or chooses Insert.
- Insert opens clip search, upload, stock/generated image request, graphic template, music, placeholder, and citation choices.
- Selecting a structured card opens a right-hand inspector with timing, audio, crop, fit, handles, template inputs, provenance, and build status.
- **Hovering or selecting a right-column visual highlights the narration range it covers. Selecting narration can create a visual event or adjust an existing event's semantic start/end anchors.**
- Every row has an unobtrusive build-state indicator: excluded, ready, unresolved, generating, stale, failed, or built.
- A Preview timing mode estimates duration from generated or recorded narration and displays row-level time spans without turning the document into a timeline.
- A Resolve view shows the last build, track map, warnings, changed blocks, and the exact timeline/project destination.
- The primary action reads **Edit video** before the first build and **Update video** afterward. Its menu exposes `Timeline only`, `Timeline + review MP4`, and `Timeline + review MP4 + Drive upload`, with the chosen destination and sharing policy visible before submission.
- Build preparation summarizes how many media requirements will be reused,
  materialized, exported, relinked, or left unresolved, plus estimated new disk
  usage. It proceeds without interruption when policy resolves every item and
  opens a focused remediation view only for missing, incompatible, invalid, or
  authorization-blocked media.
- Reuse policy and project-media policy are separate controls. The recommended
  defaults are `Reuse verified; export missing/incompatible` and
  `Make project self-contained by copy/clone`. Advanced alternatives may
  reference verified media in place, forbid new exports, or explicitly
  re-export all clips.
- Each narration block shows its temporary-audio state—missing, queued, generating, ready, stale, locked, failed, or replaced by host recording—and can preview or regenerate only that block.

### 6.4 Narration-first visual anchoring

**Recommended model: keep each narration paragraph intact and add independent, range-anchored event lanes. A host-visibility lane records OC/VO spans. A visual lane records clips, stills, graphics, and placeholders. Both lanes use stable text anchors—block ID plus start/end token IDs or resilient relative positions—rather than new table rows.**

**A visual card in the right column shows a compact coverage label and aligns approximately with the relevant text. Hovering the card highlights its covered words on the left; hovering highlighted words emphasizes the corresponding card. Multiple cards can cover successive or overlapping ranges inside one paragraph. Full-frame visuals normally create a VO span over the same range; overlays can coexist with OC when the host remains visible.**

**Authoring anchors express meaning before exact audio timing exists. After generated or recorded narration is available, the compiler resolves text anchors to milliseconds/frames using provider speech marks or word alignment. Timing precision is visible. A secondary timing mode lets the editor fine-tune frame boundaries without changing the paragraph or its semantic anchors.**

#### Coverage rule

**Every spoken token belongs to exactly one host-visibility state. Every VO interval must be covered by at least one full-frame visual instruction or an explicit unresolved-visual placeholder. Gaps, contradictory overlaps, and visual events with no duration are build validation errors, not silent defaults.**

#### Alternative interaction models

- **Inline cut markers between words offer maximum immediacy and export cleanly, but they clutter the prose and make revisions fragile. They are best as an optional visibility mode, not the primary interface.**
- **One row per shot is simple to compile, but it makes editorial cuts control the writing structure and breaks continuous paragraphs. Reject this as the default.**
- **A miniature timeline under every paragraph is precise, but visually heavy during drafting. Use it only in the secondary timing/refinement mode.**
- **Sentence-level visual cards are easier to implement but cannot express mid-sentence cuts cleanly. They may be a prototype constraint, not the final data model.**

### 6.5 Row and block types

| Type                 | Readable rendering                                         | Build behavior                                                        |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| section              | Heading spanning the document                              | Chapter marker; optional timeline marker                              |
| narration            | Continuous paragraph; OC ranges semibold, VO ranges normal | Generates/references narration audio; carries host-visibility spans   |
| direction            | Parenthetical or muted text                                | Non-spoken; may create marker or actor note                           |
| clip                 | Title plus transcript excerpt                              | Resolves a stable clip reference and places chosen source/audio range |
| visual               | Thumbnail, name, or request text                           | Places still/video or creates an explicit placeholder                 |
| graphic              | Template name plus human-readable values                   | Instantiates a versioned Fusion template                              |
| music/sfx            | Track name and instruction                                 | Places licensed audio with mix intent metadata                        |
| citation             | Linked source                                              | Preserved in script/build report; no timeline item by default         |
| note/draft           | Ordinary scratch text                                      | Excluded unless promoted                                              |
| host-visibility span | OC or VO state over a narration range                      | Emits prompter markers and validates host visibility                  |
| visual event         | Right-column card linked to highlighted words              | Places a clip/still/graphic over the compiled time range              |

### 6.6 Prompter export

**The prompter export contains only spoken host narration, in document order. It excludes direction blocks, citations, visual notes, asset transcripts, graphics data, and excluded drafts. It always begins with a state marker and adds a new marker only when host visibility changes.**

**Default formatting places (OC) or (VO) on its own line immediately before the first affected word, even when the transition occurs inside an authoring paragraph. Paragraph wording and order remain unchanged. Section headings may be included as non-spoken navigation labels through an export option.**

**(OC)**

**We’re doing Finland for the third time in a row? Why in the Helsinki would we do that?**

**(VO)**

**All the clues are hidden in last season’s videos, if you have way too much time on your hands.**

**The export records the source document revision and is deterministic: the same revision and settings produce the same text file. Validation blocks export if any spoken range has no camera state.**

## 7. Canonical content model

Do not compile directly from HTML, Google Docs table markup, or free-form prose. The editor should persist a versioned document tree whose nodes have stable IDs and typed properties. ProseMirror/Tiptap is a strong prototype candidate because custom block nodes, collaborative history, and Google-Docs-like editing are established patterns, but the choice should be validated with a two-column selection/clipboard spike before commitment.

Illustrative row shape:

**ScriptDocument { id, projectId, title, activeDraft, ideaOutline, extras, revision, version }**

**IdeaItem { id, parentId, orderKey, text, state: open | incorporated, linkedDraftBlockIds[], collapsed, version }**

**StoredFragment { id, orderKey, contentTree, sourceBlockIds[], sourceRevision, sourceLocation, state: stored | stale, version }**

**NarrationBlock { id, orderKey, text, hostVisibilitySpans[], visualEvents[], timingPolicy, state, notes, version }**

**TextAnchorRange { blockId, startTokenId, endTokenId, startAffinity, endAffinity, quotedText, anchorVersion }**

**HostVisibilitySpan { id, range, state: on_camera | voiceover, source, version }**

**VisualEvent { id, range, source, presentationMode, framingPolicy, motionPreset, audioPolicy, layer, transitionIn, transitionOut, timingOverrides, status }**

**CompiledEventTiming { eventId, startMs, endMs, startFrame, endFrame, timingPrecision, alignmentVersion }**

MediaReference { id, kind, sourceSystem, sourceId, sourceUrl, versionSnapshot, transcriptSnapshot, requestedInOut, exportHandles, captureProfile, artifactId, provenance, status }

ArtifactRequirement { id, mediaReferenceId, clipSnapshot, requiredBounds, requiredHandles, conversionRequirements, languageArtifactPolicy, reusePolicy }

ResolvedArtifact { requirementId, artifactId, packageManifestHash, contentHashes, compatibility, availability, verifiedAt, sourceLocatorId }

MaterializedMedia { id, projectId, requirementId, artifactId, mode: clone | copy | reference, projectRelativeLocator, contentHashes, verifiedAt }

TransitionPolicy { presenterToBroll, brollToPresenter, brollToBroll }

TransitionSpec { kind, durationFrames, easing, templateId, templateVersion, audioBehavior }

GraphicInstance { id, templateId, templateVersion, data, styleOverrides, durationPolicy, validationState }

BuildSnapshot { id, scriptRevision, activeDraftBlockVersions, assetVersions, voiceSettings, templateVersions, timelineSettings, target, status, manifestHash }

The document transaction and revision cover Draft, Ideas, and Extras together, but the compiler receives only `activeDraft`. Moving a block between Draft and Extras is a reversible document operation, not destructive deletion. A build snapshot records the active block versions it compiled so later outline or Extra edits do not falsely imply that generated media is stale.

## 8. Integration with the research clip project

The existing project should remain authoritative for research clips, transcripts, source-video identity, transcript provenance, selected bounds, export bounds, notes/tags, and rendered clip packages. The authoring platform consumes those records through an API; it should not scrape the spreadsheet or duplicate YouTube/transcript logic.

1. The writer searches project clips by project, tags, note, source title, or transcript text.
1. Dropping a result onto selected narration creates a VisualEvent whose assetReference points to the stable project clip ID. It snapshots the readable transcript plus selected version/bounds while its TextAnchorRange states exactly which words the clip covers.
1. At build time, the authoring client asks the research artifact resolver for an
   exact package matching the clip snapshot, required bounds/handles,
   language-policy files, and conversion requirements.
1. If a compatible artifact is reachable, the resolver verifies its manifest and
   required hashes before the build reuses it. A catalog status of `complete`
   alone is not a cache hit.
1. If the expected locator is missing, the local agent searches only configured
   artifact roots or asks the user to locate the package. A located candidate is
   accepted only after its manifest, clip snapshot, and hashes verify.
1. If no verified compatible artifact is reachable, the authoring build requests
   a new immutable export through the existing durable export boundary and
   waits, fails clearly, or builds with a placeholder according to policy.
1. Script-specific choices—mute source audio, use only part of the exported range, crop, layer, speed, or placement duration—remain usage overrides and do not mutate the research clip.
1. If the research record changes, the script shows “update available” and offers keep snapshot, update reference, or compare. It never silently retargets the edit.

**Recommended ownership boundary:**

- Research project owns source acquisition, transcripts, clip logging, rights/provenance notes, clip export, and reusable clip artifacts.
- Authoring project owns narrative order, usage of a clip in a particular video, voiceover, graphics, visual requests, timeline placement, and build history.
- Resolve bridge owns deterministic translation from one build snapshot into a local Resolve project/timeline and the reconciliation report.

### 8.1 Build-time media resolution and materialization

Artifact identity and file placement are separate concerns. The immutable
research artifact/package ID, manifest, and content hashes identify reusable
media. Local paths, object keys, temporary download grants, and project-local
copies are locators. The build must verify actual bytes; it must not infer
availability from a remembered path or a completed export record.

When **Edit video** or **Update video** freezes a revision, create an
`ArtifactRequirement` for every research clip and produce a media-preparation
plan before timeline compilation:

| Resolution state                                       | Default action                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Exact, compatible, reachable, and hash-verified        | Reuse and materialize into the authoring project                       |
| Reachable but incompatible or lacking required handles | Request a new immutable export                                         |
| Completed record with a missing locator                | Search configured roots, then offer verified `Locate`                  |
| User-located package                                   | Accept only after manifest/snapshot/hash verification                  |
| Still missing                                          | Request durable re-export from the frozen clip snapshot                |
| Source unavailable or unauthorized                     | Block or use an explicit labeled placeholder according to build policy |

Keep two settings independent:

- **Reuse policy:** `Reuse verified; export missing/incompatible` (default),
  `Re-export all`, or `Reuse only; do not start exports`.
- **Project media policy:** `Make project self-contained by copy/clone` (default),
  `Reference verified media in place`, or `Ask for each source`.

The default authoring workspace keeps reusable media outside individual build
directories so later builds can reuse it without multiplying copies:

```text
Authoring Project/
  Media/
    Research Clips/
      <clip-id>/<artifact-id>/
        <verified package files>
  Builds/
    <build-id>/
      timeline-manifest.json
      build-report.json
```

Prefer a filesystem-supported copy-on-write clone when it preserves independent
consumer bytes; otherwise copy. Referencing in place is an advanced, less
portable option. Do not move the research package. Do not use ordinary hard
links when later mutation could alter canonical bytes. Record the materialized
artifact ID, project-relative locator, hashes, and verification time in the
build snapshot.

`Re-export all` creates new immutable research artifact versions using the
frozen requirements; it never overwrites prior packages or silently changes an
earlier build. If a project-local copy is deleted later, the next build attempts
verified rematerialization from the canonical package, then verified relink,
then durable re-export. If reacquisition is impossible, preserve the clip
reference and transcript and expose missing media rather than substituting
unrelated footage.

## 9. Voiceover subsystem

- Temporary speech is an editing aid, not the intended final performance. The system must make that status obvious in the script, build report, Resolve metadata, and review export.
- Generate audio per narration block (the default row-level unit), not as one monolithic file. Stable block IDs enable partial regeneration and precise timeline replacement. Long blocks may be internally chunked for provider limits, but finalize as one logical block asset with continuous timing metadata.
- The first **Edit video** or **Update video** action creates speech only for missing or stale narration blocks. Reuse a verified block asset when its text, voice profile, pronunciation dictionary, synthesis settings, provider/model version, and normalization profile hashes are unchanged.
- **Preserve word/speech-mark timing when the provider supplies it; otherwise run alignment or expose honest sentence/cue precision. Range anchors must not be presented as frame-exact until compiled timing is verified.**
- Store plain text separately from provider-specific synthesis input. Support pronunciation dictionary entries, phoneme/alias overrides, emphasis, pacing, pause, and named voice/profile.
- Record provider, model, voice version, settings, input hash, output hash, duration, sample rate, and generation time.
- Allow locked audio: once a human recording or approved synthetic take is attached, a normal rebuild must not regenerate it.
- A recorded host take can replace a temporary block asset while preserving the block ID and editorial intent. Because the real performance may have a different duration, replacement triggers a timing-impact preview and a new compiled timeline rather than silently stretching or overwriting the edit.
- Create audible and visible placeholders when synthesis fails. Never compress the remaining timeline and hide a missing line.
- Normalize loudness and sample format through the media worker, but treat final mixing as editorial work in Resolve.
- **Generate the plain-text prompter artifact from host-visibility spans independently of whether the timeline uses synthetic or recorded narration.**

### 9.1 Speech provider boundary

Define a narrow `SpeechSynthesisProvider` contract that accepts normalized block text, voice/profile settings, pronunciations, and requested timing output, then returns audio plus timing/provenance metadata. Compare at least one cloud provider and one local/offline provider before choosing a default. The build model must not encode vendor-specific voices, SSML, identifiers, or billing assumptions.

### 9.2 Narration artifact identity

`NarrationAudioAsset { id, blockId, blockRevision, kind: temp_synthetic | host_recording, textHash, synthesisProfileHash, provider, model, voiceVersion, audioHash, durationMs, timingPrecision, timingArtifact, normalizationProfile, status }`

Temporary audio should be stored as an immutable artifact. Regeneration creates a new version and never mutates the asset used by a previous build snapshot.

## 10. Visual assets and B-roll

- A visual request begins as intent: description, purpose, desired duration, aspect/crop policy, source preference, and rights note.
- It can resolve to a research clip, uploaded file, generated image, licensed stock item, URL-backed reference, screen capture, or placeholder slate.
- Generated images must preserve prompt, model, seed/settings when available, generation policy, and content hash. The writer explicitly selects the accepted candidate.
- URLs are references, not durable media. A local build must resolve them into authorized, checksum-tracked artifacts before final placement.
- Stills receive a default motion preset only when the author chooses one; the compiler should not invent pans and zooms globally.
- Every asset card exposes fit/fill, crop focus, in/out, speed, source-audio policy, attribution, and rights status where relevant.
- **Each visual event exposes its covered narration text, semantic start/end anchors, compiled timing, timing precision, presentation mode (full frame, overlay, picture-in-picture, background), and coverage validation state.**

### 10.1 Common visual-source presets

These are common typed inputs, not an exclusive list:

| Input                                   | Resolution behavior                                                                                                                                                                             | Default composition behavior                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Logged research clip                    | Resolve the stable project clip/version; reuse its verified export when available or request the existing durable export pipeline to download, trim with handles, convert, and finalize it      | Full-frame B-roll using the chosen source-audio policy; no invented retiming                                  |
| Webpage URL                             | Capture through a versioned webpage-capture adapter using a recorded viewport, device scale, final URL, capture time, and capture profile; persist the resulting image as an immutable artifact | Full-frame capture with a slow top-left-anchored drift over the visual event's duration                       |
| Direct image URL or uploaded image file | Download/read the original full-resolution asset, verify media type and dimensions, hash it, and preserve source/provenance metadata                                                            | Scale to the largest size that keeps the entire image visible; preserve aspect ratio; no animation by default |

For image aspect ratios that do not match the timeline, “fill without cutting anything off” means **contain**, not crop: the complete image is visible, with letterbox/pillarbox space filled by a project background preset. Stretching and silent cropping are prohibited. The writer can explicitly choose crop-to-fill or a motion preset as an override.

The webpage default is a still capture plus a motion transform, not live web content embedded in Resolve. The card should preview the selected viewport or region before build. Public pages can be captured by a local headless-browser worker; no browser extension is required. Authenticated, paywalled, or session-dependent pages are deferred to an explicitly authorized attached-browser flow or a user-supplied screenshot. The MVP must not copy browser cookies into a background worker silently.

Web capture must record the requested URL, final URL after redirects, page title, capture timestamp, viewport, device scale, capture-adapter/version, artifact hash, and any load warnings. Dynamic pages, consent overlays, failed fonts/images, blocked automation, and pages that change between revisions must be visible failure or review states rather than hidden differences. A hosted capture service must reject private/local-network targets and apply normal SSRF protections.

### 10.2 Transition policy

Transitions are properties of visual boundaries, not narration paragraphs. A project/video may set three independent defaults:

- `presenterToBroll`: the presenter is visible before the boundary and a full-frame B-roll source begins.
- `brollToPresenter`: a full-frame B-roll source ends and the presenter becomes visible.
- `brollToBroll`: one full-frame B-roll source changes to another.

Each slot may be `cut` or a versioned transition specification with type, duration, easing, and optional Fusion/template identity. `Apply to everything` copies one selection into all three slots as a convenience; the slots remain independently editable afterward. A visual event can override either adjacent boundary without changing project defaults.

The compiler classifies each boundary from the OC/VO state plus the neighboring events, resolves the effective transition in this order—boundary override, event/type preset, project default, hard cut—and writes the result into the immutable build snapshot. Transitions affect picture only by default; audio crossfades or source-audio behavior require an explicit audio setting.

Transition duration must fit the available handles and adjacent event durations. When it does not, validation should ask the writer to shorten the transition, extend the event/handles, or use a cut; the compiler must not silently move narration anchors or steal time from another visual.

## 11. Fusion graphics template system

Template design is a separate creative/engineering workstream, but the authoring contract should be defined early. Each template is a versioned package with a stable ID, Resolve/Fusion artifact, preview, semantic input schema, default duration, safe-area/aspect support, fonts, dependencies, and validation fixture.

| Template contract field | Example                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Semantic inputs         | name, job_title, quote, value_a, value_b, source_label                |
| Data types              | short text, long text, number, percent, date, image, color, series    |
| Constraints             | max characters, min/max values, required fields, line limits          |
| Timing                  | fixed, stretchable, intro/hold/outro, minimum duration                |
| Layout support          | 16:9 initially; explicit 9:16/1:1 variants later                      |
| Versioning              | new immutable version when animation, schema, font, or layout changes |
| Verification            | reference render, edge-case fixture, missing-font/dependency check    |

The UI should render inputs as a small form, then show the result in readable prose inside the script. For example, a lower third card can read “Erika Vikman — Singer” while storing template ID, version, fields, duration, and style variant. Avoid exposing raw Fusion node names to writers.

## 12. DaVinci Resolve output architecture

### 12.1 Recommended hybrid

Compile first into an editor-neutral timeline manifest, then use a local Resolve bridge. Generate OTIO or FCPXML for standard media/timing interchange where it is reliable, and use Resolve’s Python/Lua scripting API for project creation, bins, exact track setup, media import, timeline item placement, markers, and Fusion title/generator insertion. The installed Resolve scripting documentation confirms support for importing timelines from AAF/EDL/XML/FCPXML/DRT/ADL/OTIO, importing media, appending source ranges at record frames, inserting Fusion titles/generators, attaching Fusion comps, setting timeline-item properties, and storing marker custom data.

This hybrid prevents the product from depending entirely on undocumented project-file internals while acknowledging that interchange formats do not fully express Fusion templates, custom metadata, and all Resolve-specific settings.

### 12.2 Predictable track map

| Track | Default purpose                                                                 |
| ----- | ------------------------------------------------------------------------------- |
| V1    | Primary picture or presenter/A-roll placeholder                                 |
| V2    | Research clips and featured source footage                                      |
| V3    | B-roll and still images                                                         |
| V4    | Fusion graphics, titles, and overlays                                           |
| V5    | Debug slates or unresolved placeholders; disabled for clean review when desired |
| A1–A2 | Generated or recorded narration                                                 |
| A3–A4 | Source clip audio                                                               |
| A5    | Music and sound effects scratch track                                           |

### 12.3 Build sequence

1. Freeze an immutable script/build snapshot and validate row order, timeline rate, asset identities, graphics data, and voice settings.
1. Build the media-preparation plan. Resolve exact research artifact candidates,
   verify manifests/hashes and compatibility, classify missing or invalid
   locators, and freeze the effective reuse/project-media policies.
1. Resolve or generate changed narration, clip packages, stills, and graphics
   dependencies. Reuse or re-export according to the plan, then copy/clone or
   reference verified packages into the authoring workspace. Record hashes,
   materialization locators, and actionable failures.
1. **Calculate durations. Narration is the default timing spine. Resolve text anchors to verified speech timing, compile OC/VO spans and visual-event ranges into integer frames, then apply explicit timing overrides and transitions. Report anchor/alignment precision rather than implying exactness.**
1. Resolve every visual source into a verified immutable artifact. Logged clips use the research export boundary; webpage URLs use the capture adapter and motion preset; image URLs/files use full-resolution acquisition plus the chosen framing policy.
1. Classify visual boundaries and compile effective presenter→B-roll, B-roll→presenter, and B-roll→B-roll transition specifications, validating available duration and handles.
1. Emit a canonical timeline manifest using integer frames at the project rate, plus a human-readable build report.
1. Create or select the target Resolve project, import media into deterministic bins, and create a new timeline named from the build ID/revision.
1. Place timeline items onto named tracks, apply source in/out and simple transform/audio properties, insert Fusion templates, and add row/build IDs as marker custom data where supported.
1. Save the Resolve project, verify item counts/durations/track names against the manifest, and report discrepancies. Optionally export a DRT/OTIO backup.

### 12.4 Rebuild safety

Initial builds should always create a new timeline. Later incremental rebuilds may update a generated timeline only when every managed item retains its stable build identity. Manual editor changes require a reconciliation view with three choices: create a fresh generated timeline, preserve manual changes and update only untouched managed regions, or explicitly replace. Never rebuild over the sole edited timeline.

### 12.5 Review render and delivery

After timeline assembly passes manifest verification, the build may continue through two optional stages:

1. Render a review preset to a staging path, normally H.264/AAC MP4 with project-standard resolution and frame rate.
1. Inspect the output with FFprobe and validate duration, streams, nonzero size, and expected build/revision metadata.
1. Atomically promote the verified MP4 into the project's completed-artifact directory.
1. If Drive delivery was requested, upload that immutable artifact through a `ReviewDeliveryProvider`, initially Google Drive, using a resumable upload where supported.
1. Verify the remote file identity/size, record its Drive file ID and URL, then mark delivery complete. Sharing permissions are an explicit separate choice; uploading must not silently make the file public.

The local MP4 remains a successful artifact if Drive upload fails. The upload stage can be retried without rebuilding or rerendering. A new script revision produces a new review artifact; it does not overwrite an earlier shared review unless the user explicitly selects a version-replacement policy.

### 12.6 Background build experience

Submitting **Edit video** or **Update video** freezes the current document revision and creates a durable `VideoBuildJob`. The browser may close without canceling it. The status surface reports `queued → generating speech → resolving media → compiling → building Resolve timeline → verifying timeline → rendering MP4 → verifying MP4 → uploading → complete`, while skipped stages are labeled rather than hidden.

Jobs use idempotency keys, attempts, progress, cancellation boundaries, and worker leases. Retry resumes from the last verified immutable artifact whenever possible. The local agent must be running for local speech, Resolve automation, rendering, or Drive credentials held on the workstation; sleep, shutdown, or unavailable Resolve moves the job into a resumable waiting state rather than losing it. Completion notification can begin as in-app status and later add email/desktop notification adapters.

## 13. System architecture

- Web client: structured document editor, clip/asset search, inspectors, preview timing, and build/status UI.
- Authoring API: projects, document revisions, media references, template registry, build snapshots, collaboration-ready optimistic versions, and permissions.
- Local agent: filesystem, FFmpeg/FFprobe, voice provider credentials where local, downloads/imports, configured-root artifact lookup, manifest/hash verification, project-media materialization, Resolve discovery and automation, and local artifact cache.
- Build orchestrator: persisted dependency graph and jobs for voice, clip export, image generation, media normalization, manifest compilation, and Resolve assembly.
- Research clip adapter: versioned API client to the existing shared catalog and export worker.
- Provider adapters: voice synthesis, image generation, stock/media search, review delivery/Google Drive, notifications, and future music/SFX providers.
- Webpage capture adapter: public-page rendering/capture, viewport/region selection, provenance, and immutable screenshot finalization; authenticated capture remains a separate explicit capability.
- Template registry: metadata/schema/preview in the control plane; Resolve/Fusion package bytes in versioned object storage or a controlled local library.

## 14. Persistence and identity

- Use UUIDs for projects, documents, rows, blocks, media references, graphic instances, assets, and builds.
- Store authoring intent in a transactional database; store large artifact bytes in object storage or a verified local cache.
- Use immutable artifact versions and content hashes. A path is a locator, not identity.
- Represent long work as durable, observable, retryable jobs with idempotency keys, attempts, progress, cancellation boundaries, and leases where distributed.
- Snapshot every external dependency in a build: research clip/version, exported artifact hash, voice/provider settings, graphic template version, generated image version, and Resolve/timeline settings.
- Persist each artifact requirement, resolution result, and project-local
  materialization separately. A missing locator can be repaired without
  changing the research clip reference or pretending the old artifact never
  completed.
- Reuse policy, project-media policy, resolved compatibility decision, artifact
  ID/manifest hash, and content hashes are frozen in the build snapshot. A later
  `Re-export all` action produces new artifact dependencies and a new build.
- Keep a build dependency graph so changing one narration paragraph regenerates only its voice asset and downstream timing, while unchanged assets are reused.
- Persist `VideoBuildJob`, `ReviewRenderArtifact`, and `DeliveryAttempt` separately. A successful timeline or MP4 remains successful when a later upload attempt fails.

## 15. Failure and placeholder policy

| Condition                                                       | Default behavior                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Completed clip record but package locator is missing            | Search configured roots, offer verified `Locate`, then request immutable re-export or apply the explicit placeholder/block policy |
| Located package fails manifest/snapshot/hash verification       | Reject it as invalid; retain the clip reference and offer another location or durable re-export                                   |
| Reachable clip package lacks required handles or compatibility  | Request a new immutable export; never stretch, silently substitute, or mutate the prior package                                   |
| Project-local media copy was deleted                            | Rematerialize from a verified canonical package, then relink or re-export if necessary                                            |
| YouTube/source acquisition unavailable                          | Keep the clip reference and transcript; show remediation; never substitute unrelated footage                                      |
| Voice generation fails                                          | Place duration-preserving tone/slate or block build; retain text and error                                                        |
| Graphic data invalid                                            | Show field-level validation; optionally place template-named slate                                                                |
| Image unresolved                                                | Place request text on a slate with stable row ID                                                                                  |
| Webpage capture is blocked, incomplete, or materially different | Keep the URL/card and capture diagnostics; require review, retry with a revised capture profile, or use a supplied screenshot     |
| Image aspect ratio differs from timeline                        | Use contain plus the selected project background; never crop or stretch unless explicitly overridden                              |
| Transition lacks sufficient duration or media handles           | Block that transition with corrective choices; allow an explicit hard cut without moving narration anchors                        |
| Resolve unavailable                                             | Finish assets and timeline manifest; leave Resolve assembly retryable                                                             |
| Resolve output differs from manifest                            | Fail verification and retain both manifest and generated timeline for diagnosis                                                   |
| Review render fails                                             | Retain the verified timeline and earlier artifacts; retry render without regenerating unchanged dependencies                      |
| Drive upload fails or authentication expires                    | Keep the verified local MP4, expose reauthentication/retry, and never rebuild merely to retry delivery                            |
| Workstation sleeps, restarts, or Resolve is closed              | Persist state and resume from the last verified stage when the local agent and required application return                        |

## 16. Milestones

### Milestone 0 — Resolve capability spike

- On the actual editing workstation, detect Resolve version/edition and connect through the supported scripting API.
- Create a project and timeline, import local media, place three trimmed clips at exact record frames, add narration audio, insert one Fusion title, attach marker custom data, save, and reopen.
- Export or inspect the result and compare exact item count, durations, tracks, and start frames to a manifest fixture.
- Decide the minimum supported Resolve version and which functions require Studio after testing rather than assumption.

Gate: one deterministic local fixture becomes a correct, reopenable Resolve timeline without UI automation.

### Milestone 1 — Structured authoring prototype

- Two-column editor with section, narration, direction, clip, visual, graphic, citation, and excluded-draft blocks.
- Per-script Ideas outliner with nested items, reordering/indentation, open/incorporated state, and explicit promotion into a chosen Draft location.
- Per-script Extras surface with lossless move, restore, and duplicate-to-Draft operations for text, rows, and structured fragments.
- Stable IDs, undo/redo, copy/paste, selection across rows, autosave, revision snapshots, and printable/exportable human view.
- **Continuous paragraphs with range-anchored OC/VO spans, multiple visual cards per paragraph, bidirectional hover highlighting, complete VO coverage validation, and deterministic prompter export.**
- Legacy Google Doc table import for the example document, with an inference-review screen.

Gate: a new script can begin as a nested Ideas-only outline, promote one item into the Draft with a durable backlink, and keep incorporated planning history. The example script can then be represented naturally, including left-only/right-only rows, while unused rich content moves to Extras and restores without losing typed references. Ideas and Extras never affect validation, prompter output, or build input. One uninterrupted narration paragraph can contain multiple picture cuts and camera-state changes without being split into rows.

### Milestone 2 — Narration-led rough cut

- One voice adapter, explicit temporary-audio labeling, pronunciation overrides, per-block generation/caching, waveform/duration/timing metadata, preview/regeneration controls, and audio normalization.
- Uploaded media/stills, placeholder slates, deterministic track map, canonical timeline manifest, and new-timeline builds.
- Durable **Edit video**/**Update video** jobs that can continue after the browser closes and reuse unchanged narration/media artifacts.

Gate: a five-minute script with mixed narration, stills, and local clips produces a correctly timed Resolve rough cut and useful build report.

### Milestone 2B — Review render and Drive delivery

- A versioned review-render preset, staging/finalization, FFprobe verification, and immutable MP4 artifact records.
- Optional Google Drive destination selection, resumable upload, explicit sharing policy, remote verification, and delivery retry independent of render.
- Background progress, restart recovery, and completion/failure notification.

Gate: from the script, one action creates a verified shareable MP4; with Drive enabled, the same frozen revision appears once in the chosen folder with a recorded link. Closing the browser does not cancel the job, and an upload failure can be retried without rerendering.

### Milestone 3 — Research clip integration

- Search and insert stable clip records from the existing project.
- Resolve exact compatibility and current byte availability rather than trusting
  completed catalog state alone.
- Reuse matching verified artifacts, recover relocated packages through verified
  relink, or request durable immutable exports; propagate status and errors.
- Add a media-preparation summary plus independent reuse and project-media
  policies, defaulting to reuse verified media and copy/clone it into a
  self-contained authoring-project media folder.
- Preserve missing clip/transcript references when reacquisition fails and apply
  the project's explicit block-versus-placeholder policy.
- Snapshot transcript/version/bounds and show update comparisons.

Gate: a selected research clip appears as transcript text in the script and as
the correct trimmed media—with handles and chosen audio policy—in Resolve. A
reachable verified package is reused without rendering; a relocated package can
be verified and relinked; a missing or incompatible package creates one
idempotent re-export; and the resulting bytes are copied/cloned into the
authoring project without moving the canonical research package.

### Milestone 3B — Visual acquisition and transitions

- Typed cards and immutable artifact resolution for logged clips, public webpage captures, and direct/uploaded images.
- Webpage viewport/region preview plus the default top-left drift motion preset.
- Full-resolution image acquisition with contain/no-crop composition and no animation by default.
- Independent project defaults and per-boundary overrides for presenter→B-roll, B-roll→presenter, and B-roll→B-roll transitions.

Gate: one continuous narration passage resolves all three source types, keeps the full image visible, applies the webpage drift for exactly its covered range, and produces the independently selected transition at each boundary without shifting narration timing.

### Milestone 4 — Graphics template pipeline

- Template package/schema/preview/version registry and installer.
- Starter templates with edge-case fixtures and reference renders.
- Structured authoring forms and Resolve insertion with duration policies.

Gate: lower-third, quote, full-screen text, image-caption, and chart instances render correctly from authored data and remain traceable to template versions.

### Milestone 5 — Assisted visuals and safe rebuild

- Generated-image and stock-search adapters, candidate review, rights/provenance fields, and caching.
- Build diff and reconciliation for manually refined Resolve timelines.
- Batch resolution of placeholders and incremental regeneration.

Gate: changing a paragraph or visual choice updates a new or safely reconciled timeline without regenerating unchanged assets or losing manual work.

## 17. MVP acceptance path

1. Create a new script with no Draft content, add a three-level Ideas outline, reorder and indent items, close/reopen the script, and confirm the hierarchy persists.
1. Promote one idea at a chosen Draft location; confirm the idea remains linked and marked incorporated while only the new Draft block becomes build-eligible.
1. Import a copy of the example two-column Google Doc and review inferred rows.
1. Move one rich-text passage and one structured card/row to Extras; confirm neither affects validation, duration, voice generation, prompter output, or build input, then restore one at a chosen Draft location without losing content or references.
1. Move the imported notes/drafts tail to Extras and confirm it does not affect the build.
1. Generate voiceover for a short chosen section, including one pronunciation override and one stage direction that remains unspoken.
1. Confirm that narration is generated as separately cached block assets; edit one block, run **Update video**, and verify only that block and its timing dependents regenerate.
1. **Keep one narration paragraph intact while adding at least two visual events that begin/end at different word anchors inside it; verify hover highlighting in both directions.**
1. **Mark successive ranges OC, VO, and OC; verify OC words appear semibold, every VO range has visual coverage, and a deliberate unresolved placeholder is visible as such.**
1. **Export a narration-only prompter text file; verify it begins with (OC) or (VO), emits markers only at transitions, preserves spoken wording/order, and excludes directions and production notes.**
1. Insert one existing research clip by searching its transcript; preserve the clip ID, transcript version, selected bounds, export handles, and source audio choice.
1. Build with an exact compatible research package already present; verify its
   manifest/hashes, reuse it without rendering, and copy/clone it into the
   authoring project's `Media/Research Clips` area.
1. Move the canonical fixture package outside its recorded locator, run build
   preparation, locate it explicitly, and verify that relink succeeds only after
   the exact manifest/snapshot/hashes pass.
1. Delete another fixture package and verify the build requests exactly one
   durable re-export. Then choose `Re-export all` and verify new immutable
   versions are created without overwriting prior artifact/build history.
1. Add a public webpage URL, preview its capture viewport, and verify the finalized screenshot receives the default top-left drift for exactly the event duration.
1. Add one direct or uploaded full-resolution image and verify the entire image remains visible with no animation by default, including when its aspect ratio differs from the timeline.
1. Set different transitions for presenter→B-roll, B-roll→B-roll, and B-roll→presenter; verify each compiled boundary uses the correct versioned preset and that an event-level override affects only its selected boundary.
1. Add one unresolved visual placeholder.
1. Add a lower third and simple chart using versioned template data.
1. Build a new Resolve timeline with the documented track map and inspect exact placement.
1. Render a verified review MP4 from that timeline, close/reopen the browser while the job is running, and confirm status recovery.
1. Upload the verified MP4 to a selected Drive folder, verify the recorded remote file/link, then simulate an upload failure and confirm retry does not rerender.
1. Change one narration block and rebuild. Verify unchanged voice/media artifacts are reused and the previous timeline remains available.
1. Open the build report and trace every timeline item back to its script row and source/version.

## 18. Open questions and current recommendations

| Question                                       | Current recommendation                                                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate repo or current monorepo?             | Treat this as a separate product/repository with a versioned API to the research project. Prototype code can temporarily share contracts, but avoid making either deployment depend on the other’s UI.                             |
| Google Docs as canonical editor?               | No. Import legacy docs and export readable snapshots, but make the structured web document canonical. Perfect Docs round-trip would erase semantics or require brittle conventions.                                                |
| Ideas versus Extras?                           | Ideas is a nested pre-draft planning/task outline; Extras holds already-authored material removed from the current Draft. Both belong to one script revision but are excluded from compilation until explicitly promoted/restored. |
| What should deletion do?                       | Keep ordinary delete with undo/revision recovery, and make `Move to Extras` the visible loss-averse action for material the writer may reuse. Do not silently turn every deletion into an Extra.                                   |
| Timeline interchange or direct API?            | Hybrid: canonical internal manifest, OTIO/FCPXML where helpful, Resolve scripting for Resolve-specific placement and Fusion. Validate against the installed version.                                                               |
| Resolve project target?                        | Create a new project or new generated timeline by default. Never assume permission to overwrite an editor’s active timeline.                                                                                                       |
| Timing spine?                                  | Narration duration by default, with explicit row policies for clip-led, fixed-duration, overlap, and montage regions.                                                                                                              |
| Voice provider?                                | Keep an adapter and compare at least one cloud and one local/offline option on quality, pronunciation, latency, cost, licensing, determinism, and data handling.                                                                   |
| Speech asset granularity?                      | Narration block/row is the logical cache and replacement unit. Permit internal sentence chunks only as a provider implementation detail.                                                                                           |
| What does Edit/Update video do?                | Freeze the current revision and start a durable incremental build. Default to a verified Resolve timeline; optionally continue to a review MP4 and Drive delivery using visible presets.                                           |
| Research media reuse policy?                   | Default to reusing exact compatible verified packages and exporting only missing/incompatible requirements. `Re-export all` is explicit and creates new immutable versions.                                                        |
| Project media placement?                       | Default to a self-contained project media area populated by copy-on-write clone when safe, otherwise copy. Reference-in-place is advanced; never move canonical research packages.                                                 |
| Missing previously exported media?             | Verify configured roots or an explicit user-located package, then re-export from the frozen clip snapshot. If reacquisition fails, retain the reference and block or use a labeled placeholder.                                    |
| Drive upload semantics?                        | Upload a new immutable review version by default. Keep sharing permissions explicit and retry delivery independently of rendering.                                                                                                 |
| Can a build finish after the browser closes?   | Yes, through the persisted local/background worker. The workstation and required local applications must remain available; otherwise the job waits and resumes.                                                                    |
| Automated B-roll selection?                    | Start with writer-selected assets and explicit placeholders. Add suggestions only after provenance, replacement, and rejection workflows are strong.                                                                               |
| Does webpage capture require a browser plugin? | Not for public pages: use a local headless-browser capture adapter. Treat authenticated pages as a later explicit attached-browser/extension capability or accept a user-supplied screenshot.                                      |
| Webpage capture default?                       | Capture a writer-previewed viewport/region as an immutable still and apply a slow top-left-anchored drift across the event duration. Do not embed a live webpage in Resolve.                                                       |
| Image fit default?                             | Preserve the full-resolution source and use contain/no-crop with a project background. No animation unless explicitly selected.                                                                                                    |
| Transition defaults?                           | Store independent presenter→B-roll, B-roll→presenter, and B-roll→B-roll policies. `Apply to everything` is a shortcut, not a fourth semantic category.                                                                             |
| Fusion template inputs?                        | Design semantic schemas independent of node/control names and generate or map to Fusion controls through a versioned package.                                                                                                      |
| Manual Resolve edits?                          | Initial one-way compile to a new timeline. Add a managed-item reconciliation protocol only after stable IDs survive real editing sessions.                                                                                         |
| Collaboration?                                 | Design optimistic versions and stable IDs now; defer presence, comments, and conflict-rich real-time coauthoring until single-writer builds are reliable.                                                                          |

## 19. Decisions required before implementation

- Minimum supported DaVinci Resolve version and whether Resolve Studio is required for the intended workstation workflow.
- Primary operating system(s) for the local bridge; macOS can be first if that matches the editing environment.
- Whether presenter/A-roll footage is part of the first rough cut or the initial timing spine is voiceover only.
- Default timeline frame rate, resolution, audio sample rate, and track naming convention.
- Preferred computer voice characteristics and whether generated voice may leave the local machine.
- Default temporary voice provider/profile, cost ceiling, and whether row-level generation may run automatically on build or requires an explicit cost confirmation.
- Default review-render preset, filename/version convention, and whether a burned-in draft watermark/timecode is desired.
- Default Drive folder, retention/version policy, and who may change link-sharing permissions.
- Completion notification channels and whether the local agent should prevent sleep during an active render/upload.
- Build policy for unresolved assets: block, placeholder, or selectable per project.
- Default webpage viewport, region-selection behavior, page-load settle policy, top-left drift preset, and treatment of consent banners.
- Default contain-background treatment for mismatched image aspect ratios: black, brand color, blurred duplicate, or project template.
- Initial transition library, default duration, and whether any preset may affect audio as well as picture.
- Which five Fusion templates best represent actual repeated needs and who owns their visual approval.
- Whether authors need comments/suggestions parity early, or whether import/export snapshots cover the transition from Google Docs.

## 20. First implementation slice

Build the smallest vertical proof, not the full web editor: a checked-in JSON script fixture containing a nested Ideas outline, one incorporated idea linked to the Draft, one stored Extra, two active narration blocks, one continuous paragraph with OC → VO → OC spans, three range-anchored visual events (a fake logged-clip artifact, a webpage-capture fixture with top-left drift, and a mismatched-aspect image fixture using contain/no-crop), independent transition choices for all three boundary categories, one unresolved visual placeholder, and one lower third; deterministic per-block temporary speech generation and caching; a deterministic (OC)/(VO) prompter export; a local compiler that accepts only the active Draft and proves Ideas/Extras are absent from voice, validation, manifest, and prompter outputs; and a durable build job that creates and verifies a new Resolve timeline, renders and verifies an MP4, and optionally uploads it through a fake Drive adapter. Make the fake logged clip cross the real media-preparation contract: verify and copy/clone one existing immutable package, simulate a missing locator and verified relink, then simulate deletion and one idempotent re-export without moving or overwriting prior artifacts. Change one active block and prove that **Update video** reuses the unchanged audio and media; change only an Idea or Extra and prove it does not invalidate build artifacts. Use stable IDs, immutable artifacts, resumable stages, and marker custom data from the first spike. Once that boundary is reliable, build the two-column editor against the same schema.

## 21. Technical risks

- Resolve scripting coverage differs by version/edition and some operations may require the application to be fully running. Mitigation: capability probe, version matrix, fixtures, and hybrid interchange/API strategy.
- Fusion templates can expose implementation-specific controls and break when renamed. Mitigation: semantic schema, immutable versions, installer validation, and reference renders.
- Legacy Google Docs contain ambiguous free-form cues. Mitigation: heuristic import with visible confidence and mandatory review; never treat import guesses as production-ready automatically.
- Planning and parked material can leak into production if scope is inferred from document position. Mitigation: persist Ideas, Draft, and Extras as explicit roots and expose only the active Draft to validation, voice, prompter, and build contracts.
- Moving rich fragments out of the Draft can orphan text anchors or media relationships. Mitigation: move whole typed subtrees with stable IDs when possible, preserve source revision/location, mark invalid relationships stale, and require review before restoration or compilation.
- Generated voice changes duration, shifting the entire edit. Mitigation: block-level assets, locked takes, change-impact preview, and immutable build snapshots.
- **Word-level timing may be unavailable or change after voice regeneration. Mitigation: preserve timing precision, align when required, offer a secondary timing mode, and never claim frame accuracy from paragraph position alone.**
- **Text edits can invalidate visual anchors or cause anchor drift. Mitigation: stable token/relative-position anchors, quoted-text checks, visible stale states, repair UI, and immutable build snapshots.**
- Manual edits and generated rebuilds can diverge. Mitigation: new-timeline default, stable managed IDs, diff/reconciliation, and no silent overwrite.
- Online media may be inaccessible or unauthorized. Mitigation: reuse the research project’s explicit authorization/provider boundaries and keep placeholders useful when export fails.
- A completed research export may have been moved, deleted, or corrupted. Mitigation: separate artifact identity from locators, verify package manifests/hashes at build time, support bounded configured-root lookup and explicit verified relink, then request an immutable re-export when possible.
- Copying all research packages can waste disk, while referencing them in place can make builds fragile. Mitigation: make reuse and materialization independent policies, prefer safe copy-on-write clones with copy fallback for self-contained projects, report estimated storage, and keep reference-in-place advanced.
- Provider costs and privacy vary. Mitigation: adapters, per-project policy, previews/estimates, caching, and explicit disclosure of uploaded text/media.
- Background builds depend on workstation availability and Resolve state. Mitigation: persisted waiting states, restart recovery, capability probes, optional sleep prevention, and clear indication of which stages can run unattended.
- Review delivery can accidentally expose unfinished work. Mitigation: private-by-default Drive upload, explicit sharing controls, immutable revision naming, remote verification, and audit records.
- Webpages are mutable and browser capture can be nondeterministic. Mitigation: previewed capture profiles, immutable screenshots, final-URL/timestamp/viewport provenance, load diagnostics, and explicit recapture rather than silent refresh.
- Remote image URLs can change, disappear, or return misleading content types. Mitigation: bounded acquisition, media decoding/metadata verification, hashes, immutable finalized artifacts, and no silent replacement.
- Transitions can consume unavailable handles or obscure editorial timing. Mitigation: frame-based validation, independent boundary policies, explicit audio behavior, and a hard-cut fallback chosen by the writer.

## Appendix A. References

Primary product and implementation sources used to ground Resolve automation, Fusion template design, the example-script analysis, and integration with the existing research clip workflow.

- [Example two-column script: OEV25 Finland](https://docs.google.com/document/d/1-9FhegQDRAqfjRs_UbEIdb3SSDPW-P3qL8nKA1-N24k/edit?tab=t.0)
- [DaVinci Resolve 20 New Features Guide — AI IntelliScript](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf)
- [Fusion 20 Reference Manual — macros and Fusion templates](https://documents.blackmagicdesign.com/UserManuals/FusionManual.pdf)
- [DaVinci Resolve 20 Fusion Visual Effects Guide — creating title templates](https://documents.blackmagicdesign.com/uk/UserManuals/DaVinci-Resolve-20-Fusion-Visual-Effects.pdf)
- Installed DaVinci Resolve scripting README (local workstation; last updated 28 October 2024).
- Research Video Transcript & Clip Extraction Tool: PROJECT_GUIDE.md.
