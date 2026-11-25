# Prevent duplicate typed quotes after Save (#131)

Outcome: an ordinary successful Save keeps the draft attached to its saved
quote, so a further submission cannot create a duplicate. A correction uses
the existing versioned edit path; Cancel edit or Save and add another clears
the draft before a new quote can be created.

Boundaries: typed-quotes workspace and generated browser fixture only.
Context: completed #80 spec, finishSavedQuote, saveQuote, editQuote and the
existing item create/update contracts. No API, schema, idempotency policy,
picture storage, or broader workspace redesign.

Failure states: failed creates retain their existing retry key; a committed
quote with pending pictures retries only those pictures. After completion
(including skipping optional pictures), the same saved item is the edit
target. Version conflicts retain the draft and require the existing reload
flow. Explicit edit completion and Add another continue clearing the form.

Acceptance: ordinary Save then another submission yields exactly one POST
and one listed item; correcting the retained text PATCHes its existing ID and
version. The saved-list focus, explicit editing, Add another, picture retry
and skip behavior remain intact.

Narrow checks: generated Chromium cases in tests/e2e/typed-quotes.spec.ts,
followed by the entire typed-quotes spec and typed-quote-model tests. Run
npm run check in Linux during verification phase. No live services or data;
independent deployment acceptance is separate.
