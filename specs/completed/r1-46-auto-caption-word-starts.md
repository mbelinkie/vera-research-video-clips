# R1 #46 — Preserve YouTube auto-caption word starts

Issue: https://github.com/mbelinkie/vera-research-video-clips/issues/46

## Completed scope and decisions

- Only original `youtube-auto` WebVTT normalization consumes inline word-time tags. Preserve the source-reported millisecond start when a marker unambiguously maps to one rendered whitespace token, or when a single initial token precedes the first marker and inherits its cue anchor. Multiword, missing, invalid, duplicate, backward, word-internal or out-of-cue markers do not fabricate word starts.
- A recognized token's **end is derived**, not acoustic: `min(next timed word start, start + 500 ms, containing cue end)`. Reject a nonpositive result. Preserve cue text, source milliseconds and overlap; retain cue-only/manual/source-generated timing when reliable word starts are absent.
- Track and selection precision with source-reported starts and derived ends is `estimated`, never acoustic `word`. Preserve explicit optional `endTiming: "derived"` in tokens, selection/export snapshots, local SQLite, cloud candidates and CSV. Forward-only SQLite `0005` and cloud `0009` migrations leave old rows unlabelled.
- Timed content hashes include ordered word start/end/provenance, with normalization schema version 2 and new stable IDs. Equivalent CRLF/markup renders preserve identity. Unchanged cue-only/manual/generated transcripts retain legacy identity/schema version 1.
- English-language YouTube auto captions retain source starts; a separately translated English track from foreign-language auto captions remains cue-timed. Acquisition source ranking, authorized-media behavior and whisper.cpp are unchanged.
- Browser demo `/?fixture=auto-word-timed` demonstrates source-start seeking, selected bounds and queue/export payloads, but is explicitly a fixture, not a production live-caption transcript reader.

## Acceptance / verification — 2026-11-12

- Exact fixture `11,840` ms source word start survives provider fake acquisition, worker immutable publish, verified second-workstation cache, SQLite/SQL catalog, selection/queue/export and deterministic Chromium UI.
- Full `npm run check`: **180 passed, 4 skipped** in 33 suites (29 passed, 4 environment-gated skipped); formatting, TypeScript, web build, SQLite (5) and cloud (9) migration tests passed.
- Focused 8-suite Vitest command (`transcript`, `contracts`, `providers`, `db-local`, `db-cloud`, `worker/pipeline`, `catalog`, `shared-transcript-store`): **84/84 passed**, independently repeated **84/84 after mutation restoration**.
- `npx playwright test tests/e2e/workspace.spec.ts`: **5/5 passed** (Chromium), including word seek, reverse/phrase selection and saved queue/export bounds.
- Temporary mutation probes: **11/11** targeted regressions rejected by focused tests — start propagation, next-word cap, 500-ms cap, cue-end cap, derived end label, timing identity hash, manual-caption isolation, SQLite/cloud provenance column writes and both SQL provenance constraints. Every source/migration mutation was restored after its failing probe; worktree was clean afterward.
- Source and tests inspected end-to-end across all changed paths, including data compatibility, cache identity, translation precision, presentation, persistence and immutable export snapshots. `git diff --check` was clean.

## Changed boundaries

`packages/transcript`, `packages/contracts`, `packages/db-local` and `packages/db-cloud` migrations, `packages/catalog`, provider/worker/shared-store tests, `apps/web`, deterministic VTT/JSON fixtures, `README.md` and `outline.md`.

## Unverified / follow-up

No live YouTube `yt-dlp` word-marker smoke test was conducted in this Linux pipeline session; no authorized public video ID or Mac runtime was supplied. The browser's live shared transcript lookup remains separate work. Derived ends are not acoustic measurements; Research #47 owns shared alignment. Four optional full-suite integration tests remain environment-gated/skipped.

## Implementation commits

- `48546f0` — parser, canonical identity, bounded VTT fixture.
- `1587388` — contract/selection and durable local/cloud provenance.
- `0b588bc` — provider, worker, shared cache, UI and browser evidence.
- Final completion/specification update is committed separately on the same branch.
