# TikTok, Instagram, and Facebook search/acquisition research

Date: 2026-08-24

## Decision

Do not add a second social search/downloader library and do not expose TikTok,
Instagram, or Facebook as supported ingest platforms in this phase.

- Production discovery remains official-API-only. TikTok Research API access
  and Instagram's official hashtag/search surfaces are eligibility- and
  semantics-limited; neither is a general, production-safe replacement for the
  requested cross-platform keyword search.
- Facebook's official Graph API is appropriate for authorized Pages and assets,
  not arbitrary public-video keyword discovery. General Facebook search therefore
  remains disabled unless a future deployment has a qualifying, accurately
  represented official API scope.
- `TikTokApi` and `instagrapi` depend on undocumented/private web or mobile API
  behavior, account/browser sessions, anti-bot handling, and frequently
  cookies/proxies. Those properties do not meet this application's provider,
  privacy, supportability, or signed-distribution boundaries.
- `gallery-dl` and Cobalt principally duplicate direct acquisition already
  available through the hardened `yt-dlp` runtime. They do not solve compliant
  keyword search for these platforms and would add another volatile runtime and
  license/operations surface.

Relevant upstream references:

- [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- [TikTok Research API overview](https://developers.tiktok.com/products/research-api/)
- [Instagram Platform documentation](https://developers.facebook.com/docs/instagram-platform/)
- [Facebook Video API](https://developers.facebook.com/docs/video-api/)
- [TikTokApi](https://github.com/davidteather/TikTok-Api)
- [instagrapi](https://github.com/subzeroid/instagrapi)
- [gallery-dl](https://github.com/mikf/gallery-dl)
- [Cobalt](https://github.com/imputnet/cobalt)

## Bounded acquisition spikes

The non-shipping harness is `scripts/social-acquisition-spike.ts`. It runs one
explicitly supplied canonical URL at a time and requires both
`--rights-cleared` and `--authorization-confirmed`. It uses the existing
`MediaCommandRunner` and configured `yt-dlp` executable only.

The harness:

- accepts canonical TikTok video, Instagram post/reel, and Facebook watch/reel/
  video URLs and extracts a provider-scoped stable media ID;
- invokes `yt-dlp` with argument arrays, `--no-config`, `--no-playlist`, and
  `--no-cookies`, with bounded metadata/download timeouts and a 1 GiB limit;
- sanitizes metadata into title, creator, duration, thumbnail presence, and
  caption-language summaries without retaining raw responses;
- acquires one full source, validates video/audio and duration with FFprobe,
  records byte size and SHA-256 fingerprint, and removes the complete private
  scratch directory on every terminal path;
- emits no supplied URL, account/session data, cookies, raw provider response,
  downloaded media, or local path in its result.

The worker image pins `yt-dlp` `2026.07.04`; the harness records the actual
runtime `--version` used by every live run. Deterministic runner fixtures cover
the supported URL shapes and the complete hardened command/metadata/media/
probe/cleanup path. No live smoke was run or claimed on 2026-08-24 because no explicitly
authorized, rights-cleared TikTok, Instagram, or Facebook URL was supplied to
this task.

Example opt-in invocation (use an external, rights-cleared URL; do not commit
it):

```sh
npm run source:social-spike -- \
  --platform tiktok \
  --url 'https://www.tiktok.com/@ACCOUNT/video/ID' \
  --rights-cleared \
  --authorization-confirmed \
  --yt-dlp /absolute/path/to/pinned/yt-dlp \
  --ffprobe /absolute/path/to/ffprobe
```

Run TikTok, Instagram, and Facebook separately. A passing result proves only
acquisition feasibility for that exact public source and tool version. It does not enable
UI ingest, persistence, transcription, timed navigation, clip logging,
export, or Script to Timeline.

## Qualification gaps

Before any platform can be labeled supported, a separate bounded spec must
prove canonical redirects/share links, stable identity under edits, public and
removed states, login/age/region/protected-media classification, caption
semantics, authorized audio/full-media acquisition or local-file fallback,
transcription, precise/honest timed navigation, clip logging, export,
authoring compatibility, cancellation, size limits, and crash cleanup.
