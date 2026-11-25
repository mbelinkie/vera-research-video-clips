# BUG-TRANSCRIPT-003 — Transcript word click-to-play

## User-visible outcome

Activating a transcript word seeks to that word and immediately starts video
playback. Exact token timestamps remain authoritative; an untimed token in a
cue-timed caption uses an honestly labeled playback-only estimate inside its
cue instead of always starting at the cue boundary.

## Confirmed current behavior

- Timed token activation sends the token start to the player but does not send
  `playVideo`.
- YouTube WebVTT, translated, and manual-import tracks intentionally persist
  untimed tokens with cue-level evidence. Every token in one of those cues
  currently falls back to the same cue start.
- Selection and export derivation correctly preserve cue bounds when token
  timing is absent; this behavior must not change.

## Affected boundaries

- Shared transcript navigation-time derivation.
- Virtual transcript token activation and active-token highlighting.
- Web player seek/play orchestration and timing-precision messaging.
- Focused transcript unit and workspace browser coverage.

## Non-goals

- No persisted token timing, transcript regeneration, schema/version/checksum
  change, cache migration, or database migration.
- No forced alignment or provider-specific WebVTT inline-timestamp parsing.
- No estimated timing in transcript selections, logged evidence, exports,
  search navigation, bookmarks, cue buttons, restored navigation, or clip open.
- No autoplay for navigation other than transcript token activation.

## Failure states

- Estimated targets must remain deterministic integer milliseconds inside the
  owning cue, including very short cues and single-token cues.
- A segment without token records remains cue-only and must not receive
  fabricated persistent or DOM token identities.
- Drag-selection must not trigger seek or playback.
- If the player cannot accept the seek command, token activation must not send
  a standalone play command.

## Acceptance criteria

1. Exact timed tokens seek to their stored start and synchronously request
   playback.
2. Untimed tokens evenly partition their cue by ordered token position, seek
   to the estimated token start, request playback, and report `estimated`
   precision.
3. Playback-time highlighting uses the same exact/estimated navigation bounds.
4. Mouse click and Enter/Space activation behave consistently; browser text
   selection remains stable and does not autoplay.
5. Cue buttons and every non-token navigation path retain seek-only behavior.
6. Transcript selection/export bounds remain exact-word when genuinely timed
   and cue-level otherwise.

## Narrow verification first

- `npm test -- packages/transcript/src/index.test.ts`
- `npx playwright test tests/e2e/workspace.spec.ts --workers=1`
- `npm run typecheck`
- `npm run build:web`

## Completion record — 2026-08-25

### Decisions

- Cue-only token estimates are deterministic playback conveniences derived in
  memory from the canonical cue and ordered token count. They are never written
  into transcript artifacts, caches, selections, logs, or export snapshots.
- Only token activation autoplays. Cue timestamps, search results, bookmarks,
  navigation restore, keyword evidence, and clip opening remain seek-only.
- A failed player seek suppresses the follow-up play command.

### Implementation

- Added shared exact/estimated navigation-token derivation and reused those
  bounds for active-token lookup.
- Routed mouse and Enter/Space token activation through one seek-then-play
  callback and exposed exact versus estimated status text/tooltips.
- Added exact, estimated, short-cue, single-token, tokenless, active-lookup,
  iframe-command, keyboard, and drag-selection regressions.
- Closed the account dropdown explicitly in one existing large browser test so
  its overlay cannot intercept the subsequent Clip Library refresh action.
- Updated `PROJECT_GUIDE.md` and `outline.md` with the verified playback-only
  timing policy.

### Verification

- `npm test -- packages/transcript/src/index.test.ts` — 41 tests passed.
- Focused Playwright exact/estimated cases — 2 tests passed.
- `npx playwright test tests/e2e/workspace.spec.ts --workers=1` — 25 tests
  passed after correcting the unrelated account-menu test interaction.
- `npm run typecheck` — passed.
- `npm run build:web` and `npm run build:desktop` — passed; Vite retained its
  existing informational chunk-size warning.
- Targeted Prettier check and `git diff --check` — passed.
- The deterministic player iframe smoke verified ordered `seekTo` then
  `playVideo` commands for exact and estimated tokens. A separate live-source
  packaged replay was not performed because it requires the external signed-in
  dogfood session and an authorized playable source.

### Compatibility and remaining risk

- No public API, persistent schema, transcript bundle, cache identity, or
  database migration changed.
- Equal token partitioning is approximate for cue-only captions; forced
  alignment remains the later precision upgrade.

### Commits

- None; implementation remains in the current working tree for user review.
