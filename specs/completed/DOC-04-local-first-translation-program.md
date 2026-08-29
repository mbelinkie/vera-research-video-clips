# DOC-04 — Local-first translation program specification

Status: active documentation-only specification.

## User-visible outcome

The repository contains one decision-complete future implementation program for
making audited local translation the default and restricting paid Amazon
Translate use to account-level, platform-admin-approved access. The program
also gives implementers an evidence-backed model-pack research record and a
bounded slice order; it does not claim that the feature is implemented.

## Focused context

The current product already preserves original, canonical-English, and
supplemental preferred-language tracks behind a provider-neutral translation
boundary. Amazon Translate is the current opt-in production adapter, while the
desktop setup stores a provider choice and remote-text consent. The requested
future state makes local Argos/CTranslate2 translation primary, manages model
downloads and deletion, and adds separately governed AWS access.

## Affected boundaries

- `specs/future/`: decision-complete translation implementation program.
- `docs/research/`: current provider, model-index, licensing, platform, and AWS
  metering evidence.
- Future bounded implementation specs: contracts, local/cloud persistence,
  desktop/model lifecycle, worker/provider composition, cloud authorization,
  and web/admin UI.

## Explicit non-goals

- Do not implement providers, sidecars, model downloads, migrations, APIs, UI,
  Cognito groups, launch grants, metering, or AWS calls.
- Do not change current provider selection or consent behavior.
- Do not mark a product milestone or translation feature complete.
- Do not approve an unlicensed or unaudited model pack.
- Do not edit unrelated current UI work.

## Failure states

- The future program treats the mutable upstream Argos index as an approved
  catalog or implies that all listed packs have verified redistribution rights.
- It hard-codes Spanish, Romanian, or another example-language subset instead
  of defining language-neutral registry rules.
- It allows project roles to approve account-level paid translation.
- It omits revoke, immediate user opt-out, launch-grant expiry, optional admin
  messages, usage estimates, or whole-job local fallback.
- It weakens immutable original-track linkage, shared-first reuse, or
  single-provider published output.
- Planned work leaks into living current-state documentation as though it were
  already implemented.

## Acceptance criteria

1. The future spec is decision-complete for provider resolution, model
   retention/deletion, registry approval, AWS request/decision/grant lifecycle,
   optional admin messages, metering, UI, migration, failure handling, and
   release validation.
2. The program preserves current transcript authority and divides later code
   work into dependency-ordered bounded slices.
3. A dated research record distinguishes upstream availability from VERA
   approval and records the 49 current bidirectional English-hub pairs, license
   uncertainty, CTranslate2 platform support, and AWS billing evidence.
4. Current application code, schemas, configuration, guide, and outline remain
   unchanged because product implementation has not begun.
5. Changed Markdown passes scoped formatting and whitespace checks.

## Narrow verification

- Run Prettier check on the three documentation files changed by this task.
- Search the future spec for all required policy states and lifecycle terms.
- Run `git diff --check` and review the complete targeted diff/status.

## Completion record

Completed on 2026-08-26 without a dedicated implementation commit.

### Decisions

- Recorded audited Argos/CTranslate2 local translation as the future default,
  with one lazily retained non-English preferred target pack and every other
  pack governed by durable leases and verified cleanup.
- Recorded account-level, platform-admin-controlled Amazon Translate access
  with request/resubmission, approve/deny/revoke, optional 500-character admin
  messages, next-launch administrator decisions, immediate user opt-out,
  12-hour grants, metering, estimates, and whole-job local fallback.
- Kept current implemented behavior in `PROJECT_GUIDE.md` and `outline.md`
  unchanged. Later bounded implementation slices must update them only after
  real behavior is complete and verified.

### Files changed

- `specs/future/TRANSLATION-001-local-first-translation-and-admin-governed-aws.md`
- `docs/research/local-translation-model-and-aws-governance-2026-08-26.md`
- `specs/completed/DOC-04-local-first-translation-program.md`

### Checks and actual results

- Scoped `npx prettier --check` passed for all three documentation files.
- The targeted policy-term search found the required provider, retention,
  request/decision, optional-message, grant, fallback, metering, platform-admin,
  and language-coverage terms.
- The targeted trailing-whitespace search returned no matches.
- `git diff --check` passed.
- Final status review preserved the pre-existing changes in
  `apps/web/src/styles.css`, `apps/web/src/workspace-shell.tsx`, and
  `specs/completed/UI-ACCOUNT-001-preferred-language-dropdown.md`.

### Remaining risks and follow-ups

- No Argos model pack is approved by this documentation task. Each exact pair
  still requires license/provenance, checksum, runtime, and validation review.
- Product implementation remains six future bounded slices; no provider,
  migration, entitlement, grant, metering, UI, or packaged runtime changed.
- Platform-admin Cognito configuration and live AWS verification require
  separately authorized implementation and bounded cost evidence.

### Commit IDs

None; the user did not request a commit.
