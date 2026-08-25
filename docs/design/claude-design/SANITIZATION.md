# Sanitization manifest

This handoff is intended to be safe to store in the private source repository
and import into Claude Design.

## Allowed content

- Tracked source code and public project documentation.
- Fictional UI fixture data listed in `UI-CONTEXT.md`.
- Screenshots captured from deterministic fixture or mock states after all
  credential inputs have been cleared.
- Synthetic transcript excerpts written solely for the design review.

## Excluded content

- `.env` files or environment-variable values.
- Bearer credentials, cookies, refresh tokens, API keys, OAuth codes, or AWS
  profiles.
- Presigned object-storage URLs, private object keys, or signed artifact URLs.
- Real project names, member identities, handles, comments, notes, tags, source
  history, or transcript text.
- Local database contents, caches, outboxes, runtime logs, crash reports,
  filesystem paths, or exported media.
- Screenshots of live accounts, production deployments, or authorized private
  sources.

## Screenshot verification

Before adding each image:

1. Use a fresh in-memory development fixture or mocked browser flow.
2. Confirm every visible name and transcript excerpt is fictional.
3. Clear the development credential field after the fixture has loaded.
4. Check the full image, including browser chrome, menus, dialogs, tooltips,
   status messages, downloads, and error details.
5. Confirm no local path, credential, URL query signature, or real video title
   is visible.
6. Record the state and fictional data in `screenshots/README.md`.

Do not redact a sensitive screenshot and assume hidden pixels are safe. Capture
a clean fictional state at the source.
