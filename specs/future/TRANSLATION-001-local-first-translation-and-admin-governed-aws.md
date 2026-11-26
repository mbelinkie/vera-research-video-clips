# TRANSLATION-001 — Local-first translation and admin-governed AWS

Status: future implementation program. Execute the bounded slices below in
dependency order with exactly one specification in `specs/active/` per task.

Research basis:
`docs/research/local-translation-model-and-aws-governance-2026-08-26.md`.

## User-visible outcome

VERA translates transcript text locally by default without a per-call API
charge. It downloads only release-approved language packs, keeps at most the
current signed-in user's non-English preferred target pack, and deletes every
other translation pack after active work releases it.

A user who wants Amazon Translate as the primary route can submit an account-
level request after accepting the remote-text and paid-service disclosure. A
platform administrator can approve, deny, or later revoke access from a global
in-app queue and may include a short optional message with any decision. AWS is
never enabled by a project role or an old desktop provider setting.

## Current state and compatibility constraints

- The provider-neutral `TranslationProvider` boundary and immutable original,
  canonical-English, and supplemental translation tracks already exist.
- Verified local/project derivatives are resolved before provider work. Keep
  that precedence: a provider preference never justifies regenerating an
  existing usable track.
- Preferred translations remain linked to the exact original track and base
  transcript version by source-video time. The canonical English track remains
  a collaboration/export role; a preferred translation does not advance the
  active base transcript pointer or add a preferred-language SRT to exports.
- Current production provider identity and historical Amazon Translate
  derivatives remain readable and reusable. Do not rewrite provenance.
- Current desktop provider/consent settings are historical configuration, not
  account-level AWS approval.

## Product decisions

### Provider resolution

For a requested source track and normalized preferred language:

1. Reuse an exact verified local derivative, then an authorized project-shared
   derivative, before any provider work.
2. If source and target share the same normalized primary language, use the
   source track and acquire no model.
3. If the target is English, use the canonical English track when verified;
   otherwise run local source-to-English translation.
4. If an unexpired AWS launch grant is attached to newly requested work, try
   Amazon Translate as primary.
5. Without an AWS grant, or after an AWS operational fallback, run local Argos
   translation.
6. If no approved local route exists and AWS is not granted, keep the language
   preference and return an actionable unsupported/unavailable state. Never
   substitute another language or label a track incorrectly.

Provider choice applies only when new work is required. A cached output from a
different provider remains preferable to a new paid or local computation when
it satisfies the exact immutable identity and authorization checks.

### English-hub local translation

- Use `argos-local` as the local provider identity and English as the internal
  routing hub.
- Non-English source to English acquires one source-to-English pack.
- English source to a non-English preference acquires one English-to-target
  pack.
- A non-English source to a different non-English target acquires both packs,
  runs source-to-English and English-to-target inside one provider operation,
  and publishes only the complete final target track.
- Preserve the original track as `sourceTrackId` for every final derivative.
  Record the ordered model chain and registry revision so the internal English
  pivot is explicit without treating the English track as a new source
  authority.
- Never publish a track containing segments from more than one provider. If a
  provider changes after failure, discard its partial text and regenerate the
  entire derived track with the fallback provider.

## Approved model registry

Ship a versioned, release-owned registry rather than downloading the mutable
Argos index at runtime. Each `TranslationModelDescriptor` must contain:

- stable descriptor ID and registry revision;
- normalized source and target BCP-47/ISO mapping plus display labels;
- exact Argos runtime and model/package versions;
- immutable HTTPS source, expected byte size, and SHA-256;
- SPDX/model license, training-data/provenance evidence, attribution and notice
  requirements, and review timestamp;
- supported desktop architectures and minimum runtime requirements;
- validation fixture/version, result, and `approved` status.

An entry is eligible only when the exact bytes pass license/provenance review,
commercial redistribution/use review, integrity verification, packaged runtime
compatibility, and the common functional/quality release gate. Apply identical
gates to every language pair. Do not promise equal semantic quality across
languages.

The account preferred-language picker and runtime capability checks consume the
approved registry, not a curated example list. Preserve a legacy normalized
BCP-47 preference even when unsupported and show its status. Use explicit
aliases/variant mappings in the registry; do not silently reduce arbitrary
regional/script tags to an unrelated pack.

Expose three distinct concepts in the UI and diagnostics:

- **Available upstream:** research information only and never executable.
- **VERA approved:** present in the signed/pinned release registry.
- **Installed:** verified bytes currently present on this workstation.

## Runtime and model lifecycle

### Sidecar boundary

- Package a pinned CPU-first Argos/CTranslate2 sidecar for the current Intel
  macOS application, then include macOS ARM64 and Windows x64 packs in the M8
  distribution work.
- Give the sidecar no network authority. Invoke it with argument arrays or a
  bounded structured process protocol; validate input/output schemas, segment
  identity, language pair, result completeness, timeouts, cancellation, and
  output size.
- Keep transcript text out of command lines, logs, crash reports, progress
  payloads, and support bundles. Return only bounded sanitized error codes.
- Electron/local-agent code owns downloads, paths, leases, and deletion. The
  renderer receives descriptor IDs, lifecycle state, byte progress, and
  remediation only—never filesystem paths or executable authority.

### Storage and leases

Store models in a private app-owned root with atomic staging. Every artifact has
an exact descriptor identity and one of these durable states:

```text
download_required -> downloading -> verifying -> ready -> in_use
                         |              |          |         |
                         +--------------+----------+---------+-> deleting
                                                               |       |
                                                               deleted cleanup_failed
```

- Preflight expected bytes plus the established 2 GB safety reserve before a
  download; a missing model blocks only dependent translation work.
- Download to a random contained `.part` path, bound maximum bytes, verify size
  and SHA-256, inspect the archive without path traversal, and atomically
  activate only the expected files. Failure leaves a prior verified pack
  untouched.
- Use durable model leases/reference counts keyed to exact job/attempt and
  descriptor. Concurrent translations may share verified bytes; deletion waits
  for the last lease.
- On success, failure, cancellation, or lease loss, release the exact leases.
  Retry cleanup independently without retranslating a verified output.
- Run a bounded startup sweeper for interrupted staging, expired leases,
  abandoned ephemeral packs, and `cleanup_failed` records. Delete only
  descriptor-owned contained paths and verify absence.

### Retention rule

- If the signed-in user's preferred language is English, retain no translation
  pack.
- Otherwise, lazily download and retain only the approved
  English-to-preferred pack on first need.
- Source-to-English packs and every other pack are ephemeral and are deleted
  after the final active lease releases them.
- When the preference or signed-in account changes, mark the previous retained
  pack for deletion immediately; delete after any active lease ends. Download
  the replacement only when translation first needs it.
- At steady state there is at most one retained preferred target pack per
  installation. Public model bytes are not duplicated per account.
- Model deletion never deletes cached transcript derivatives, immutable shared
  translations, or logged clip evidence.

## AWS account access and launch policy

### Authority and lifecycle

Use a Cognito `vera-platform-admins` group as the sole paid-translation
decision authority. Normalize the verified group claim into an application
capability such as `manageAwsTranslationAccess`; do not trust renderer state,
project Owner/Administrator roles, or a mutable user-profile flag.

Each immutable `AwsTranslationAccessRequest` records request ID, user ID,
preferred language at request time, disclosure version accepted, state,
optimistic version, requested/decided timestamps and actors, and decision
history. States are:

```text
pending -> approved -> revoked
   |          |
   +-> denied +-> withdrawn
   +-> withdrawn
```

- One pending or approved request may exist per user. Denied, revoked, or
  withdrawn users may submit a new request with a new ID.
- Users can withdraw a pending request. An approved user can choose **Stop using
  AWS now**, which records `withdrawn`, invalidates the current launch grant,
  and routes new work locally immediately.
- Administrators can approve or deny pending requests and revoke approved
  requests with optimistic version checks and stable idempotency keys.
- Every approve, deny, and revoke command accepts an optional `message` of at
  most 500 Unicode characters. Normalize line endings, trim outer whitespace,
  remove disallowed control characters, treat empty as absent, store plain text
  only, and render it as escaped text. Preserve it in the append-only audit
  history and show it to the affected user.
- Decision history contains no transcript, project, source URL, local path, or
  provider credential.

### Launch grants

- At authenticated desktop launch, request one server-issued
  `AwsTranslationLaunchGrant` only if the latest account access state is
  approved. Bind it to user, random launch identity, approval request/version,
  issued time, and expiry no later than 12 hours.
- Keep the opaque grant secret in desktop main-process memory. Store only its
  server-side hash/record and never send it to React, SQLite, logs, transcript
  bundles, or a worker job payload.
- Validate the grant while accepting AWS-backed work, then attach the internal
  grant record ID and initiating user to the job server-side. Workers use that
  association and never receive the raw launch secret.
- Approval and administrator revocation take effect when the user next launches
  the app. A grant issued before administrator revocation may continue until
  app exit or its 12-hour expiry and cannot be renewed after revocation.
- User-initiated **Stop using AWS now** invalidates the current grant
  immediately. An AWS request already accepted by the service may finish, but
  no new AWS call may start.
- App exit performs best-effort invalidation and discards the secret. The
  server-side expiry is the crash backstop. Work that has not begun an AWS call
  stays actionable/local-fallback eligible on the next launch.

### AWS failure and metering

- Retry only network, throttling, and server failures, with at most three total
  attempts and bounded jittered backoff. Nonretryable authorization, request,
  or language failures skip retries.
- If AWS still fails, discard partial AWS output and rerun the whole derivative
  through `argos-local`. Record `fallbackFrom = amazon-translate` and the
  failure class without transcript text. If the local route is unavailable,
  retain an actionable failure rather than publishing partial work.
- Record successful AWS request count, billable source characters, language
  pair, initiating user, grant/access decision, timestamp, and translation job.
  Count/meter every successful AWS call even when its partial result is later
  discarded during whole-job fallback.
- Configure price-per-million characters, currency, and effective date outside
  application code. Display a clearly labeled estimate; do not subtract a free
  tier or imply it is an invoice. Reconcile aggregate application characters
  against AWS CloudWatch `CharacterCount` without putting user IDs in AWS metric
  dimensions.

## Contracts, APIs, and persistence

Add provider-neutral shared schemas before application-specific duplicates:

- `TranslationProviderId = argos-local | amazon-translate`;
- `TranslationModelDescriptor`, registry summary, installed model state, lease
  identity, download progress, and cleanup result;
- ordered `TranslationModelChain` in `DerivedTranslationIdentity`;
- `TranslationExecutionPolicy` with primary, fallback, registry revision, and
  optional internal AWS grant reference;
- AWS request, access status/history, admin decision, launch-grant summary, and
  usage-summary contracts;
- closed actionable error/remediation vocabularies for unsupported pair,
  download/integrity/license/runtime failure, cleanup failure, approval needed,
  grant expiry, and provider fallback.

Add authenticated cloud capabilities equivalent to:

```text
GET    /api/account/aws-translation-access
POST   /api/account/aws-translation-requests
POST   /api/account/aws-translation-access/withdraw
POST   /api/account/aws-translation-launch-grants
DELETE /api/account/aws-translation-launch-grants/:grantId

GET    /api/admin/aws-translation-requests
POST   /api/admin/aws-translation-requests/:requestId/decision
GET    /api/admin/aws-translation-usage
```

The decision command body contains `approve | deny | revoke`, expected version,
idempotency key, and optional message. The admin list is pending-first and can
filter by state without exposing research content.

Cloud persistence requires account access requests, append-only decisions,
launch grants/token hashes, idempotency receipts, and per-request AWS usage.
Local persistence requires model artifacts, exact descriptor state, leases,
retention intent, cleanup attempts, and startup-recovery evidence. Every schema
change receives a forward migration that fabricates no actor, approval,
license, installed-model, or usage history.

## User experience

### Account settings

- Present **Local translation** as the default, with approved-language
  capability, required download size, installed/retained status, progress,
  cleanup state, and remediation.
- Replace the current provider selector and standalone AWS consent checkbox with
  **Request AWS translation**, the disclosure, pending/current status, decision
  history/messages, **Cancel request**, and **Stop using AWS now**.
- An approval received during a running app says it will apply after relaunch.
  Administrator revocation similarly leaves the current launch snapshot honest;
  user opt-out remains immediate.
- A provider fallback is visible on the resulting translation provenance and
  job status without exposing internal credentials or raw provider errors.

### Platform administration

- Add a capability-gated global queue, separate from project settings. Show
  handle/display identity, preferred language, request time/state/version,
  decision history, current grant summary, successful AWS request count,
  billable characters, and estimated cost.
- Pending requests sort first. Approve, deny, and revoke each open the same
  confirmation pattern with an optional 500-character message and stale-
  version handling.
- Do not show transcript text, projects, video/source identity, local device
  paths, grants, or tokens.

### Language catalog

- Publish the release-approved list from the runtime registry in setup/account
  UI. Make it searchable and distinguish approved versus installed.
- Do not present the upstream 49-pair list as guaranteed product support. A new
  release may add approved packs without application code changes, but registry
  bytes remain pinned and release-reviewed.

## Migration and rollout

- Default every existing account/installation to local translation. No current
  user is automatically AWS-approved.
- Preserve old provider/consent fields only for backward reading and historical
  evidence during the migration window; stop using them for new authorization.
- Preserve every finalized AWS/local translation and provider/model identity.
  Shared-first reuse still applies after migration.
- An unstarted legacy job that explicitly requires AWS but has no approved
  grant transitions to `needs_aws_approval`/actionable state; it does not incur
  a paid call or silently mutate its immutable provider snapshot. The user may
  approve/relaunch or create a new local retry.
- Already accepted AWS calls may finish. Never change provider midway through a
  published derivative; whole-job fallback creates one local result identity.
- Keep the program behind release/configuration gates until the local runtime,
  registry, migrations, admin authority, and recovery tests pass. Do not enable
  an empty or unaudited registry as though it were usable local translation.

## Sequential bounded implementation slices

### 1. Registry, contracts, and audit tooling

Define shared types, release-owned registry validation, BCP-47 mapping, exact
pack audit fields, generated approved-language summaries, and deterministic
fixtures. Produce no runtime download until at least one bidirectional audited
route passes.

### 2. Secure local runtime and model manager

Package the sidecar for the current Intel Mac, extend desktop readiness and
storage preflight, implement atomic verified download, durable leases,
retention/deletion, startup recovery, and renderer-safe progress. Keep model
bytes private and translation disabled until the manager proves its lifecycle.

### 3. Local translation pipeline and provider policy

Implement the Argos adapter, one/two-pack English-hub routing,
direct-from-original provenance, shared/local reuse, immutable publication,
preferred-pack reconciliation, whole-output validation, and local-primary
policy. Remove no current AWS path yet.

### 4. AWS account governance, grants, and metering

Add verified platform-admin authority, cloud migrations, request/decision
history, optional admin messages, launch grants, immediate user opt-out,
usage/estimate accounting, and authorization checks at AWS job acceptance and
execution. Migrate no user to approved.

### 5. Account and administration UI

Replace provider/consent controls, expose local model/catalog state, implement
AWS request/history/stop flows, and add the global platform-admin queue with
approve/deny/revoke messages and usage estimates. Prove stale, unauthorized,
offline, and relaunch states through the real contracts.

### 6. Migration, fallback, packaging, and release gate

Migrate legacy settings/jobs, enable AWS-to-local whole-job fallback, complete
Intel macOS dogfood, and add ARM64 macOS/Windows x64 runtime/model packs to the
M8 signed dependency work. Update `PROJECT_GUIDE.md`, `outline.md`, help,
privacy, notices/SBOM, and operator documentation only for behavior actually
verified.

## Failure states

- Registry entry absent or unsupported preference: retain the preference and
  expose remediation; acquire nothing.
- Download interruption, oversize, checksum mismatch, invalid archive,
  incompatible runtime, or missing license evidence: fail closed and preserve
  prior verified bytes.
- Preference/account switch during translation: the active lease completes or
  cancels safely; old retained bytes delete only after final release.
- Crash or cleanup failure: startup recovery retries exact contained deletion;
  cached translated artifacts remain usable.
- Sidecar returns missing, duplicate, empty, reordered, oversized, or wrong-
  language results: publish nothing and retain an actionable provider failure.
- AWS request is pending/denied/revoked/withdrawn, grant is missing/expired, or
  initiating user differs: perform no AWS call.
- Admin command is unauthorized, stale, divergent replay, or invalid for the
  current state: mutate nothing and return an actionable conflict/denial.
- AWS fails after partial paid work: meter successful calls, discard partial
  text, and restart locally; never publish mixed-provider output.
- User stops AWS: invalidate the current grant immediately; only a call already
  accepted by AWS may settle.
- Admin revokes AWS: issue no new grant; a previously issued launch snapshot
  remains usable only until exit or its 12-hour limit.

## Test and acceptance gate

1. Registry tests reject mutable/unpinned URLs, missing size/checksum/license/
   provenance, duplicate language mappings, unsupported architectures, and
   unapproved entries; the UI list is generated from the accepted registry.
2. Model-manager tests cover lazy download, disk preflight, atomic activation,
   checksum/archive failure, cancellation, concurrent leases, preference and
   account changes, English/no-retention, startup recovery, cleanup retry, and
   the one-retained-target invariant.
3. Translation tests cover English source, non-English-to-English,
   English-to-preferred, non-English two-pack pivot, BCP-47 aliases, unsupported
   targets, exact segment/timing preservation, original-track linkage, model
   chain provenance, and no mixed-provider publication.
4. Resolution tests prove verified local/shared derivatives bypass both model
   download and AWS calls and never change the active base transcript.
5. Governance tests cover request/resubmission, one-active-request uniqueness,
   approve/deny/revoke with absent/present/max-length messages, sanitization,
   exact replay, stale conflict, platform-group authorization, project-role
   denial, history visibility, and removed administrator access.
6. Grant tests cover next-launch approval/revocation, 12-hour expiry, renewal
   denial after revocation, app-exit invalidation, crash expiry, immediate user
   opt-out, user/job binding, secret redaction, and no secret in renderer/SQLite/
   job payloads.
7. AWS tests use fakes to prove three-attempt retry classification, whole-job
   local fallback, partial-output discard, successful-call metering, estimate
   configuration/effective date, and aggregate CloudWatch reconciliation. Live
   AWS tests remain explicit, authorized, bounded, and cost-recorded.
8. Migration tests preserve populated local/cloud databases, completed
   provider provenance, legacy BCP-47 preferences, and historical consent while
   granting nobody AWS access and blocking unapproved queued paid work.
9. Packaged smoke tests prove offline local translation and cleanup on Intel
   macOS 15. M8 release acceptance repeats clean install/update/uninstall and
   lifecycle tests on macOS ARM64, macOS Intel, and Windows x64.
10. Security/privacy review verifies no transcript text, model path, token,
    grant, source URL, or credential appears in process arguments, logs,
    notifications, usage summaries, admin views, or support artifacts.

## Explicitly deferred

- Automatic per-user/project dollar caps, quotas, or budget exhaustion policy.
- GPU-specific local translation builds.
- Training or commissioning new language models to fill upstream gaps.
- Claiming equal model quality across languages.
- Cloud-hosted Argos inference or a bundled LibreTranslate server.
