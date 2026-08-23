# M6-04 — Clip Library export operations and storage preflight

- Status: active
- Task/thread: M6-04 only
- Dependencies: M5 durable individual/batch, immutable settings, delivery,
  progress, retry, cancellation, and same-source execution are complete; M6-03
  supplies the restart-safe authorized Clip Library selection surface

## User-visible outcome and current evidence

A researcher can select one or more authorized Clip Library clips, preview the
exact resolved export settings for every selected clip, run a workstation-local
storage preflight, and submit one durable individual request or batch through
the existing M5 export pipeline. The operation survives browser and local-agent
restart, reports each sibling independently, and reuses the established retry,
cancel, progress, and same-source behavior.

The Clip Library currently persists authorized pages and selections but exposes
no export operation. M5 already owns request identity, immutable resolved
settings, idempotent individual/batch creation, execution, progress, retry,
cancel, and compatible same-source acquisition. This slice composes those
boundaries; it does not add another queue or artifact version model.

## Smallest end-to-end proof

Select three eligible clips from two source videos in the Clip Library. Resolve
and display one immutable settings preview per clip, calculate one local
preflight that counts two compatible source groups rather than three when the
siblings execute on the same worker/profile, includes all staged-output estimates,
an equal promotion-copy reserve, active update/checkpoint reserve, and a 2 GiB
safety margin, then submit one durable batch with
`requestOrigin = clip_library`.
Restart the browser/local-agent while the requests are active and recover the
same batch and per-clip leaves. Prove one sibling can fail, retry, or cancel
without changing the other two, while compatible same-source siblings retain
M5's single acquisition behavior.

## Affected boundaries

- Shared contracts: strict storage-estimate/preflight inputs and sanitized
  results; bounded Clip Library export preview/submit operation state; no paths,
  source URLs, credentials, delivery secrets, or raw filesystem errors.
- Cloud catalog/API: reuse the existing authorized settings-preview,
  individual/batch creation, retry, cancel, batch summary, and progress
  operations. Add only the smallest composition surface required to bind an
  authorized Clip Library selection to those existing commands.
- Local persistence: store only restart-safe operation intent/result state that
  is not already durable in cloud/M5 state. Any new SQLite migration must be
  ordered, empty on upgrade, and preserve all M5/M6 rows.
- Local agent: obtain local free-space and operation reserve evidence, calculate
  the preflight without disclosing workstation details, gate only the affected
  heavy submission, and proxy/recover the idempotent cloud command.
- Web: preview per-clip resolved settings, show the preflight components and
  unknown-size warning, require explicit confirmation when allowed, submit once,
  and render the existing durable leaf progress/retry/cancel state after reload.

## In-scope behavior

1. Use the current M5 settings resolver for every selected clip. Display the
   exact resolved settings material and fingerprint that the eventual request
   will store; the create transaction stamps its own `resolvedAt` provenance.
   Stale preset/default/capability evidence must fail before submission.
2. Submit one selected clip through M5 individual creation and two through
   twenty-five through M5 batch creation, always with
   `requestOrigin = clip_library`. Preserve M5 idempotency and keep origin out of
   work compatibility, settings identity, package identity, and deduplication.
3. Keep the persistent operation identity stable across lost responses,
   browser/local-agent restart, and explicit retry of an unknown submission
   result. Exact replay adopts the existing request/batch; divergent material
   input conflicts rather than creating duplicate work.
4. Derive storage need from unique compatible same-worker/profile source
   acquisitions, every
   selected output package estimate, a second-copy promotion reserve, an explicit currently active
   update/checkpoint reserve, and an exact 2 GiB safety margin. Same-source
   siblings are deduplicated only when M5 would actually share their acquisition.
   Report that assurance explicitly: cloud assignment to another worker may
   require another physical acquisition and therefore another measured worker
   check.
5. Return exact known-byte components plus an honest unknown-source-size state.
   Known insufficient space blocks submission. Unknown source size requires an
   explicit user confirmation before acquisition and a second free-space check
   against actual acquired bytes before rendering. Concurrent render/promotion
   attempts reserve their output peaks so siblings cannot pass against the same
   free bytes.
6. The local free-space measurement and reserve are evidence for this operation,
   not a global readiness gate. Browsing, search, transcript review, selection,
   logging, and unrelated work remain available below the recommended 10 GB.
7. Reuse current batch summary, request progress, retry, and cancellation APIs.
   A batch is composition only; each clip remains an independent M5 request and
   retry leaf. One sibling's terminal or low-space state cannot rewrite another.
8. Preserve the M6-03 authorization/cache boundary. Shared mutations require a
   current online credential; stale cached pages may remain browsable but cannot
   submit, retry, or cancel.

## Explicit non-goals

- A new export executor, queue, batch state machine, artifact table, artifact
  version identity, compatibility fingerprint, or same-source coordinator.
- Editing any completed M5 migration or changing M5 package/manifest identity.
- Locator verify/reveal/open/relink or artifact resolution states (M6-05).
- Authoring-client APIs/descriptors (M6-06), runtime drain/quiescence or general
  updater readiness (M6-07/M7), cloud clip storage, or Sheets control.
- Treating the 10 GB recommendation as a global gate, guessing unknown source
  size, or persisting/reporting an absolute path or filesystem volume identity.

## Failures and recovery

- A removed/ineligible clip, stale settings preview, unsupported installed
  renderer, invalid mixed selection, or authorization failure stops before any
  request is created.
- A known-byte preflight shortage returns a bounded actionable result and creates
  no request. An unknown source estimate returns a warning, never a fabricated
  byte count; declining confirmation creates no request.
- A cloud timeout after submission leaves the operation `unknown` until the same
  idempotency identity is replayed or read back. It must not mint a new command.
- Online 401/403 follows M6-03 revocation behavior and never falls back to a
  stale mutation. Local storage errors are mapped to bounded classes without
  paths, device names, commands, or raw operating-system text.
- Retry creates the existing immutable M5 retry child and copies origin/settings;
  cancel uses existing intent/execution cleanup. Neither operation mutates prior
  success, failure, canceled, delivery, or artifact history.
- Space becoming insufficient after acquisition blocks only that request before
  render, preserves actionable durable state, and releases/cleans source media
  through the established M5 lifecycle.

## Migration and compatibility

Prefer no cloud migration and no M5 schema change. Add a local migration only if
recon proves M6-03 cache plus cloud idempotency cannot recover operation state;
it must create empty M6-owned tables and perform no inferred backfill. Existing
M5 requests without Clip Library operation records remain readable. Existing
selection-action requests and artifact history are unchanged.

## Acceptance criteria

1. One real authorized browser-to-local-agent-to-cloud path resolves selected
   clips, displays the exact immutable settings snapshots, preflights storage,
   and creates the existing M5 individual request or batch.
2. Three clips from two videos count compatible source acquisition once per
   source, include every staged-output estimate, an equal promotion-copy reserve,
   active update/checkpoint reserve, and exactly 2 GiB of safety margin; known
   shortage and unknown-size confirmation behavior are directly tested.
3. Submission is exact-replay/restart safe and uses `clip_library` origin without
   changing any compatibility/deduplication identity.
4. Existing per-leaf progress, retry, cancellation, terminal evidence, and
   same-source execution remain authoritative and sibling-isolated.
5. A post-acquisition actual-size recheck prevents rendering when space is no
   longer sufficient and still follows M5 cancellation/failure and scratch
   cleanup invariants.
6. Stale/offline/revoked authorization cannot mutate cloud state; browsing and
   other lightweight Clip Library behavior remain usable below the disk
   recommendation.
7. Contracts, cache/operation state, APIs, events, errors, diagnostics, and UI
   contain no workstation path, filename, source URL/identity, credential,
   delivery/lease token, raw command/output, transcript text, note, or tag.
8. Focused contract/catalog/cloud/local/UI tests, migration inventories,
   browser flows, formatting, typecheck, aggregate checks, and `git diff --check`
   pass in proportion to the final change.

## Verification plan

Run strict contract tests; settings preview and M5 individual/batch replay tests;
local storage calculator tests for unique sources, outputs, active reserve,
2 GiB margin, shortage, unknown size, and changed free space; authorization and
restart/lost-response integration tests; current retry/cancel/progress and
same-source fixture regressions; and browser flows covering one and three clip
submission, offline mutation lockout, restart recovery, and sibling isolation.
Then run both migration CLIs if persistence changes, TypeScript typecheck, web
build, Playwright, aggregate `npm run check` in a clean worktree, formatting for
owned files, and `git diff --check`. Record any platform/real-source skips
without weakening the claimed proof.
