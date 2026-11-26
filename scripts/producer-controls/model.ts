/**
 * Producer Controls (#107): the pure model behind the panel.
 *
 * A `Snapshot` is everything VERA could observe on this Mac, with secrets and
 * personal data already removed. The functions here turn it into plain-language
 * readiness, one next action, and the gate for opening outside access. They do
 * no I/O, so every state can be tested and demonstrated with example data.
 */

export type Tri = "yes" | "no" | "unknown";

export type EdgeResult = "ok" | "problem" | "unknown";

export type Snapshot = {
  mode: "live" | "demo";
  checkedAt: string;
  /** Where the private settings file lives (home-relative for display). */
  settingsFile: {
    displayPath: string;
    exists: boolean;
    private: boolean;
    /** First validation failure, already free of secret values. */
    problem?: string;
  };
  /** Non-secret settings only. Never the Cognito secret, DB passwords or key. */
  settings: {
    publicOrigin?: string;
    cognitoDomain?: string;
    accessTeamDomain?: string;
    /** Settings that can only be filled in after the Cognito/Cloudflare steps. */
    providerProblems?: string[];
    tunnelConfigured: boolean;
    drillRoleConfigured: boolean;
    /** Both database URLs hold real credentials (not placeholders). */
    databaseAccountsConfigured?: boolean;
    destinationDisplay?: string;
    destinationKind?: string;
    destinationOffDevice: Tri;
    destinationExists: Tri;
  };
  mac: { fileVault: Tri };
  tools: {
    postgresTools: Tri;
    cloudflared: Tri;
    websiteBuilt: Tri;
    servicesInstalled: Tri;
  };
  backupKey: { exists: boolean; private: boolean; fingerprint?: string };
  service: {
    apiRunning: boolean;
    apiSince?: string;
    databaseReachable: boolean;
    remoteLoaded: boolean;
    remoteConnected: boolean;
    reachableByFriends: boolean;
    restartsLast24h: number;
    savingPaused?: "backup" | "disk";
    freeDiskBytes?: number | null;
    counts?: Record<string, number>;
  };
  backup: {
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastFailureMessage?: string;
    backupName?: string;
  };
  recovery: {
    lastDrillAt?: string;
    lastDrillFailureAt?: string;
    lastDrillFailureMessage?: string;
  };
  edge: {
    checkedAt?: string;
    access: EdgeResult;
    accessDetail?: string;
    signIn: EdgeResult;
    signInDetail?: string;
    signOut: EdgeResult;
    signOutDetail?: string;
  };
  /** Things only the Producer can confirm, with when they confirmed them. */
  confirmations: Partial<Record<ConfirmationId, string>>;
};

export type ConfirmationId =
  | "domain-approved"
  | "access-invite-list"
  | "cognito-admin-only"
  | "cache-bypass"
  | "backup-key-saved";

export const BACKUP_STALE_HOURS = 36;
export const DRILL_STALE_DAYS = 8;

const hoursSince = (at: string | undefined, now: Date) =>
  at ? (now.getTime() - new Date(at).getTime()) / 3_600_000 : undefined;

const failedAfter = (failure?: string, success?: string) =>
  Boolean(failure && (!success || failure > success));

export function callbackUrl(origin: string): string {
  return `${origin}/cloud-api/auth/callback`;
}
export function signOutUrl(origin: string): string {
  return `${origin}/`;
}

/** Plain "3 hours ago" wording for the panel. */
export function ago(at: string | undefined, now: Date): string {
  const hours = hoursSince(at, now);
  if (hours === undefined) return "never";
  if (hours < 1 / 60) return "just now";
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ---------------------------------------------------------------------------
// Actions the panel can offer. The server allows exactly these.

export const ACTIONS = {
  "check-again": { label: "Check again", changesExposure: false },
  "start-research": { label: "Start Research", changesExposure: false },
  "stop-research": { label: "Stop Research", changesExposure: true },
  "open-access": { label: "Open access for testing", changesExposure: true },
  "pause-access": { label: "Pause access", changesExposure: true },
  "back-up-now": { label: "Back up now", changesExposure: false },
  "test-recovery": { label: "Test recovery", changesExposure: false },
  "build-website": { label: "Build website", changesExposure: false },
  "install-services": { label: "Install services", changesExposure: false },
  "create-settings-file": {
    label: "Create settings file",
    changesExposure: false,
  },
  "open-settings-file": { label: "Open settings file", changesExposure: false },
  "create-backup-key": { label: "Create backup key", changesExposure: false },
  "copy-backup-key": {
    label: "Copy key for password manager",
    changesExposure: false,
  },
  "choose-backup-folder": {
    label: "Choose backup folder",
    changesExposure: false,
  },
  "open-filevault": {
    label: "Open FileVault settings",
    changesExposure: false,
  },
  "open-postgres": { label: "Open Postgres.app", changesExposure: false },
  "create-database-accounts": {
    label: "Create database accounts",
    changesExposure: false,
  },
  "open-cloudflare": {
    label: "Open Cloudflare Zero Trust",
    changesExposure: false,
  },
  "open-cognito": {
    label: "Open sign-in settings (Cognito)",
    changesExposure: false,
  },
  "restore-test-copy": {
    label: "Restore a test copy",
    changesExposure: false,
  },
  confirm: { label: "Confirm", changesExposure: false },
  unconfirm: { label: "Undo confirmation", changesExposure: false },
} as const;

export type ActionId = keyof typeof ACTIONS;

// ---------------------------------------------------------------------------
// Guided setup: one task at a time, in order.

export type StepState = "done" | "todo" | "attention" | "unverified";

export type SetupStep = {
  id: string;
  title: string;
  state: StepState;
  /** One line: what is true now. */
  summary: string;
  /** What VERA checks or does automatically. */
  vera: string;
  /** What the Producer approves or does, in order. */
  producer: string[];
  /** Where an administrator or technical help is needed, if anywhere. */
  help?: string;
  /** Exact values to copy into provider settings. */
  values?: Array<{ label: string; value: string }>;
  actions: ActionId[];
  confirmations?: Array<{ id: ConfirmationId; label: string }>;
};

export function setupSteps(s: Snapshot, now = new Date()): SetupStep[] {
  const origin = s.settings.publicOrigin;
  const steps: SetupStep[] = [];

  steps.push({
    id: "mac-protection",
    title: "Protect this Mac's disk",
    state:
      s.mac.fileVault === "yes"
        ? "done"
        : s.mac.fileVault === "no"
          ? "todo"
          : "unverified",
    summary:
      s.mac.fileVault === "yes"
        ? "FileVault is on. Research data on this disk is encrypted."
        : s.mac.fileVault === "no"
          ? "FileVault is off. Turn it on before storing friends' research here."
          : "VERA couldn't read FileVault's status.",
    vera: "Reads FileVault's status from macOS. VERA never changes it.",
    producer: [
      "Open FileVault settings.",
      "Click Turn On and follow Apple's steps. Store the recovery key the way Apple suggests.",
      "Come back and press Check again. Encryption can keep running in the background.",
    ],
    actions: ["open-filevault", "check-again"],
  });

  const settingsOk =
    s.settingsFile.exists && s.settingsFile.private && !s.settingsFile.problem;
  steps.push({
    id: "settings-file",
    title: "Create the private settings file",
    state: settingsOk ? "done" : s.settingsFile.exists ? "attention" : "todo",
    summary: !s.settingsFile.exists
      ? "No pilot settings file yet."
      : !s.settingsFile.private
        ? "The settings file can be read by other users. VERA can fix this."
        : s.settingsFile.problem
          ? `Settings need a fix: ${s.settingsFile.problem}`
          : `Settings are valid (${s.settingsFile.displayPath}).`,
    vera: "Creates the file from a template with private permissions, then validates every value. Secrets stay in this file and never appear in the panel.",
    producer: [
      "Create settings file. VERA fills in everything it can.",
      "Nothing to paste yet. VERA fills in the database passwords in step 3, and the Cognito and Cloudflare values come in step 4.",
      "Press Check again. VERA names any value that's still wrong.",
    ],
    actions: s.settingsFile.exists
      ? ["open-settings-file", "check-again"]
      : ["create-settings-file"],
  });

  const accountsOk =
    s.settings.databaseAccountsConfigured ?? s.settings.drillRoleConfigured;
  const pgOk =
    s.tools.postgresTools === "yes" &&
    s.service.databaseReachable &&
    accountsOk;
  steps.push({
    id: "research-storage",
    title: "Set up Research storage",
    state: pgOk
      ? "done"
      : s.tools.postgresTools === "no"
        ? "todo"
        : !s.service.databaseReachable && accountsOk
          ? "attention"
          : "todo",
    summary: pgOk
      ? "PostgreSQL is running on this Mac only, with separate pilot and recovery-test accounts."
      : s.tools.postgresTools === "no"
        ? "PostgreSQL isn't installed yet."
        : !accountsOk
          ? "PostgreSQL is installed. Next, let VERA create the two database accounts."
          : "PostgreSQL isn't answering on this Mac. Open Postgres.app and press Start.",
    vera: "Creates the vera_pilot account and database and a separate vera_drill account for recovery tests, with passwords it generates and saves straight into the settings file. Then checks that the database answers on this Mac only.",
    producer: [
      "Download Postgres.app from postgresapp.com (free), move it to Applications and open it.",
      "Press Initialize (first time) or Start. Leave it running.",
      "Press Create database accounts. You never see or type a password.",
    ],
    actions:
      s.tools.postgresTools === "no" || !s.service.databaseReachable
        ? ["open-postgres", "create-database-accounts", "check-again"]
        : accountsOk
          ? ["check-again"]
          : ["create-database-accounts", "check-again"],
  });

  const siteChecked =
    Boolean(origin) &&
    s.edge.access === "ok" &&
    s.edge.signIn === "ok" &&
    s.edge.signOut === "ok";
  const siteProblem =
    s.edge.access === "problem" ||
    s.edge.signIn === "problem" ||
    s.edge.signOut === "problem";
  const providerProblems = s.settings.providerProblems ?? [];
  steps.push({
    id: "website-address",
    title: "Connect the website address",
    state:
      !origin || providerProblems.length
        ? "todo"
        : siteChecked && s.confirmations["domain-approved"]
          ? "done"
          : siteProblem
            ? "attention"
            : "unverified",
    summary: providerProblems.length
      ? `Fill in the settings file from Cognito and Cloudflare: ${providerProblems.join("; ")}.`
      : !origin
        ? "No website address chosen yet."
        : siteProblem
          ? [
              s.edge.access === "problem" ? s.edge.accessDetail : undefined,
              s.edge.signIn === "problem" ? s.edge.signInDetail : undefined,
              s.edge.signOut === "problem" ? s.edge.signOutDetail : undefined,
            ]
              .filter(Boolean)
              .join(" ")
          : siteChecked
            ? `${origin} is behind Cloudflare Access, and sign-in and sign-out return to it.`
            : `${origin} hasn't been checked yet.`,
    vera: "Checks from this Mac that the address is behind Cloudflare Access and that Cognito sends sign-in and sign-out back to exactly this address.",
    producer: [
      "Choose one HTTPS address you own on Cloudflare, for example research.<your-domain>. Buying a domain costs money and needs your approval.",
      "In Cloudflare Zero Trust, create a self-hosted Access application for exactly this address, and the tunnel route.",
      "In the Cognito app client, paste the sign-in and sign-out addresses below.",
      "Open settings file and fill in BROWSER_PUBLIC_ORIGIN, the four COGNITO_ values, CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD and the two PILOT_TUNNEL_ values. Save, then press Check again.",
    ],
    help: "Creating the Cloudflare tunnel credentials is a one-time technical step (runbook going-live step 5).",
    values: origin
      ? [
          { label: "Website address", value: origin },
          { label: "Access application domain", value: new URL(origin).host },
          { label: "Cognito allowed callback URL", value: callbackUrl(origin) },
          { label: "Cognito allowed sign-out URL", value: signOutUrl(origin) },
        ]
      : [],
    actions:
      s.edge.signIn === "problem" || s.edge.signOut === "problem"
        ? [
            "open-cognito",
            "open-settings-file",
            "check-again",
            "open-cloudflare",
          ]
        : providerProblems.length || !origin
          ? [
              "open-cloudflare",
              "open-cognito",
              "open-settings-file",
              "check-again",
            ]
          : ["open-cloudflare", "open-cognito", "check-again"],
    confirmations: [
      {
        id: "domain-approved",
        label: "I approve this one address for the friends-only pilot.",
      },
    ],
  });

  const invitesConfirmed =
    s.confirmations["access-invite-list"] &&
    s.confirmations["cognito-admin-only"] &&
    s.confirmations["cache-bypass"];
  steps.push({
    id: "invitations",
    title: "Decide who can sign in",
    state: invitesConfirmed ? "done" : "todo",
    summary: invitesConfirmed
      ? "Invitation and sharing rules are confirmed."
      : "Confirm the invitation policy in Cloudflare and Cognito.",
    vera: "Keeps project permissions on the server: Owners share projects with people who already have a VERA account. Revoking access takes effect on the next request.",
    producer: [
      "Pilot invitation: list each friend's email in the Cloudflare Access Allow policy. Anyone else is turned away before reaching VERA.",
      "Account: the service administrator creates each friend's Cognito account. Public sign-up stays off.",
      "Project sharing happens later, inside Research: an Owner adds an existing account as Editor or Viewer.",
    ],
    help: "Creating Cognito accounts is an administrator action in the AWS console.",
    actions: ["open-cloudflare", "open-cognito"],
    confirmations: [
      {
        id: "access-invite-list",
        label:
          "Cloudflare Access allows only the invited testers' email addresses.",
      },
      {
        id: "cognito-admin-only",
        label:
          "Cognito only lets administrators create users (self-sign-up is off).",
      },
      {
        id: "cache-bypass",
        label:
          "No Cloudflare cache rule caches this address (private pages and downloads are never cached).",
      },
    ],
  });

  const keyOk =
    s.backupKey.exists &&
    s.backupKey.private &&
    Boolean(s.confirmations["backup-key-saved"]);
  steps.push({
    id: "backup-key",
    title: "Keep the backup key safe",
    state: keyOk ? "done" : s.backupKey.exists ? "attention" : "todo",
    summary: !s.backupKey.exists
      ? "No backup key yet."
      : !s.backupKey.private
        ? "The backup key file isn't private."
        : s.confirmations["backup-key-saved"]
          ? `Key ${s.backupKey.fingerprint ?? ""} is saved in your password manager.`
          : "Save the key in your password manager. Without it, no backup can be restored if this Mac is lost.",
    vera: "Creates the key on this Mac and copies it to the clipboard for you. The key is never shown in the panel, logs or diagnostics.",
    producer: [
      "Create backup key.",
      "Copy key for password manager, then paste it into a new password manager item named VERA Research backup key.",
      "Confirm the fingerprint shown here matches the item's notes, then confirm below.",
    ],
    actions: s.backupKey.exists
      ? ["copy-backup-key", "check-again"]
      : ["create-backup-key"],
    confirmations: [
      {
        id: "backup-key-saved",
        label:
          "The key is in my password manager, away from the backup folder.",
      },
    ],
  });

  const destinationOk =
    s.settings.destinationOffDevice === "yes" &&
    s.settings.destinationExists === "yes";
  const backupAge = hoursSince(s.backup.lastSuccessAt, now);
  const backupFailing = failedAfter(
    s.backup.lastFailureAt,
    s.backup.lastSuccessAt,
  );
  steps.push({
    id: "backup",
    title: "Back up off this Mac",
    state:
      destinationOk &&
      backupAge !== undefined &&
      backupAge <= BACKUP_STALE_HOURS &&
      !backupFailing
        ? "done"
        : backupFailing
          ? "attention"
          : s.settings.destinationOffDevice === "no"
            ? "attention"
            : s.settings.destinationOffDevice === "unknown"
              ? "unverified"
              : "todo",
    summary: backupFailing
      ? `The latest backup failed: ${s.backup.lastFailureMessage ?? "unknown error"}.`
      : s.settings.destinationOffDevice === "no"
        ? "The backup folder is on this Mac, so it doesn't protect against losing the Mac."
        : s.settings.destinationOffDevice === "unknown"
          ? "Unverified: VERA can't tell whether this folder leaves the Mac."
          : backupAge === undefined
            ? `No encrypted copy yet. Destination: ${s.settings.destinationKind ?? "not set"}.`
            : `Last encrypted copy ${ago(s.backup.lastSuccessAt, now)}, verified at ${s.settings.destinationKind}.`,
    vera: "Encrypts a consistent copy on this Mac, copies it to the folder, then re-reads and verifies it there. Nightly at 3 am once services are installed.",
    producer: [
      "Choose backup folder: an iCloud Drive folder or an external drive.",
      "Back up now.",
    ],
    actions: ["choose-backup-folder", "back-up-now"],
  });

  const servicesOk =
    s.tools.websiteBuilt === "yes" &&
    s.tools.servicesInstalled === "yes" &&
    s.service.apiRunning;
  steps.push({
    id: "services",
    title: "Start Research on this Mac",
    state: servicesOk ? "done" : "todo",
    summary: servicesOk
      ? "Research is running on this Mac only. Nobody outside can reach it yet."
      : s.tools.websiteBuilt !== "yes"
        ? "The website hasn't been built."
        : s.tools.servicesInstalled !== "yes"
          ? "Background services aren't installed."
          : "Research isn't running.",
    vera: "Builds the website, installs the background services that restart Research after a crash or login, and schedules backups and recovery tests. Outside access stays off.",
    producer: ["Build website.", "Install services.", "Start Research."],
    actions:
      s.tools.websiteBuilt !== "yes"
        ? ["build-website"]
        : s.tools.servicesInstalled !== "yes"
          ? ["install-services"]
          : ["start-research"],
  });

  const drillAge = hoursSince(s.recovery.lastDrillAt, now);
  const drillFailing = failedAfter(
    s.recovery.lastDrillFailureAt,
    s.recovery.lastDrillAt,
  );
  steps.push({
    id: "recovery-test",
    title: "Test your backup",
    state:
      drillAge !== undefined &&
      drillAge <= DRILL_STALE_DAYS * 24 &&
      !drillFailing
        ? "done"
        : drillFailing
          ? "attention"
          : "todo",
    summary: drillFailing
      ? `The latest recovery test failed: ${s.recovery.lastDrillFailureMessage ?? "unknown error"}.`
      : drillAge === undefined
        ? "Never tested. A backup isn't proven until it has been restored."
        : drillAge > DRILL_STALE_DAYS * 24
          ? `Last recovery test ${ago(s.recovery.lastDrillAt, now)}. Test again.`
          : `Recovery test passed ${ago(s.recovery.lastDrillAt, now)}.`,
    vera: "Opens a temporary copy of the newest off-Mac backup, checks every project, transcript and file fingerprint, then deletes the copy. Your live data is never touched.",
    producer: ["Test recovery."],
    actions: ["test-recovery"],
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Overview: answers "Can friends connect?", "Is my research protected?" and
// "What should I do next?".

export type AreaState =
  "ready" | "checked" | "attention" | "unverified" | "off" | "on";

export type Overview = {
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "bad" | "neutral" | "live";
  primary?: { action: ActionId; label: string; hint?: string };
  secondary: ActionId[];
  areas: Array<{
    id: string;
    label: string;
    state: AreaState;
    text: string;
    badge?: string;
  }>;
  setupComplete: boolean;
  openGate: { allowed: boolean; reasons: string[] };
};

export function openAccessGate(
  s: Snapshot,
  now = new Date(),
): { allowed: boolean; reasons: string[] } {
  const reasons = setupSteps(s, now)
    .filter((step) => step.state !== "done")
    .map((step) => `${step.title}: ${step.summary}`);
  if (s.service.savingPaused === "disk")
    reasons.push("Saving is paused because the disk is nearly full.");
  return { allowed: reasons.length === 0, reasons };
}

export function overview(s: Snapshot, now = new Date()): Overview {
  const steps = setupSteps(s, now);
  const byId = Object.fromEntries(steps.map((step) => [step.id, step]));
  const gate = openAccessGate(s, now);
  const setupComplete = steps.every((step) => step.state === "done");
  const remoteOn = s.service.remoteLoaded;

  const backupStep = byId.backup!;
  const recoveryStep = byId["recovery-test"]!;
  const backupText =
    backupStep.state !== "done"
      ? backupStep.summary
      : recoveryStep.state !== "done"
        ? `Encrypted copy ${ago(s.backup.lastSuccessAt, now)}. ${recoveryStep.summary}`
        : `Encrypted copy ${ago(s.backup.lastSuccessAt, now)}; recovery tested ${ago(s.recovery.lastDrillAt, now)}.`;
  const siteStep = byId["website-address"]!;
  const invites = byId.invitations!;
  const storageOk = s.service.databaseReachable && s.service.apiRunning;

  const areas: Overview["areas"] = [
    {
      id: "mac",
      label: "Mac protection",
      state:
        s.mac.fileVault === "yes"
          ? "ready"
          : s.mac.fileVault === "no"
            ? "attention"
            : "unverified",
      text: byId["mac-protection"]!.summary,
    },
    {
      id: "storage",
      label: "Research storage",
      state: s.service.savingPaused
        ? "attention"
        : storageOk
          ? "ready"
          : "attention",
      text: s.service.savingPaused
        ? s.service.savingPaused === "disk"
          ? "Saving is paused: the disk is nearly full. Reading still works."
          : "Saving is paused for a few seconds while a backup runs."
        : storageOk
          ? `Running since ${new Date(s.service.apiSince ?? s.checkedAt).toLocaleString()}.`
          : !s.service.databaseReachable
            ? "PostgreSQL isn't answering."
            : "Research isn't running on this Mac.",
    },
    {
      id: "site",
      label: "Website and invitation settings",
      state:
        siteStep.state === "done" && invites.state === "done"
          ? "checked"
          : siteStep.state === "attention"
            ? "attention"
            : "unverified",
      text:
        siteStep.state === "done" && invites.state === "done"
          ? `Checked ${ago(s.edge.checkedAt, now)}.`
          : siteStep.state !== "done"
            ? siteStep.summary
            : invites.summary,
    },
    {
      id: "backup",
      label: "Encrypted backup",
      state:
        backupStep.state === "done" && recoveryStep.state === "done"
          ? "ready"
          : backupStep.state === "unverified"
            ? "unverified"
            : "attention",
      text: backupText,
      ...(backupStep.state === "done" && recoveryStep.state !== "done"
        ? { badge: "Recovery test needed" }
        : {}),
    },
    {
      id: "remote",
      label: "Remote access",
      state: remoteOn
        ? s.service.reachableByFriends
          ? "on"
          : "attention"
        : "off",
      text: remoteOn
        ? s.service.reachableByFriends
          ? "On. Invited testers can connect while this Mac is awake and online."
          : "On, but Cloudflare isn't connected. Check this Mac's internet connection."
        : "Off. Nobody outside this Mac can reach Research.",
    },
  ];

  const nextStep = steps.find((step) => step.state !== "done");
  const base = { areas, setupComplete, openGate: gate };

  if (remoteOn && !s.service.apiRunning)
    return {
      ...base,
      headline: "Research stopped while access is on",
      detail:
        "Testers see an unavailable page. Saved work is safe. Start Research, or pause access.",
      tone: "bad",
      primary: { action: "start-research", label: "Start Research" },
      secondary: ["pause-access", "check-again"],
    };
  if (remoteOn && s.service.reachableByFriends)
    return {
      ...base,
      headline:
        "Invited testers can connect while this Mac is awake and online",
      detail:
        "If the Mac sleeps or goes offline, testers see an unavailable page and their saved work stays safe.",
      tone: "live",
      primary: { action: "pause-access", label: "Pause access" },
      secondary: ["back-up-now", "check-again"],
    };
  if (remoteOn)
    return {
      ...base,
      headline: "Remote access is on, but Cloudflare isn't connected",
      detail:
        "This Mac may be offline or asleep, or the tunnel settings may have changed. Testers can't connect right now.",
      tone: "warn",
      primary: { action: "check-again", label: "Check again" },
      secondary: ["pause-access"],
    };
  if (nextStep && nextStep.id !== "recovery-test") {
    const action = nextStep.actions[0] ?? "check-again";
    return {
      ...base,
      headline:
        nextStep.state === "attention"
          ? "Remote access is off: something needs fixing"
          : "Remote access is off",
      detail:
        nextStep.state === "attention"
          ? `${nextStep.title}: ${nextStep.summary}`
          : `Setup isn't finished. Next: ${nextStep.title}.`,
      tone: "neutral",
      primary: { action, label: ACTIONS[action].label, hint: nextStep.summary },
      secondary: ["check-again"],
    };
  }
  if (nextStep)
    return {
      ...base,
      headline: "Remote access is off",
      detail:
        "Local Research is ready. Test recovery before inviting friends in.",
      tone: "neutral",
      primary: {
        action: "test-recovery",
        label: "Test recovery",
        hint: "VERA opens a temporary copy to check that projects and transcripts can be recovered.",
      },
      secondary: ["back-up-now", "check-again"],
    };
  return {
    ...base,
    headline: "Remote access is off",
    detail:
      "Everything checks out. Open access when you're ready to run the walkthrough with your testers.",
    tone: "ok",
    primary: {
      action: "open-access",
      label: "Open access for testing",
      hint: "Invited testers can connect while this Mac is awake and online. You can pause at any time.",
    },
    secondary: ["back-up-now", "check-again"],
  };
}

// ---------------------------------------------------------------------------
// Secret and personal-data scrubbing for anything shown or copied.

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // URL credentials: postgres://user:password@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/giu, "$1:•••@"],
  [/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\b/gu, "•••jwt•••"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/gu, "•••"],
  [/\b[0-9a-f]{48,}\b/giu, "•••"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "•••@•••"],
  [/((?:SECRET|PASSWORD|TOKEN|KEY)[A-Z_]*\s*[=:]\s*)\S+/gu, "$1•••"],
];

export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

/** A support summary safe to paste anywhere: no secrets, emails or IDs. */
export function diagnosticSummary(s: Snapshot, now = new Date()): string {
  const o = overview(s, now);
  const lines = [
    `VERA Research Producer Controls — diagnostic summary (${s.checkedAt})`,
    `Headline: ${o.headline}`,
    ...o.areas.map((area) => `${area.label}: ${area.state} — ${area.text}`),
    "Setup:",
    ...setupSteps(s, now).map(
      (step) => `  ${step.state.padEnd(10)} ${step.title} — ${step.summary}`,
    ),
    `Edge checks: access=${s.edge.access}, sign-in=${s.edge.signIn}, sign-out=${s.edge.signOut} (${s.edge.checkedAt ?? "not run"})`,
    `Restarts in 24h: ${s.service.restartsLast24h}`,
    s.service.counts
      ? `Counters: ${Object.entries(s.service.counts)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}`
      : "Counters: unavailable",
    `Free disk: ${s.service.freeDiskBytes == null ? "unknown" : `${(s.service.freeDiskBytes / 1024 ** 3).toFixed(1)} GB`}`,
  ];
  return scrub(lines.join("\n"));
}
