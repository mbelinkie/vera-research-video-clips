# PUNCH-004E — Automatic local processing and resource policy

- Status: completed 2026-08-24
- Parent entry: `PUNCH-004`
- Priority: P1 high
- Dependencies: completed PUNCH-003A authority, PUNCH-004A–D canonical
  worklist/processing/approval foundations, and the existing supervised local
  transcription worker

## User-visible outcome

Each project exposes an independent local-processing policy: **Automatic** or
**Paused**. Under Automatic, direct canonical video ingest reuses an active
shared transcript when present and otherwise creates or reuses one durable local
caption-first transcription path. Paused projects still retain the canonical
project video and the current member's flag but start no new local work.

Owners and Administrators can pause or resume local processing. Resume performs
a bounded catch-up over active, unprocessed project videos. The Workbench shows
the durable policy plus queued/active local job counts, known queued/active
source duration, and unknown-duration counts without treating those estimates as
billing or replacing worker concurrency authority.

## Smallest end-to-end proof

A Researcher directly ingests a captionless video into an Automatic project and
receives one canonical worklist row, one flag, one automatic local batch item,
and one deduplicated `captions-then-generate` job. Repeating or racing the same
ingest creates no additional item or job. After an Administrator pauses the
project, another direct ingest creates only the canonical row/flag and no job;
dispatch and a new worker claim cannot start queued local work. Resuming with an
optimistic, exactly replayable command creates at most 50 missing local items,
reports any remaining count, and makes eligible work claimable again. Existing
claimed work may drain safely and hosted approval remains unchanged.

## Affected authority boundaries and persisted records

- Shared contracts own the local-processing policy, strict optimistic command,
  bounded workload estimate, and response shapes.
- Cloud migration 0032 adds durable policy/version/actor/time to projects,
  exact-replay command receipts, and an explicit project-local automatic batch
  origin with uniqueness for automatic project/video items.
- The shared catalog remains authoritative for policy authorization, replay,
  automatic item/job composition, bounded catch-up, workload aggregation, and
  dispatch/claim eligibility.
- Direct metadata-resolve and canonical add-video routes keep their existing
  video response while invoking the catalog composition boundary.
- `BatchWorkspace` reads and changes the real policy and presents workload
  estimates; it does not create jobs or infer worker/provider state.
- Existing worker configuration remains authoritative for one-to-eight local
  lanes and caption discovery before configured Whisper generation.

## Failure, restart, concurrency, authorization, and migration behavior

- Policy changes require a current Owner or Administrator, an exact expected
  policy version, and a stable idempotency key. Exact replay returns the stored
  response; a divergent key, stale version, nonmember, removed member,
  Researcher, or Viewer fails closed.
- Historical projects migrate to Automatic without fabricated actor/time
  evidence. Historical batches remain manual and retain their existing state.
- Policy, automatic batch/item, and job records survive restart. A project row
  lock plus database uniqueness serializes concurrent direct ingest and bounded
  catch-up so no duplicate automatic item or job is created.
- Pausing blocks new local queue reservation, queue-delivery recording, and
  worker claim. It does not terminate an already claimed lease, mutate immutable
  job options, cancel hosted work, or block lightweight review.
- Automatic composition skips dismissed rows, active transcripts, and an
  existing automatic item/equivalent local job. Language conflict/capability
  gates remain authoritative and actionable through the existing batch item.
- Resume processes at most 50 candidates per command and returns a remaining
  count. A later distinct optimistic command may reconcile another bounded
  page; exact command replay never repeats side effects.
- Workload estimates count distinct local jobs, separate queued from active,
  sum only known source durations, and report unknown-duration counts. They are
  not monetary, completion-time, CPU, or provider-cost promises.

## Explicit non-goals

- Idle detection, overnight operating-system scheduling, battery/thermal
  policy, dynamic worker-lane changes, or background-service redesign.
- Project dollar/token budgets, provider pricing/billing, hosted worker
  provisioning/scaling, or automatic hosted approval.
- Keyword scans/summaries, broader notifications, invitations/settings,
  visible VERA shell redesign, PUNCH-005 through PUNCH-010, or PUNCH-009.
- Live providers/media, production data, deployment, external service actions,
  commit, or push.

## Acceptance criteria

1. Automatic direct ingest creates/reuses one local caption-first batch item and
   deduplicated job only when no active transcript/equivalent automatic item
   exists; repeated and concurrent ingest remain one canonical row/flag/item/job.
2. Paused direct ingest preserves the row and flag without creating work, and
   pause blocks local dispatch reservation/delivery and new worker claims while
   allowing an already claimed attempt to drain.
3. Owner/Administrator policy commands are current-role checked, optimistic,
   exactly replayable, divergent-key safe, cross-project isolated, and denied to
   Researcher/Viewer/nonmember/removed-member actors.
4. Resume catches up at most 50 active unprocessed rows, reports remaining work,
   and does not process dismissed rows, active transcripts, or existing
   equivalent work.
5. Workload reads are membership-bounded and accurately report distinct queued/
   active local counts plus known and unknown duration totals across direct and
   bulk local work.
6. Automatic policy does not change hosted approval, review, triage, priority,
   flags, transcript evidence, clips, artifacts, immutable job options, or
   configured worker concurrency.
7. Clean/populated migration, contracts, catalog/API/queue/worker/browser tests,
   typecheck, builds, migration CLIs, scoped formatting, aggregate tests, and
   `git diff --check` pass without external access.

## Narrow tests first

1. Strict contract and clean/populated migration tests.
2. Catalog authorization/replay/concurrency/direct-ingest/catch-up/workload
   tests, including project-policy enforcement at dispatch and claim.
3. Cloud API forwarding plus queue-pump reservation tests.
4. Focused Chromium policy/workload/direct-ingest flow.
5. Typecheck, affected aggregate suites, migration CLIs, full Playwright,
   builds, scoped Prettier, and `git diff --check` before closure.

## Completion record

Completed 2026-08-24.

### Decisions and delivered behavior

- Cloud migration `0032_project_local_processing_policy.sql` adds independent
  Automatic/Paused policy state/version/actor/time evidence, exact-replay
  command receipts, and a distinct `manual | project_local` batch origin.
  Historical projects safely default to Automatic without an invented actor or
  time, and historical batches remain Manual. A uniqueness constraint retains
  one automatic processing batch per project.
- Direct user-facing canonical ingest opts into project-local composition. It
  serializes on the project, preserves one canonical row and member flag,
  skips dismissed or transcript-ready rows, reuses equivalent active local
  jobs, and otherwise creates one durable `captions-then-generate` local item.
  Unknown-language items remain behind the existing language confirmation gate;
  no translation consent or provider capability is fabricated. Internal
  catalog setup calls retain an explicit no-automation default.
- Current Owners and Administrators change policy with strict optimistic
  versions, payload-hashed idempotency keys, exact replay, divergent-key
  rejection, and project-scoped locking. A command may intentionally set an
  already-Automatic project to Automatic again to reconcile the next bounded
  page. Each pass creates at most 50 missing items and reports the remaining
  active unprocessed count.
- Workload reads are current-membership bounded and count distinct queued and
  active local jobs with separate known-duration totals and unknown-duration
  counts. The configured one-to-eight local worker lanes remain authoritative;
  the estimates make no billing or completion-time promise.
- Pause is enforced at undispatched discovery, atomic dispatch reservation,
  queue-delivery recording, and worker claim/reclaim. Already claimed work may
  heartbeat and finish safely. Hosted approval behavior, immutable job options,
  transcript evidence, flags, triage, review, clips, and artifacts are
  unchanged.
- The automatic processing batch remains durable catalog evidence but is hidden
  from legacy manual batch/review lists, and ordinary batch controls reject it,
  preventing a second UI authority from bypassing the project policy.
- The Workbench loads and clears policy with project context, shows durable
  state plus bounded workload, and issues stable SHA-256 Pause/Resume/Queue next
  50 commands. The Chromium flow proves workload text, policy transitions,
  expected versions, and distinct stable command keys against mutable API
  state.

### Primary files

- `packages/db-cloud/migrations/0032_project_local_processing_policy.sql`
- `packages/contracts/src/index.ts`
- `packages/catalog/src/index.ts`
- `apps/cloud-api/src/app.ts`
- `apps/cloud-api/src/job-queue.ts`
- `apps/web/src/batch-workspace.tsx`
- Corresponding contract, migration, catalog, API, queue-pump, and Chromium
  tests.

### Verification evidence

- `npm run typecheck` — passed.
- Focused Vitest matrix for contracts, cloud migrations, catalog, cloud API,
  and queue pump — 5 files passed; 140 tests passed; 2 optional PostgreSQL
  tests skipped. A final focused catalog rerun after hiding automatic batches
  also passed.
- Aggregate `npm test` — 53 files passed, 1 skipped; 582 tests passed, 4
  skipped.
- Full Playwright gate — 11 passed, including the mutable Automatic/Paused
  workload and bounded-resume flow.
- `npm run build:desktop` — passed and included the production web build. Vite
  retained its existing advisory for a roughly 506 kB minified web chunk.
- Cloud migration CLI — 32 migrations applied and validated. Local migration
  CLI — 30 migrations applied and validated; no local migration was required.
- Scoped Prettier on the supported changed TypeScript/TSX/Markdown files passed.
  Migration SQL was manually reviewed because Prettier has no SQL parser. The
  known unrelated full-repository Prettier failure in
  `docs/Script-to-Resolve Product Spec.md` remains outside this slice.
- `git diff --check` passed after closure documentation.
- Root review covered current-role authorization, exact/divergent replay,
  project-row serialization, bounded catch-up, shared-job dependency semantics,
  removed-member actor tombstones, migration compatibility, automatic/manual
  UI authority, and discovery/reservation/delivery/claim races. No unresolved
  P0/P1 finding remained. Terra tooling was unavailable, so no independent-agent
  review is claimed.

### Remaining bounded risks and follow-ups

- Project dollar/token budgets and provider billing remain a separate hosted-
  processing policy slice. Automatic hosted approval was not introduced.
- Idle/overnight OS scheduling, battery/thermal policy, and dynamic worker-lane
  control remain intentionally deferred; this slice only controls whether new
  local starts are eligible.
- A queue signal rejected after publication is safely deleted; its durable job
  remains queued and becomes discoverable after the existing dispatch-reservation
  timeout, while direct local claims are immediately eligible on resume.
- Failed or canceled local batch items remain authoritative remediation evidence
  and are not silently replaced by automatic catch-up. A deliberate retry path
  remains responsible for those rows.
- No live provider/media, production data, deployment, commit, push, or external
  service action was used. Commit ID: none (not requested).
