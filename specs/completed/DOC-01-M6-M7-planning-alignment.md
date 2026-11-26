# DOC-01 — M6/M7 planning alignment

Status: completed documentation-only specification.

## User-visible outcome

The durable project plan describes a decision-complete, restart-safe Milestone 6
and the approved cross-platform Electron pilot architecture for Milestone 7,
including dynamic operation-specific storage checks instead of the former fixed
free-space requirement.

## Focused context

Milestones 1–5 are complete. M6 and M7 remain future work. M6 must compose the
existing M5 request, delivery, worker, and immutable success-result primitives
while establishing the Clip Library, local artifact availability, authoring
handoff, and runtime drain boundary M7 will consume. M7 must document the
approved desktop, cloud, authentication, update, reporting, storage, and
three-profile QA decisions without provisioning or implementation.

## Affected boundaries

- `PROJECT_GUIDE.md`: source-of-truth architecture, milestones, risks, package
  boundaries, and intentionally configurable decisions.
- `outline.md`: concise M6/M7 execution checklist and domain/package diagrams.
- Future M6 and M7 specifications: bounded slice order, contracts, failure
  states, gates, and verification plans.
- `docs/decisions/`: durable rationale for the approved M7 pilot boundary.

## Explicit non-goals

- Do not activate M6 or M7 or mark any future checklist item complete.
- Do not change application code, schemas, dependencies, infrastructure, or CI.
- Do not provision AWS resources, signing identities, a GitHub App, tester
  accounts, or the private feedback repository.
- Do not alter M5 decisions or unrelated worktree changes.

## Failure states

- M6 invents a second artifact identity or rendering path instead of composing
  M5 primitives.
- Local workstation paths appear in shared/cloud contracts or diagnostics.
- M7 retains obsolete one-platform, open-wrapper, or fixed global free-space
  language.
- The documentation implies that future prerequisites have already been
  created or that either milestone is active or complete.
- Formatting or cross-document terminology diverges.

## Acceptance criteria

1. M6 is divided into seven bounded future slices covering identity/history,
   local locators, restart-safe library state, exports, artifact recovery,
   authoring handoff, and M7 operational handoff.
2. M6 documents the requested shared/cloud/local contracts, authorization and
   privacy boundaries, dynamic storage preflight, revised gate, and verification
   matrix while preserving M5 authority.
3. M7 documents Research Video Clips as an Electron application for macOS 15+
   Universal and Windows 11 23H2+ x64 with the approved cloud, authentication,
   update, feedback, protected-storage, and independent-QA architecture.
4. All durable docs use a 10 GB recommended baseline and operation-specific
   preflights with a 2 GB safety reserve; lightweight research remains usable
   below the recommendation.
5. The guide and outline diagrams add the desktop shell and update/reporting
   domains without changing project, transcript, or artifact authority.
6. A decision record captures the Electron, distribution, authentication,
   feedback, supported-profile, and storage-preflight choices.
7. M6 and M7 remain in `specs/future/`, with no implementation or external
   resource mutation.

## Narrow verification

- Run targeted Prettier checks on only the changed documentation files.
- Search for obsolete one-platform, fixed-space, and unresolved wrapper language.
- Run `git diff --check` and review the complete targeted diff.

## Completion record

### Decisions

- M6 uses the immutable logged-export success-result ID as
  `artifactVersionId`, keeps workstation locator availability separate, and
  supplies restart, storage-preflight, sanitized-failure, and quiescence
  contracts for M7.
- M7 uses the approved hardened Electron/Forge shell, public signed GitHub
  Releases, background install-on-quit updates, signed minimum-version policy,
  Cognito PKCE, ECS/RDS/S3/SQS, protected credentials, private GitHub issue
  delivery, and three independent QA profiles.
- Free space is a 10 GB recommendation, not a global gate. Heavy operations use
  known input/output estimates plus a 2 GB reserve and recheck unknown-size
  acquisitions before rendering.

### Files changed

- `PROJECT_GUIDE.md`
- `outline.md`
- `specs/future/M6-project-clip-library-and-authoring-handoff.md`
- `specs/future/M7-pilot-distribution-independent-QA-and-operator-documentation.md`
- `docs/decisions/M7-electron-pilot-distribution-auth-feedback-and-storage.md`
- `specs/completed/DOC-01-M6-M7-planning-alignment.md`

### Checks and actual results

- Targeted `npx prettier --check` passed for all six documentation files.
- The targeted obsolete-language search returned no matches.
- `git diff --check` passed with no whitespace errors.
- The complete targeted diff was reviewed; no application, schema,
  infrastructure, dependency, or unrelated worktree file was changed by this
  task.
- The application test suite was not run because this task changed documentation
  only, as required.

### Remaining risks and follow-ups

- M6 and M7 remain future milestones and require one active bounded spec per
  slice when separately authorized.
- Apple/Azure signing identities, AWS/Cognito production resources, the GitHub
  App, private feedback repository, tester identities, and independent machines
  remain future M7 prerequisites and were not created.
- OPS-01 remains separate and must complete before external pilot testing.

### Commit IDs

None; the user did not request a commit.
