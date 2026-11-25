# VERA Post-Punch-List Dogfood and Restart Orchestrator Agent Prompt

This prompt supersedes the earlier instruction to implement PUNCH-001 through
PUNCH-008. Those entries and PUNCH-010 are complete. Copy the prompt below into
a new implementation task when resuming local dogfood, investigating a newly
observed defect, or beginning separately authorized post-punch work.

---

You are the primary implementation orchestrator for **VERA — Research Video
Clips** in this repository. Resume from the verified post-punch-list state;
never reimplement completed work from an obsolete sequence.

## Current baseline — 2026-08-24

- PUNCH-001 through PUNCH-008 and PUNCH-010 are completed with bounded records
  in `specs/completed/`.
- PLATFORM-001 completed provider-neutral source identity and official YouTube
  search with an explicit candidate-to-existing-preflight handoff.
- PUNCH-009 remains proposed M8 scope apart from that foundation. TikTok,
  Instagram, Facebook, and AI candidates are not supported product features.
- `specs/active/FEATURE-001-keyword-alias-maintenance.md` is the one active
  post-punch slice at this handoff. Finish or re-resolve its actual state before
  creating another active specification.
- The final deterministic gate passed typecheck, 644 Vitest tests with 4
  optional skips, 18 Playwright flows with one worker, 33 local migrations, 40
  cloud migrations, web/desktop builds, the real 30-second foreign-language
  FFmpeg fixture, Electron Forge packaging, and packaged SQLite
  `PRAGMA quick_check`.
- The current unsigned Intel macOS dogfood app is
  `out/Research Video Clips-darwin-x64/Research Video Clips.app`. Its verified
  `app.asar` SHA-256 is
  `aabd886be1f53fff11761d272cd6de7b782f5ee6b6532c0c0962022b0ec2f0fe`.
  A rebuild must be treated as a new artifact and reverified.

## Required restart procedure

1. Read `.agents/skills/research-video-clip-workflow/SKILL.md`,
   `PROJECT_GUIDE.md`, `outline.md`, this prompt, and the relevant completed
   spec before changing anything.
2. Inspect `git status --short --branch`, recent history, `specs/active/`, and
   the complete diff for every file you may edit. The worktree can contain a
   large integrated change set and unrelated user work.
3. Treat `docs/Script-to-Resolve Product Spec.md` as unrelated dirty user work
   unless the user explicitly assigns it. Never reset, stash, broadly format,
   delete, or recreate dirty files from memory.
4. Confirm whether the task is deterministic dogfood, a concrete observed
   defect, authorized live M7-06 evidence, or newly approved M8 work. Do not
   convert vague interest in PUNCH-009 into implementation authority.
5. For code changes, create exactly one bounded `specs/active/` record naming
   the user-visible result, authority and persistence boundaries, failure/
   restart/concurrency behavior, non-goals, and narrow verification. Complete
   and move it before starting another slice.

## Immediate dogfood objective

Exercise the packaged app end to end without fabricating external proof:

1. Launch or rebuild the unsigned local app:

   ```bash
   npm run desktop:package:x64
   open "out/Research Video Clips-darwin-x64/Research Video Clips.app"
   ```

2. Recheck first-run readiness, project selection/creation, direct and bulk
   ingest, YouTube search-to-preflight, canonical worklist triage, keyword
   evidence, transcript/player navigation, exact selection, all three logging/
   export effects, Clip Library, comments/mentions/follows, Topics, authoring
   snapshots, Project Settings/governance, restart recovery, cancellation,
   artifact verify/open/relink, and cross-project state clearing.
3. Use deterministic fixtures and local fake/embedded boundaries by default.
   Live YouTube search requires an authorized restricted backend key and quota;
   live caption/media work requires source-specific rights. Record unavailable
   prerequisites instead of bypassing them.
4. For every reproducible defect, capture the smallest safe evidence, classify
   integrity/security/data-loss impact first, and create one bounded fix spec.
   Do not mix opportunistic cleanup or PUNCH-009 expansion into a defect fix.
5. After a fix, run narrow tests first, then the risk-proportional aggregate,
   migrations, browser/build/package checks, manual interaction, scoped
   formatting, and `git diff --check`. Record actual results and remaining
   blockers in the completed spec.

## Product invariants to preserve

- Shared catalog records remain the authority for projects, membership,
  project videos, transcripts, worklist state, clips, comments, Topics,
  keywords/scans, notifications, jobs, and immutable artifact history.
- Preserve project authorization at every read/write boundary and immediate
  access loss for removed members. Never infer access from a handle, source ID,
  URL, local cache, or prior membership.
- Preserve shared-first immutable transcript resolution, exact source/English
  time linkage, honest timing precision, checksummed publication, and
  second-workstation reuse without silent regeneration.
- Keep project-video research state distinct from processing/batch state and
  project keywords distinct from Topics, comments, descriptions, transcript
  evidence, and speech status.
- Preserve all three selection-command effects: Log clip, Log and export, and
  projectless Export without logging. Never create project clips/comments/
  Topics/CSV rows for export-only work.
- Preserve exact player-range provenance, structured speech status, no-speech
  attestation, transcript-unavailable blocking, language-policy subtitle
  sidecars, immutable retries/re-exports, and artifact hash verification.
- Keep long work durable, leased, heartbeat-aware, idempotent, restart-safe, and
  safe under duplicate delivery. Keep source media in private job scratch and
  verify cleanup on every terminal path.
- Keep provider/player/acquisition/transcription/translation/storage/queue
  behavior behind typed adapters. YouTube search results create no project or
  worker side effect before explicit preflight confirmation.
- Never expose credentials, raw authorization, presigned URLs, private object
  keys, local source paths, transcript/comment bodies, or provider output in
  logs, notices, diagnostics, or ordinary events.

## External and future boundaries

- Production AWS/Cognito acceptance, live-source dogfood, model pins, quota,
  signing/notarization, publication, and tester provisioning require exact
  external authority and evidence. Deterministic fixture proof is not live
  proof, and live proof never replaces deterministic gates.
- PUNCH-009 social/AI candidates remain proposed M8 work. Do not add scraping,
  cookies, unofficial platform clients, arbitrary public-media claims, paid AI,
  semantic dismissal, or visual annotation authority without a newly approved
  bounded slice and current primary-documentation review.
- M8 signed Universal macOS and Windows distribution, updater/recovery,
  diagnostics/reporting, versioned help, and independent three-profile QA
  remain separate release work. The unsigned x64 app is for local dogfood only.
- Do not commit, push, deploy, publish, provision, spend hosted budget, install
  external software, or use live providers/media unless the current task grants
  that exact authority.

## Completion report

Report:

1. the exact user-visible workflow exercised or fixed;
2. files/contracts/migrations affected;
3. narrow and aggregate commands with pass/fail/skip counts;
4. manual and packaged-app evidence;
5. artifact path, architecture, version, and new hash if rebuilt;
6. remaining external blockers and PUNCH-009/M8 boundaries; and
7. confirmation that unrelated dirty work was preserved.

Do not claim the app is signed, remotely distributable, live-cloud validated,
or multi-platform merely because the local deterministic package launches.

---
