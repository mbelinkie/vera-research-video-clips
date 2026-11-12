# R1 #19 — Immediate real YouTube transcript

## User-visible outcome

From the existing Research browser workspace, Matthew can run one documented local
command, paste an authorized YouTube URL into the existing input, see a real
caption-derived or locally recognized English transcript, and click it to seek.
When the video is unavailable or recognition is not configured, show one short,
safe, actionable sentence instead of demo text or an indefinite spinner.

## Boundaries and implementation slices

- Phase 1: Pure single-video adapter for the existing batch request, item-stage
  reporting, and immutable verified transcript response; deterministic tests.
- Phase 2: One-command private loopback runtime, project bootstrap, worker
  supervision, and safe signed-object storage across processes. Keep credentials
  out of browser JavaScript and require origin/CSRF protection.
- Phase 3: Existing workspace input submits and polls the exact one-item batch,
  resolves the authenticated project transcript, and cancels stale async UI
  updates on video/project changes. Preserve selection, search, and queue UX.
- Phase 4: Local provider fallback and worker lifecycle; real caption/ASR/error
  pipeline fakes, signed HTTP publication, safe runtime documentation and a
  separately authorized local Mac smoke test.
- Phase 5: Full gate, critical security/integrity guard mutation checks,
  real-source acceptance evidence, self-review, and PR handoff.

Use the existing `CreateTranscriptionBatchRequestSchema`,
`TranscriptionBatchItemSchema`, and `NormalizedTranscriptSchema`. Batch creation
may immediately reuse an active transcript or enter a queued worker path. A
catalog video UUID is never interchangeable with a YouTube video ID; the
published version must match the exact active version and English track.

## Phase 2 managed-local runtime contract

`npm run dev:research` supervises the existing cloud API, local agent, worker
and Vite web server on 127.0.0.1 ports 43111, 43110 and 43112. Its personal
private state defaults to `~/.vera-research-managed` (0700); `identity.json`
is 0600 and contains the stable catalog identity and local object HMAC key.
Managed cloud uses the isolated PGlite catalog and signed immutable on-disk
objects, never the cross-process-broken memory upload URLs. The bootstrap
registers this identity and creates one visible `Personal research` project
only when none exists, reusing membership/project across restarts. The worker
starts continuously even with no opt-in caption/recognizer tools; missing
recognition is terminal and no transcript is invented.

Phase 3 browser wiring: detect `import.meta.env.VITE_MANAGED_RESEARCH === "true"`;
fetch same-origin `GET /__research/session` to obtain a *CSRF token only* (not
the bearer), then send `x-vera-csrf` on mutation requests (the browser supplies
the matching `Origin` header)
through `/cloud-api/api/*` and `/local-agent/api/*`. Vite injects the private
bearer only on its server-side proxy path. Never forward a browser bearer:
the proxy rejects one, all cross-origin and mismatched Host/Sec-Fetch-Site
requests, and unsigned object-route forwarding. The signed `/__objects` URL
comes from the catalog grant on the direct loopback cloud HTTP endpoint;
there is no browser-supplied object path or `memory-upload://` transport.

Provider opt-ins and Mac acceptance remain phase 4/5; phase 2 deterministic
checks do not establish real Mac YouTube/provider success.

## Failure and recovery states

- Unsupported URL or unavailable metadata: safe terminal sentence.
- Captionless video: use opted-in local ASR; otherwise report missing recognizer.
- Worker missing/failing, blocked or canceled item: visible terminal/actionable
  status and retry where supported; never show raw worker stderr or filesystem paths.
- Missing active version or mismatched video/version: reject verified response;
  do not show a successful or fixture transcript.
- Source/project switched during polling: discard stale results, preserve
  project authorization and never attach content to the wrong video.

## Non-goals

No redesign, desktop shell, colleague sign-in, new recognizer provider, hosted
transcription/translation billing, or new word-exact alignment (#47). Preserve
the source-reported auto-caption starts/derived ends from #46 and cue timing
when that is all the source has. No unrelated changes to exports or database.

## Acceptance checks

Phase 1: `npx vitest run --maxWorkers=1 apps/web/src/immediate-transcript.test.ts`
and `npm run typecheck`, including canonical URL, all stage/error states,
missing IDs, mismatched version/video/track and fake successful verified
response. Later phases: focused worker/API/browser/security suites, Playwright
workspace checks, `npm run check`, and on-Mac authorized captioned, captionless,
unavailable-source and restart smoke checks. Do not treat fixture tests as real
YouTube/recognition evidence or mark this spec complete until all required
integration evidence exists.
