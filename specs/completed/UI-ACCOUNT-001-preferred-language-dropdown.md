# UI-ACCOUNT-001 — Constrain preferred transcript language selection

## User-visible outcome

Account settings presents preferred transcript language as a dropdown of the
application's supported language choices instead of a free-text BCP-47 field.
An already-saved legacy BCP-47 value remains visible so an existing account can
replace it safely.

## Affected boundaries

- Web account settings presentation and its existing preference-save command.
- Shared web language-choice list.

## Non-goals

- No change to the account API, stored BCP-47 schema, translation policy, or
  historical logged-clip evidence.
- No change to the explicit spoken-language confirmation flow, where arbitrary
  valid BCP-47 input remains necessary for unknown-language cases.

## Failure states

- A saved preference not in the curated list must not render as an empty select.
- Disabled account settings must keep the language control disabled.
- Saving a selected supported language must continue to use the existing
  validated preference endpoint.

## Acceptance criteria

1. The account setting uses a native select control with readable supported
   language labels.
2. The free-text placeholder and arbitrary account-language typing are removed.
3. Existing non-curated persisted language tags remain visible as a legacy
   selection until replaced.
4. Focused language-choice tests, typecheck, and the production web build pass.

## Verification

- `vitest run apps/web/src/spoken-language-choice.test.ts`
- `npm run typecheck`
- `npm run build:web`

## Completion record

- Decision: reuse the existing curated spoken-language choices for account
  preference selection. Preserve a currently saved non-curated BCP-47 tag as a
  labeled legacy option until the user selects a supported replacement.
- Files changed: `apps/web/src/workspace-shell.tsx` and
  `apps/web/src/styles.css`.
- Checks: Prettier check passed; `apps/web/src/spoken-language-choice.test.ts`
  passed (2 tests); `npm run typecheck` passed; `npm run build:web` passed.
- Remaining risk: the production build emits its pre-existing advisory that the
  main JavaScript chunk exceeds 500 kB. This small UI change does not affect
  code-splitting.
- Commit: not created in this task.
