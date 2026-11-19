# Chrome extension testing (Research #79)

The real-Chrome check is deliberately opt-in. It uses only a synthetic page
served from loopback and a disposable Chrome profile. It must not be run with
the profile used for subscriptions, personal browsing, or saved passwords.

## Automated fixture

The Playwright fixture is `tests/e2e/extension.spec.ts`. By default the suite
is skipped. To run it, start a signed-in local/managed Research instance using
the repository's normal development instructions, then set the destination
origin and opt in:

```sh
VERA_EXTENSION_REAL_CHROME=1 \
VERA_EXTENSION_DESTINATION_URL=https://127.0.0.1:43177 \
npx playwright test tests/e2e/extension.spec.ts \
  --config=playwright.auth.config.ts
```

`VERA_EXTENSION_DESTINATION_URL` must be the loopback Research origin that
serves the signed-in pairing page and `/extension/v1` gateway. The extension's
confirmation UI stays on its own `chrome-extension://` origin; the gateway is
the only destination that receives an explicit, user-confirmed capture. The
fixture does not accept a cookie, bearer token, or HTML/PNG payload through an
environment variable. The test obtains authentication only through the normal
Research sign-in flow that the operator has already configured for this
disposable test account.

The test launches Chrome with a temporary user-data directory and loads the
unpacked extension with `--load-extension`. The directory is removed after the
run. If the system Chrome binary is not discoverable, set
`VERA_EXTENSION_CHROME_PATH` to a Chrome binary explicitly. Do not point it at
the default Chrome profile or use `--profile-directory` from a personal
installation.

Because pairing is an explicit VERA action, use a disposable profile that has
already been paired when running this automated check. For example, launch a
temporary profile once, load the unpacked extension, approve the connection from
Options in the signed-in local Research page, close Chrome, and then run:

```sh
VERA_EXTENSION_REAL_CHROME=1 \
VERA_EXTENSION_PROFILE_DIR=/private/tmp/vera-extension-profile \
VERA_EXTENSION_DESTINATION_URL=https://127.0.0.1:43177 \
VERA_EXTENSION_PROJECT_NAME='Synthetic extension project' \
npx playwright test tests/e2e/extension.spec.ts \
  --config=playwright.auth.config.ts
```

The profile directory must be a fresh disposable directory and must not be
reused for personal browsing. When `VERA_EXTENSION_PROFILE_DIR` is omitted,
the test creates and removes a profile itself; that mode is useful for testing
the disconnected/error state, but cannot save until pairing has been approved.

The synthetic article is reached through a loopback login route that sets only
a fixture cookie, then contains a known exact quote, author/publication
metadata, and a wrapped second line. Assertions cover the extension's visible
confirmation form, exact quote text, separate speaker fields, project
destination, and successful gateway save. The test also verifies both PNG
payloads, multiple normalized passage rectangles, restoration of the original
scroll position, and that the gateway receives no server-side article refetch.
It records only fixture URLs, status codes, dimensions, and pin/request
identifiers; it never prints captured text, page HTML, cookies, or image bytes.

The normal `npm test` suite does not run this browser check. A skipped result
without `VERA_EXTENSION_REAL_CHROME=1` is intentional, not evidence that a
real Chrome integration passed.

## Manual disposable-profile check

For toolbar, context-menu, and shortcut behavior that a Playwright page cannot
invoke through Chrome's browser chrome:

1. Create a temporary profile directory with `mktemp -d`, launch Chrome with
   `--user-data-dir` set to that directory, `--disable-sync`, and no personal
   profile flags. Close Chrome before removing the directory.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load
   unpacked**. Select `apps/chrome-extension/`; confirm the extension requests
   only the permissions documented by its manifest.
3. Open the extension's **Options**, enter the local Research origin, and
   choose **Connect to VERA**. Sign in to the synthetic test account in the
   same-origin VERA pairing page, enter the one-time code shown in Options,
   then close that page. Explicitly choose the disposable test project in the
   confirmation page. Verify that a viewer or another project cannot write.
4. Open the local synthetic article (use its fixture login route) and select the known quote, including its
   wrapped line. Exercise **Log quote** from the toolbar, context menu, and
   configured shortcut. Confirm the popup shows the exact text and destination;
   save once with an empty speaker and once with a name and a separate title.
   Cancel once and verify that it creates no source, quote, or asset.
5. Use **Save page** with no selection, **Save as still** on the synthetic
   image, **Save audio** on the loopback media link, and **Send to VERA** on a
   local synthetic YouTube-shaped page. Verify each result in the chosen test
   project. These are synthetic fixtures only; do not use a public, paywalled,
   or subscription page for this check.
6. Read the saved top and passage images through the authorized pinned read
   path. Check dimensions, checksum/pin identity, and that each normalized
   rectangle covers the quote in the corresponding screenshot. Never paste the
   screenshot or captured HTML into an issue, terminal log, or test artifact.
7. Revoke pairing or sign out, then confirm a subsequent capture fails closed.
   Stop the Research process and confirm the extension reports unavailable
   rather than showing a success toast. Close Chrome and delete only the
   temporary profile directory.

## Privacy and failure rules

- Keep all fixture traffic on `127.0.0.1`; no external page or media URL is
  needed. A paywalled external page is not a substitute for this fixture and
  cannot prove the synthetic acceptance gate.
- Do not grant blanket browsing-history access, copy cookies/localStorage, or
  capture hidden inputs, scripts, iframes, or unrelated tabs. Data leaves the
  active tab only after an explicit action and confirmation.
- If the tab navigates, the selection is clipped, or screenshot geometry no
  longer matches the captured viewport, the extension must report a failure or
  save the quote with an explicit missing-picture state. It must not silently
  attach a neighboring image.
- A failed run is useful evidence. Report the fixture class, command, status,
  dimensions, and redacted request/pin IDs only. Do not report private page
  contents, session identifiers, cookies, or binary payloads.
