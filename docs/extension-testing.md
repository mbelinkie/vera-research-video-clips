# Testing Chrome capture

Use Chrome for Testing with a disposable browser profile and fresh managed Research projects. The opt-in suite runs entirely on loopback. The existing #79 check opens the native extension toolbar action on a synthetic signed-in article, cancels once, saves once, and retrieves both saved PNGs by their immutable revisions. The #101 check uses two additional disposable projects and a local synthetic, seekable YouTube-shaped page. It verifies a blank general save, attributed reason creation and editing, two independently timed moments (one without a note), frozen playhead and mode drafts, unavailable and active-ad handling, retry after a committed response is lost, project isolation, the canonical source path/details endpoint, and an empty Library for both sources.

Start managed Research with an empty private data directory using the normal local startup command. From the repository root, run the following against that instance. Supply the path to a Chrome for Testing executable that supports the DevTools Extensions.triggerAction command. Use a unique synthetic project name per run.

```sh
VERA_EXTENSION_REAL_CHROME=1 \
VERA_EXTENSION_DESTINATION_URL=http://127.0.0.1:43112 \
VERA_EXTENSION_CHROME_PATH='/path/to/Chrome for Testing' \
VERA_EXTENSION_PROJECT_NAME='Synthetic capture 01' \
VERA_EXTENSION_PAIR=1 VERA_EXTENSION_CREATE_PROJECT=1 \
VERA_EXTENSION_HEADLESS=1 \
npx playwright test tests/e2e/extension.spec.ts --config=playwright.config.ts
```

The #101 test names its projects `Synthetic capture 01 moments` and
`Synthetic capture 01 isolated`, derived from `VERA_EXTENSION_PROJECT_NAME`.
Use a unique base name with an empty managed data directory. Omit
`VERA_EXTENSION_PROFILE_DIR`; the test creates and removes its own temporary
Chrome profile and never touches a personal profile. `VERA_EXTENSION_HEADLESS=1`
is supported when the installed Chrome for Testing build exposes
`Extensions.triggerAction`.

The fixture pairs through Options and the VERA approval window, then closes every VERA tab. Its staging copy pregrants access only to the synthetic Research host, 127.0.0.1, so the operating system permission prompt needs no automation. The article uses localhost, a separate host. Chrome grants temporary access to that article when its toolbar action runs. The fixture disables browser traces, screenshots and video recording.

For producer acceptance, use the original unpacked manifest, approve its host permission in Chrome, and choose an authorized article and destination project. Check the top picture, the saved passage and its highlight against the original page. Exercise Save page, Save as still, Save audio and Send YouTube. For the video, log two different positions and leave the time unchecked once. Verify one source with distinct comments. Record the outcome and any failure stage without sharing article text, image bytes, private URLs or credentials.
