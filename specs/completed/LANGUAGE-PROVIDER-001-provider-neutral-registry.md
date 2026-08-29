# LANGUAGE-PROVIDER-001 — Provider-neutral language-service adapter registry

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

The backend can enumerate and select any registered cloud translation or
transcription adapter by opaque provider ID and service kind. A provider can be
enabled, drained, disabled, or suspended without a vendor-specific branch, and
new cloud work always carries local-only fallback policy metadata. The current
Amazon Translate adapter remains compatible and retains `amazon-translate` on
translated-track provenance.

## Affected boundaries

- `packages/providers`: provider descriptors, in-memory adapter registry,
  generic execution-policy metadata, Amazon Translate factory composition, and
  deterministic registry tests.

## Explicit non-goals

- Contracts, migrations, credentials, cloud APIs, consent/grants, metering,
  administration UI, Amazon Transcribe, external calls, model catalog work, or
  changing historical transcript records.
- Persisting provider state; the later control-plane slice owns durable state.

## Failure states

- Duplicate/invalid opaque IDs, wrong service kind, unknown providers, and
  every state other than `enabled` reject new work.
- A provider state transition cannot alter an adapter instance already handed to
  a running operation.
- A cloud failure policy cannot silently name or select a different cloud
  provider.
- Descriptor snapshots expose no factory configuration or credential material.

## Acceptance criteria

1. The registry accepts arbitrary translation and transcription factories,
   returns immutable safe descriptors, and resolves only enabled adapters.
2. Enabled, draining, disabled, and suspended behavior is deterministic;
   drained/suspended/disabled entries remain observable but cannot start work.
3. Cloud translation and transcription policies both encode local-only fallback
   and prohibit automatic cloud-vendor substitution.
4. Amazon Translate is composable through the registry while its compatibility
   factory and historical `amazon-translate` provenance remain unchanged.
5. A deterministic third fake translation and transcription provider prove
   generic dispatch without vendor-specific branching.

## Narrow verification first

- `vitest run packages/providers/src/language-service-registry.test.ts packages/providers/src/translation-aws.test.ts`
- `npm run typecheck`

## Completion record — 2026-08-26

### Decisions and files changed

- Added the in-memory `LanguageServiceRegistry` in
  `packages/providers/src/language-service-registry.ts`. It validates and
  snapshots the shared `CloudProviderDescriptor` contract, resolves only
  enabled adapter factories, and leaves already-created adapters unaffected by
  later registry state changes.
- The registry's translation/transcription policies now construct the shared
  execution-policy schemas directly. A cloud policy carries one opaque
  provider ID and `fallback: local`; the shared contract has no alternate-cloud
  provider field.
- Updated `packages/providers/src/translation-aws.ts` to expose the composable
  Amazon Translate factory with the full shared descriptor shape. The existing
  `createTranslationProvider` compatibility factory still resolves that
  adapter, and translated-track provenance remains `amazon-translate`.
- Added deterministic registry coverage in
  `packages/providers/src/language-service-registry.test.ts` and Amazon
  descriptor/provenance coverage in
  `packages/providers/src/translation-aws.test.ts`.

### Checks and results

- `npm exec vitest run packages/providers/src/language-service-registry.test.ts packages/providers/src/translation-aws.test.ts`
  — passed: 2 files, 9 tests.
- `npm exec -- prettier --write packages/providers/src/language-service-registry.ts packages/providers/src/language-service-registry.test.ts packages/providers/src/translation-aws.ts packages/providers/src/translation-aws.test.ts`
  — passed; all four files were already formatted.
- `npm run typecheck` — passed (`tsc --noEmit`).
- `git diff --check` — passed.

### Remaining risks/follow-ups

- This intentionally has no persistent provider state, credentials, access
  grants, API surface, UI, or cloud invocation. The later control-plane slice
  owns those boundaries.
- No commit was created in this shared working tree.
