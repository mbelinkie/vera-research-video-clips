/**
 * Example-data provider for the clickable walkthrough and tests. It touches
 * nothing on this Mac: actions change an in-memory snapshot the way the real
 * controls would. Every value is synthetic.
 */
import {
  acceptanceComment,
  AcceptanceError,
  newRecord,
  recordItem,
  signOff,
  undoItem,
} from "./acceptance.ts";
import type { ActionResult, ControlsState, Provider } from "./live.ts";
import {
  ACTIONS,
  openAccessGate,
  type ActionId,
  type ConfirmationId,
  type Snapshot,
} from "./model.ts";

export const SCENARIOS = {
  "first-run": "First-time setup",
  "recovery-needed": "Setup done, recovery not tested",
  ready: "Ready to test",
  "access-on": "Remote access on",
  paused: "Access paused",
  "wrong-sign-in": "Failure: wrong sign-in address",
  "backup-stale": "Failure: backup missing or stale",
  offline: "Failure: Mac offline",
  "research-stopped": "Failure: Research stopped",
} as const;

export type ScenarioId = keyof typeof SCENARIOS;

const hoursAgo = (now: Date, hours: number) =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

const ALL_CONFIRMED = (now: Date): Snapshot["confirmations"] => ({
  "domain-approved": hoursAgo(now, 30),
  "access-invite-list": hoursAgo(now, 29),
  "cognito-admin-only": hoursAgo(now, 29),
  "cache-bypass": hoursAgo(now, 29),
  "backup-key-saved": hoursAgo(now, 28),
});

export function readySnapshot(now = new Date()): Snapshot {
  return {
    mode: "demo",
    checkedAt: now.toISOString(),
    settingsFile: {
      displayPath:
        "~/Library/Application Support/VERA Research Pilot/pilot.env",
      exists: true,
      private: true,
    },
    settings: {
      publicOrigin: "https://research.example-producer.test",
      cognitoDomain: "https://example-pilot.auth.us-east-1.amazoncognito.com",
      accessTeamDomain: "https://example-team.cloudflareaccess.com",
      tunnelConfigured: true,
      drillRoleConfigured: true,
      destinationDisplay:
        "~/Library/Mobile Documents/com~apple~CloudDocs/VERA Research Backups",
      destinationKind: "iCloud Drive (syncs off this Mac)",
      destinationOffDevice: "yes",
      destinationExists: "yes",
    },
    mac: { fileVault: "yes" },
    tools: {
      postgresTools: "yes",
      cloudflared: "yes",
      websiteBuilt: "yes",
      servicesInstalled: "yes",
    },
    backupKey: {
      exists: true,
      private: true,
      fingerprint: "3f9a 1c07 be42 d815",
    },
    service: {
      apiRunning: true,
      apiSince: hoursAgo(now, 5),
      databaseReachable: true,
      remoteLoaded: false,
      remoteConnected: false,
      reachableByFriends: false,
      restartsLast24h: 1,
      freeDiskBytes: 182 * 1024 ** 3,
      counts: {
        accessDenied: 0,
        signedOut: 3,
        callbackFailed: 0,
        forbidden: 0,
        serverErrors: 0,
        writesPaused: 0,
      },
    },
    backup: { lastSuccessAt: hoursAgo(now, 7) },
    recovery: { lastDrillAt: hoursAgo(now, 6) },
    edge: {
      checkedAt: hoursAgo(now, 0.2),
      access: "ok",
      accessDetail:
        "research.example-producer.test sends visitors to Cloudflare Access first.",
      signIn: "ok",
      signInDetail: "Cognito sends sign-in back to this address.",
      signOut: "ok",
      signOutDetail: "Cognito returns signed-out testers to this address.",
    },
    confirmations: ALL_CONFIRMED(now),
  };
}

export function scenario(id: ScenarioId, now = new Date()): Snapshot {
  const s = readySnapshot(now);
  switch (id) {
    case "first-run":
      return {
        ...s,
        settingsFile: { ...s.settingsFile, exists: false, private: false },
        settings: {
          tunnelConfigured: false,
          drillRoleConfigured: false,
          destinationOffDevice: "unknown",
          destinationExists: "unknown",
        },
        mac: { fileVault: "no" },
        tools: {
          postgresTools: "no",
          cloudflared: "no",
          websiteBuilt: "no",
          servicesInstalled: "no",
        },
        backupKey: { exists: false, private: false },
        service: {
          apiRunning: false,
          databaseReachable: false,
          remoteLoaded: false,
          remoteConnected: false,
          reachableByFriends: false,
          restartsLast24h: 0,
          freeDiskBytes: 182 * 1024 ** 3,
        },
        backup: {},
        recovery: {},
        edge: { access: "unknown", signIn: "unknown", signOut: "unknown" },
        confirmations: {},
      };
    case "recovery-needed":
      return { ...s, recovery: {} };
    case "ready":
      return s;
    case "access-on":
      return {
        ...s,
        service: {
          ...s.service,
          remoteLoaded: true,
          remoteConnected: true,
          reachableByFriends: true,
        },
      };
    case "paused":
      return s;
    case "wrong-sign-in":
      return {
        ...s,
        edge: {
          ...s.edge,
          signIn: "problem",
          signInDetail:
            "Cognito doesn't allow https://research.example-producer.test/cloud-api/auth/callback as a callback URL. Copy the correct address into the app client's allowed callback URLs.",
        },
      };
    case "backup-stale":
      return {
        ...s,
        settings: { ...s.settings, destinationExists: "no" },
        backup: {
          lastSuccessAt: hoursAgo(now, 75),
          lastFailureAt: hoursAgo(now, 3),
          lastFailureMessage:
            "Backup destination is not available (is the drive connected?)",
        },
      };
    case "offline":
      return {
        ...s,
        service: {
          ...s.service,
          remoteLoaded: true,
          remoteConnected: false,
          reachableByFriends: false,
        },
      };
    case "research-stopped":
      return {
        ...s,
        service: {
          ...s.service,
          apiRunning: false,
          remoteLoaded: true,
          remoteConnected: false,
          reachableByFriends: false,
        },
      };
  }
}

export class DemoProvider implements Provider {
  readonly mode = "demo" as const;
  private current: Snapshot;
  private controls: ControlsState;
  scenarioId: ScenarioId;

  constructor(id: ScenarioId = "recovery-needed") {
    this.scenarioId = id;
    this.current = scenario(id);
    this.controls = this.freshControls(id);
  }

  private freshControls(id: ScenarioId): ControlsState {
    const now = new Date();
    const acceptance = newRecord(now);
    if (id === "paused") {
      // A walkthrough recorded up to the pause, for the "paused" example.
      acceptance.items = {
        "setup-complete": {
          at: hoursAgo(now, 3),
          remoteOn: false,
          evidence: "All nine setup steps passed.",
        },
        "edge-checked": {
          at: hoursAgo(now, 3),
          remoteOn: false,
          evidence: "Access, sign-in and sign-out checked.",
        },
      };
    }
    return {
      confirmations: this.current.confirmations,
      acceptance,
      archived: [],
    };
  }

  setScenario(id: ScenarioId) {
    this.scenarioId = id;
    this.current = scenario(id);
    this.controls = this.freshControls(id);
  }

  /** Example sleep/wake for the interruption step. */
  simulate(event: "sleep" | "wake") {
    const asleep = event === "sleep";
    this.patch((s) => ({
      ...s,
      service: {
        ...s.service,
        remoteConnected: !asleep && s.service.remoteLoaded,
        reachableByFriends:
          !asleep && s.service.remoteLoaded && s.service.apiRunning,
        ...(asleep
          ? {}
          : {
              restartsLast24h: s.service.restartsLast24h + 1,
              apiSince: new Date().toISOString(),
            }),
      },
    }));
  }

  async snapshot(): Promise<Snapshot> {
    return {
      ...this.current,
      checkedAt: new Date().toISOString(),
      confirmations: this.controls.confirmations,
    };
  }

  async state(): Promise<ControlsState> {
    return this.controls;
  }

  private patch(change: (s: Snapshot) => Snapshot) {
    this.current = change(this.current);
  }

  async act(
    action: ActionId,
    input: Record<string, unknown>,
  ): Promise<ActionResult> {
    if (!(action in ACTIONS)) return { ok: false, message: "Unknown action." };
    const now = new Date().toISOString();
    const service = (patch: Partial<Snapshot["service"]>) =>
      this.patch((s) => ({ ...s, service: { ...s.service, ...patch } }));
    switch (action) {
      case "check-again":
        if (this.current.settings.publicOrigin)
          this.patch((s) => ({
            ...s,
            edge: { ...readySnapshot().edge, checkedAt: now },
          }));
        return { ok: true, message: "Checked." };
      case "open-access": {
        const gate = openAccessGate(await this.snapshot());
        if (!gate.allowed)
          return {
            ok: false,
            message: `Access stays off until setup passes. ${gate.reasons[0] ?? ""}`,
          };
        service({
          remoteLoaded: true,
          remoteConnected: true,
          reachableByFriends: true,
        });
        return {
          ok: true,
          message:
            "Tunnel started: invited friends can reach Research while this Mac is awake.",
        };
      }
      case "pause-access":
        service({
          remoteLoaded: false,
          remoteConnected: false,
          reachableByFriends: false,
        });
        return {
          ok: true,
          message:
            "Tunnel stopped: nobody outside this Mac can reach Research now.",
        };
      case "start-research":
        service({
          apiRunning: true,
          apiSince: now,
          databaseReachable: true,
          ...(this.current.service.remoteLoaded
            ? { remoteConnected: true, reachableByFriends: true }
            : {}),
        });
        return { ok: true, message: "Research API started on this Mac." };
      case "stop-research":
        service({
          apiRunning: false,
          remoteLoaded: false,
          remoteConnected: false,
          reachableByFriends: false,
        });
        return { ok: true, message: "Tunnel and Research API stopped." };
      case "back-up-now":
        if (this.current.settings.destinationExists === "no")
          return {
            ok: false,
            message:
              "Backup destination is not available (is the drive connected?). Choose backup folder or reconnect the drive.",
          };
        this.patch((s) => ({ ...s, backup: { lastSuccessAt: now } }));
        return { ok: true, message: "Backup verified at the destination." };
      case "test-recovery":
        if (!this.current.backup.lastSuccessAt)
          return {
            ok: false,
            message: "No backup found at the destination to drill.",
          };
        this.patch((s) => ({ ...s, recovery: { lastDrillAt: now } }));
        return {
          ok: true,
          message: "Restore drill passed; temporary copy removed.",
        };
      case "choose-backup-folder":
        this.patch((s) => ({
          ...s,
          settings: {
            ...s.settings,
            destinationDisplay: "/Volumes/Backup Drive/VERA Research Backups",
            destinationKind: "external drive",
            destinationOffDevice: "yes",
            destinationExists: "yes",
          },
        }));
        return { ok: true, message: "Backups will go to external drive." };
      case "open-filevault":
        this.patch((s) => ({ ...s, mac: { fileVault: "yes" } }));
        return {
          ok: true,
          message: "Example: FileVault settings would open. Marked as on.",
        };
      case "create-settings-file":
        this.current = {
          ...readySnapshot(),
          mac: this.current.mac,
          tools: { ...this.current.tools },
          service: this.current.service,
          backup: {},
          recovery: {},
          backupKey: { exists: false, private: false },
          edge: { access: "unknown", signIn: "unknown", signOut: "unknown" },
        };
        return {
          ok: true,
          message: "Created. Open settings file to fill it in.",
        };
      case "create-backup-key":
        this.patch((s) => ({
          ...s,
          backupKey: {
            exists: true,
            private: true,
            fingerprint: "3f9a 1c07 be42 d815",
          },
        }));
        return { ok: true, message: "Backup key created." };
      case "copy-backup-key":
        return {
          ok: true,
          message:
            "Example: key copied to the clipboard; fingerprint 3f9a 1c07 be42 d815.",
        };
      case "create-database-accounts":
        if (!this.current.service.databaseReachable)
          return {
            ok: false,
            message:
              "PostgreSQL isn't answering. Open Postgres.app and press Start, then try again.",
          };
        this.patch((s) => ({
          ...s,
          settings: {
            ...s.settings,
            drillRoleConfigured: true,
            databaseAccountsConfigured: true,
          },
        }));
        return {
          ok: true,
          message:
            "Set up the vera_pilot and vera_drill accounts and the vera_pilot database, and saved their passwords in the settings file.",
        };
      case "open-postgres":
        this.patch((s) => ({
          ...s,
          tools: { ...s.tools, postgresTools: "yes" },
          service: { ...s.service, databaseReachable: true },
        }));
        return {
          ok: true,
          message: "Example: Postgres.app opened and started.",
        };
      case "build-website":
        this.patch((s) => ({
          ...s,
          tools: { ...s.tools, websiteBuilt: "yes" },
        }));
        return { ok: true, message: "Website built." };
      case "install-services":
        this.patch((s) => ({
          ...s,
          tools: { ...s.tools, servicesInstalled: "yes" },
        }));
        service({ apiRunning: true, apiSince: now, databaseReachable: true });
        return {
          ok: true,
          message: "Services installed; Research started on this Mac only.",
        };
      case "confirm":
      case "unconfirm": {
        const id = String(input.id ?? "") as ConfirmationId;
        const confirmations = { ...this.controls.confirmations };
        if (action === "confirm") confirmations[id] = now;
        else delete confirmations[id];
        this.controls = { ...this.controls, confirmations };
        return {
          ok: true,
          message:
            action === "confirm" ? "Confirmed." : "Confirmation removed.",
        };
      }
      case "restore-test-copy": {
        const a = this.controls.acceptance;
        if (input.remove === true) {
          if (a.restoreTest)
            this.controls = {
              ...this.controls,
              acceptance: {
                ...a,
                restoreTest: { ...a.restoreTest, removedAt: now },
              },
            };
          return { ok: true, message: "Test copy removed." };
        }
        this.controls = {
          ...this.controls,
          acceptance: {
            ...a,
            restoreTest: {
              at: now,
              backupName: "vera-research-20261120T030000Z-a1b2c3.verabk",
              database: "vera50_test_recovered_20261120120000",
              objectRoot: "/example/recovery-tests/20261120120000/objects",
              comparison: {
                unchanged: 4,
                restoredOnly: [
                  {
                    project: "Urban Heat Research",
                    member: "tester-b@example.test",
                    role: "editor",
                  },
                ],
                liveOnly: [],
                roleChanged: [
                  {
                    project: "Council Hearings",
                    member: "tester-a@example.test",
                    role: "editor",
                    liveRole: "viewer",
                  },
                ],
              },
              counts: { projects: 3, members: 6, clips: 18 },
            },
          },
        };
        return {
          ok: true,
          message:
            "Restored and verified the newest backup. 2 membership differences to review.",
        };
      }
      default:
        return {
          ok: true,
          message: `Example: ${ACTIONS[action].label} would open the right macOS or provider page.`,
        };
    }
  }

  async acceptance(
    op: "record" | "undo" | "sign-off" | "restart",
    input: Record<string, unknown>,
  ): Promise<ActionResult> {
    const snapshot = await this.snapshot();
    try {
      let acceptance = this.controls.acceptance;
      if (op === "record")
        acceptance = recordItem(snapshot, acceptance, String(input.id));
      else if (op === "undo")
        acceptance = undoItem(acceptance, String(input.id));
      else if (op === "sign-off")
        acceptance = signOff(acceptance, String(input.by ?? ""));
      else acceptance = newRecord();
      this.controls = { ...this.controls, acceptance };
      return {
        ok: true,
        message:
          op === "sign-off"
            ? "Signed off. Copy the #48 comment below."
            : "Saved.",
        ...(op === "sign-off"
          ? { output: acceptanceComment(snapshot, acceptance) }
          : {}),
      };
    } catch (error) {
      if (error instanceof AcceptanceError)
        return { ok: false, message: error.message };
      throw error;
    }
  }
}
