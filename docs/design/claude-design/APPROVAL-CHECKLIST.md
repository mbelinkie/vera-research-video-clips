# Claude Design approval checklist

- Prototype: [VERA Redesign](https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html)
- Review baseline: independent full regression audit completed 2026-08-27 in
  external Chrome against Claude's latest saved revision
- Request status: CD-001–CD-033 sent to Claude Design on 2026-08-27; latest
  revision independently reviewed; approval blockers remain
- Behavioral authority: [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md)

Use the stable IDs when requesting or reviewing changes. Check an item only
after verifying the live prototype and its implementation handoff; updated
copy on one screen is insufficient when the component or visual-token sheets
still specify the old behavior.

## Current live-audit evidence

- Both the `1280 × 800` and `1024 × 768` controls changed the visible
  viewport label and rendered a frame with the named width. Pointer click and
  Enter activation were independently exercised for all 26 advertised
  scenarios; in every case the selected scenario, viewport label, and live DOM
  changed together. The exact Researcher → Archived projects → Claude Reload
  sequence also returned a nonempty Application frame, preserved the Researcher
  role, and removed every Restore control when Archived projects was reopened.
- Sources, Workspace, Clips, Installation setup, Owner project setup, Account
  Settings, Platform Administration, all four project-lifecycle presentations,
  Component States, and Visual Tokens were inspected at both widths. Compact
  Sources and Clips expose the named `Sort · Date added` control.
- Both Online translation and Online transcription independently expose Not
  requested, Pending, Approved, Denied, Revoked, and Withdrawn states at both
  widths. Pointer and Enter activation produced the same service-specific state,
  and changing one service did not change the other.
- The request, no-speech, export, and archive-confirmation overlays expose
  dialog role, modal semantics, accessible names, initial focus, forward and
  reverse focus containment, Escape dismissal, and focus restoration at both
  widths. Request messages are accessibly named and bounded to 500 characters.
- The revised Clips presentation passes at both widths: original clip text is
  primary 14.5 px content; the source-video title is secondary 12 px metadata;
  the original excerpt wraps to two lines within a roughly 68-character measure;
  and its English companion wraps below `Translation from {source language}`.
- The remaining failures are handoff consistency and two incomplete behavioral
  demonstrations: the request-history/admin message fixtures do not match, the
  empty no-speech Description rejection is not programmatically demonstrated,
  and Component States/Visual Tokens retain superseded rights, New-activity,
  multilingual, and wrapping guidance.

## Pending correction request

### Language access and Account Settings

- [x] **CD-001 — Request-first online access.** In each unrequested Online
      translation or Online transcription section, place the request action directly
      after the short local-first explanation and before provider, history, or usage
      detail. Both services pass in their independently selectable Not requested
      state at both widths.
- [x] **CD-002 — Paid-service disclosure dialog.** The request action opens a
      focused dialog that says each online job costs the VERA host and asks users to
      request access only when local processing does not work for the need or is too
      slow.
- [x] **CD-003 — Provider choice follows the disclosure.** Put provider choice
      and provider-specific cost context inside the request dialog. If only one
      provider is eligible, identify it without a redundant selector.
- [ ] **CD-004 — Requester message.** The dialog includes **Message to the
      administrator (optional)**, bounded to 500 characters. The submitted message
      appears in the user's request history and the authorized Platform
      Administration decision view. The dialog label and 500-character bound
      pass, but the pending Account Settings fixture says “The Dzongkha material
      for the autumn essay has no local route, and the deadline is in two weeks.”
      The corresponding Platform Administration record says “Dzongkha material
      for the autumn essay, no local route.” The exact-message round trip is
      therefore not demonstrated.
- [x] **CD-005 — State-driven account details.** Hide empty request history and
      speculative personal monthly usage before a request exists. Show provider
      preference, actual usage, withdrawal, stop/switch, and history only when the
      pending or approved state makes them relevant. Both services independently
      pass all six states at both widths: pre-request details stay hidden, pending
      exposes withdrawal, approved exposes stop, and terminal states expose the
      appropriate history and request-again path.
- [x] **CD-006 — Preserved unavailable language.** Do not show English selected
      while claiming Tibetan remains the saved preference. Show the preserved,
      unavailable value honestly or move that exceptional state to the component
      sheet.

### Transcript readiness and multilingual clips

- [x] **CD-007 — Hard Workspace gate.** Remove every normal path that opens
      Workspace or logs a clip without a verified transcript in the current user's
      preferred language. A blocked source remains in Sources with its contextual
      remedy and is not marked Viewed.
- [x] **CD-008 — Manual ranges only after readiness.** Keep player in/out range
      logging only after a transcript-ready source is open, including a no-speech
      interval. Remove the **No transcript available / Logging stays available**
      state and the handoff instruction that repeats it.
- [ ] **CD-009 — No-speech description.** A no-speech range opens the required
      Description dialog. Demonstrate it over a passage that actually contains no
      dialogue, and say that the current Topics are preserved rather than implying
      they can only be added later. The correct dialog, no-dialogue example, and
      Topics-preservation copy are present, but the empty Description textarea has
      neither `required` nor `aria-required`, and `Log clip` remains enabled. The
      prototype therefore does not yet demonstrate rejection of an empty required
      description.
- [x] **CD-010 — No false original-language fallback.** Remove copy saying the
      researcher can continue reading the source in its spoken language while the
      preferred-language route is unavailable. Original evidence remains stored,
      but Workspace waits for preferred-language readiness.
- [x] **CD-011 — Canonical multilingual clip example.** Add a component/details
      state proving that a clip selected while viewing a preferred-language
      translation still logs canonical Original plus English companion evidence by
      source time. In user-facing copy, label these **Original language** and
      **English translation**, never **Evidence**. Optional viewer context may say
      only `Logged while viewing Spanish`. Verified in Component States at both
      widths: the Dzongkha example presents Original language, English translation,
      and the quiet `Logged while viewing Spanish` line.
- [x] **CD-012 — Multilingual Clips presentation.** Demonstrate the canonical
      original-language excerpt in Clips and its paired English translation.
      The later user-directed presentation makes the original excerpt the primary
      row content and places the English companion directly below under
      `Translation from {source language}`; it no longer uses the earlier
      two-column language-details block. Remove the visible sentence beginning
      `Viewer context is secondary provenance only`; implementation and export
      invariants belong in the handoff, not the normal Clips interface. The
      canonical Original/English roles remain unchanged. The revised hierarchy,
      wrapping, and translation presentation pass at both widths.

### Sources and bulk ingest

- [x] **CD-013 — Bulk-count consistency.** Use one coherent sample count from
      pasted lines through resolved videos and final additions; remove the current
      `6 lines` versus `14 lines resolved` contradiction.
- [x] **CD-014 — Add every valid new source.** Language uncertainty or a missing
      translation route does not exclude a valid new video from the add count. Add
      it, then give it the applicable Confirm language, Language pack needed, or
      Access needed state in Sources.
- [x] **CD-015 — Translation is not a bulk-ingest choice.** Remove the label
      **Confirm translation**. Translation to the user's preferred language is automatic when
      an enabled local or approved online route exists.
- [x] **CD-016 — Role-correct hidden duplicates.** Owner/Administrator variants
      may offer Restore. Researcher variants say the source is hidden and an Owner
      or Administrator can restore it. Cover direct and bulk duplicate results.
      Verified from clean role changes: Owner has Restore in both direct and bulk
      hidden-duplicate results; Researcher has no Restore in the DOM and sees the
      Owner/Administrator explanation in both results.
- [x] **CD-017 — Low-noise readiness count.** Replace `6 need attention` with
      `6 not ready`, or remove the count, because ordinary processing does not
      necessarily require a person to act.
- [x] **CD-018 — Blocker-state switch.** Make the prototype's Capability
      blockers switch open a representative blocker rather than an unchanged
      Sources state.

### Keywords, Topics, roles, and rights

- [x] **CD-019 — Keep the taxonomies separate.** Remove Owner setup copy saying
      project keywords become tags on logged clips. Project keywords scan and filter
      Sources; Topics are assigned to clips during logging and never inherit
      automatically.
- [x] **CD-020 — Use Sources terminology.** Replace visible `worklist`, Queue,
      Claim, and explicit-review language with Sources and the actual open/log flow.
      Do not claim that keywords rank the list when its default order is Date Added.
- [x] **CD-021 — Correct Researcher capabilities.** Remove Owner setup copy
      saying Researchers claim and review. Describe the actual focused actions and
      add a concise project-role capability record covering Owner, Administrator,
      and Researcher. Owner setup now describes add/open/log/comment/export; Project
      Settings contains the three-role capability record and explicitly denies
      Researcher Hide/Restore and Archive/Restore.
- [x] **CD-022 — Preserve necessary onboarding gates.** Do not say that account
      plus project access are the only requirements. Retain the necessary
      storage/privacy/rights acknowledgements and operation-specific readiness
      gates, while keeping optional Transcription, Translation, and Export setup
      independently skippable. The four-step setup flow now keeps Transcription,
      Translation, and Export independently skippable while explicitly retaining
      storage, privacy, project-rights, transcript-readiness, and operation-specific
      gates; the former unconditional readiness copy is absent.
- [ ] **CD-023 — Correct rights timing.** Do not describe the single project
      rights attestation as export-only. Apply it to normal source processing where
      the rights/provider boundary requires it, while preserving any stronger
      operation-specific safety gate until the implementation spec deliberately
      replaces it. Owner setup, Project Settings, and Visual Tokens now state the
      normal source-processing boundary. Component States still says adding sources,
      reading, logging, and commenting all work before attestation and limits refusal
      to export or online-provider processing, contradicting the contract.
- [x] **CD-024 — Remove ambiguous re-verification.** Remove **Always re-verify**
      from Advanced Project Settings unless a bounded specification proves that it
      cannot bypass verified shared-first resolution, silently regenerate work, or
      create unnecessary provider jobs.

### Clips, activity, responsive behavior, and handoff accuracy

- [x] **CD-025 — Preserve compact sorting.** At 1024 px, Date Added and other
      folded metadata need a compact, named Sort control. Do not make a sortable
      field inaccessible merely because its column folded into Video metadata.
- [x] **CD-026 — Standardize Viewed treatment.** Choose one Sources treatment
      rather than shipping dot, checkmark, and worded alternatives behind a
      setting. Use the quiet main-screen treatment: checkmark for Viewed, no noisy
      marker for Unopened, plus explicit All/Unopened/Viewed filters and accessible
      labels. Verified in Sources, the compact composition, Component States, and
      Visual Tokens at both widths; no orange-dot or alternate-treatment option
      remains.
- [ ] **CD-027 — New, not Unread.** Update every handoff reference so the header
      badge opens Clips filtered to **New**, containing both newly logged clips and
      unread comments and counting unique affected clips. Do not label the Clips
      count or design tokens generically **Unread**. The Application count is now
      correct: header badge, New tab, All Clips summary, and four unique affected
      rows agree, and visiting New alone changes no receipts; previewing a new clip
      and expanding its new comments clear the two signals independently. Component
      States still describes the destination and clearing rule as `unread activity`
      and `latest unread comment`, so the handoff terminology remains stale.
- [x] **CD-028 — No explicit Open row action.** Remove stale component/tab-order
      copy that specifies an Open button. A neutral clip-row action opens the
      companion preview; Comments, selection, and Edit retain their own controls,
      and Edit is the only explicit row action.
- [x] **CD-029 — Remove transcript-free legacy examples.** Replace the example
      **Time-based research log — no transcript evidence attached** and similar normal examples
      with a valid transcript-ready no-speech description, or clearly mark any
      retained record as legacy data rather than a creatable state.
- [ ] **CD-030 — Synchronize the handoff sheets.** Component States and Visual
      Tokens must agree with the application screens on Workspace gating, rights,
      New activity, row actions, multilingual evidence, access requests, and the
      final Viewed treatment. Both handoff sheets open at both widths, and their
      Workspace gating, row-action, access-request, Viewed, and dialog guidance pass.
      Component States retains the obsolete export/provider-only rights boundary,
      unread wording, and two-label Original language/English translation details.
      Visual Tokens still prescribes that table rows never wrap, forbids two-line
      clamping, and calls for the old Original language/English translation pair.
      Those rules contradict the live Clips presentation and the contract.

### Project switching and lifecycle

- [x] **CD-031 — Active-project switcher.** Demonstrate that clicking the project
      name in the header opens every active personal or shared project in which the
      current user is a member. Switching changes the project context for Sources,
      Workspace, and Clips; unauthorized and archived projects never appear. The
      menu correctly groups five active member projects, excludes archived projects
      from the active choices, and links to separate archived management at both
      widths. Pointer and Enter switching among Urban Heat Research, Coastal Flood
      Narratives, Pavement and shade audit, and Method tests changed the header plus
      the Sources, Workspace, and Clips project fixtures at both widths.
- [x] **CD-032 — Non-destructive project archive.** Add a contextual Project
      Settings lifecycle state in which Owner or Administrator can Archive after a
      confirmation. Archive removes the project from every member's ordinary list
      without deleting membership, sources, transcripts, clips, comments, Topics,
      settings, history, jobs, or artifacts. Owner and Administrator can find it in
      an Archived projects management view and Restore it. Show the archived
      deep-link state and update the role-capability/handoff record. Verified for
      Owner, Administrator, and Researcher at both widths. Owner/Administrator
      receive Archive, Archived-project Restore, and deep-link Restore; Researcher
      receives none. Changing to Researcher while already in Archived projects
      immediately removes Restore from the DOM and shows the active-project route.
      The same denial survives Claude Reload.
- [x] **CD-033 — Restore scenario and viewport controls.** Pointer click and Enter
      independently activated all 26 advertised scenarios at both viewports. Every
      activation produced one matching selected switch, the expected viewport label,
      and the named live DOM state. Pointer and keyboard activation of both viewport
      controls also switched between `1280 × 800 · full` and
      `1024 × 768 · compact`; the compact live frame has an explicit 1024 px width.

## Verified baseline — do not regress

- [x] **VB-001 — Focused destinations.** The primary shell is Sources,
      Workspace, and Clips; rare setup, administration, and export controls remain
      contextual.
- [x] **VB-002 — One Sources list.** Queue/Reviewed/Dismissed views, assignment,
      Claim, completion ceremony, and source-row selection are absent.
- [x] **VB-003 — Source discovery.** Project keywords appear above Sources,
      filter one at a time, and collapse behind `+N more`.
- [x] **VB-004 — Source table.** Date Added, Transcript, compact Hits, Clips
      split into you/others, Logged by, copy-link, and role-gated overflow are
      represented; compact Transcript badges and Hits spacing are readable.
- [x] **VB-005 — Viewed model.** All, Unopened, and Viewed filters exist; the
      Workspace picker lists only ready Sources and carries Viewed/Unopened state.
- [x] **VB-006 — Duplicate structure.** Visible and hidden duplicate outcomes
      create nothing, and Bulk add has a partial-success review rather than CSV
      import, playlist expansion, or all-or-nothing failure.
- [x] **VB-007 — Workspace emphasis.** Logged by you/others, overlaps, playback,
      selection, project keywords, and search use separate treatments; Following
      has its own active-block fill and rail.
- [x] **VB-008 — Already logged.** Already Logged Here is collapsed by default
      and provides All/Mine after expansion.
- [x] **VB-009 — Comments-first Clips.** The Comments disclosure is the first
      data column, threads expand inline with a composer, and comments are not
      promoted into Workspace.
- [x] **VB-010 — Unified New state.** New clips and new comments have distinct
      labels, can coexist on one row, and clear independently.
- [x] **VB-011 — Clip row actions.** The application screen uses neutral row
      preview with Edit as the explicit action; the old Open button is absent.
- [x] **VB-012 — Clip Date Added.** Date Added is present and newest-first on the
      full Clips layout.
- [x] **VB-013 — Contextual export.** Selection reveals Export above Clips;
      setup, preflight, progress, and recovery stay out of the default table.
- [x] **VB-014 — Subtitle sidecars.** Export copy preserves English sidecars and
      adds the original-language sidecar for a non-English source.
- [x] **VB-015 — Secondary logging actions.** More uses concise labels, keeps
      optional Description contextual, and contains no descriptor paragraphs.
- [x] **VB-016 — Companion player.** One managed companion window is reused;
      unpinned stays above VERA, pinned always-on-top is explicit, and position and
      size recovery are specified.
- [x] **VB-017 — Administration.** Platform Administration separates access
      requests, local pack governance, and online providers, with project content
      and protected provider details excluded.
- [x] **VB-018 — Compact composition.** Sources, Workspace, Clips, Account
      Settings, and Platform Administration have coherent 1024 px compositions,
      including the named compact Date Added sort control.

## Final approval gate

- [ ] Every pending `CD-*` item is verified in the live prototype. Five items
      remain open: CD-004, CD-009, CD-023, CD-027, and CD-030.
- [x] Every applicable screen is checked at both 1280 × 800 and 1024 × 768.
      All 26 advertised scenarios, both service-state matrices, role variants,
      dialogs, project switching, and revised Clips rows were exercised at both
      widths with pointer and keyboard activation where applicable.
- [ ] Component States and Visual Tokens contain no stale behavior contradicted
      by the application screens or `BEHAVIOR-CONTRACT.md`.
- [x] Any deliberate exception is written into `BEHAVIOR-CONTRACT.md` before
      approval rather than left implicit in a mockup. The audit itself made no
      new product decision or exception. A subsequent user-directed Clips
      hierarchy, wrapping, and translation-presentation decision is now recorded
      explicitly in the contract and UI context.
- [ ] The prototype is approved as the visual model for implementation planning.
