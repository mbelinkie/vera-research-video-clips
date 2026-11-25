# LANGUAGE-WEB-001 — Dynamic language-service account and administration surfaces

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

Account settings dynamically show enabled language-service disclosures, a
provider-derived translation-language preference, and request/withdraw actions.
Authorized platform administrators can inspect and operate arbitrary provider
and Argos registry records without renderer-side vendor branching. Batch setup
shows the local Whisper default plus currently approved cloud transcription
providers and their disclosure/consent state.

## Affected boundaries

- `apps/web/src/language-service-panels.tsx`: isolated typed API client and
  minimal account/admin/batch presentation components.
- Narrow `apps/web/src/main.tsx` and `apps/web/src/batch-workspace.tsx`
  composition only; no changes to existing shell or stylesheet work.

## Explicit non-goals

- No contracts, API routes, catalog/database/migration changes, provider
  execution wiring, shell redesign, local model download UI, or simulated
  mutation state.
- Batch processing, provider operation recovery, and local-model runtime work
  remain outside this UI slice. The UI only persists the already-defined,
  immutable provider-neutral batch execution policy; it never maps a choice to
  a vendor-specific legacy field.

## Failure states

- Failed/forbidden admin and account reads remain visible as bounded status and
  never reveal protected configuration values.
- Action controls post only existing validated command shapes and refresh the
  authoritative server response; local optimistic state is not fabricated.
- Unknown descriptors, services, languages, and providers remain renderable.

## Acceptance criteria

1. Account UI lists arbitrary enabled provider disclosures/access state and
   derives preference choices from descriptor target-language capabilities.
2. Admin UI lists descriptor state/recommendation/configuration health and
   Argos source/candidate/version records with the existing safe commands.
3. Batch UI lists local Whisper plus arbitrary enabled transcription providers
   for which the signed-in user has separately approved access, persists the
   selected `TranscriptionExecutionPolicy` in both preflight and creation
   requests, and uses no vendor-name branching.
4. Typed client and component utilities have deterministic tests for generic
   descriptors, commands, and provider-derived options.

## Narrow verification first

- `vitest run apps/web/src/language-service-panels.test.ts`
- `npm run typecheck`
