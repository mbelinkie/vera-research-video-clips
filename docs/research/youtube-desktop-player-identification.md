# YouTube desktop player identification

Checked: 2026-08-25

## Primary sources

- [YouTube API Services — Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Help — Embed videos and playlists](https://support.google.com/youtube/answer/171780)

## Finding

YouTube defines iframe-player error 153 as a request missing the HTTP
`Referer` header or equivalent API-client identification. Its desktop-app
instructions require an explicitly added HTTPS `Referer`. The host must be the
stable installed application ID, excluding version and architecture details;
for Apple platforms this is the bundle ID.

The packaged VERA desktop app uses the bundle ID
`com.researchvideoclips.desktop`, so its required player identity is:

```text
Referer: https://com.researchvideoclips.desktop/
```

The renderer's `rvc://app` origin remains the real isolated renderer origin and
continues to be used by the iframe API's `origin` parameter. Desktop request
identification is isolated in the Electron session adapter and limited to the
two HTTPS YouTube player hosts allowed by the renderer CSP.
