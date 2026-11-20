# VERA Research #53: friends-only hosting on the Producer's MacBook

**What this is.** A few invited friends can use the Research website while the
Producer's MacBook is awake and online. There is **no uptime guarantee** and
**no paid always-on cloud compute**. When the Mac sleeps, restarts or is
offline, friends see a Cloudflare error page and an open tab shows
"Research is unavailable… the host's laptop may be asleep or offline; your
saved work is safe."

**What is not switched on by this work.** No tunnel, domain, Cloudflare
Access application, Cognito pool, metered storage or real Research data was
created, bought or exposed. Going live is the separate Producer-approved
checklist below.

## How it fits together

```
friend's browser ──HTTPS──► Cloudflare Access (invite list: emails)
                               │  signed Cf-Access-Jwt-Assertion
                               ▼
                         Cloudflare Tunnel (outbound-only from the Mac;
                               │            no router ports are opened)
                               ▼
  Mac: cloudflared ──► 127.0.0.1:43111  Research API + built website
                        │   1. verifies the Access token again (fails closed)
                        │   2. Cognito browser session (#51)
                        │   3. project membership on every request (#49/#52)
                        ├──► PostgreSQL on 127.0.0.1 only (#50), never tunnelled
                        └──► private transcript folder (#50)
       127.0.0.1:43114  operator port: health, maintenance, diagnostics.
                        Never tunnelled; refuses any proxy/Cloudflare header.
```

Defense in depth on the public path: Cloudflare Access at the edge,
`cloudflared` itself validating the Access token (`originRequest.access`),
the API validating it again with the Access signing keys, then Cognito and
project permissions. Removing or misconfiguring the Access application
therefore locks everyone out instead of exposing the sign-in page.

Every request through the tunnel arrives from `127.0.0.1`, so "loopback" no
longer proves a request is local. That is why maintenance and diagnostics
moved to the separate operator port, why the public port no longer serves
`/__maintenance/*`, and why the tunnel config also 404s those paths.

## Commands (`npm run pilot -- <command>`)

All commands read the private env file at
`~/Library/Application Support/VERA Research Pilot/pilot.env` (or
`PILOT_ENV_FILE`). It must be `chmod 600`; secrets never go in a plist,
command line or log.

| Command                                | What it does                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`                                | Preflight: settings valid, website built, PostgreSQL tools present, backup key private, destination present.                                                                                                        |
| `status` (`--json`)                    | Friends can reach it now? API, PostgreSQL, tunnel, restarts in 24h, Access/sign-in failure counts, last good backup and drill, free disk, and a "Needs attention" list. Exit code 2 when something needs attention. |
| `connect`                              | Starts the tunnel. Invited friends can reach Research while the Mac is awake.                                                                                                                                       |
| `disconnect`                           | **Stops outside access immediately.** Research keeps running locally.                                                                                                                                               |
| `stop` / `start`                       | Stops tunnel and API / starts the API (local only; friends still need `connect`).                                                                                                                                   |
| `backup`                               | Takes a consistent backup now (see below).                                                                                                                                                                          |
| `drill`                                | Restores the newest off-device backup into a throwaway database and checks it.                                                                                                                                      |
| `recover FILE DIR`                     | Disaster recovery into a new database and folder (see below).                                                                                                                                                       |
| `install [--load\|--dry-run]`          | Writes the four LaunchAgents; `--load` starts the API and schedules backup and drill, **not** the tunnel.                                                                                                           |
| `tunnel-config`                        | Writes the validated `cloudflared.yml`.                                                                                                                                                                             |
| `backup-key create\|show\|fingerprint` | Creates the backup key or shows it for your password manager.                                                                                                                                                       |

## Supervision, restarts, sleep and disk

- Per-user LaunchAgents (`com.vera-research.pilot.{api,tunnel,backup,drill}`),
  no root. The API and tunnel start at login and are restarted after a crash
  (15 s throttle). Each API start is recorded; `status` shows restarts in the
  last 24 h.
- Shutdown, logout and `stop` send SIGTERM: the API stops accepting
  requests, finishes in-flight ones and closes its PostgreSQL connections
  (30 s grace before a forced stop). PostgreSQL and transcript writes are
  crash-safe (#50: transactional catalog, fsync'd atomic object publish), so a
  power loss or lid close cannot leave a half-published transcript.
- Sleep simply pauses everything; on wake `cloudflared` reconnects on its own.
- API logs rotate at 5 MB, keeping 5 files, under `logs/` in the pilot home.
- **Disk guard:** when free space on the transcript volume drops below
  `PILOT_DISK_PAUSE_BELOW_MB` (default 2 GB), saving is refused with a clear
  message while reading keeps working. `status` reports it.
- **Transcription worker:** not run on the pilot. Friends can view, search
  and log against existing transcripts. New transcription happens on the
  Producer's own setup. `status` never claims a worker is running.

## Backups

Nightly at `PILOT_BACKUP_HOUR` (default 3 am), with reduced CPU/disk priority:

1. #50 consistent backup: the write gate pauses saves (they return "try again
   shortly"), in-flight writes drain via the operator port, then a PostgreSQL
   dump plus the exact transcript object versions and a checksummed manifest.
2. Packed and **encrypted on the Mac** (AES-256-GCM, 1 MB authenticated chunks,
   per-file key from the master key). Tampering, truncation, reordering or the
   wrong key is detected; nothing is restored from a damaged file.
3. Copied to `PILOT_BACKUP_DESTINATION` (default: an iCloud Drive folder, so it
   leaves the Mac), then **re-read and fully verified** at the destination.
4. Retention: newest 3, plus one per day for 14 days, one per ISO week for 8
   weeks and one per month for 12 months. Only exact backup file names are
   ever deleted.
5. A failure is recorded, shown first in `status`, and pops a macOS
   notification. Nothing fails silently.

Weekly (`PILOT_DRILL_WEEKDAY`, default Sunday) the **restore drill** decrypts
the newest off-device backup, restores it into a brand-new
`vera50_test_drill_*` database and folder with all #50 integrity checks
(dump checksum, every object hash, table counts and digests), then deletes
both. `status` flags a backup older than 36 h or a drill older than 8 days.

### The backup key (Producer action)

The key lives at `PILOT_BACKUP_KEY_FILE` on the Mac, **never** in the backup
folder. After `backup-key create`, run `backup-key show` and save the key in
your password manager. If the Mac is lost and the key isn't saved elsewhere,
**no backup can be restored**. iCloud only ever holds encrypted files.

### Disaster recovery (new or repaired Mac)

1. Install Postgres.app and create the pilot and drill roles (setup step 2).
2. Restore the code checkout and `pilot.env`, and put the saved key back into
   `PILOT_BACKUP_KEY_FILE` (`chmod 600`).
3. `npm run pilot -- recover "<backup folder>/vera-research-<time>.verabk" "<new empty folder>"`
   verifies and restores into a new database named
   `vera50_test_recovered_<time>` and the new folder.
4. As the Postgres.app superuser:
   `ALTER DATABASE "vera50_test_recovered_<time>" RENAME TO vera_pilot;`
   `ALTER DATABASE vera_pilot OWNER TO vera_pilot;` then, connected to
   `vera_pilot`: `REASSIGN OWNED BY vera_drill TO vera_pilot;`
5. Point `PILOT_OBJECT_ROOT` at the new folder, run `npm run pilot -- check`,
   then `start`. Rehearsed on 2026-11-20 against PostgreSQL 18 (see PR).

## Going live: Producer checklist

None of these were done by #53. Each needs your explicit go-ahead.

1. **Turn on FileVault** (System Settings → Privacy & Security). It is
   currently **off** on this MacBook; the pilot stores transcripts and the
   database on this disk.
2. **PostgreSQL:** install Postgres.app (free; Homebrew can't supply
   ready-made PostgreSQL for this Intel Mac). Keep it on `localhost` only.
   Create a `vera_pilot` role and database (not superuser) and a `vera_drill`
   role with `CREATEDB` only.
3. **Domain:** a domain you own on Cloudflare (free plan), for example
   `research.<your-domain>`. Buying a domain costs money and needs approval.
4. **Cloudflare Zero Trust** (free for up to 50 users): create a self-hosted
   Access application for that exact hostname with an Allow policy listing
   your friends' emails. Copy the team name and the application's audience tag.
5. **Cloudflare Tunnel:** `cloudflared tunnel login`, `cloudflared tunnel create vera-research`,
   `cloudflared tunnel route dns vera-research research.<your-domain>`.
6. **Cognito** (#51): admin-create-only user pool and a web client whose
   callback is exactly `https://research.<your-domain>/cloud-api/auth/callback`
   and logout `https://research.<your-domain>/`. Never a desktop custom scheme.
7. Fill in `pilot.env`, then `npm run build:web`, `npm run pilot -- backup-key create`,
   `backup-key show` (save it), `check`, `tunnel-config`, `install --load`.
8. Take a first `backup` and `drill`, then `connect`.
9. **Acceptance test with two friends** on their own networks and devices:
   each signs in and sees only their projects; an uninvited email is refused by
   Access; you close the lid and they see the unavailable message; on wake it
   recovers. Then `disconnect` and confirm they're cut off.

## Security boundaries (unchanged guarantees)

- No router port forwarding; the tunnel is outbound-only and forwards one
  exact hostname to `127.0.0.1:43111`. Everything else gets 404.
- PostgreSQL, the operator port and `/local-agent` are never reachable
  through the tunnel. Forwarded headers are only accepted from loopback
  (#51), and the operator port refuses them entirely.
- No development bearer tokens in browser mode (#51). Production config
  refuses to start without browser auth, Mac-pilot mode and Cloudflare Access
  settings.
- Diagnostics counters keep no emails, IDs, URLs or tokens.

See `managed-migration.md` for moving off the laptop later.
