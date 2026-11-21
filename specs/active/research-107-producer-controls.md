# Research #107 — Producer Controls for the friends-only pilot

[Research #107](https://github.com/mbelinkie/vera-research-video-clips/issues/107)
· parent [#48](https://github.com/mbelinkie/vera-research-video-clips/issues/48)
· go-live [#99](https://github.com/mbelinkie/vera-research-video-clips/issues/99)

The Producer sets up, operates and accepts the pilot from one page on the Mac,
without Terminal. The page answers three questions first: can invited friends
connect, is the research protected, and what to do next.

Per the Producer's direction, #107 delivers a working panel rather than only a
mock: the same screens run on example data (`--demo`) for design review and on
this Mac's real state for the live walkthrough. Design approval, #48 live
acceptance and #99 go-live remain separate Producer gates.

## How it runs

- `scripts/producer-controls/server.ts` serves the page on `127.0.0.1:43115`.
  It is a separate process from the Research API and the tunnel, so it works
  when either is down, and it has no build step.
- One-time install: `npm run controls -- install-app` creates
  `~/Applications/VERA Producer Controls.app`. Opening it starts the panel if
  needed and opens the page. After that the Producer never needs Terminal for
  normal operation.
- `npm run controls -- --demo[=scenario]` shows example data and changes
  nothing on the Mac.

### Local-only boundary

- Listens on loopback only. Refuses requests carrying Cloudflare or proxy
  headers (`cf-*`, `x-forwarded-*`, `forwarded`, `via`), checks `Host` against
  DNS rebinding, and requires a per-launch token on every `/api/*` call. POSTs
  must be JSON and same-origin. Responses are `no-store` with a strict CSP and
  `frame-ancestors 'none'`.
- Every pilot operation runs the existing `npm run pilot` command with an
  argument array, so the panel cannot bypass its safety checks. Output is
  size-capped and scrubbed.
- Secrets never reach the page. The settings file is edited in TextEdit. The
  backup key goes straight to the clipboard (`pbcopy`) for the password
  manager, and for the restore test it is typed into a native macOS dialog.
  The diagnostic summary and the #48 comment remove passwords, keys, tokens,
  emails and (for the public comment) the pilot address.
- **Open access for testing** is refused on the server unless every setup step
  passes, including a recovery test within eight days. **Pause access** is
  never gated.
- Outside services are contacted only when the Producer presses **Check
  again**, with public unauthenticated requests: the site root (expects a
  Cloudflare Access redirect), Cognito `/oauth2/authorize` with the exact
  callback (expects `/login`, not `redirect_mismatch`), and Cognito `/logout`
  with the exact sign-out URL.

### Screens

1. **Overview** — headline, one main next action, and five areas: Mac
   protection, Research storage, Website and invitation settings, Encrypted
   backup, Remote access. When access is on: "Invited testers can connect
   while this Mac is awake and online" and a prominent **Pause access**.
2. **Setup** — nine steps, one at a time, each with what VERA checks or does,
   what the Producer does, where help is needed, exact values to copy, and
   **Check again**. Progress is the real state plus saved confirmations.
3. **#48 walkthrough** — five stages, 24 recorded steps, sign-off, and a
   copyable comment for #48.
4. **Activity** — operations run this session with scrubbed details.

Example states (`--demo`): first-time setup, recovery not tested, ready, access
on, access paused, wrong sign-in address, stale or missing backup, Mac offline,
Research stopped.

## #48 traceability

| #48 live gate                                                               | Panel step                          | Evidence that passes it                                                                                                                                                                            | Failure remedy or named human action                                                                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FileVault                                                                   | Setup 1 · Overview "Mac protection" | `fdesetup status` reports On                                                                                                                                                                       | **Open FileVault settings** → Turn On → Check again                                                                                                                                        |
| Loopback PostgreSQL, separate drill role                                    | Setup 3 · "Research storage"        | `pg_dump` present, port answers, `PILOT_DRILL_PG_URL` set                                                                                                                                          | **Open Postgres.app** → Start → **Create database accounts** (VERA creates both least-privileged accounts and the database with generated passwords saved straight into the settings file) |
| Private settings                                                            | Setup 2                             | File is 0600, owned, passes the pilot's own `assertFriendFacing` and `hostSettings`, no `CHANGE_ME`                                                                                                | **Create settings file** / **Open settings file**; names the failing setting, never its value                                                                                              |
| Exact HTTPS origin                                                          | Setup 4                             | Producer confirms the one approved address; derived callback/logout kept in step on Check again                                                                                                    | Domain purchase: Producer approval                                                                                                                                                         |
| Cloudflare Access + Tunnel                                                  | Setup 4, 5                          | Unauthenticated `GET /` redirects to `*.cloudflareaccess.com`; Producer confirms the invite-only Allow list                                                                                        | **Open Cloudflare Zero Trust**; site opening without Access is flagged "Pause access, then add Access". Tunnel login/create: technical helper (runbook step 5)                             |
| Cognito callback and sign-out                                               | Setup 4                             | Authorize with exact callback reaches `/login`; logout returns exactly to origin                                                                                                                   | **Copy** the exact value → **Open sign-in settings (Cognito)** → Check again                                                                                                               |
| Admin-only invitations, no self-sign-up                                     | Setup 5                             | Producer confirmation                                                                                                                                                                              | Admin provisions accounts in Cognito; project Owners share only with registered accounts (server-enforced, #49/#52)                                                                        |
| Private pages/downloads bypass shared caches                                | Setup 5                             | Producer confirms no cache rule; API already sends `no-store`                                                                                                                                      | Live proof is walkthrough step "revoked download refused"                                                                                                                                  |
| Encrypted off-device backup                                                 | Setup 6, 7 · "Encrypted backup"     | Key exists and is private; Producer confirms password-manager custody with fingerprint; backup verified at an iCloud/cloud/external destination ≤36 h                                              | **Choose backup folder**, **Back up now**. On-Mac folder: "doesn't protect against losing the Mac". Unknown: **Unverified**                                                                |
| Recovery tested                                                             | Setup 9                             | `drill` passed ≤8 days                                                                                                                                                                             | **Test recovery**                                                                                                                                                                          |
| Restore into fresh DB + folder with the separate key; reconcile memberships | Walkthrough 2                       | **Restore a test copy**: key from the password manager via macOS dialog, fingerprint match, `recoverBackup` into a new `vera50_test_recovered_*` DB and folder, membership comparison against live | Comparison lists grants revoked or changed since the backup. **Remove test copy** drops it. Real switchover stays the runbook's technical recovery                                         |
| 1. Two invited outside-network testers; uninvited denied                    | Walkthrough 3                       | Remote access on and connected (checked); Producer records each observation                                                                                                                        | **Open access for testing** (gated)                                                                                                                                                        |
| 2. New tester registers and creates a project; share only with registered   | Walkthrough 3                       | Producer observation                                                                                                                                                                               | —                                                                                                                                                                                          |
| 3. Editor logs from published transcript; Owner sees after reload           | Walkthrough 4                       | Producer observation, ordered                                                                                                                                                                      | —                                                                                                                                                                                          |
| 4. Viewer reads, can't write; revoked tab and pre-issued download refused   | Walkthrough 4                       | Producer observation, ordered                                                                                                                                                                      | —                                                                                                                                                                                          |
| 5. Sleep/restart, recovery, fresh sign-in, data persists; pause cuts off    | Walkthrough 5                       | Reachable again after the interruption (checked); paused = tunnel job confirmed gone (checked); Producer observations                                                                              | **Pause access**                                                                                                                                                                           |
| Producer approval                                                           | Sign-off                            | All 24 steps recorded; name; confirmation                                                                                                                                                          | **Copy comment** → post on #48                                                                                                                                                             |

## Action mapping

| Panel action                                                                                                | Backed by                                                                                                                                                                                                                                                            | Kind                            |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Start / Stop Research, Open / Pause access, Back up now, Test recovery, Install services, Create backup key | `npm run pilot -- start / stop / connect / disconnect / backup / drill / install --load / backup-key create`                                                                                                                                                         | Existing #53 operator control   |
| Check again                                                                                                 | `collectStatus`, `fdesetup`, tool checks, edge probes; keeps derived sign-in URLs in step                                                                                                                                                                            | New, read-only                  |
| Build website                                                                                               | `vite build`                                                                                                                                                                                                                                                         | Existing build                  |
| Create database accounts                                                                                    | Postgres.app's local administrator: `vera_pilot` (no superuser, createdb or createrole) owning the `vera_pilot` database, and `vera_drill` (CREATEDB only); generated passwords go straight into the 0600 settings file; never drops anything or touches other roles | New                             |
| Create / Open settings file, Choose backup folder                                                           | Template written 0600; TextEdit; macOS folder picker + validated in-place edit                                                                                                                                                                                       | New                             |
| Copy key for password manager                                                                               | `readKeyFile` → `pbcopy`                                                                                                                                                                                                                                             | New, key never shown            |
| Restore a test copy / Remove test copy                                                                      | `recoverBackup` + membership comparison; drop DB and folder                                                                                                                                                                                                          | New, wraps existing recovery    |
| Open FileVault / Postgres.app / Cloudflare / Cognito                                                        | `open` System Settings, app or provider console                                                                                                                                                                                                                      | Graphical macOS / provider step |
| Confirmations                                                                                               | Saved in `state/producer-controls.json` (0600)                                                                                                                                                                                                                       | Producer attestation            |

**Proven locally:** FileVault, tools, settings validity, database reachability,
services, backup and drill timestamps, destination kind, key privacy,
tunnel state. **Needs live evidence:** Access redirect, Cognito callback and
sign-out (probed from the Mac on demand), and every tester observation.

## Feasibility, gaps and fallbacks

- One-time Terminal steps remain, each named as **Needs help** in the panel:
  `npm run controls -- install-app` (first launch) and
  `cloudflared tunnel login/create/route`. The database accounts are created
  by the panel through Postgres.app's local administrator. A normal
  Producer flow after that needs no Terminal.
- Cognito self-sign-up and the Access Allow list cannot be read without
  provider credentials, so they are Producer confirmations, backed by the live
  walkthrough (uninvited email refused).
- Cache bypass is a confirmation plus the live "revoked download refused" step.
- Real disaster recovery (renaming the restored DB, repointing the folder)
  stays the runbook's technical procedure. The panel's restore test proves the
  backup, the separately kept key and the membership comparison without
  touching live data.
- Sleep cannot be triggered from the panel. The Producer closes the lid; the
  panel then proves service came back.
- If the panel itself stops, the app relaunches it; `npm run pilot` remains a
  documented fallback.

## Verification

- `tests/infra/producer-controls.test.ts` (29): every example state's headline
  and next action; the open-access gate (also enforced server-side); walkthrough
  remote-access, ordering, undo, sign-off and frozen record; comment without
  address or emails; scrubbing; edge probe pass/fail/unknown; membership
  comparison; settings template and in-place edits; live provider creates a
  private file once and refuses to open access; server token, Host, proxy
  header, origin, content type and action allowlist; launcher script.
- Browser (example data): Overview → Test recovery → Open access (confirm
  dialog) → all 24 walkthrough steps through the real buttons → restore
  comparison → sign-off → comment. Wrong-sign-in remedy; 375 px width with no
  horizontal scroll.
- Read-only live snapshot on this Mac with an empty temp settings path:
  FileVault reported Off (matches the runbook), first step offered; a request
  with `cf-ray` was refused 403.
- Not run: real Postgres restore test from the panel (needs the live roles and
  a backup), Cognito/Access probes against real providers, a screen-reader pass.

## Revised #48 Producer live acceptance (using Producer Controls)

Replaces the Terminal-based steps in
`specs/active/r1-48-browser-pilot-integration.md#producer-live-acceptance`.
The gates are unchanged.

0. **Open the panel.** Open **VERA Producer Controls** from Applications (first
   time only, a helper runs `npm run controls -- install-app`).
1. **Setup (Setup tab, steps 1–9).** Work down the list until every step shows
   Done: FileVault on; settings file created and filled in TextEdit; Postgres.app
   running and **Create database accounts** pressed; the one HTTPS address approved, with the shown
   callback and sign-out values pasted into Cognito and the Access application
   created; invitation, admin-only and no-cache confirmations ticked; backup key
   created, copied to the password manager and confirmed by fingerprint; backup
   folder chosen off the Mac and **Back up now** passed; website built, services
   installed, Research started; **Test recovery** passed. The Overview then
   reads "Remote access is off · Everything checks out".
2. **Walkthrough stage 1 — Before you invite anyone.** Press **Check again** on
   the Overview, then **Record** both checks.
3. **Stage 2 — Prove the backup can be restored.** Record the off-Mac backup.
   Press **Restore a test copy** and paste the key from the password manager
   into the macOS window. Review the membership comparison: every row marked
   "revoked since" or "role changed" must already be revoked or changed on the
   live service. Record both steps, then **Remove test copy**.
4. **Stage 3 — Testers sign in.** Press **Open access for testing**. Have the
   administrator create two test accounts. Each tester signs in on their own
   device and network; one registers and creates a project; the Owner tries an
   unregistered email (refused) and a registered tester (works); an uninvited
   email is refused by Cloudflare. Record each with **I saw this**.
5. **Stage 4 — Editor, Viewer and revocation.** Share as Editor; the tester logs
   a clip from a published transcript; the Owner reloads and sees it. Change to
   Viewer; the tester reads but can't change clips or members. Revoke; the
   open tab and a previously copied download link are refused. Record each.
6. **Stage 5 — Interruption and pausing.** Close the lid or restart while a
   tester has Research open (they see the unavailable page). Wake the Mac,
   wait for the Overview to show testers can connect, record **back online**;
   the tester signs in again and finds the project, members, transcript and
   clip. Press **Pause access**, record it, and record that the tester is cut
   off.
7. **Sign off.** Enter your name, press **Approve #48 live acceptance**, then
   **Copy comment** and post it on #48. Close #48 only after that comment is
   posted. #99 go-live stays separate.
