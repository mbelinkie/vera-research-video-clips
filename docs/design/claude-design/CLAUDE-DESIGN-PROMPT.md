# Opening prompt for Claude Design

Review the desktop UI of VERA Research Video Clips, a shared-project research
application for resolving verified YouTube transcripts, navigating videos by
transcript, logging candidate ranges, and exporting editing-ready clips.

First, study `docs/design/claude-design/UI-CONTEXT.md`, the screenshots in
`docs/design/claude-design/screenshots`, and the source files listed in the
context document. Treat `PROJECT_GUIDE.md` as authoritative when UI ideas
appear to conflict with product behavior.

Focus on:

- information hierarchy and navigation across Add, Review, Logged, Project
  Settings, and the active video workspace;
- reducing cognitive load while retaining honest operational state;
- transcript readability, search, bilingual switching, timing precision, and
  text-range selection;
- clarity and safety of the three distinct clip actions;
- discoverability of collaboration, review, queue, keyword, and export states;
- keyboard navigation, focus treatment, contrast, target size, and screen
  reader semantics;
- consistent component patterns, spacing, typography, color, and status
  language.

Preserve these non-negotiable behaviors:

1. `Queue / log only` requires a visible project, creates a logged clip, and
   starts no render.
2. `Export + log` requires a visible project, creates the logged clip first,
   and then requests its render.
3. `Export only` requires no project, creates a persisted technical export,
   and creates no project clip or project log entry.
4. Original-language and English transcripts remain separate and time-linked.
5. Exact word, cue-level, and estimated playback timing must be labeled
   honestly.
6. Completed transcript or media work is never regenerated silently.
7. Long-running work remains visible, retryable, cancellable at documented
   boundaries, and safe under duplicate delivery.
8. A project destination is always visible and changeable wherever work is
   logged; there is no hidden default project.

Produce two or three materially different design directions before choosing a
preferred direction. Then create a high-fidelity interactive desktop prototype
covering the representative states listed in `UI-CONTEXT.md`. Reuse the
product's vocabulary, but you may reorganize layout and simplify copy when the
meaning remains intact. Call out any proposed workflow change instead of
silently baking it into the design.

Finish with a Claude Code handoff bundle containing design intent, component
and state mappings, tokens, assets, accessibility notes, and a prioritized
implementation sequence. Do not modify the production repository.
