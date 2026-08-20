# M7 — Pilot distribution, independent QA, and operator documentation

Status: future milestone specification. Promote to `specs/active/` and split
into bounded vertical slices after Milestone 6 passes its gate.

## User-visible outcome

A nontechnical collaborator can receive a versioned release and documentation
link, install the application on one supported clean machine, sign in and finish
setup, perform the core research and export workflows, understand recoverable
failures, update or remove the software safely, and send a useful diagnostic
report without developer tools or live developer assistance.

The milestone also creates a bounded handoff package for an independent QA
contractor. QA uses dedicated test access and rights-cleared fixtures, follows a
versioned acceptance matrix, and returns reproducible evidence without receiving
production credentials or private project media.

## Product decision

Milestone 6 proves the completed product workflow. Milestone 7 turns that
workflow into an independently installable and operable pilot release. A green
automated suite or a developer-run local checkout is necessary evidence, but it
is not sufficient evidence that a nontechnical collaborator can use the
software.

The first pilot may deliberately support one operating system and one documented
provider/worker profile. The selected profile must be explicit in the release
manifest and documentation. Expanding platform parity is a later decision, not
an excuse to leave the supported path dependent on a terminal.

## Smallest end-to-end proof

1. A maintainer publishes one release candidate, checksum/build identity,
   version-matched documentation bundle, isolated QA fixture pack, and test
   account/project instructions.
2. An independent nontechnical collaborator starts from the supported clean
   machine and installs without source code, Node/npm, shell commands, or cloud
   console access.
3. First run explains privacy/rights behavior, gathers only required settings,
   stores credentials safely, and reports whether every required service/tool is
   ready before accepting work.
4. Using the supplied guide, the collaborator opens a project, resolves a
   fixture transcript, navigates/selects text, logs one clip, exports one clip,
   finds its verified package, and restarts the application while durable work
   is in progress.
5. The collaborator completes one authorized real-source workflow, then follows
   the guide to recover from one seeded provider/network/tool failure.
6. The collaborator creates a redacted support bundle. A maintainer can identify
   the build, failed boundary, and remediation evidence without a credential,
   presigned URL, private object key, or reusable source-media locator.
7. Update/reinstall preserves durable data. Uninstall offers an explicit,
   verified choice to preserve or remove application-owned data.
8. A separate QA contractor executes the published matrix. No critical/high
   defects remain open; accepted lower-severity issues appear in the release
   notes or known-issues guide.

## In scope

### Supported release profile

- Select and publish one supported pilot operating-system version range,
  hardware baseline, worker/provider profile, and required network access.
- Produce a versioned release artifact with checksum, build/commit identity,
  release notes, and the selected platform's ordinary signing/notarization or
  equivalent trust requirements.
- Bundle required application runtimes and tools where licensing and size allow.
  When a model/tool must be acquired separately, provide an in-app guided,
  checksum-verified installation instead of shell instructions.
- Launch, stop, and restart the web client and loopback local agent as one
  product. Detect unhealthy or conflicting instances and offer safe recovery.

### First run and ordinary operation

- Sign in and confirm project access.
- Select and validate output, cache, and temporary-storage locations.
- Configure the documented local/cloud worker, transcript, translation, and
  acquisition providers with plain-language privacy and retention explanations.
- Store secrets in the operating-system credential store or an equivalently
  protected boundary; application databases and files retain references only.
- Run readiness checks for version/build, disk space, permissions, network,
  cloud API, local agent, required tools/models, worker registration, output
  writability, and provider capability.
- Block only the affected operation when a capability is unavailable. Preserve
  browsing, logging, cached transcripts, and other unaffected work.
- Present actionable remediation without exposing raw commands as the normal
  user path.

### Update, recovery, and removal

- Preflight local schema/data compatibility and free space before updating.
- Back up or checkpoint durable local state before a risky migration, define the
  supported rollback/recovery boundary, and never silently discard a newer
  user database.
- Preserve projects, settings, jobs, caches, and completed artifact locators
  across a normal update/reinstall when compatible.
- Make uninstall behavior explicit: application binaries can be removed while
  durable data is preserved, or application-owned data can be deliberately
  removed after a confirmation that names the exact locations and consequences.
- Test interrupted launch/update, unclean shutdown, and restart/resume against
  durable job guarantees.

### Diagnostics and support handoff

- Provide plain-language health for local agent, shared API, worker, providers,
  tools/models, network, storage, permissions, and database migrations.
- Provide one user action that creates a bounded support bundle with build ID,
  platform profile, component health, sanitized recent events/errors, and job/
  artifact IDs needed for correlation.
- Exclude credentials, cookies/tokens, presigned URLs, private object keys,
  transcript/media content, reusable source locators, and unrestricted local
  paths. Let the user inspect the bundle before sharing it.
- Provide a stable issue template covering environment/build, severity,
  reproduction steps, expected/actual result, frequency, screenshots when safe,
  and support-bundle attachment.

### First shareable documentation set

Publish a version-matched documentation bundle in repository Markdown plus a
nontechnical shareable form such as a small static help site or PDF. It covers:

- supported system requirements and known limitations;
- install, first launch, update/recovery, and uninstall;
- sign-in, project access, output/cache choices, providers/tools/models, and
  readiness checks;
- immediate review, batch preparation, all three selection actions, conversion
  presets, multilingual evidence/subtitle behavior, and the Clip Library;
- where durable data, cache, scratch media, and completed exports live, including
  privacy, authorization, retention, and cleanup behavior;
- status/error meanings, retry/cancel boundaries, offline behavior, and common
  recovery procedures;
- how to reveal/verify/relink/re-export an artifact;
- how to collect diagnostics and report an issue safely.

Every tested task in the QA matrix links to the exact documentation section the
tester should use. Documentation defects are tracked like product defects.

### Independent QA kit and execution

- Rights-cleared fixture media/transcripts plus a documented authorized-real-
  source slot; no tester must use personal or questionable media.
- Dedicated least-privilege test identities/projects with setup, expiration,
  reset, and teardown instructions; never distribute production credentials.
- Acceptance matrix covering clean install, update from the previous supported
  build, uninstall/reinstall, first-run readiness, immediate review, batch
  preparation, preferred-language display/logging, all three clip actions,
  preset alternatives, multilingual/English subtitle policies, Clip Library,
  artifact actions, restart/resume, and support-bundle creation.
- Degraded-state cases for offline/cloud outage, provider unavailable, missing
  tool/model, denied filesystem permission, unwritable output, bounded low-disk
  simulation, stale worker, canceled/failed work, and moved/corrupted artifact.
- A severity rubric: critical means security/data loss or a completely blocked
  install/core workflow; high means a major documented workflow has no safe
  workaround; medium/low issues require explicit triage and release-note or
  known-issue treatment when accepted.
- Evidence requirements: build ID, test case, result, reproduction, expected/
  actual behavior, safe screenshot/video when useful, and redacted support
  bundle for relevant failures.
- Final QA report with environment matrix, passed/failed/not-run cases, linked
  defects, retest evidence, residual risks, and release recommendation.

## Explicit non-goals

- Adding new research, editing, AI, collaboration, or hosted-scale features.
- App-store publication or public consumer launch.
- Multi-platform parity in the first pilot unless separately scoped.
- Enterprise software distribution, silent install, mobile support, or managed
  device policy.
- Giving a QA vendor production access, personal media, unrestricted cloud
  credentials, or developer workstation access.
- Replacing automated tests with manual QA; independent QA adds installation,
  comprehension, and real-operation evidence to the existing suite.
- A 24/7 support desk, formal SLA, public knowledge base, or polished marketing
  site.

## Failure states

- Release artifact cannot be trusted or matched to a build: block installation
  and provide a verified replacement path.
- Required component is absent or incompatible: readiness names the component,
  affected operations, supported version, and guided remediation.
- Sign-in/project/provider setup fails: preserve entered nonsecret settings,
  protect secrets, and offer a safe retry without leaving partial registration.
- Update migration fails: retain the prior durable data/checkpoint, do not start
  against a half-migrated store, and present recovery instructions.
- Local agent fails to start or becomes unhealthy: show component health and a
  bounded restart/diagnostic action; never ask the ordinary user to inspect a
  developer terminal.
- Network/provider becomes unavailable during work: persist status, stop unsafe
  side effects, and resume/retry according to the immutable job contract.
- Support bundle contains a prohibited secret/content field: fail bundle
  creation closed and treat it as a release blocker.
- Documentation and UI disagree: treat the tested workflow as failed until the
  product or version-matched guide is corrected.
- QA cannot execute a required case without maintainer intervention: record the
  exact blocker; the milestone cannot pass on an assumed result.

## Acceptance criteria

1. One supported release profile and versioned artifact are explicit and
   reproducible from the tagged/committed source.
2. A clean-machine collaborator installs, launches, configures, and removes the
   application without a terminal, source checkout, package manager, cloud
   console, production secret, or live developer coaching.
3. First-run readiness correctly detects every dependency required by the
   supported workflow and explains any blocked capability.
4. Credentials and diagnostic output satisfy the secret/redaction boundary.
5. The version-matched documentation lets the collaborator complete the fixture
   workflow and one authorized real-source workflow.
6. Restart during durable work and update/reinstall do not lose accepted
   commands, project data, completed package history, or compatible locators.
7. Uninstall makes preserve/remove behavior explicit and touches only validated
   application-owned locations.
8. A seeded failure can be understood and recovered through the documented UI,
   and its support bundle lets a maintainer identify the failing boundary.
9. Independent QA executes every required matrix case or records an explicit
   release-blocking reason it could not be run.
10. All critical/high defects are fixed and retested. Every accepted medium/low
    defect is linked from release notes or known issues with a workaround or
    limitation statement.
11. The final QA report, release artifact/checksum, documentation version, test
    account teardown, and release decision are retained as durable records.

## Expected slice boundaries when activated

1. Supported-profile decision, distribution spike, and reproducible release
   manifest.
2. Installer/launcher plus local-agent supervision and platform trust.
3. First-run setup, readiness checks, and protected credential storage.
4. Update/data migration recovery and uninstall semantics.
5. Diagnostics, redacted support bundle, and issue-reporting boundary.
6. Version-matched first-pass documentation and shareable publishing format.
7. QA kit, isolated identities/fixtures, independent execution, defect triage,
   retest, and final pilot release decision.

Each slice needs its own active spec and verification evidence. Do not begin
outsourced QA until the release candidate, documentation, accounts, fixtures,
reset procedure, and data-handling rules are complete.
