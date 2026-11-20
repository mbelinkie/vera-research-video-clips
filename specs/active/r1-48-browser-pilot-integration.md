# R1 #48 browser pilot integration

[Research #48](https://github.com/mbelinkie/vera-research-video-clips/issues/48)

Invited researchers can sign in, register, reopen a shared project and read or
log clips according to their current membership. Committed project data and
transcripts survive service recovery.

## Integration scope

- B1. Trace role checks through the workspace, the protected API and the
  catalog. Verify Owner sharing, Editor logging, Viewer reads, nonmember
  isolation, revocation from an open session and concurrent Owner changes.
- B2. Check the Mac pilot composition and #53 runbook against the generated
  database and transcript restart/restore tests.
- B3. Trace browser login and onboarding through the Cognito provider, server
  session, profile registration and project creation. Use separate disposable
  browser contexts and the simulated provider for local verification.

The [Mac pilot runbook](../../docs/operations/mac-pilot-hosting.md) governs live
setup. This work uses generated data and loopback test services. Live provider
changes, hosting, invitations, host settings, real data, spending and media
processing are outside this task.

## Failures to verify

Invalid or expired login state, missing profiles, unauthorized or revoked
members, stale writes, removal of the last Owner and interrupted service or
restore. Verify denial and recoverable errors at the boundary users reach.

## Acceptance

1. Run existing HTTPS browser-auth, membership and disposable native PostgreSQL
   checks first. Add a focused regression only for a confirmed integration gap.
2. Record what each local check exercised, then run `npm run check` and submit
   the change to the protected GitHub Test workflow.
3. Obtain the requested read-only source review at or after the authorized
   Claude CLI window and address confirmed in-scope findings.
4. Keep #48 open for the separate live acceptance checklist and the Producer's
   explicit approval of the observed Owner, Editor and Viewer walkthrough.

## Source audit

- **B1.** The catalog enforces read, write and manage-members permissions.
  Membership grants, changes, transfers and revocations use the existing
  transactional and versioned catalog commands. The browser sharing panel
  resolves an exact verified address for a registered account.
- **B2.** The Mac pilot entrypoint uses PostgreSQL, private versioned transcript
  files and a loopback operator listener. The browser can now read the active
  English track directly from the authorized project API. The local transcript
  download rechecks membership even for URLs issued before a revoke. The
  transcript and project CSV responses carry `Cache-Control: no-store`.
  Cloudflare lists CSV among its default cacheable extensions.
  [Cloudflare default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- **B3.** The Cognito BFF verifies the authorization-code exchange with PKCE,
  one-time browser-bound state and a nonce. Its opaque cookie session resolves
  the verified provider subject to the registered catalog identity. Profile
  registration and first-project creation use the browser. Live invitations and
  account provisioning are administrator actions in the approved Cognito pool.

## Local evidence

- The strengthened HTTPS sharing test failed on the original built app because
  it displayed zero transcript rows for the published fixture. Both browser
  tests then passed against disposable PostgreSQL 16 and against the embedded
  catalog. Separate Chromium contexts used a simulated Cognito provider.
- The Editor selected and logged the stored fixture. The Owner saw the clip
  after reload. The Viewer read the transcript and was denied clip mutations.
  Nonmembers and the revoked browser received 403 for the transcript, signed
  download and clip CSV. An independent PostgreSQL connection found the fixture
  projects, memberships, transcript version and clip after API shutdown.
- The three opt-in PostgreSQL tests passed. They cover cold concurrent
  migrations, last-Owner races across separate connections, and the encrypted
  backup, restore and tamper checks. The backup destination was a separate
  temporary directory on the same host.
- All 15 desktop workspace browser tests passed. The signed-object test now
  verifies that an anonymous browser receives 401 and a current member can
  still read the pinned bytes while the backup gate blocks writes.
- With a private, nonsymlinked `TMPDIR` on macOS, `npm run check` passed
  formatting and type-checking. Vitest reported 389 passed, four opt-in tests
  skipped and two 15-second timeouts (worker lease and transcript finalization).
  Both timed-out cases passed on an isolated rerun with a 30-second local
  timeout. The web build and the six local and 15 cloud migration checks
  passed when run separately. CI retains its normal timeout.

## Review checkpoint

The issue remains open and claimed. The local revision is ready for a bounded
review of whether the published transcript and signed downloads enforce
current roles after revocation, and whether the existing auth, restart and
restore boundaries leave a release-blocking gap. Share only sanitized source
and diff excerpts. The Claude CLI window starts November 20 at 5:35 AM Eastern.
Resume by running the one authorized consultation and resolving confirmed
findings. Re-run the standard check and start protected GitHub Test CI.

## Producer live acceptance

1. Approve and follow the pilot runbook for FileVault, loopback PostgreSQL, the
   exact HTTPS origin, Cloudflare Access and Tunnel, and the Cognito callback
   and logout URLs. Confirm that protected API responses bypass shared caches.
2. Confirm an encrypted backup reaches the approved off-device destination.
   Recover the key from its separate location and restore into a fresh database
   and object directory.
3. Have an administrator provision test accounts. Observe two invited users
   sign in on separate outside-network browsers. Register a profile and create
   a project. Confirm that an Owner can share only with a registered account
   and an uninvited identity is denied at the edge.
4. Share as Editor, log from a published transcript and see the clip after the
   Owner reloads. Change the member to Viewer, verify read access and write
   denial, then revoke and verify that the existing tab loses access on its next
   request.
5. Observe suspend or restart, reconnection and a fresh sign-in. Verify that the
   shared project, clip, memberships and transcript persist. Confirm that
   disconnect cuts off remote access. Record the Producer's explicit approval
   on #48 after the walkthrough.
