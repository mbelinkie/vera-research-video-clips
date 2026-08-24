# FEATURE-003 — Desktop workflow and direct-mention notifications

## User-visible outcome

A signed-in desktop user may opt into one account-scoped setting for bounded
workflow outcomes and direct clip-comment mentions. Eligible events that occur
while the app is closed are delivered once after the next launch, and clicking
a native notification restores the app at the safe relevant batch, video,
clip/request, local export status, or exact comment anchor. Browser development
remains functional and reports native notifications as unavailable.

## Durable authority and privacy

- Add a cursor-paginated user-authorized cloud feed with stable event IDs and
  exactly-once recipient uniqueness for the first batch terminal summary,
  transcription action-needed transitions, logged export terminal outcomes,
  and existing direct mentions only. Followed-comment and unsupported activity
  never become native candidates.
- Add stable local export-only terminal receipts when existing local terminal
  evidence cannot provide one immutable event identity.
- Payloads contain only bounded safe labels, status, and validated navigation
  identities. They never contain transcript/comment bodies, provider/error
  details, paths, URLs, credentials, artifact locators, or provider output.

## Desktop boundary and preferences

- A main-process coordinator uses injected/testable native-notification,
  preference/ledger, feed, scheduler, window-focus, and navigation adapters.
- Device-local preferences are account-scoped, default off, record `enabledAt`,
  and share one toggle for workflow and direct-mention events. A bounded
  delivered-event ledger survives restart and prevents duplicate delivery.
- Poll only while signed in and enabled, with bounded non-overlapping polling
  and backoff. Stop and clear in-memory account state on sign-out. No access
  token crosses renderer IPC.
- Closed preload IPC permits preference/support reads and updates plus validated
  click-navigation delivery. Untrusted senders and malformed targets fail
  closed.

## Non-goals

Email, remote push, notification delivery while fully quit, routine progress,
cancellation, reviews, triage, keyword scans, followed comments, every unread
activity item, transcript/comment previews, or arbitrary renderer-controlled
native notifications.

## Acceptance gate

Contracts, cloud/local migrations, transition receipt exactness under replay
and concurrency, recipient rules, payload redaction, mention deduplication,
default-off/enabledAt/account/ledger/restart/sign-out/backoff behavior,
unsupported-runtime behavior, strict IPC, click routing and removed-project
fallback, browser no-op behavior, settings UI, typecheck/builds, focused
desktop/API/catalog/local tests, relevant Playwright coverage, migration gates,
aggregate network-free tests, formatting, and diff checks must pass before this
spec moves to completed.

## Completion record

Completed on 2026-08-24 without a dedicated implementation commit.

### Decisions and durable behavior

- Cloud migration `0043_workflow_notification_events.sql` adds body-free
  workflow events and recipient receipts with source-identity uniqueness.
  Catalog transitions emit only the first terminal transcription-batch
  summary, transcription action-needed events to the creator and active
  project-video flaggers, and logged-export outcomes to the requesting
  user/clip creator. The feed merges existing direct-mention notices but never
  followed-comment notices.
- Local migration `0035_local_export_notification_receipts.sql` adds stable
  account-scoped export-only terminal receipts. Terminal transitions persist
  completed/action-needed receipts immediately, while bounded reconciliation
  remains available for compatible prior terminal evidence. No migration
  fabricates historical notification or delivery records.
- Shared contracts define the strict event union, bounded cursor feed,
  account-scoped desktop preference/support status, and closed navigation
  target union. Safe labels are bounded to 160 characters and sanitized for
  controls, URLs, absolute paths, bearer values, and credential-like
  assignments at contract, catalog/local persistence, and desktop display
  boundaries.
- The injected main-process coordinator stores default-off account preferences,
  `enabledAt`, and at most 1,000 delivered IDs atomically under Electron user
  data. It polls cloud and local feeds only while signed in and enabled, caps
  each source at eight pages per poll, prevents overlap, applies exponential
  backoff capped at five minutes, ignores pre-enable events, and invalidates a
  pending poll on sign-out or account change.
- Closed preload IPC exposes preference reads/updates, native-support status,
  and validated click navigation only. Access tokens and account-scope hashes
  remain main-process-only. A click restores/focuses the window and routes to
  the relevant Workbench batch/video, Clips request/clip, local export status,
  or exact clip/comment anchor; removed-project targets use a safe fallback.
  Browser development exposes the same settings surface but reports native
  notifications unavailable and never calls Electron's `Notification` API.

### Primary implementation map

- Contracts and authorities: `packages/contracts/src/index.ts`,
  `packages/catalog/src/index.ts`, `packages/db-local/src/index.ts`, cloud
  migration `0043`, and local migration `0035`.
- Authorized transport: `apps/cloud-api/src/app.ts` and
  `apps/local-agent/src/app.ts`, including the main-process-only
  `x-research-video-account-scope` boundary.
- Desktop delivery: `apps/desktop/src/notification-coordinator.ts`,
  `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`,
  `apps/desktop/src/ipc.ts`, and `apps/desktop/src/auth/broker.ts`.
- Renderer preference/navigation: `apps/web/src/notification-preferences.tsx`,
  `apps/web/src/notification-navigation.ts`, `apps/web/src/main.tsx`,
  `apps/web/src/batch-workspace.tsx`, and `apps/web/src/clip-queue.tsx`.

### Verification evidence

- Focused contract, catalog, cloud API, local database/agent, desktop
  coordinator/IPC, and pure renderer-navigation tests passed, including
  recipient exactness, replay/concurrency deduplication, feed redaction,
  mention/follow separation, account isolation, default-off and `enabledAt`,
  restart ledger reuse, non-overlapping polls, sign-out invalidation, malformed
  IPC denial, and every supported click target.
- The aggregate network-free gate passed `667` Vitest tests with `4` optional
  skips across `61` passing files and `1` skipped file. All `19` one-worker
  Playwright workspace flows passed, including browser-unavailable messaging
  and the existing 1440×900/narrow no-primary-scroll coverage.
- Typecheck, web and desktop production builds, local migration CLI (`35`
  migrations), cloud migration CLI (`43` migrations), scoped Prettier, and
  `git diff --check` passed. The existing Vite chunk-size warning and Node's
  experimental SQLite warning remain informational.

### Residual risks and deferred scope

- No background push is promised while the app is fully quit; eligible durable
  events are read after the next enabled signed-in launch. Native behavior is
  adapter-tested rather than certified across signed macOS/Windows packages.
- Email, remote push services, notification mirroring for reviews, triage,
  scans, followed comments, cancellation, routine progress, or all unread
  activity remain explicitly deferred.
- The unrelated dirty worktree was preserved. No commit was created, so the
  implementation commit ID is unavailable.
