# BUG-TRANSCRIPT-001 — Surface automatic language confirmation

## User-visible outcome

When immediate URL transcription pauses for spoken-language confirmation, the
Research view explains that there is no active transcript yet and the
Project Videos view automatically exposes the existing language-confirmation
form.

## Confirmed reproduction

- The selected project has one video and automatic local processing enabled.
- The supervised local worker and every required local component are ready.
- The canonical worklist reports `needs_language_confirmation`, with no active
  transcript, queued job, or active job.
- Automatic project-local batches are intentionally omitted from the ordinary
  batch list. The project worklist previously selected only listed manual batches, so
  the language-confirmation form in the exact hidden batch was unreachable.
- Transcript resolution correctly returned 404 because no version is active,
  but the local error sanitizer mislabeled `not_found` as authorization denial
  and displayed `This operation is not available.`
- A real automatic item can reach the gate with no provider-reported language,
  no creator-reported language, and no prior decision. The confirmation UI
  built its `<select>` exclusively from those absent values, disabled the empty
  control, and left no route to continue.
- After explicit Dzongkha confirmation, the supervised desktop worker reached
  media acquisition but `yt-dlp` reported the playable video as unavailable.
  The Electron utility process received a deliberately narrow environment with
  no executable search path. Current `yt-dlp` therefore could not discover the
  JavaScript runtime installed beside the configured media tools, while the
  same configured binary resolved the same video from an interactive shell.

## Affected boundaries

- Project Videos selection of an action-required automatic project-local batch.
- Local transcript 404 classification and path-free user message.
- Focused web/local-agent regression coverage.

## Non-goals

- No automatic guessing or silent confirmation of spoken language.
- No change to worker language evidence, transcription providers, immutable
  transcript publication, or project authorization.
- No exposure of hidden local paths, credentials, or provider payloads.

## Failure states

- A user-selected listed batch must not be displaced by an automatic batch.
- A stale hidden batch that no longer needs confirmation must not remain
  selected merely because its ID was previously active.
- Other not-found local operations must retain their fail-closed presentation.
- Unknown evidence must not silently default to English or any other language.
- An arbitrary valid BCP-47 language must remain confirmable even when it is not
  one of the built-in suggestions.
- A GUI-launched worker must preserve the restricted inherited executable path
  while prepending only the directories of explicitly trusted configured tools;
  it must not inherit unrelated shell variables or enable config-file loading.

## Acceptance criteria

1. With no selected listed batch, Project Videos selects the first canonical video
   whose exact processing state is `needs_language_confirmation` and loads its
   batch through the existing authorized detail endpoint.
2. An explicitly selected listed batch remains selected.
3. Transcript 404 presents `No active transcript exists yet` and directs the
   researcher to Project Videos for progress or language confirmation.
4. The transcript absence is classified as a durable-state conflict rather
   than an authorization denial.
5. Focused tests, typecheck, desktop build, and package verification pass.
6. With provider, creator, and prior decision languages all absent, the UI shows
   an enabled editable language control, keeps confirmation disabled until the
   researcher enters a valid BCP-47 tag, and offers readable common-language
   suggestions including Dzongkha (`dz`).
7. The submitted confirmation uses the normalized explicit language and does
   not infer a default from the empty evidence.
8. The supervised transcription worker can discover a JavaScript runtime
   installed beside a configured absolute tool path, allowing current `yt-dlp`
   to resolve and acquire a video that the embedded player can play.

## Narrow verification first

- `vitest run apps/web/src/transcription-action-batch.test.ts apps/web/src/spoken-language-choice.test.ts apps/local-agent/src/app.test.ts`
- `vitest run apps/desktop/src/tool-search-path.test.ts`
- `playwright test tests/e2e/workspace.spec.ts --grep "accepts an explicit language when provider and creator evidence are unknown"`
- `npm run typecheck`
- Rebuild/package, relaunch, confirm the visible spoken language in Project Videos,
  and verify the transcript continues processing.
