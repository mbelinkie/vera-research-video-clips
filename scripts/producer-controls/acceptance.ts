/**
 * The #48 Producer live acceptance walkthrough as a guided, recorded checklist.
 *
 * Two kinds of item:
 * - "check": VERA can prove it from this Mac. It can only be recorded while
 *   the check passes, and the evidence is stored with the time.
 * - "observe": only the Producer can see it happen (a tester's browser on
 *   another network). The Producer records what they saw.
 *
 * Items that need outside testers can only be recorded while remote access
 * is actually on, and ordering is enforced where it matters (recovery after
 * the interruption, cut-off after pausing). Sign-off is refused until every
 * item is recorded. Nothing is posted anywhere: the panel produces text for
 * the Producer to post on #48 themselves.
 */
import { BACKUP_STALE_HOURS, openAccessGate, type Snapshot } from "./model.ts";

export type MembershipRow = {
  project: string;
  member: string;
  role: string;
};

export type RestoreTest = {
  at: string;
  backupName: string;
  /** Temporary database and folder, kept until removed. */
  database: string;
  objectRoot: string;
  removedAt?: string;
  comparison: {
    unchanged: number;
    /** In the backup but not granted now: revoked since the backup. */
    restoredOnly: MembershipRow[];
    /** Granted now but missing from the backup: added since the backup. */
    liveOnly: MembershipRow[];
    /** Same person and project, different role. */
    roleChanged: Array<MembershipRow & { liveRole: string }>;
  };
  counts: { projects: number; members: number; clips: number };
};

export type RecordedItem = {
  at: string;
  remoteOn: boolean;
  evidence?: string;
};

export type AcceptanceRecord = {
  startedAt: string;
  items: Record<string, RecordedItem>;
  restoreTest?: RestoreTest;
  signOff?: { at: string; by: string; statement: string };
};

type Check = (
  s: Snapshot,
  r: AcceptanceRecord,
  now: Date,
) => { ok: boolean; evidence: string };

export type Item = {
  id: string;
  kind: "check" | "observe";
  text: string;
  how?: string;
  needsRemote?: boolean;
  /** Must be recorded after this item. */
  after?: string;
  check?: Check;
};

export type Stage = {
  id: string;
  title: string;
  gate: string;
  intro: string;
  items: Item[];
};

const hoursAgo = (at: string | undefined, now: Date) =>
  at ? (now.getTime() - new Date(at).getTime()) / 3_600_000 : Infinity;

export const STAGES: Stage[] = [
  {
    id: "preflight",
    title: "Before you invite anyone",
    gate: "#48 live step 1",
    intro:
      "VERA proves the setup from this Mac: FileVault, local PostgreSQL, the exact HTTPS address, Cloudflare Access, and Cognito sign-in and sign-out.",
    items: [
      {
        id: "setup-complete",
        kind: "check",
        text: "Every setup step passes.",
        check: (s, _r, now) => {
          const gate = openAccessGate(s, now);
          return gate.allowed
            ? { ok: true, evidence: "All nine setup steps passed." }
            : { ok: false, evidence: gate.reasons[0] ?? "Setup incomplete." };
        },
      },
      {
        id: "edge-checked",
        kind: "check",
        text: "In the last hour, the address was behind Cloudflare Access and Cognito returned sign-in and sign-out to it.",
        how: "Press Check again on the Overview to re-run the address checks.",
        check: (s, _r, now) => {
          const fresh = hoursAgo(s.edge.checkedAt, now) <= 1;
          const ok =
            fresh &&
            s.edge.access === "ok" &&
            s.edge.signIn === "ok" &&
            s.edge.signOut === "ok";
          return {
            ok,
            evidence: ok
              ? `Access, sign-in and sign-out checked at ${s.edge.checkedAt} for ${s.settings.publicOrigin}.`
              : fresh
                ? "An address check didn't pass."
                : "Run the address checks again (older than an hour).",
          };
        },
      },
    ],
  },
  {
    id: "restore",
    title: "Prove the backup can be restored",
    gate: "#48 live step 2",
    intro:
      "Restore the newest off-Mac backup into a fresh, separate copy, using the key from your password manager. Then compare its project memberships with today's approvals. Remote access stays as it is; your live data is not touched.",
    items: [
      {
        id: "offsite-backup",
        kind: "check",
        text: "An encrypted backup reached the off-Mac folder and was verified there.",
        check: (s, _r, now) => {
          const ok =
            s.settings.destinationOffDevice === "yes" &&
            hoursAgo(s.backup.lastSuccessAt, now) <= BACKUP_STALE_HOURS;
          return {
            ok,
            evidence: ok
              ? `Backup verified at ${s.backup.lastSuccessAt} in ${s.settings.destinationKind}.`
              : s.settings.destinationOffDevice !== "yes"
                ? "The backup folder isn't confirmed to leave this Mac."
                : "No verified backup in the last 36 hours. Back up now.",
          };
        },
      },
      {
        id: "restore-copy",
        kind: "check",
        text: "Using the key from my password manager, a test copy was restored into a fresh database and folder and verified.",
        how: "Use Restore a test copy below. VERA asks for the key in a macOS window, checks its fingerprint, and never shows it.",
        check: (_s, r) =>
          r.restoreTest
            ? {
                ok: true,
                evidence: `Restored ${r.restoreTest.backupName} at ${r.restoreTest.at} with the password-manager key (fingerprint matched): ${r.restoreTest.counts.projects} projects, ${r.restoreTest.counts.members} memberships, ${r.restoreTest.counts.clips} clips.`,
              }
            : { ok: false, evidence: "No test copy restored yet." },
      },
      {
        id: "memberships-reconciled",
        kind: "observe",
        text: "I compared the restored memberships with today's approvals. Every grant revoked or changed since the backup is accounted for and stays revoked on the live service.",
        after: "restore-copy",
      },
    ],
  },
  {
    id: "sign-in",
    title: "Testers sign in from outside",
    gate: "#48 live step 3",
    intro:
      "Open access for testing first. Each tester uses their own device on their own network (home Wi-Fi or a phone hotspot), not this Mac's network.",
    items: [
      {
        id: "access-open",
        kind: "check",
        text: "Remote access is on and Cloudflare is connected.",
        check: (s) => ({
          ok: s.service.reachableByFriends,
          evidence: s.service.reachableByFriends
            ? `Reachable at ${s.settings.publicOrigin}.`
            : "Open access for testing first.",
        }),
      },
      {
        id: "accounts-provisioned",
        kind: "observe",
        needsRemote: true,
        text: "The administrator created VERA accounts for two testers. Project Owners can't create accounts.",
      },
      {
        id: "tester-a",
        kind: "observe",
        needsRemote: true,
        text: "Tester A signed in from an outside network and saw their own name.",
      },
      {
        id: "tester-b",
        kind: "observe",
        needsRemote: true,
        text: "Tester B signed in separately, on a different browser and network, and saw a different name.",
      },
      {
        id: "registered",
        kind: "observe",
        needsRemote: true,
        text: "A first-time tester registered a profile and created a project in the browser, without the desktop app.",
      },
      {
        id: "share-registered-only",
        kind: "observe",
        needsRemote: true,
        text: "The Owner tried to share with an email that has no VERA account and was refused. Sharing with a registered tester worked.",
      },
      {
        id: "uninvited-denied",
        kind: "observe",
        needsRemote: true,
        text: "An uninvited email was turned away by Cloudflare before reaching VERA.",
      },
    ],
  },
  {
    id: "roles",
    title: "Editor, Viewer and revocation",
    gate: "#48 live step 4",
    intro:
      "The Owner manages the tester's role from the project's Members panel. Keep the tester's tab open throughout.",
    items: [
      {
        id: "editor-logs",
        kind: "observe",
        needsRemote: true,
        text: "Shared as Editor, the tester opened a published transcript and logged a clip.",
      },
      {
        id: "owner-sees-clip",
        kind: "observe",
        needsRemote: true,
        text: "The Owner reloaded and saw that clip.",
        after: "editor-logs",
      },
      {
        id: "viewer-reads",
        kind: "observe",
        needsRemote: true,
        text: "Changed to Viewer, the tester could still read the project and transcript.",
        after: "owner-sees-clip",
      },
      {
        id: "viewer-denied",
        kind: "observe",
        needsRemote: true,
        text: "As Viewer, the tester couldn't log, edit or delete clips, or change members.",
        after: "viewer-reads",
      },
      {
        id: "revoked-tab",
        kind: "observe",
        needsRemote: true,
        text: "After the Owner revoked access, the tester's already-open tab was refused on its next action.",
        after: "viewer-denied",
      },
      {
        id: "revoked-download",
        kind: "observe",
        needsRemote: true,
        text: "A download link the tester copied before revocation was refused too.",
        after: "viewer-denied",
      },
    ],
  },
  {
    id: "interruption",
    title: "Interruption, recovery and pausing",
    gate: "#48 live step 5",
    intro:
      "Close the lid (or restart) while a tester has Research open. Wake the Mac, then check the work survived. Finish by pausing access.",
    items: [
      {
        id: "interrupted",
        kind: "observe",
        text: "While this Mac slept or restarted, the tester saw the unavailable page.",
      },
      {
        id: "back-online",
        kind: "check",
        text: "After waking, Research and the tunnel came back on their own.",
        after: "interrupted",
        check: (s) => ({
          ok: s.service.reachableByFriends && s.service.apiRunning,
          evidence:
            s.service.reachableByFriends && s.service.apiRunning
              ? `Reachable again; Research running since ${s.service.apiSince ?? "unknown"}; ${s.service.restartsLast24h} restarts in 24h.`
              : "Not reachable yet. Wait a minute after waking, then check again.",
        }),
      },
      {
        id: "fresh-sign-in",
        kind: "observe",
        needsRemote: true,
        text: "The tester had to sign in again, and could.",
        after: "back-online",
      },
      {
        id: "data-persisted",
        kind: "observe",
        needsRemote: true,
        text: "The shared project, its members, the transcript and the logged clip were all still there.",
        after: "back-online",
      },
      {
        id: "paused",
        kind: "check",
        text: "Remote access is paused.",
        after: "data-persisted",
        check: (s) => ({
          ok: !s.service.remoteLoaded,
          evidence: !s.service.remoteLoaded
            ? "Tunnel stopped and confirmed gone."
            : "Press Pause access.",
        }),
      },
      {
        id: "cut-off",
        kind: "observe",
        text: "The tester's browser could no longer reach Research.",
        after: "paused",
      },
    ],
  },
];

export const ALL_ITEMS: Item[] = STAGES.flatMap((stage) => stage.items);

export function newRecord(now = new Date()): AcceptanceRecord {
  return { startedAt: now.toISOString(), items: {} };
}

export type ItemView = Item & {
  recorded?: RecordedItem;
  canRecord: boolean;
  blockedBy?: string;
  live?: { ok: boolean; evidence: string };
};

export function itemViews(
  s: Snapshot,
  r: AcceptanceRecord,
  now = new Date(),
): ItemView[] {
  return ALL_ITEMS.map((item) => {
    const recorded = r.items[item.id];
    const live = item.check?.(s, r, now);
    let blockedBy: string | undefined;
    if (r.signOff) blockedBy = "Signed off. Start a new walkthrough to change.";
    else if (item.after && !r.items[item.after])
      blockedBy = `Record "${ALL_ITEMS.find((i) => i.id === item.after)?.text}" first.`;
    else if (item.needsRemote && !s.service.reachableByFriends)
      blockedBy = "Needs remote access on, with Cloudflare connected.";
    else if (live && !live.ok) blockedBy = live.evidence;
    return {
      ...item,
      ...(recorded ? { recorded } : {}),
      ...(live ? { live } : {}),
      canRecord: !recorded && !blockedBy,
      ...(blockedBy ? { blockedBy } : {}),
    };
  });
}

export class AcceptanceError extends Error {}

export function recordItem(
  s: Snapshot,
  r: AcceptanceRecord,
  id: string,
  now = new Date(),
): AcceptanceRecord {
  const view = itemViews(s, r, now).find((item) => item.id === id);
  if (!view) throw new AcceptanceError("Unknown walkthrough step.");
  if (view.recorded) return r;
  if (!view.canRecord)
    throw new AcceptanceError(view.blockedBy ?? "Not ready to record.");
  return {
    ...r,
    items: {
      ...r.items,
      [id]: {
        at: now.toISOString(),
        remoteOn: s.service.reachableByFriends,
        ...(view.live ? { evidence: view.live.evidence } : {}),
      },
    },
  };
}

/** Undo the latest recording of an item and everything recorded after it. */
export function undoItem(r: AcceptanceRecord, id: string): AcceptanceRecord {
  if (r.signOff)
    throw new AcceptanceError("Signed off. Start a new walkthrough instead.");
  const target = r.items[id];
  if (!target) return r;
  const items = Object.fromEntries(
    Object.entries(r.items).filter(([, item]) => item.at < target.at),
  );
  return { ...r, items };
}

export function progress(r: AcceptanceRecord) {
  const done = ALL_ITEMS.filter((item) => r.items[item.id]).length;
  return { done, total: ALL_ITEMS.length, complete: done === ALL_ITEMS.length };
}

export function signOff(
  r: AcceptanceRecord,
  by: string,
  now = new Date(),
): AcceptanceRecord {
  if (r.signOff) return r;
  if (!progress(r).complete)
    throw new AcceptanceError(
      "Every walkthrough step must be recorded before sign-off.",
    );
  const name = by.trim().slice(0, 80);
  if (!name) throw new AcceptanceError("Enter your name to sign off.");
  return {
    ...r,
    signOff: {
      at: now.toISOString(),
      by: name,
      statement:
        "I observed the #48 Owner, Editor and Viewer browser walkthrough on outside networks, the off-device restore with membership reconciliation, interruption recovery and disconnect, and I accept #48.",
    },
  };
}

/**
 * Text for the Producer to post on #48. Counts and times only: no emails,
 * IDs, addresses of testers, or secrets.
 */
export function acceptanceComment(s: Snapshot, r: AcceptanceRecord): string {
  const lines: string[] = [
    "### #48 Producer live acceptance (recorded in Producer Controls)",
    "",
    `Walkthrough started ${r.startedAt}${r.signOff ? `; signed off ${r.signOff.at} by ${r.signOff.by}` : " — **not signed off**"}.`,
    "Website: the approved pilot address (withheld from this public comment).",
    "",
  ];
  for (const stage of STAGES) {
    lines.push(`**${stage.title}** (${stage.gate})`);
    for (const item of stage.items) {
      const rec = r.items[item.id];
      lines.push(
        `- [${rec ? "x" : " "}] ${item.text}${rec ? ` — ${item.kind === "check" ? "verified" : "observed"} ${rec.at}${rec.evidence ? `. ${rec.evidence}` : ""}` : ""}`,
      );
    }
    lines.push("");
  }
  const t = r.restoreTest;
  if (t)
    lines.push(
      `Restore comparison: ${t.comparison.unchanged} unchanged, ${t.comparison.restoredOnly.length} revoked since backup, ${t.comparison.liveOnly.length} added since backup, ${t.comparison.roleChanged.length} role changes.${t.removedAt ? ` Test copy removed ${t.removedAt}.` : ""}`,
      "",
    );
  if (r.signOff) lines.push(`> ${r.signOff.statement}`);
  const text = lines.join("\n");
  const origin = s.settings.publicOrigin;
  return origin ? text.split(origin).join("the pilot address") : text;
}
