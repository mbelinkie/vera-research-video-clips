# BUG-PLAYER-153 — Identify the desktop YouTube player

## User-visible outcome

YouTube videos embedded in the packaged desktop app load normally instead of
showing `Error 153 — Video player configuration error`.

## Confirmed reproduction

- The packaged renderer is served from the custom `rvc://app` origin.
- The iframe uses `strict-origin-when-cross-origin`, but the Electron session
  does not explicitly identify desktop requests to YouTube.
- YouTube documents error 153 as a missing HTTP `Referer` or equivalent API
  client identity and requires desktop apps to add an HTTPS `Referer` based on
  the stable installed app ID.
- The packaged macOS app ID is `com.researchvideoclips.desktop`.

## Affected boundaries

- Electron's default session request headers for YouTube and YouTube
  privacy-enhanced embed hosts.
- Desktop security regression coverage.

## Non-goals

- No player UI redesign or remote YouTube JavaScript in the privileged
  renderer.
- No broad header rewriting for media CDNs, API requests, or non-YouTube hosts.
- No change to caption/media acquisition or authorization policy.

## Failure states

- An existing custom-scheme or stale `Referer` must not survive on a YouTube
  player request.
- Non-YouTube requests must remain untouched by the session filter.
- Relaunching or recreating the BrowserWindow must not remove identification.

## Acceptance criteria

1. Before the renderer loads, the Electron default session installs a bounded
   request filter for HTTPS YouTube embed hosts.
2. Matching requests carry
   `Referer: https://com.researchvideoclips.desktop/`, derived from the stable
   installed macOS bundle ID and valid across app versions.
3. The wrapper keeps its current iframe sandbox, strict referrer policy,
   privacy-enhanced host, and constrained `postMessage` boundary.
4. Focused unit/security tests and typecheck pass.

## Narrow verification first

- `vitest run apps/desktop/src/youtube-player-identification.test.ts tests/infra/desktop-boundary.test.ts`
- `npm run typecheck`
- Rebuild and manually replay an embeddable video in the packaged desktop app.

## Verification record

- `npx vitest run apps/desktop/src/youtube-player-identification.test.ts tests/infra/desktop-boundary.test.ts`
  — 2 files and 6 tests passed.
- `npm run typecheck` — passed.
- `npm run build:desktop` — passed; the web renderer, preload, desktop main
  process, local agent, and transcription worker bundles were rebuilt.
- `npm run desktop:package:x64` with the three approved development stack
  outputs — passed; the rebuilt app is at
  `out/Research Video Clips-darwin-x64/Research Video Clips.app`. Direct ASAR
  inspection verified the complete cloud configuration and YouTube desktop
  identification without logging their deployment values. Its packaged ASAR
  SHA-256 is
  `b7ab8917ee8bd9e2b1f010fcde7c9dd3582e569a7a3e61656113e721d375e2a3`.
- Focused packaged-config/player gate — 3 files and 13 tests passed.
- `git diff --check` and focused Prettier check — passed.

Manual replay in the packaged desktop app remains before this spec moves to
`specs/completed/`.
