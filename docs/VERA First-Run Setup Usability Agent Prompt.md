# VERA First-Run Setup Usability Agent Prompt

Copy and paste the prompt below into the implementation task that will fix the
desktop setup experience. This is an immediate M7 dogfood blocker, not a request
to begin M8 distribution work.

---

You are the primary implementation agent for the **VERA — Research Video Clips**
desktop first-run setup usability fix. Make local transcription and export
setup understandable and completable by an ordinary user on the current Intel
Mac without Terminal, hidden Homebrew navigation, `.env` editing, or manual
configuration-file changes.

Continue until the bounded behavior below is implemented and verified, or until
a genuinely external prerequisite that cannot safely be resolved is precisely
identified. Do not stop at a mockup, documentation change, or fixture-only UI.

## Why this is urgent

During packaged-app dogfood, the **Folders, tools, and model** section presents
seven undifferentiated rows:

- Export folder — Not selected
- Transcript cache folder — Not selected
- FFmpeg — Not selected
- FFprobe — Not selected
- yt-dlp — Not selected
- whisper-cli — Not selected
- Whisper model — Not selected

The user is expected to understand every component and locate it manually. On
the current workstation, all four executables are already installed, but their
convenient `/usr/local/bin/...` Homebrew entries are symbolic links rejected by
the exact-file validator. The only successful manual route is to navigate into
hidden, version-specific Cellar directories. This is not an acceptable ordinary
first-run workflow.

The packaged runtime configuration also has no `whisperModelPin`. Consequently,
the model cannot be selected or downloaded through the app: arbitrary model
files are correctly rejected because no approved expected byte count and
SHA-256 exist. The user cannot finish transcription setup in the current build.

M7-03 was intended to deliver terminal-free setup and detection. M8-01 still
owns signed portable dependency/model packs for remote macOS and Windows
testers, but the current local Mac must become usable now as an M7-06 dogfood
fix. Do not defer the broken current experience wholesale to M8.

## Required repository and worktree procedure

1. Read in full before editing:
   - `.agents/skills/research-video-clip-workflow/SKILL.md`
   - `PROJECT_GUIDE.md`
   - `outline.md`
   - `specs/completed/M7-03-terminal-free-first-run-tools-model-and-readiness.md`
   - `docs/research/M7-03-electron-tool-and-whisper-model-readiness.md`
   - `docs/decisions/M7-M8-local-desktop-and-pilot-distribution-boundary.md`
   - the current active dogfood spec(s)
2. Inspect `git status --short --branch`, recent history, every active spec, and
   the complete current diff before editing. Preserve all unrelated user work.
   Never reset, stash, clean, broadly format, or recreate dirty files.
3. At the time this prompt was written,
   `specs/active/DOGFOOD-001-first-run-project-and-local-setup.md` was active and
   the worktree contained ongoing Cognito/profile/project/local-agent fixes plus
   AWS development-boundary work. Re-resolve the actual state. Do not create a
   second active spec or edit overlapping files concurrently.
4. If DOGFOOD-001 is still active, finish and verify it first, or deliberately
   amend that one spec if and only if this setup defect is still one coherent
   first-run slice. Otherwise create exactly one bounded active spec such as
   `specs/active/DOGFOOD-002-one-click-local-processing-setup.md` before
   substantive implementation.
5. Do not commit, push, deploy, publish, install software, use live media, or
   mutate cloud resources unless the current task separately authorizes that
   exact action. A model artifact may be researched and downloaded solely for
   establishing the approved public pin and testing the app-owned model flow;
   retain no ambiguous or unverified model candidate.

## User-visible outcome

Replace the manual seven-row prerequisite puzzle with a guided, capability-
oriented setup experience:

1. The primary action is **Set up this Mac** (or equivalently clear wording).
2. The app proposes safe default export and cache locations and detects the
   already-installed compatible tools through a bounded trusted search.
3. It summarizes what it found, what it will create, the approved model name
   and download size, and which operations this enables before making changes.
4. One explicit confirmation validates and activates the detected tools,
   creates/activates the approved roots, and offers the verified model download.
5. Model download remains a distinct, explicit network/storage action with
   progress, cancellation before promotion, checksum verification, and clear
   failure recovery.
6. Successful setup reports outcomes in user language: **Review transcripts**,
   **Create transcripts**, and **Export clips**. It must not require the user to
   know why FFprobe is separate from FFmpeg.
7. Manual root/tool/model replacement remains available under **Advanced
   setup** for recovery and expert use, but it is not the normal path.
8. The configuration persists across app restart. A replaced, upgraded, moved,
   or changed tool/model fails only its dependent operation and offers
   **Re-detect** or **Choose a different file** without silently trusting it.

## Required design behavior

### 1. Capability-oriented presentation

Present three understandable capability groups:

- **Browse and log research** — account/project/cloud and local database; media
  tools are not required.
- **Create transcripts** — transcript cache, authorized yt-dlp audio provider,
  whisper-cli, approved Whisper model, rights/privacy acknowledgements, and the
  local worker.
- **Export clips** — export folder, authorized yt-dlp source provider, FFmpeg,
  FFprobe, rights/privacy acknowledgements, and the local worker.

Keep component-level evidence accessible in a details/advanced view. Missing
transcription or export dependencies must not globally disable browsing,
verified cached review, or logging.

### 2. Recommended roots

Offer user-understandable defaults equivalent to:

- Export folder: `~/Movies/Research Video Clips Exports`
- Transcript cache: an app-owned private cache directory, or a clearly named
  `~/Library/Caches/Research Video Clips` location

Do not send either raw path into React state or public diagnostics. Main process
and authenticated local-agent code own path resolution, directory creation,
permissions, write probing, filesystem identity, storage measurement, and
trusted runtime composition.

Creating the proposed folders is a user-authorized native setup action. Create
only the exact approved directories, use appropriately private permissions,
and preserve existing content. Never delete or repurpose a pre-existing
directory to make setup pass. Keep the 10 GiB recommendation and measured need
plus 2 GiB safety reserve; low storage degrades or blocks only the dependent
heavy operation.

### 3. Safe tool detection and activation

Detect only bounded approved candidates appropriate to the current platform,
including the current Intel Homebrew layout. Known current installations are:

- `/usr/local/bin/ffmpeg` ->
  `/usr/local/Cellar/ffmpeg/8.1.2_1/bin/ffmpeg`
- `/usr/local/bin/ffprobe` ->
  `/usr/local/Cellar/ffmpeg/8.1.2_1/bin/ffprobe`
- `/usr/local/bin/yt-dlp` -> a versioned Homebrew launcher whose canonical
  regular file is currently
  `/usr/local/Cellar/yt-dlp/2026.8.19/libexec/bin/yt-dlp`
- `/usr/local/bin/whisper-cli` ->
  `/usr/local/Cellar/whisper-cpp/1.9.1/bin/whisper-cli`

Do not hard-code those version numbers as the product algorithm. Search a
closed set of platform-appropriate entrypoints such as Intel Homebrew,
Apple-Silicon Homebrew where useful for forward compatibility, and later
app-owned locations. Resolve an approved entrypoint to its canonical target
only inside the trusted native/local-agent boundary. Then apply the existing
regular-file, executable, identity, byte/hash, bounded-output, timeout, and
tool-specific capability probes to the canonical target before activation.

Do not weaken validation to execute arbitrary symlinks, accept the first `PATH`
match, invoke a shell, trust a version string alone, or expose a canonical path
to the renderer. Symlink resolution is discovery of a candidate; activation is
still based on the exact canonical regular file and its validated identity.

The current FFmpeg build must continue proving required encoders, muxers, and
filters; FFprobe must return the required structured program data; yt-dlp must
use `--ignore-config` and expose required structured/simulation options; and
whisper-cli must expose the required model/file arguments. Preserve the prior
valid reference if any replacement or re-detection fails.

### 4. Approved Whisper model pin

Complete the missing production pin instead of teaching the user to find a
random `.bin` file. The existing project documentation and environment examples
name `ggml-large-v3-turbo.bin`; treat that as the preferred candidate, not as
permission to invent metadata.

Before approving it:

1. Consult current primary whisper.cpp model documentation and the exact
   artifact host/revision.
2. Confirm the artifact and model license are compatible with this app's
   intended use and future distribution. Record sources and access date in
   `docs/research/`.
3. Choose an immutable HTTPS artifact identity or otherwise pin the exact
   resolved revision. Do not depend on a mutable “latest” URL without recording
   and verifying the resulting immutable artifact identity.
4. Obtain the exact byte count and independently compute a 64-hex SHA-256 over
   the complete artifact. Do not mistake upstream 40-hex SHA-1 metadata for
   SHA-256.
5. Record the approved public name, URL/revision, byte count, SHA-256, license,
   and provenance in an appropriate non-secret release/configuration boundary.
6. Make the desktop build include the complete public model pin. The current
   `DesktopRuntimeConfigurationSchema` already allows `whisperModelPin`, but
   `scripts/build-desktop.ts` currently emits only the three cloud values. Fix
   the real build/configuration flow and its partial/invalid-configuration
   failures rather than asking the user to edit app-data JSON.

The normal UI should say what will be downloaded and approximately how much
space it needs, then use the existing app-owned private staging, measured
stream, exact size/SHA-256 verification, atomic promotion, cancellation, and
prior-valid-model preservation boundaries. Never activate a partial or
unverified model. Keep network/provider tests deterministic by default; a
real-artifact pin/download check may be an explicit integration gate.

### 5. Clear states and remediation

For the recommended setup flow, expose bounded states such as:

- Checking this Mac
- Ready to set up
- Creating folders
- Validating FFmpeg/FFprobe
- Validating yt-dlp
- Validating whisper.cpp
- Model download required
- Downloading model with bytes/progress
- Verifying model
- Ready to create transcripts
- Ready to export clips
- Needs action, with one direct corrective action

Do not use one indefinite spinner. Do not report “validated and activated” when
the native dialog was canceled. Avoid raw backend vocabulary such as
`whisper_cli`, `output_root`, or `model_pin_required` in primary user-facing
copy. Detailed component evidence may remain available in an advanced panel.

## Security, privacy, and architecture invariants

- Keep the Electron renderer sandboxed and context-isolated with no Node,
  filesystem, process, token, arbitrary URL, or arbitrary IPC authority.
- React receives only typed path-free summaries, opaque references, versions,
  bounded progress, and closed remediation actions.
- Native discovery, canonicalization, folder creation, model-network access,
  tool execution, hashing, and path persistence stay in the main process and
  authenticated local-agent boundary according to current ownership.
- Every tool probe uses an exact validated executable and argument array with a
  bounded environment, working directory, timeout, stdout, and stderr. Never
  invoke a shell or inherit arbitrary user configuration.
- Preserve prior validated roots/tools/models until a replacement is fully
  validated and atomically activated.
- Keep OAuth credentials, desktop session secrets, private paths, raw command
  output, model staging paths, research content, and source URLs out of
  renderer state, logs, notices, and shared/cloud contracts.
- Do not alter shared catalog authority, transcript publication, clip/export
  semantics, source-rights confirmation, full-source scratch cleanup, subtitle
  policy, or artifact immutability.

## Explicit non-goals

- No signed/notarized macOS Universal build, Windows build, installer, public
  GitHub Release, automatic updater, or remote-tester dependency pack. Those
  remain M8.
- No automatic Homebrew installation, `brew` subprocess, shell script,
  privilege escalation, or package-manager mutation.
- No weakening tool/model validation merely to accept convenient symlinks.
- No arbitrary PATH scan, whole-filesystem search, user-supplied download URL,
  model picker without an approved pin, or mutable unverified model download.
- No live YouTube/media acquisition unless separately authorized for one exact
  source. Tool detection and model verification grant no source rights.
- No redesign of projects, transcript processing, exports, jobs, migrations,
  or readiness contracts beyond what this bounded first-run experience needs.
- No unrelated cleanup or feature work.

## Smallest end-to-end proof

Starting from disposable app data with no selected roots, tools, or model:

1. Launch the packaged Intel macOS `.app` from Finder/Dock.
2. Reach the setup screen without Terminal.
3. Choose **Set up this Mac**.
4. See the proposed roots, the four detected compatible installed tools with
   safe display names/versions, and the approved model name/download size.
5. Confirm setup. The app creates/validates roots and activates canonical tool
   references without opening hidden Finder directories.
6. Start the approved model download, observe progress, and verify successful
   size/hash promotion. Also cancel an interrupted disposable download and
   prove the prior valid model remains active with staging cleaned up.
7. Enable the authorized providers/local worker and observe **Create
   transcripts** and **Export clips** become ready while lightweight operation
   readiness remains independently accurate.
8. Quit and relaunch. The selections and operation readiness persist with no
   raw path or token visible in renderer state or logs.
9. Replace or mutate a disposable tool fixture and prove only its dependent
   capability becomes **Needs action**, then recover with **Re-detect**.

## Required tests

Run narrow tests first, then broaden proportionally. At minimum cover:

1. Closed trusted-candidate discovery for supported Intel and Apple-Silicon
   Homebrew entrypoints, app-owned candidates, absent tools, duplicates, and
   deterministic preference.
2. Safe symlink-to-canonical discovery, including broken links, link chains,
   loops, target replacement races, target outside policy, non-regular files,
   changed identity/hash, and preservation of the prior active reference.
3. Existing FFmpeg/FFprobe/yt-dlp/whisper-cli capability-probe failures,
   timeout/bounded-output behavior, no-shell execution, and exact canonical
   activation.
4. Recommended-root proposal/creation, existing-directory preservation,
   permission/write-probe failures, low-space states, path-free renderer
   contracts, and restart persistence.
5. Complete/partial/invalid model-pin build configuration and packaged-config
   inclusion without secrets.
6. Model size/hash mismatch, redirect policy, oversize, cancellation, staging
   cleanup, atomic promotion, previous-model preservation, and restart.
7. Recommended-setup UI states, confirmation, cancellation, actionable errors,
   advanced/manual fallback, operation-oriented readiness, and accessibility.
8. Regression coverage for existing manual selection, setup persistence,
   worker restart/reconciliation, transcript readiness, and export readiness.

Then run the relevant formatting, typecheck, Vitest, migration, Playwright,
web/desktop build, package, `git diff --check`, and broader repository checks.
Manually test the packaged app on this workstation. Retain actual commands,
file/test counts, skips, package architecture/path, and the new app artifact
hash.

## Acceptance criteria

1. A first-time user can prepare this Mac for transcript creation and exports
   from one guided setup flow without Terminal, `.env`, app-data JSON, hidden
   directories, Homebrew knowledge, or seven manual picker decisions.
2. The four currently installed tools are discovered and activated only after
   the existing exact capability/security validation of their canonical regular
   files; no arbitrary PATH/symlink trust is introduced.
3. The approved Whisper model has documented immutable provenance, exact byte
   count, independently verified SHA-256, compatible license evidence, and a
   complete public pin in the actual packaged runtime configuration.
4. The user can explicitly download, monitor, cancel, verify, and activate the
   model in-app. Failure never removes or replaces a prior valid model.
5. Recommended roots are understandable, safely created/validated after user
   confirmation, storage-aware, and never exposed as renderer/public paths.
6. Primary readiness is expressed by user outcomes; advanced component details
   and manual replacement remain available without dominating first run.
7. Browsing/review/logging stay usable when only transcription/export setup is
   missing. Dependent heavy operations fail closed and offer direct recovery.
8. Settings and validated references survive relaunch; changed components are
   detected honestly and recover through re-detection or advanced replacement.
9. Focused and aggregate checks, packaged-app manual proof, and independent
   review find no unresolved security, integrity, privacy, storage, or normal-
   workflow blocker.
10. The completed spec records decisions, files, checks/results, model
    provenance, artifact identity, remaining risks, and commit IDs. Update
    `PROJECT_GUIDE.md` and `outline.md` only for behavior actually verified.

## Completion and milestone boundary

Treat this as an immediate M7 dogfood correction. It closes the current setup
usability/model-pin blocker for the locally built Intel Mac app; it does not
complete M7-01 production infrastructure, fabricate authorized live-source
evidence, or begin M8.

After implementation, independently review the complete diff for renderer/IPC
authority, symlink/canonical-path races, untrusted executable invocation, model
download integrity, directory containment/permissions, secret/path leakage,
restart behavior, and preservation of existing setup data. Resolve every P0/P1
finding before moving the active spec to `specs/completed/`.

Report the exact user-visible result, model pin and provenance, files and
migrations affected, tests/builds/manual package evidence, package hash,
remaining external blockers, and confirmation that unrelated dirty work was
preserved. Stop after this bounded fix; do not proceed into M8 dependency packs
or release engineering.

---
