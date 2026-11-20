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
