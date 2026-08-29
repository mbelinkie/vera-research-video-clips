# VERA limited web edition design brief

- Status: approved product-design input for extending the Claude prototype
- Last updated: 2026-08-28
- Implementation status: not implied by this document
- Related authority: [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md)

## Purpose and authority

This brief defines the limited browser edition of VERA Research Video Clips.
It is the authoritative design input for runtime-specific feature availability,
browser-to-desktop handoff, and browser-suite navigation to VERA Script to
Timeline. The existing behavior contract remains authoritative for shared
research, language, clip, project, authorization, and collaboration semantics.

The web edition is not a copied or independently designed product. VERA remains
one React application with one component system, information architecture,
terminology set, responsive system, and shared cloud authority. Claude Design
must add **Desktop** and **Web** runtime presentations to the same prototype
rather than create a separate web design that can drift from Desktop.

## Product definition

VERA has two runtime presentations:

- **Desktop edition:** the complete local-first research, processing, export,
  artifact, offline, and native application.
- **Web edition:** an online research and collaboration application with
  caption-first hosted processing plus separately approved cloud translation
  and transcription.

The primary project destinations remain **Sources**, **Workspace**, and
**Clips** in both runtimes. Account Settings, Project Settings, and
capability-gated Platform Administration remain supporting destinations.

Runtime availability changes which controls are offered; it does not create a
second meaning for a transcript, source, clip, Topic, comment, project, member,
or language role. A clip logged in Web is the same canonical shared clip that
Desktop reads.

## Web edition feature availability

### Available in Web

The browser workflow includes:

- Web authentication using the shared VERA account identity.
- Active-project switching and project governance.
- Sources list, direct add, newline-list bulk add, and YouTube search.
- Reuse of verified project-shared transcripts.
- Hosted acquisition of available YouTube manual or automatic captions.
- Separately approved cloud translation when the preferred-language transcript
  is not already available.
- Separately approved cloud transcription when usable captions are unavailable.
- Transcript readiness, processing progress, retry, and actionable blocked
  states.
- YouTube playback through the established player wrapper.
- Preferred, Original, and English transcript views when the corresponding
  verified tracks exist.
- Transcript search, timing disclosure, navigation, and text selection.
- Manual player ranges after the source has passed the transcript-readiness
  gate.
- Clip logging, required descriptions where applicable, Topics, and an optional
  first comment.
- Clips, unified New state, comments, mentions, editing, search, Topics, and CSV
  export.
- Project Settings, Account Settings, and capability-gated Platform
  Administration for cloud-backed authorities.
- Read-only visibility of shared export history or status when it helps
  collaborators understand a clip's history.
- Logged-clip handoff to the separately installed Desktop application.
- One-click browser navigation to VERA Script to Timeline.

### Explicitly unavailable in Web

The following features are not available in the limited web edition and must
not be implied by mockups, disabled controls, help text, or status copy:

- `Export + log`.
- `Export only`.
- Individual, batch, retry, forced, or replacement media export.
- Creation or submission of export jobs from the browser.
- FFmpeg or FFprobe processing.
- Source-video or source-audio acquisition for local processing.
- Local Whisper transcription.
- Local Argos translation or language-pack installation.
- Browser-local WASM or WebGPU transcription or translation.
- Export presets, encoder settings, storage preflight, render progress,
  cancellation, and retry controls.
- Local output-root, cache-root, or scratch-root configuration.
- Local media-package or artifact-byte verification.
- Reveal, Open, Locate, Relink, or Re-export filesystem actions.
- Any guarantee that a local artifact is reachable from the browser.
- Cloud clip-package storage or browser delivery of rendered media.
- Verified offline transcript cache.
- Offline mutation outbox or offline collaboration.
- Native desktop notifications.
- The managed companion player and always-on-top behavior.
- Desktop tool, model, executable, output, and readiness setup.
- Automatic submission of work to an available Desktop export worker.
- Transfer of an unlogged browser selection into Desktop.
- Mobile or tablet layouts below approximately 1024 CSS pixels.

Shared export history may be shown read-only. A completed shared export record
means that a verified package version was finalized at some point; it is not
proof that its bytes are currently reachable from the browser or any particular
workstation. Web must not expose a local path, locator, or artifact action.

## Transcript processing in Web

Web uses this visible high-level resolution policy:

1. Reuse the exact verified shared transcript when one exists.
2. Attempt hosted acquisition of an available YouTube manual or automatic
   caption track.
3. If the source requires a preferred-language derivative, use the user's
   separately approved cloud-translation access.
4. If usable captions are unavailable, use the user's separately approved
   cloud-transcription access.
5. If a required service is unavailable, keep the Source visible and present
   the exact access, provider, retry, unsupported-route, or Desktop remediation.

Caption acquisition does not guarantee that every public YouTube source is
accessible. The interface must distinguish ordinary processing from a state
that needs user action and must never claim that automatic captions are always
available.

Users do not select a provider from the ordinary Sources or Workspace flow.
Provider-specific access, consent, preference, history, and withdrawal remain
in the focused Account Settings request flow. Platform Administration remains
separately capability-gated.

## Screen-specific Web behavior

### Global shell

- Keep the same project switcher and Sources, Workspace, and Clips navigation.
- Add a quiet, accessible **Web version** disclosure.
- Add the VERA suite-product switcher defined below.
- Keep Web and Desktop visually related; do not create a second header,
  navigation grammar, or token system.

### Onboarding and setup

- Retain sign-in, project access, privacy, project-rights, and relevant hosted-
  processing access requirements.
- Remove executable selection, model installation, output/cache roots, disk
  setup, and local-worker readiness.
- Explain that local transcription, local translation, media export, offline
  review, native notifications, and filesystem artifacts require Desktop.
- Optional hosted translation and transcription access can be requested when a
  blocked source actually requires them; do not force every browser user to
  request paid processing during initial entry.

### Sources

- Preserve direct and bulk ingest, official YouTube search, project keywords,
  Viewed state, Hide/Restore, duplicate outcomes, and role authorization.
- Replace Desktop-only local setup remedies with concise Web states such as
  **Translation access needed**, **Transcription access needed**, **Use Desktop
  processing**, **Processing**, **Retry**, and an honest unsupported-route
  state.
- Preserve the hard Workspace entry gate: the requesting user's verified
  preferred-language transcript must be ready before the source opens.

### Workspace

- Preserve the player, transcript, language views, search, timing honesty,
  logged-range treatments, selection editing, Topics, first comment, and
  **Log clip**.
- The Web action set is **Log clip** and **Copy**.
- Do not show disabled or decorative versions of `Export + log` or `Export
  only`.
- Do not expose companion-window, pin, or always-on-top controls.
- An unlogged selection cannot be handed to Desktop. If the user wants to
  export the selected range, explain that they must log it first.

### Post-log result and Desktop handoff

- After the durable clip is created successfully, offer **Open in Desktop to
  export**.
- The action opens the exact authorized logged clip; it does not create an
  export request or start media work.
- If Desktop is not installed, unavailable, signed out, or cannot authorize
  the clip, keep the logged clip intact and show the smallest relevant recovery
  path.
- Handoff must never pretend that an export started or that an artifact exists.

### Clips

- Preserve All, New, Mentions me, Mine, Topic filters, comments, editing,
  source preview, multilingual reading hierarchy, search, and CSV.
- Remove selection checkboxes when their only purpose is media export.
- Remove the contextual Export panel, preset/settings controls, local storage
  preflight, progress actions, and artifact filesystem actions.
- An authorized logged clip may offer **Open in Desktop**.
- Shared export history may appear as quiet read-only context without local
  availability or recovery claims.

### Account Settings

- Explain which capabilities require Desktop without presenting the Web
  edition as broken.
- Keep Online translation and Online transcription as independent provider-
  and service-specific access decisions.
- Retain the host-cost disclosure, optional administrator message, provider
  scope, request history, and state-specific withdrawal or stop controls.
- Adapt local-first copy honestly: Desktop local processing remains the private
  default when available, while approved hosted processing enables browser
  work that cannot run locally in Web.

### Project Settings and Platform Administration

- Preserve cloud-backed project governance, rights, membership, processing
  policy, keywords, lifecycle, provider access administration, and Argos
  catalog administration when the authenticated actor has the corresponding
  server-authorized capability.
- Hide Desktop-local worker, filesystem, executable, model-installation, and
  output-root controls.
- Project roles still never imply platform-administrator authority.

### Connection loss

- Web v1 is online-only.
- Already rendered content may remain readable in the current tab when safe,
  but the UI must not call it a verified offline cache.
- Disable new transcript resolution, project mutations, comments, logging, and
  other writes until reconnection.
- Preserve unsent form text in memory where practical and state clearly that
  it has not been saved.

## VERA browser suite navigation

### Suite switcher

The Web shell includes a product switcher with:

- **Research Video Clips** — the current product.
- **Script to Timeline** — a direct link to the browser-based VERA scripting
  program.

Selecting **Script to Timeline** opens it in a new browser tab so the current
research session remains intact.

### Identity, context, and authorization

- The browser products use the same suite identity, but each product remains an
  independently deployed application with its own project authority.
- Carry the current research-project identity only as navigation context.
- The navigation context may prioritize already linked authoring projects; it
  never grants project membership or access.
- Script to Timeline rechecks current authoring-project membership and current
  authorization to every linked research project before reading clips or other
  research records.
- If exactly one authorized authoring project is linked, the scripting home may
  prioritize it.
- If several authorized projects are linked, show an authorized chooser.
- If none are linked, open the normal scripting home with the research project
  available as context. Do not create or link a project automatically.
- An unauthorized, removed, stale, or archived context falls back to a safe
  scripting home or access explanation without revealing project existence or
  content beyond what the current account may read.

The navigation URL or handoff must never carry transcript text, comments, clip
content, credentials, tokens, presigned URLs, object keys, local paths, artifact
locators, or media identifiers beyond the minimum stable navigation identity.

The Script to Timeline design should use the reciprocal suite-switcher pattern
for returning to Research Video Clips. Desktop applications remain separately
installed applications; browser suite navigation does not merge their desktop
runtimes, databases, workers, or release processes.

## Capability-driven design contract

Claude Design should represent an explicit runtime/server capability model
rather than infer capabilities from browser identity or duplicate screens.

```ts
type RuntimeCapabilities = {
  runtime: "desktop" | "web";
  localTranscription: boolean;
  localTranslation: boolean;
  hostedTranscription: "unavailable" | "requestable" | "approved";
  hostedTranslation: "unavailable" | "requestable" | "approved";
  mediaExport: boolean;
  filesystemArtifactActions: boolean;
  verifiedOfflineCache: boolean;
  nativeNotifications: boolean;
  companionPlayer: boolean;
  scriptToTimelineWebNavigation: boolean;
};
```

This is a design-facing capability vocabulary, not final permission to create a
production contract with this exact wire shape. Production controls must use
typed runtime and server-authorized capability data, never user-agent sniffing,
renderer-only role inference, or a copied Web page implementation.

The established Desktop action semantics remain unchanged:

- `Log clip` creates a project clip and starts no render.
- `Export + log` creates the clip first and then requests its render.
- `Export only` creates no project clip.

Web offers only `Log clip`; absence of the other actions does not redefine
them.

## Claude prototype requirements

- Preserve every currently valid `CD-*` and `VB-*` decision.
- Close the five existing Desktop approval blockers before adding Web variants,
  so new scope cannot conceal an unresolved Desktop regression.
- Add a Desktop/Web runtime switch to the same interactive prototype.
- Add Web scenarios for Sources processing, selected Workspace logging,
  post-log Desktop handoff, Clips collaboration, independent hosted-service
  access requests, connection loss, and the Script to Timeline suite switcher.
- Update Component States, Visual Tokens, interaction notes, accessibility
  guidance, and handoff sheets for both runtimes.
- Normally omit unsupported Desktop controls from Web instead of displaying a
  field of disabled actions. Explain the limitation at the point where the user
  needs it.
- Keep role- and capability-valid actions absent from the DOM when the current
  actor or runtime cannot use them.
- Extend the fictional screenshot inventory with representative Web Sources,
  Workspace, Clips, processing-blocked, Desktop-handoff, and suite-switcher
  states.

## Design acceptance matrix

Verify Desktop and Web at both `1280 x 800` and `1024 x 768`:

- Shared screens use the same hierarchy, components, language roles,
  permissions, and project data.
- Every explicitly unavailable Web feature is absent from the Web DOM and
  remains present where appropriate in Desktop.
- Caption unavailability, translation-access absence, transcription-access
  absence, provider failure, connection loss, unsupported route, and Desktop-
  required states are distinct and actionable.
- Logging the same range in Web or Desktop creates the same canonical Original,
  English, and optional preferred-viewer-context evidence.
- Desktop handoff appears only after the clip is durably logged and does not
  create or imply an export automatically.
- Script to Timeline navigation works by pointer and keyboard, opens a new tab,
  carries only safe project context, and never bypasses authorization.
- Authorized linked authoring projects are prioritized correctly; multiple
  projects produce a chooser; unlinked or unauthorized accounts reach the safe
  scripting home or access state.
- Web connection loss never claims verified offline state and never presents an
  unsaved mutation as saved.
- Switching runtime presentations does not regress any approved Desktop
  scenario.
- Screenshots, fixture links, handoff states, and accessibility output contain
  no credentials, private content, local paths, object keys, signed URLs, or
  artifact locators.

## Assumptions and non-goals

- Web v1 supports desktop browsers at approximately 1024 CSS pixels and wider.
- Web v1 is online-only.
- Web and Desktop use the same cloud account, project, transcript, clip,
  comment, Topic, and collaboration authorities.
- Hosted caption acquisition plus separately approved cloud translation and
  transcription are the Web processing profile.
- Cloud media export, cloud clip-package storage, browser-local ML, tablet, and
  mobile support are outside this brief.
- Desktop remains the only runtime that creates export-only jobs and operates
  local media packages.
- Research Video Clips and Script to Timeline share suite identity and browser
  navigation but retain separate project memberships, authorization checks,
  data ownership, deployments, and application release lifecycles.
