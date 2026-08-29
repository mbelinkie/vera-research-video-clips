# UI context

## Product and audience

VERA Research Video Clips is a desktop-first tool for researchers building
evidence libraries for documentary and video-essay production. Users often
review long videos, search or scan transcripts, compare original and English
tracks, select precise passages, collaborate on review status, and export clips
for downstream editing.

The interface must support expert, high-volume work without hiding uncertainty
or operational state. Density is acceptable when grouping and hierarchy make
the next action obvious.

## Core journey

1. Open an authorized project and see its canonical video worklist.
2. Add one YouTube source or preflight a batch of sources.
3. Reuse an exact verified transcript when possible; otherwise observe queued,
   processing, language-decision, failure, or retry states.
4. Open a ready video into the player/transcript workspace.
5. Search, navigate, switch language views, and select transcript text or set a
   manual player range.
6. Add optional notes and project-scoped tags.
7. Queue/log the range, export and log it, or create an export-only job.
8. Review logged clips, collaboration activity, export progress, and artifacts.

## Information architecture

- **Global shell:** VERA identity, active project, account/setup, current
  destination, current source, back navigation, and recent sources.
- **Add:** single-source load, provider-gated search, canonical project
  worklist, keyword evidence, activity, batch preflight, and batch progress.
- **Review:** review inbox and source-level review coordination.
- **Logged:** searchable/filterable clip library, topics/tags, comments,
  collaboration state, export progress, artifacts, and CSV projections.
- **Project Settings:** governance, members/invitations, project defaults,
  reusable tags/topics/keywords, and processing controls.
- **Video workspace:** YouTube player, transcript navigation, selection editor,
  selection command panel, bookmarks, and the current clip queue.

## Timing and language vocabulary

- **Word timing:** exact persisted token timing; precise navigation and
  selection bounds are allowed.
- **Cue timing:** only the caption cue is authoritative; selection and export
  remain cue-bounded.
- **Estimated position:** playback-only position within a cue. It improves word
  click navigation but is not promoted to persisted selection evidence.
- **Original:** source-language transcript.
- **English:** separate time-linked English transcript.
- **Preferred:** the user's preferred view when an authorized derivative is
  available; it does not replace original or English evidence.

## Non-negotiable interaction distinctions

| Action           | Project required      | Creates project clip | Starts render |
| ---------------- | --------------------- | -------------------- | ------------- |
| Queue / log only | Yes, visibly selected | Yes                  | No            |
| Export + log     | Yes, visibly selected | Yes, first           | Yes           |
| Export only      | No                    | No                   | Yes           |

Notes and project tags belong only to the two logging actions. Export-only work
must not silently inherit them.

## Representative screen states

The screenshot set should use fictional data and cover:

1. **Add / canonical worklist:** populated project, multiple videos, keyword
   evidence groups, review claims, priorities, activity, and batch creation.
2. **Transcript workspace:** player plus a populated word-timed transcript,
   search result, active token, and language/timing status.
3. **Selected passage:** visible transcript range, padded export bounds, project
   destination, notes, tags, and the three actions together.
4. **Review:** a mixture of ready, processing, conflict, failed, claimed, and
   completed source states.
5. **Clips:** several clips with topics/tags, comments, export progress, and a
   completed artifact. Treat each logged excerpt as the primary reading content,
   use a smaller source-video title as secondary metadata, and let the excerpt
   wrap within a readable measure rather than truncating it to one line. For a
   non-English source, show the original excerpt first and its English companion
   directly below under `Translation from {source language}`.
6. **Project Settings:** project identity, membership/governance, processing,
   keywords, and export defaults.
7. **Operational states:** empty, loading, offline cached, authorization lost,
   stale/conflict, retryable failure, and non-retryable failure.

## Clips reading hierarchy

- Use the source-video title as compact secondary metadata; the reference
  prototype uses 12 px title text.
- Use larger clip text as the primary row content; the reference prototype uses
  14.5 px for both the original excerpt and its English companion.
- Constrain both language texts to about a 68-character measure. Let the
  original excerpt wrap to a two-line default-row presentation and let the
  translation wrap naturally at the same measure.
- For non-English speech, keep the original excerpt first and place one concise
  `Translation from {source language}` label immediately above the English
  companion. The simplified visual presentation does not change the canonical
  Original and English data roles.

## Fictional fixture vocabulary

Use these names consistently if new prototype content is needed:

- Person: **Alex Rivera**
- Project: **Urban Heat Research**
- Videos: **Cooling cities with reflective roofs**, **Neighborhood voices on
  summer heat**, and **Tree canopy and block-level temperature**
- Channels: **Civic Futures Lab**, **Fictional Field Notes**, and **Fictional
  Climate Desk**
- Tags/topics: **heat islands**, **public health**, **adaptation**, and
  **neighborhood testimony**

These are invented for design review and do not identify real research data.

## Visual implementation source map

Read these files before proposing a replacement component system:

- `apps/web/src/styles.css` — current tokens, layout, components, states, and
  responsive rules.
- `apps/web/src/workspace-shell.tsx` — global shell and destination layout.
- `apps/web/src/main.tsx` — top-level state orchestration and video workspace.
- `apps/web/src/batch-workspace.tsx` — Add worklist, keyword, activity, and
  transcription batch surfaces.
- `apps/web/src/source-ingest-panel.tsx` — paste/search source entry.
- `apps/web/src/player-panel.tsx` and `apps/web/src/youtube-player.tsx` — player
  boundary and transport controls.
- `apps/web/src/transcript-navigation-panel.tsx` and
  `apps/web/src/virtual-transcript.tsx` — transcript search, language/timing
  status, virtualization, and token activation.
- `apps/web/src/selection-editor.tsx` and
  `apps/web/src/selection-command-panel.tsx` — selected-range editing and the
  three clip commands.
- `apps/web/src/clip-queue.tsx` — logged clip library and collaboration/export
  state.
- `apps/web/src/project-governance.tsx` — project settings and access controls.
- `apps/web/src/bookmarks-panel.tsx` — source bookmarks.
- `apps/web/src/desktop-setup.tsx` — first-run account, tools, model, rights, and
  readiness setup.

## Product authority and implementation constraints

- `PROJECT_GUIDE.md` is the authoritative product/architecture plan.
- `outline.md` records completed and remaining scope.
- The UI is React 19 with Vite and is packaged in Electron.
- The player remains behind a YouTube wrapper.
- Local services bind to loopback; do not propose a public development tunnel.
- Credentials, presigned URLs, private transcript text, and runtime paths never
  belong in designs, screenshots, logs, or source control.
- A visual prototype may use fictional content and simulated controls, but the
  production implementation must continue to use typed contracts and real
  service boundaries.
