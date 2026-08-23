# OPS-01 — Production observability and Sentry error pilot

- Status: queued future slice; do not implement from `specs/future/`
- Task/thread: OPS-01 only
- Sequence: after M7 has a production deployment and before the first external
  M8 pilot test

## Activation gate

Before implementation, confirm all of the following:

1. `specs/active/` contains no other task. Move this file to
   `specs/active/OPS-01-production-observability-and-sentry-pilot.md` and update
   its status to `active`.
2. The M7 production deployment exists for the desktop renderer/web build and
   cloud API, with a deployed worker target where worker observability will be
   enabled. Do not add production observability to development-only entrypoints
   with no deployment path.
3. The user has supplied or locally configured separate browser and backend
   Sentry projects/DSNs. Do not reuse another application's DSN or create an
   external Sentry project without explicit authorization.
4. If source maps will be uploaded, the deployment environment has a dedicated
   build-only Sentry token. It must be distinct from any read-only triage token,
   stored in CI/secret management, and never exposed to browser or runtime
   configuration.
5. Review the current official Sentry React/Vite, Node ESM, and Fastify guidance
   before selecting package versions or initialization mechanics. Record the
   consulted links and any version-sensitive decision in the completion record.

If these inputs are unavailable, stop and report the missing prerequisite. Do
not leave a half-enabled SDK, public source maps, or placeholder credentials.

## User-visible outcome

During a production pilot, an unexpected browser crash, cloud-API 5xx failure,
or worker-service fault creates one privacy-scrubbed, release-associated Sentry
event without interrupting the application's durable retry/recovery behavior.
Expected validation, provider, authorization, cancellation, and job-lifecycle
outcomes remain in their existing UI and durable job records rather than
becoming noisy Sentry issues. Operators can also see queue stalls and dead-letter
messages through CloudWatch alarms.

With every Sentry DSN absent, all applications must retain their current
behavior and start normally with a no-op observability adapter.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, `.env.example`, the root and application
package manifests, the web Vite entry/build configuration, both Fastify
entrypoints/error handlers, the worker supervisor/entrypoint, and
`infra/aws/template.yaml`. Limit edits to configuration, a vendor-neutral
observability boundary, runtime adapters/bootstrap, targeted error hooks,
source-map build wiring, AWS queue alarms, and their tests.

Preserve these existing boundaries:

- Expected transcription/export failures remain durable, actionable job state.
- Worker observability must never terminate a lane, steal a lease, acknowledge a
  queue message, change retryability, or alter finalization/cleanup.
- Browser reporting must not alter project selection, transcript resolution,
  playback, logging, or export behavior.
- The local agent remains local-only and Sentry-disabled in this slice.
- Sentry is an error-aggregation service, not the authority for projects,
  transcripts, jobs, artifacts, retries, or queue health.

## Decisions fixed for this slice

1. Use the normal package/build pipeline, not a runtime CDN import.
2. Use one browser Sentry project and one backend Sentry project initially. Tag
   backend events with the low-cardinality service name `cloud-api` or `worker`.
3. Error monitoring is enabled only when the matching DSN is configured.
   Development and tests default to disabled/no-op operation.
4. Disable session replay. Set performance tracing and profiling to zero/off for
   the pilot unless a separate approved spec changes that policy.
5. Do not send user identity, project/video/job/clip IDs, transcript or subtitle
   content, research notes/tags, YouTube URLs, request/response bodies, query
   strings, credentials, presigned URLs, command arguments/output, local paths,
   filenames, environment-variable contents, or local-variable values.
6. Only stable, allowlisted, low-cardinality fields may accompany an event:
   `service`, `environment`, `release`, `operation`, `failure_class`, and an HTTP
   status category where applicable.
7. CloudWatch owns queue/DLQ health alarms. Do not synthesize queue backlog,
   missing-heartbeat, or dead-letter conditions as Sentry exceptions.
8. Scheduled Sentry triage or repair automation is not part of this slice.

## In scope

### 1. Vendor-neutral observability boundary

Add the smallest shared, SDK-independent contract needed by the three reporting
runtimes. It should support a no-op implementation plus an operation such as:

```ts
captureUnexpectedError(error, {
  service,
  operation,
  failureClass,
  statusCategory,
});
```

Keep browser and Node SDK imports in runtime-specific adapters so shared domain
packages do not depend on Sentry. The contract must be best-effort: adapter or
transport failure is swallowed after a safe local warning and cannot change the
calling operation's result.

Implement a single shared allowlist-based sanitizer for explicitly supplied
context. Add runtime `beforeSend` processing as a second line of defense that:

- removes user, request body/data, headers, cookies, query strings, extras,
  attachments, and breadcrumbs not explicitly created by this boundary;
- removes or replaces absolute paths, URLs, bearer/token-like values, and
  unexpected strings in exception messages;
- retains stack frame/module/function information needed for debugging while
  preventing local-variable capture; and
- drops an event entirely if it cannot be reduced to the approved schema.

Do not accept arbitrary context objects at call sites. Prefer closed enums or
validated string unions for service, operation, and failure class.

### 2. Configuration and credentials

Extend validated configuration only for runtime-safe values:

- browser DSN exposed through the established Vite-safe configuration path;
- backend DSN available only to Node runtimes;
- explicit `environment` and immutable `release` values; and
- an enable/disable decision derived from a valid DSN, not from package
  presence.

Document variable names with empty examples. Never add a real DSN or token.
Keep the source-map upload token outside normal runtime configuration; pass it
to the build plugin only from CI/secret management. Do not name or reuse that
write-capable token as the read-only `SENTRY_AUTH_TOKEN` used by issue-triage
tools.

### 3. Browser pilot

- Initialize the supported Sentry React/browser SDK before rendering the app,
  but allow rendering to continue if initialization or transport fails.
- Add a top-level React error boundary for render failures and retain global
  uncaught-error/unhandled-rejection capture supplied by the supported SDK.
- Add stable operation capture only at caught boundaries where an unexpected
  application defect would otherwise disappear. Do not capture ordinary failed
  requests, form validation, authorization denials, unsupported sources, user
  cancellations, or known races.
- Avoid duplicate reports between the React boundary, global handlers, and
  explicit capture calls.
- Do not persist a browser diagnostics ring containing research content in this
  slice.

### 4. Cloud API pilot

- Initialize the Node SDK early enough for the current ESM/Fastify versions,
  following current official guidance rather than relying on import order by
  accident.
- Integrate with the existing Fastify error boundary. Capture only unexpected
  server failures that will produce a 5xx response; exclude Zod validation,
  authentication/authorization, conflicts, not-found responses, and other
  expected 4xx outcomes.
- Preserve the existing client-safe generic 500 response and status code.
- Add structured, redacted local/server logs for the same unexpected failure,
  without logging request headers/bodies or the raw exception message when it
  fails the approved sanitizer.

### 5. Worker pilot

- Capture unexpected supervisor/claim-loop faults through the existing
  best-effort `onUnexpectedError` hook and capture fatal startup/bootstrap
  failures before exit where the SDK can safely flush within a short bound.
- Do not capture executor/provider failures merely because a job failed; those
  already become durable job state. Capture only a defect in the worker
  supervisor/control path or a separate explicitly classified invariant breach.
- Preserve concurrency, heartbeat/lease behavior, retry/backoff, cancellation,
  scratch cleanup, and shutdown draining exactly.
- Emit a matching safe structured log without exposing source URLs, transcript
  text, tool output, commands, credentials, paths, or durable entity IDs.

### 6. Releases and browser source maps

- Associate browser and backend events with the same immutable deployed release
  identifier, normally the deployed commit SHA or deployment version.
- Configure the supported Vite/Sentry build integration to generate and upload
  matching browser source maps only in the authorized production build.
- Ensure source maps are not included in the public deployment artifact after a
  successful upload. A missing upload token must fail the production release
  preflight when Sentry is enabled; it must not silently deploy minified code
  with unusable diagnostics.
- Keep upload credentials out of browser bundles, generated config, logs, and
  source control.

### 7. AWS queue health alarms

Extend the CloudFormation template and infrastructure tests with alarms for:

- any visible message in `JobDeadLetterQueue`;
- `JobQueue` oldest-message age above a configurable threshold; and
- `JobQueue` visible backlog above a configurable threshold.

Use parameters or environment configuration for workload-dependent thresholds.
Allow an optional notification target rather than hard-coding an account/topic.
Keep development and production values separate and verify that an omitted
notification target still creates inspectable alarms without an invalid action.

### 8. Documentation and operator verification

Document:

- runtime/build configuration and the browser-DSN versus secret-token boundary;
- the exact capture/exclusion/privacy policy;
- how to trigger controlled browser, API, and worker test failures in a
  non-production environment;
- how to inspect an entire received event for forbidden fields;
- how to verify release/source-map association; and
- how to disable reporting immediately without breaking application startup.

## Explicit non-goals

- Sentry instrumentation for the loopback local agent.
- Session replay, performance tracing, profiling, user feedback, product
  analytics, or transcript/media observability.
- Persisting local browser diagnostic history or adding a diagnostics-download
  UI.
- Capturing expected provider/media/tool errors, every failed job, 4xx requests,
  lease loss, cancellation, retry, or validation failures.
- Changing shared contracts, project authorization, databases, migrations,
  transcript/artifact schemas, job state machines, queue acknowledgement,
  retries, or scratch cleanup.
- Creating Sentry organizations/projects, changing Sentry retention or alert
  policies, resolving issues, deploying, or committing/pushing code.
- Scheduled Codex triage, automated fixes, source-control changes, deployment,
  issue resolution, or team notification driven by Sentry.

## Failure states

- Missing/malformed DSNs disable the matching runtime cleanly outside an
  explicitly Sentry-enabled production release. An enabled production release
  with missing/malformed DSNs fails preflight before deployment.
- Missing source-map credentials fail an enabled production build before
  deployment; they never appear in emitted assets or logs.
- SDK initialization/import/transport failure leaves the application usable,
  produces at most one safe local warning per failure class, and cannot recurse
  through the observability adapter.
- Sanitization failure drops the event. It must never fall back to sending the
  raw error or context.
- Sentry latency/outage does not delay normal requests, worker retry/backoff, or
  browser interaction beyond a short bounded shutdown flush for fatal Node
  failures.
- Repeated expected failures do not create Sentry noise. Repeated equivalent
  unexpected failures group consistently without including entity IDs in the
  fingerprint.
- CloudWatch alarm resources validate for both development and production
  parameter sets, with and without an optional notification target.

## Acceptance criteria

- With all DSNs absent, focused tests and all three application entrypoints use
  no-op adapters and preserve current behavior.
- One controlled browser render exception, one cloud-API 5xx exception, and one
  unexpected worker-loop exception each produce exactly one event through a
  fake transport, tagged only with approved low-cardinality fields.
- Controlled validation, authentication, not-found/conflict, provider failure,
  cancellation, retry, and lease-loss paths produce no Sentry event and retain
  their existing user-visible/durable outcomes.
- Tests inject nested secrets, authorization headers, presigned URLs, YouTube
  URLs with query strings, transcript/note text, absolute paths, filenames,
  command output, circular data, and oversized strings. None survives in the
  captured event or structured log.
- Observability-adapter failure does not change HTTP responses, worker results,
  leases, acknowledgements, cleanup, retries, or browser rendering outside the
  deliberately tested error boundary.
- A production-like browser build carries the configured release, uploads maps
  through a fake or controlled provider boundary, and leaves no `.map` files in
  the public artifact.
- The CloudFormation template exposes valid alarms for DLQ visibility, queue
  age, and backlog under both environment parameter sets.
- If approved DSNs are available, a controlled non-production smoke test is
  inspected in Sentry and contains no forbidden content. Live Sentry access is
  optional for normal automated tests and must never use production user data.

## Verification plan

1. Run focused sanitizer/adapter tests first, including drop-on-uncertain input,
   recursive secret/path/URL removal, no-op behavior, transport failure, and
   duplicate suppression.
2. Run focused web tests for the error boundary plus one unexpected and several
   excluded caught failures.
3. Run focused cloud-API tests proving one captured 5xx, excluded 4xx outcomes,
   unchanged response bodies/statuses, and transport-failure isolation.
4. Run focused worker supervisor tests proving one unexpected-loop capture,
   excluded durable job failures/lease loss, unchanged backoff/concurrency, and
   observer-failure isolation.
5. Run infrastructure tests for all alarm resources and both parameter files.
6. Build the web app in disabled and production-like enabled modes; inspect the
   emitted bundle/config for tokens, DSNs in expected browser-safe locations,
   release identity, and absence of public source maps.
7. Run `npm run typecheck`, relevant application/package suites,
   `npm run build:web`, infrastructure tests, `npm run check`, and
   `git diff --check`.
8. Review the complete diff for raw context capture, request/body/header
   logging, unexpected SDK imports in domain packages, startup/import-order
   hazards, new job-state side effects, unbounded flushes, public maps, tokens,
   and local-agent activation.
9. When approved non-production Sentry inputs exist, trigger the three
   controlled faults, inspect the complete received payloads and grouping, then
   disable the test routes/fault switches before completion.

## Completion record template

- Decisions made:
- Official references and versions reviewed:
- Sentry projects/environments used for the optional smoke test (no DSNs or
  tokens):
- Files changed:
- Checks run and actual results:
- Received-event privacy inspection result:
- Remaining risks/follow-ups:
- Commit ID(s):

After all acceptance criteria pass, move this file to `specs/completed/`, update
its status and completion record, and update `PROJECT_GUIDE.md`, `outline.md`,
or `README.md` only for behavior actually completed and verified.
