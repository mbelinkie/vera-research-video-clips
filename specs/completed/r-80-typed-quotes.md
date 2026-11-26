# Typed quotes and offline sources (#80)

[Research #80](https://github.com/mbelinkie/vera-research-video-clips/issues/80) delivers a typed-quote editor that can attach a verbatim quote to a selected existing project source (including a web page with failed extraction) or a newly created offline source. Subsequent quotes reuse the exact source ID and bibliography without re-entering it. The same editor can correct typed and extension-originated quotes. The approved Research r14 handoff governs focus and navigation; Sources and Library remain the two top-level tabs.

## Boundaries and decisions

- Use existing Library `CreateSourceRequest`, `CreateItemRequest` and `UpdateItemRequest` contracts and project-authorized API. No second quote store and no offline-source title deduplication. User-entered bibliography fields use `confirmed` state; new offline sources require a title in the form, but other citation fields are optional. Authors are individual newline-separated entries, not comma-separated names.
- Require original quote text, preserving every character including leading/trailing whitespace. Map optional speaker, separate speaker title, page, citation correction, Topics and note to the existing quote fields. Never assume the author is the speaker or fabricate missing citation fields.
- Edits use the saved item version and never change its source ID or the distinct `latestDisplayText`. Preserve existing `content.title`, `surroundingWords`, `highlight`, capture metadata and source provenance not represented in the form; clearing an editable optional value removes it. An unchanged existing source is not patched when a quote is added.
- Use stable per-intent idempotency keys; successful source creation is durable even if a subsequent quote or picture upload fails. Save and add another retains the source and clears only quote-specific inputs, then focuses the quote text. Separate later phases implement UI, picture storage, and full API/browser evidence.
- Optional source and quote pictures are private owner-linked assets, not new visible still items or embedded JSON. Retain original, display and thumbnail variants with existing still security limits and project authorization.

## Failure states

Reject absent/blank/oversized quote text, invalid URL, malformed or excessive Topics, invalid source IDs and oversized metadata via the shared contracts. Keep invalid drafts editable; never partially claim success. A 409 version conflict requires reload/retry, not last-write-wins. Reuse the created source ID and the intended idempotency key on retries. Keep UI responses scoped to the current project and reject unauthorized cross-project access. If a photo fails after a record saves, show a partial-success recovery path and do not create duplicates.

## Acceptance and verification plan

- Phase 1: Pure schema-validated source/quote create and edit mappings. Verify minimal/partial bibliography, author commas, confirmed state, invalid URL, exact text, Topics validation, clearing optional fields, versioned extension edits and preserved capture/display metadata. Run `npx vitest run apps/web/src/typed-quote-model.test.ts packages/contracts/src/index.test.ts` and `npm run typecheck`.
- Phase 2: Dedicated private picture persistence, guarded routes, migration and integrity/permission tests.
- Phase 3: Project-scoped existing/new source picker and typed quote UI, Save/Save and add another focus and retry behavior, browser tests.
- Phase 4: Edit typed and extension quotes, picture upload/read/retry and approved r14 responsive states with real API/browser evidence.
- Phase 5: Full `TMPDIR=/private/tmp npm run check`, focused Chromium, protective mutation tests, diff review and PR evidence. Do not mark the r14 mock as proof of production persistence.

Out of scope: #81's full Sources/Library shell and web page workspace; extraction and Chrome capture changes (#78/#79); automatic citations/export, Timeline placement, media/PDF viewing, new highlight capture, or production data mutation.

## Completion record — 2026-11-20

### Delivered decisions and file boundaries

- Kept original quote text verbatim and independent from script `latestDisplayText`; edits preserve extension capture metadata. The new-source path creates a distinct offline source; subsequent quotes explicitly reuse its ID and do not rewrite its bibliography. Per-intent source and quote idempotency keys survive retries.
- Added project-authorized, owner-linked private source/quote pictures with immutable object versions, original/display/thumbnail variants, guarded replacements, integrity verification, and a 0062 cloud migration. Photos do not become Library still items or modify browser capture assets.
- Exposed a standalone typed-quote editor in the current shell with paginated project source/quote selection, versioned edit/reload, focused Save and add another, partial-success photo retry/skip, and responsive Research r14-inspired layout. The final Sources/Library navigation belongs to #81.
- Changed `apps/web/src/typed-quote-model.ts`, `.test.ts`, `typed-quotes-workspace.tsx`, `typed-quote-pictures.tsx`, `main.tsx`, `styles.css`; `apps/cloud-api/src/library-reference-pictures.ts`, `.test.ts`, `app.ts`; `packages/catalog/src/library-reference-pictures.ts`, `project-library.ts`; `packages/db-cloud/migrations/0062_library_reference_pictures.sql`, `src/index.test.ts`; and `tests/e2e/typed-quotes.spec.ts`. Three synthetic Chromium screenshots are retained in `docs/evidence/r-80-*.png`.

### Verified commands and actual results

- `TMPDIR=/private/tmp npm run check` — exit 0: formatting and typecheck passed; 61 Vitest files passed, 4 skipped; 440 tests passed, 5 skipped; production Vite web build passed; local migrations valid (6 newly applied), cloud migrations valid (17 newly applied). Log: `.pipeline/80/phase-5-check.log` (conductor ticket folder).
- `npx playwright test tests/e2e/typed-quotes.spec.ts --project=chromium` — exit 0, **16/16 passed**, covering offline/existing source, retry/idempotency, extension and typed quote edits, 409 conflict/reload, existing/cover/quote pictures, error recovery, project switching, wide and compact responsive behavior. Log: `.pipeline/80/phase-5-chromium.log`.
- Synthetic screenshot capture using the same test fixtures (`npx playwright test tests/e2e/typed-quotes.spec.ts --project=chromium -g 'creates an offline book|compact width retains|wide view docks'`) — exit 0, **3/3 passed**. Test-only capture calls were restored after execution; screenshots are `docs/evidence/r-80-new-offline-quote.png`, `r-80-compact-edit.png`, and `r-80-wide-edit.png`. Screenshot dimensions verified as 1216×1577, 354×1538 and 1216×1141, respectively.
- Protective mutation verification (each against its named focused Vitest test): bypassed reference-picture write authorization, bypassed expected-picture-revision guard, disabled offline-source retry receipts, disabled quote retry receipts, and disabled the stored-object byte digest comparison. **All five mutations failed the intended assertions (red, exit 1) and passed after byte-for-byte restoration (green, exit 0)**. Per-case logs and machine-readable results: `.pipeline/80/phase-5-*-red.log`, `*-green.log`, `phase-5-mutation-results.json`.
- Complete committed phase 1–4 source diff reviewed against issue scope; `git diff --check` passed. The temporary mutations and screenshot test instrumentation were restored before final commit.

### Commit history, remaining risks and next owner

Implementation commits: `5560217`, `91a8a2e`, `879e500`, `ac961a1`, `1b42aa8`; the phase-5 completion commit adds this record and screenshot fixtures. No unrelated navigation, still-crop, transcript/extension logging, or production data migrations were intentionally changed.

Remaining: Chromium tests use synthetic mocked API fixtures; the API tests use embedded project databases and fake object storage, not a deployed production store. The accepted r14 prototype was not manually image-compared on a Mac; desktop application pixel fidelity and real-world physical uploads were not manually accepted. Five existing test cases were skipped in the full gate. CI protected `Check`, branch push, PR opening, auto-merge and issue closure are conductor-owned and cannot be asserted until GitHub reports them. #81 owns the final Sources/Library navigation.
