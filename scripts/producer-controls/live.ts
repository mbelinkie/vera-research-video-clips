/**
 * Live provider: observes this Mac and runs the existing #53 pilot controls.
 *
 * Boundaries:
 * - Every pilot operation runs the existing `npm run pilot` command (as a
 *   child process with an argument array), so the panel never bypasses its
 *   safety checks. Output is size-capped and scrubbed.
 * - Secrets stay server-side. The settings file is edited in TextEdit, the
 *   backup key goes straight to the clipboard or is typed into a native macOS
 *   dialog, and nothing returned to the page contains them.
 * - Outside services are contacted only when the Producer presses Check
 *   again, and only with public, unauthenticated requests.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Pool } from "pg";

import { keyId, readKeyFile } from "../pilot-host/backup-crypto.ts";
import { assertFriendFacing } from "../pilot-host/cli.ts";
import {
  ensurePrivateDir,
  parseEnvFile,
  readState,
  writeState,
} from "../pilot-host/files.ts";
import { labelFor } from "../pilot-host/launchd.ts";
import {
  collectStatus,
  destinationKind,
  hostSettings,
  latestBackup,
  recoverBackup,
  type HostSettings,
} from "../pilot-host/operations.ts";
import {
  configuredUrl,
  createDatabaseAccounts,
  DatabaseAccountError,
} from "./database-accounts.ts";
import {
  acceptanceComment,
  AcceptanceError,
  newRecord,
  recordItem,
  signOff,
  undoItem,
  type AcceptanceRecord,
  type MembershipRow,
  type RestoreTest,
} from "./acceptance.ts";
import {
  ACTIONS,
  callbackUrl,
  openAccessGate,
  scrub,
  signOutUrl,
  type ActionId,
  type ConfirmationId,
  type EdgeResult,
  type Snapshot,
} from "./model.ts";

const run = promisify(execFile);
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const defaultEnvFile = join(
  homedir(),
  "Library/Application Support/VERA Research Pilot/pilot.env",
);
const POSTGRES_APP_BIN =
  "/Applications/Postgres.app/Contents/Versions/latest/bin";

export type ControlsState = {
  confirmations: Partial<Record<ConfirmationId, string>>;
  edge?: Snapshot["edge"];
  acceptance: AcceptanceRecord;
  archived: AcceptanceRecord[];
};

export type ActionResult = { ok: boolean; message: string; output?: string };

export interface Provider {
  readonly mode: "live" | "demo";
  snapshot(): Promise<Snapshot>;
  state(): Promise<ControlsState>;
  act(action: ActionId, input: Record<string, unknown>): Promise<ActionResult>;
  acceptance(
    op: "record" | "undo" | "sign-off" | "restart",
    input: Record<string, unknown>,
  ): Promise<ActionResult>;
}

const homeDisplay = (path: string) =>
  path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;

const inside = (parent: string, child: string) =>
  resolve(child) === resolve(parent) ||
  resolve(child).startsWith(`${resolve(parent)}${sep}`);

// ---------------------------------------------------------------------------
// Edge probes (public, unauthenticated, on demand)

type FetchLike = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export async function probeEdge(
  options: { origin: string; cognitoDomain?: string; clientId?: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now = new Date(),
): Promise<Snapshot["edge"]> {
  const get = (url: string) =>
    fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(6_000) });
  const host = new URL(options.origin).host;
  let access: EdgeResult = "unknown";
  let accessDetail: string;
  try {
    const response = await get(`${options.origin}/`);
    const location = response.headers.get("location") ?? "";
    let locationHost = "";
    try {
      locationHost = new URL(location, options.origin).hostname;
    } catch {
      /* not a URL */
    }
    if (
      response.status >= 300 &&
      response.status < 400 &&
      locationHost.endsWith(".cloudflareaccess.com")
    ) {
      access = "ok";
      accessDetail = `${host} sends visitors to Cloudflare Access first.`;
    } else if (response.status >= 200 && response.status < 300) {
      access = "problem";
      accessDetail = `${host} opened without Cloudflare Access. Pause access, then add a self-hosted Access application for exactly ${host}.`;
    } else if (response.status === 530 || response.status === 1033) {
      access = "problem";
      accessDetail = `Cloudflare can't find a tunnel for ${host}. Check the tunnel route.`;
    } else {
      access = "problem";
      accessDetail = `${host} answered ${response.status} instead of Cloudflare Access's sign-in.`;
    }
  } catch {
    accessDetail = `Couldn't reach ${host}. Check the address and this Mac's internet connection.`;
  }

  let signIn: EdgeResult = "unknown";
  let signInDetail = "Cognito settings are missing from the settings file.";
  let signOut: EdgeResult = "unknown";
  let signOutDetail = signInDetail;
  if (options.cognitoDomain && options.clientId) {
    const callback = callbackUrl(options.origin);
    const logout = signOutUrl(options.origin);
    try {
      const authorize = new URL(`${options.cognitoDomain}/oauth2/authorize`);
      authorize.search = new URLSearchParams({
        client_id: options.clientId,
        response_type: "code",
        scope: "openid",
        redirect_uri: callback,
      }).toString();
      const response = await get(authorize.toString());
      const location = response.headers.get("location") ?? "";
      if (/redirect_mismatch/iu.test(location) || response.status === 400) {
        signIn = "problem";
        signInDetail = `Cognito doesn't allow ${callback} as a callback URL. Copy the correct address into the app client's allowed callback URLs.`;
      } else if (
        response.status >= 300 &&
        response.status < 400 &&
        /\/login\b/iu.test(location)
      ) {
        signIn = "ok";
        signInDetail = "Cognito sends sign-in back to this address.";
      } else {
        signIn = "problem";
        signInDetail = `Cognito answered ${response.status}. Check the Cognito domain and client ID.`;
      }
    } catch {
      signInDetail = "Couldn't reach Cognito from this Mac.";
    }
    try {
      const url = new URL(`${options.cognitoDomain}/logout`);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        logout_uri: logout,
      }).toString();
      const response = await get(url.toString());
      const location = response.headers.get("location") ?? "";
      if (
        response.status >= 300 &&
        response.status < 400 &&
        location === logout
      ) {
        signOut = "ok";
        signOutDetail = "Cognito returns signed-out testers to this address.";
      } else {
        signOut = "problem";
        signOutDetail = `Cognito doesn't allow ${logout} as a sign-out URL. Copy it into the app client's allowed sign-out URLs.`;
      }
    } catch {
      signOutDetail = "Couldn't reach Cognito from this Mac.";
    }
  }
  return {
    checkedAt: now.toISOString(),
    access,
    accessDetail,
    signIn,
    signInDetail,
    signOut,
    signOutDetail,
  };
}

// ---------------------------------------------------------------------------
// Settings file helpers

export function settingsTemplate(home: string): string {
  const icloud = join(
    homedir(),
    "Library/Mobile Documents/com~apple~CloudDocs/VERA Research Backups",
  );
  return `# VERA Research friends-only pilot settings (#53/#107).
# Private: keep this file chmod 600. Secrets belong here and nowhere else.
# Producer Controls fills in what it can. Replace every CHANGE_ME.
NODE_ENV=production
VERA_RUNTIME_MODE=mac-pilot
CLOUD_AUTH_MODE=browser
CLOUD_API_PORT=43211
OPERATOR_PORT=43114
DATABASE_MODE=postgres
OBJECT_STORE_MODE=local
# The one approved HTTPS address. Producer Controls keeps the two URLs below
# in step with it when you press Check again.
BROWSER_PUBLIC_ORIGIN=https://research.example.com
BROWSER_CALLBACK_URL=https://research.example.com/cloud-api/auth/callback
BROWSER_LOGOUT_URL=https://research.example.com/
# Cognito (admin-create-only user pool and its web app client)
COGNITO_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_CHANGEME
COGNITO_DOMAIN=https://CHANGE_ME.auth.us-east-1.amazoncognito.com
COGNITO_CLIENT_ID=CHANGE_ME
COGNITO_CLIENT_SECRET=CHANGE_ME
# Cloudflare Access application and tunnel
CF_ACCESS_TEAM_DOMAIN=https://CHANGE_ME.cloudflareaccess.com
CF_ACCESS_AUD=CHANGE_ME
PILOT_TUNNEL_ID=CHANGE_ME
PILOT_TUNNEL_CREDENTIALS=${join(homedir(), ".cloudflared", "CHANGE_ME.json")}
PILOT_CLOUDFLARED=/usr/local/bin/cloudflared
# Local PostgreSQL (Postgres.app) with two least-privileged roles
PILOT_PG_BIN=${POSTGRES_APP_BIN}
PILOT_PG_URL=postgresql://vera_pilot:CHANGE_ME@127.0.0.1:5432/vera_pilot
PILOT_DRILL_PG_URL=postgresql://vera_drill:CHANGE_ME@127.0.0.1:5432/postgres
PILOT_OBJECT_ROOT=${join(home, "transcripts")}
# Encrypted backups: the folder must leave this Mac; the key must not.
PILOT_BACKUP_DESTINATION=${icloud}
PILOT_BACKUP_KEY_FILE=${join(home, "backup.key")}
`;
}

/** Replaces one KEY=VALUE line in place, keeping comments and order. */
export function setEnvValue(text: string, key: string, value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || /[\r\n]/u.test(value))
    throw new Error("Invalid setting");
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else
    lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, `${key}=${value}`);
  const next = lines.join("\n");
  parseEnvFile(next); // never write a file the pilot can't read
  return next;
}

/** Settings the pilot needs that VERA can fill in itself. */
export function completeSettings(text: string): string {
  const env = parseEnvFile(text);
  let next = text;
  if (env.DATABASE_MODE !== "postgres")
    next = setEnvValue(next, "DATABASE_MODE", "postgres");
  if (env.OBJECT_STORE_MODE !== "local")
    next = setEnvValue(next, "OBJECT_STORE_MODE", "local");
  if (Buffer.byteLength(env.LOCAL_UPLOAD_SIGNING_SECRET ?? "") < 32)
    next = setEnvValue(
      next,
      "LOCAL_UPLOAD_SIGNING_SECRET",
      randomBytes(48).toString("hex"),
    );
  return next;
}

const PROVIDER_PATHS = new Set([
  "browserPublicOrigin",
  "browserCallbackUrl",
  "browserLogoutUrl",
  "cognitoIssuer",
  "cognitoDomain",
  "cognitoClientId",
  "cognitoClientSecret",
  "cloudflareAccessTeamDomain",
  "cloudflareAccessAud",
]);
const PROVIDER_KEYS = /^(BROWSER_|COGNITO_|CF_ACCESS_|PILOT_TUNNEL_)/u;
const AUTO_FILLED = new Set(["runtimeMode", "localSigningSecret"]);

/**
 * Splits validation failures into what belongs to this Mac's settings and
 * what can only be filled in after the Cognito and Cloudflare steps. Messages
 * name settings, never their values.
 */
export function classifySettingsProblems(
  error: unknown,
  env: Record<string, string>,
): { local: string[]; provider: string[] } {
  const local: string[] = [];
  const provider: string[] = [];
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let issues: Array<{ path?: unknown[]; message?: string }> | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) issues = parsed;
  } catch {
    /* plain message */
  }
  for (const issue of issues ?? (raw ? [{ message: raw }] : [])) {
    const path = String(issue.path?.[0] ?? "");
    const message = scrub(String(issue.message ?? "invalid setting"));
    if (PROVIDER_PATHS.has(path)) provider.push(message);
    else if (AUTO_FILLED.has(path))
      local.push(`${message} (VERA fills this in when you press Check again)`);
    else local.push(message);
  }
  const placeholders = Object.entries(env)
    .filter(([, value]) => value.includes("CHANGE_ME"))
    .map(([key]) => key);
  // Database passwords are filled in by step 3's Create database accounts.
  const localPlaceholders = placeholders.filter(
    (key) =>
      !PROVIDER_KEYS.test(key) &&
      key !== "PILOT_PG_URL" &&
      key !== "PILOT_DRILL_PG_URL",
  );
  const providerPlaceholders = placeholders.filter((key) =>
    PROVIDER_KEYS.test(key),
  );
  if (localPlaceholders.length)
    local.push(`Replace CHANGE_ME in ${localPlaceholders.join(", ")}`);
  if (providerPlaceholders.length && !provider.length)
    provider.push(`Replace CHANGE_ME in ${providerPlaceholders.join(", ")}`);
  return { local: [...new Set(local)], provider: [...new Set(provider)] };
}

async function writePrivate(path: string, text: string) {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(
    temp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

// ---------------------------------------------------------------------------

const LIMIT = 64 * 1024;

export function runBounded(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    input?: string;
  },
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let output = "";
    const take = (chunk: Buffer) => {
      if (output.length < LIMIT) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    if (options.input !== undefined) child.stdin?.end(options.input);
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      done({ code: 1, output: error.message });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      done({
        code: code ?? (signal ? 1 : 0),
        output: output.slice(0, LIMIT),
      });
    });
  });
}

/** macOS dialogs via osascript. Returns undefined when the Producer cancels. */
async function ask(script: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("/usr/bin/osascript", ["-e", script], {
      timeout: 10 * 60_000,
    });
    return stdout.replace(/\n$/u, "");
  } catch (error) {
    if (
      /User canceled|-128/u.test(
        String((error as { stderr?: unknown }).stderr ?? error),
      )
    )
      return undefined;
    throw error;
  }
}

const MEMBERSHIP_SQL = `
  SELECT p.name AS project,
         COALESCE(NULLIF(e.email, ''), NULLIF(u.display_name, ''), 'account ' || left(u.id::text, 8)) AS member,
         pm.role, pm.project_id::text AS project_id, pm.user_id::text AS user_id
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN verified_member_emails e ON e.user_id = pm.user_id
   ORDER BY p.name, member`;

type Membership = MembershipRow & { project_id: string; user_id: string };

export function compareMemberships(
  restored: Membership[],
  live: Membership[],
): RestoreTest["comparison"] {
  const key = (row: Membership) => `${row.project_id}/${row.user_id}`;
  const liveMap = new Map(live.map((row) => [key(row), row]));
  const restoredMap = new Map(restored.map((row) => [key(row), row]));
  const strip = ({ project, member, role }: Membership): MembershipRow => ({
    project,
    member,
    role,
  });
  let unchanged = 0;
  const restoredOnly: MembershipRow[] = [];
  const roleChanged: RestoreTest["comparison"]["roleChanged"] = [];
  for (const row of restored) {
    const current = liveMap.get(key(row));
    if (!current) restoredOnly.push(strip(row));
    else if (current.role !== row.role)
      roleChanged.push({ ...strip(row), liveRole: current.role });
    else unchanged++;
  }
  const liveOnly = live.filter((row) => !restoredMap.has(key(row))).map(strip);
  return { unchanged, restoredOnly, liveOnly, roleChanged };
}

export class LiveProvider implements Provider {
  readonly mode = "live" as const;
  private readonly envFile: string;
  private readonly home: string;
  private readonly stateFile: string;

  constructor(envFile = process.env.PILOT_ENV_FILE ?? defaultEnvFile) {
    if (!isAbsolute(envFile))
      throw new Error("PILOT_ENV_FILE must be absolute");
    this.envFile = envFile;
    this.home = dirname(envFile);
    this.stateFile = join(this.home, "state", "producer-controls.json");
  }

  async state(): Promise<ControlsState> {
    const saved = await readState<ControlsState>(this.stateFile);
    return {
      confirmations: saved?.confirmations ?? {},
      ...(saved?.edge ? { edge: saved.edge } : {}),
      acceptance: saved?.acceptance ?? newRecord(),
      archived: saved?.archived ?? [],
    };
  }

  private async save(state: ControlsState) {
    await ensurePrivateDir(this.home);
    await ensurePrivateDir(join(this.home, "state"));
    await writeState(this.stateFile, state);
  }

  /** Reads the env file without the private-permission refusal, for diagnosis. */
  private async readEnv(): Promise<{
    exists: boolean;
    private: boolean;
    env?: Record<string, string>;
    problem?: string;
  }> {
    let info;
    try {
      info = await lstat(this.envFile);
    } catch {
      return { exists: false, private: false };
    }
    const isPrivate =
      info.isFile() &&
      !info.isSymbolicLink() &&
      (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== "function" || info.uid === process.getuid());
    if (!isPrivate) return { exists: true, private: false };
    try {
      const env = parseEnvFile(await readFile(this.envFile, "utf8"));
      return { exists: true, private: true, env };
    } catch (error) {
      return {
        exists: true,
        private: true,
        problem: error instanceof Error ? error.message : "unreadable",
      };
    }
  }

  private envFor(env: Record<string, string>): Record<string, string> {
    return { PILOT_HOME: this.home, PATH: process.env.PATH ?? "", ...env };
  }

  private settingsFrom(env: Record<string, string>): HostSettings | undefined {
    try {
      return hostSettings(this.envFor(env));
    } catch {
      return undefined;
    }
  }

  private toolPath(env?: Record<string, string>) {
    return [
      env?.PILOT_PG_BIN,
      POSTGRES_APP_BIN,
      process.env.PATH ?? "/usr/bin:/bin",
    ]
      .filter(Boolean)
      .join(":");
  }

  async snapshot(): Promise<Snapshot> {
    const now = new Date();
    const state = await this.state();
    const file = await this.readEnv();
    const env = file.env;
    let problem = file.problem;
    let providerProblems: string[] = [];
    if (env && !problem) {
      let failure: unknown;
      try {
        assertFriendFacing(this.envFor(env));
        hostSettings(this.envFor(env));
      } catch (error) {
        failure = error;
      }
      const split = classifySettingsProblems(failure, env);
      if (split.local.length) problem = split.local.join("; ");
      providerProblems = split.provider;
    }
    const settings = env ? this.settingsFrom(env) : undefined;
    const tri = (value: boolean | undefined): "yes" | "no" | "unknown" =>
      value === undefined ? "unknown" : value ? "yes" : "no";
    const exists = (path?: string) =>
      path
        ? access(path).then(
            () => true,
            () => false,
          )
        : Promise.resolve(undefined);

    const [
      fileVault,
      postgresTools,
      cloudflared,
      websiteBuilt,
      servicesInstalled,
    ] = await Promise.all([
      run("/usr/bin/fdesetup", ["status"])
        .then(({ stdout }) => /FileVault is On/u.test(stdout))
        .catch(() => undefined),
      run("pg_dump", ["--version"], {
        env: { ...process.env, PATH: this.toolPath(env) },
      }).then(
        () => true,
        () => false,
      ),
      env?.PILOT_CLOUDFLARED
        ? exists(env.PILOT_CLOUDFLARED)
        : run("/usr/bin/which", ["cloudflared"]).then(
            () => true,
            () => false,
          ),
      exists(join(repoRoot, "dist/web/index.html")),
      exists(
        join(homedir(), "Library/LaunchAgents", `${labelFor("api")}.plist`),
      ),
    ]);

    let backupKey: Snapshot["backupKey"] = { exists: false, private: false };
    if (settings) {
      const info = await lstat(settings.keyFile).catch(() => undefined);
      if (info) {
        backupKey = { exists: true, private: (info.mode & 0o077) === 0 };
        const key = await readKeyFile(settings.keyFile).catch(() => undefined);
        if (key)
          backupKey.fingerprint = keyId(key)
            .toString("hex")
            .match(/.{4}/gu)!
            .join(" ");
      }
    }

    const status = settings
      ? await collectStatus(settings, now).catch(() => undefined)
      : undefined;
    const kind = settings ? destinationKind(settings.destination) : undefined;
    const destinationExists = settings
      ? await exists(settings.destination)
      : undefined;
    const origin = env?.BROWSER_PUBLIC_ORIGIN;
    const validOrigin = (() => {
      try {
        return origin &&
          new URL(origin).origin === origin &&
          origin.startsWith("https://")
          ? origin
          : undefined;
      } catch {
        return undefined;
      }
    })();

    const lastBackup = (status?.backup ?? {}) as {
      lastSuccess?: { at: string; name?: string };
      lastFailure?: { at: string; message?: string };
    };
    const lastDrill = (status?.drill ?? {}) as typeof lastBackup;
    return {
      mode: "live",
      checkedAt: now.toISOString(),
      settingsFile: {
        displayPath: homeDisplay(this.envFile),
        exists: file.exists,
        private: file.private,
        ...(problem ? { problem } : {}),
      },
      settings: {
        ...(validOrigin && !validOrigin.includes("example.com")
          ? { publicOrigin: validOrigin }
          : {}),
        ...(env?.COGNITO_DOMAIN ? { cognitoDomain: env.COGNITO_DOMAIN } : {}),
        ...(env?.CF_ACCESS_TEAM_DOMAIN
          ? { accessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN }
          : {}),
        providerProblems,
        tunnelConfigured: Boolean(
          env?.PILOT_TUNNEL_ID &&
          !env.PILOT_TUNNEL_ID.includes("CHANGE_ME") &&
          env.PILOT_TUNNEL_CREDENTIALS &&
          cloudflared,
        ),
        drillRoleConfigured: configuredUrl(env?.PILOT_DRILL_PG_URL),
        databaseAccountsConfigured:
          configuredUrl(env?.PILOT_PG_URL) &&
          configuredUrl(env?.PILOT_DRILL_PG_URL),
        ...(settings
          ? { destinationDisplay: homeDisplay(settings.destination) }
          : {}),
        ...(kind ? { destinationKind: kind.replace(/^WARNING: /u, "") } : {}),
        destinationOffDevice:
          kind === undefined
            ? "unknown"
            : kind.startsWith("WARNING")
              ? "no"
              : "yes",
        destinationExists: tri(destinationExists),
      },
      mac: { fileVault: tri(fileVault) },
      tools: {
        postgresTools: tri(postgresTools),
        cloudflared: tri(cloudflared),
        websiteBuilt: tri(websiteBuilt),
        servicesInstalled: tri(servicesInstalled),
      },
      backupKey,
      service: {
        apiRunning: Boolean(status?.api.running),
        ...(status?.api.running ? { apiSince: status.api.since } : {}),
        databaseReachable: Boolean(status?.database.reachable),
        remoteLoaded: Boolean(status?.tunnel.loaded),
        remoteConnected: Boolean(status?.tunnel.connected),
        reachableByFriends: Boolean(status?.reachableByFriends),
        restartsLast24h: status?.restartsLast24h ?? 0,
        ...(status?.problems.some((p) => p.startsWith("Saving is paused: disk"))
          ? { savingPaused: "disk" as const }
          : status?.problems.some((p) =>
                p.startsWith("Saving is paused by a backup"),
              )
            ? { savingPaused: "backup" as const }
            : {}),
        freeDiskBytes: status?.disk.freeBytes ?? null,
        ...(status?.api.running ? { counts: status.api.counts } : {}),
      },
      backup: {
        ...(lastBackup.lastSuccess
          ? { lastSuccessAt: lastBackup.lastSuccess.at }
          : {}),
        ...(lastBackup.lastFailure
          ? {
              lastFailureAt: lastBackup.lastFailure.at,
              lastFailureMessage: scrub(
                lastBackup.lastFailure.message ?? "unknown error",
              ),
            }
          : {}),
      },
      recovery: {
        ...(lastDrill.lastSuccess
          ? { lastDrillAt: lastDrill.lastSuccess.at }
          : {}),
        ...(lastDrill.lastFailure
          ? {
              lastDrillFailureAt: lastDrill.lastFailure.at,
              lastDrillFailureMessage: scrub(
                lastDrill.lastFailure.message ?? "unknown error",
              ),
            }
          : {}),
      },
      edge:
        state.edge && validOrigin
          ? state.edge
          : { access: "unknown", signIn: "unknown", signOut: "unknown" },
      confirmations: state.confirmations,
    };
  }

  private async pilot(
    args: string[],
    timeoutMs = 120_000,
  ): Promise<ActionResult> {
    const result = await runBounded(
      process.execPath,
      ["--import", "tsx", "scripts/pilot-host/cli.ts", ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, PILOT_ENV_FILE: this.envFile },
        timeoutMs,
      },
    );
    const output = scrub(result.output.trim());
    return {
      ok: result.code === 0,
      message:
        output.split("\n").filter(Boolean).at(-1) ??
        (result.code === 0 ? "Done." : "It didn't work."),
      output,
    };
  }

  private async open(
    target: string[],
    fallback?: string[],
  ): Promise<ActionResult> {
    try {
      await run("/usr/bin/open", target);
    } catch {
      if (!fallback) return { ok: false, message: "macOS couldn't open it." };
      await run("/usr/bin/open", fallback);
    }
    return {
      ok: true,
      message: "Opened. Come back here and press Check again when you're done.",
    };
  }

  async act(
    action: ActionId,
    input: Record<string, unknown>,
  ): Promise<ActionResult> {
    if (!(action in ACTIONS)) return { ok: false, message: "Unknown action." };
    const file = await this.readEnv();
    const env = file.env ?? {};
    switch (action) {
      case "check-again": {
        // Fill in what VERA can generate itself (modes, signing secret).
        if (file.env) {
          const text = await readFile(this.envFile, "utf8");
          const completed = completeSettings(text);
          if (completed !== text) await writePrivate(this.envFile, completed);
        }
        // Keep the two derived sign-in URLs in step with the chosen address.
        if (file.env && env.BROWSER_PUBLIC_ORIGIN) {
          try {
            const origin = new URL(env.BROWSER_PUBLIC_ORIGIN).origin;
            if (
              origin === env.BROWSER_PUBLIC_ORIGIN &&
              origin.startsWith("https://")
            ) {
              let text = await readFile(this.envFile, "utf8");
              const before = text;
              text = setEnvValue(
                text,
                "BROWSER_CALLBACK_URL",
                callbackUrl(origin),
              );
              text = setEnvValue(
                text,
                "BROWSER_LOGOUT_URL",
                signOutUrl(origin),
              );
              if (text !== before) await writePrivate(this.envFile, text);
            }
          } catch {
            /* reported by validation */
          }
        }
        const origin = env.BROWSER_PUBLIC_ORIGIN;
        if (
          origin &&
          origin.startsWith("https://") &&
          !origin.includes("example.com")
        ) {
          const edge = await probeEdge({
            origin,
            ...(env.COGNITO_DOMAIN
              ? { cognitoDomain: env.COGNITO_DOMAIN }
              : {}),
            ...(env.COGNITO_CLIENT_ID
              ? { clientId: env.COGNITO_CLIENT_ID }
              : {}),
          });
          const state = await this.state();
          await this.save({ ...state, edge });
        }
        return { ok: true, message: "Checked." };
      }
      case "start-research":
        return this.pilot(["start"]);
      case "stop-research":
        return this.pilot(["stop"]);
      case "pause-access":
        return this.pilot(["disconnect"]);
      case "open-access": {
        const gate = openAccessGate(await this.snapshot());
        if (!gate.allowed)
          return {
            ok: false,
            message: `Access stays off until setup passes. ${gate.reasons[0] ?? ""}`,
          };
        return this.pilot(["connect"]);
      }
      case "back-up-now":
        return this.pilot(["backup"], 30 * 60_000);
      case "test-recovery":
        return this.pilot(["drill"], 30 * 60_000);
      case "install-services":
        return this.pilot(["install", "--load"]);
      case "create-backup-key":
        return this.pilot(["backup-key", "create"]);
      case "build-website": {
        const result = await runBounded(
          process.execPath,
          [
            join(repoRoot, "node_modules/vite/bin/vite.js"),
            "build",
            "--config",
            "apps/web/vite.config.ts",
          ],
          { cwd: repoRoot, env: process.env, timeoutMs: 10 * 60_000 },
        );
        return {
          ok: result.code === 0,
          message:
            result.code === 0 ? "Website built." : "The website build failed.",
          output: scrub(result.output.slice(-4000)),
        };
      }
      case "create-settings-file": {
        if (file.exists)
          return { ok: false, message: "A settings file already exists." };
        await ensurePrivateDir(this.home);
        const handle = await open(
          this.envFile,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(completeSettings(settingsTemplate(this.home)));
        } finally {
          await handle.close();
        }
        return {
          ok: true,
          message: "Created. Open settings file to fill it in.",
        };
      }
      case "open-settings-file":
        if (!file.exists)
          return { ok: false, message: "Create the settings file first." };
        return this.open(["-e", this.envFile]);
      case "copy-backup-key": {
        const settings = this.settingsFrom(env);
        if (!settings)
          return { ok: false, message: "Fix the settings file first." };
        const key = await readKeyFile(settings.keyFile);
        const copied = await runBounded("/usr/bin/pbcopy", [], {
          cwd: this.home,
          env: { PATH: "/usr/bin:/bin" },
          timeoutMs: 5_000,
          input: key.toString("base64"),
        });
        return copied.code === 0
          ? {
              ok: true,
              message: `Key copied. Paste it into your password manager now; fingerprint ${keyId(key).toString("hex").match(/.{4}/gu)!.join(" ")}. Then copy something else to clear the clipboard.`,
            }
          : { ok: false, message: "Couldn't copy to the clipboard." };
      }
      case "choose-backup-folder": {
        if (!file.env)
          return { ok: false, message: "Create the settings file first." };
        const chosen = await ask(
          'POSIX path of (choose folder with prompt "Choose where VERA keeps encrypted backups. Pick a folder in iCloud Drive or on an external drive.")',
        );
        if (!chosen) return { ok: false, message: "No folder chosen." };
        const folder = resolve(chosen);
        const text = setEnvValue(
          await readFile(this.envFile, "utf8"),
          "PILOT_BACKUP_DESTINATION",
          folder,
        );
        try {
          hostSettings(this.envFor(parseEnvFile(text)));
        } catch (error) {
          return {
            ok: false,
            message: scrub(String((error as Error).message)),
          };
        }
        await writePrivate(this.envFile, text);
        const kind = destinationKind(folder);
        return {
          ok: !kind.startsWith("WARNING"),
          message: kind.startsWith("WARNING")
            ? "Saved, but this folder is on this Mac. Choose iCloud Drive or an external drive."
            : `Backups will go to ${kind}.`,
        };
      }
      case "open-filevault":
        return this.open(
          [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?FileVault",
          ],
          ["x-apple.systempreferences:com.apple.preference.security?FileVault"],
        );
      case "open-postgres":
        return this.open(["-a", "Postgres"], ["https://postgresapp.com/"]);
      case "open-cloudflare":
        return this.open(["https://one.dash.cloudflare.com/"]);
      case "open-cognito":
        return this.open([
          "https://console.aws.amazon.com/cognito/v2/idp/user-pools",
        ]);
      case "confirm":
      case "unconfirm": {
        const id = String(input.id ?? "") as ConfirmationId;
        const allowed: ConfirmationId[] = [
          "domain-approved",
          "access-invite-list",
          "cognito-admin-only",
          "cache-bypass",
          "backup-key-saved",
        ];
        if (!allowed.includes(id))
          return { ok: false, message: "Unknown confirmation." };
        const state = await this.state();
        const confirmations = { ...state.confirmations };
        if (action === "confirm") confirmations[id] = new Date().toISOString();
        else delete confirmations[id];
        await this.save({ ...state, confirmations });
        return {
          ok: true,
          message:
            action === "confirm" ? "Confirmed." : "Confirmation removed.",
        };
      }
      case "create-database-accounts":
        return this.createDatabaseAccounts(env, Boolean(file.env));
      case "restore-test-copy":
        return this.restoreTestCopy(env, input.remove === true);
    }
    return { ok: false, message: "Unknown action." };
  }

  private async createDatabaseAccounts(
    env: Record<string, string>,
    hasFile: boolean,
  ): Promise<ActionResult> {
    if (!hasFile)
      return { ok: false, message: "Create the settings file first." };
    let host = "127.0.0.1";
    let port = 5432;
    try {
      const current = new URL(env.PILOT_PG_URL ?? "");
      if (["127.0.0.1", "localhost"].includes(current.hostname)) {
        host = current.hostname;
        port = Number(current.port || 5432);
      }
    } catch {
      /* use the Postgres.app default */
    }
    const admin = new Pool({
      host,
      port,
      user: userInfo().username,
      database: "postgres",
      max: 1,
      connectionTimeoutMillis: 3_000,
    });
    const canLogin = async (url: string) => {
      const pool = new Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 3_000,
      });
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      } finally {
        await pool.end().catch(() => undefined);
      }
    };
    try {
      const result = await createDatabaseAccounts(
        {
          ...(env.PILOT_PG_URL ? { pilotUrl: env.PILOT_PG_URL } : {}),
          ...(env.PILOT_DRILL_PG_URL
            ? { drillUrl: env.PILOT_DRILL_PG_URL }
            : {}),
        },
        {
          admin: async (sql, params) =>
            (await admin.query(sql, params as unknown[] | undefined)).rows,
          canLogin,
          host,
          port,
        },
      );
      if (result.settings) {
        let text = await readFile(this.envFile, "utf8");
        text = setEnvValue(text, "PILOT_PG_URL", result.settings.PILOT_PG_URL);
        text = setEnvValue(
          text,
          "PILOT_DRILL_PG_URL",
          result.settings.PILOT_DRILL_PG_URL,
        );
        await writePrivate(this.envFile, text);
      }
      return { ok: true, message: result.message };
    } catch (error) {
      if (error instanceof DatabaseAccountError)
        return { ok: false, message: error.message };
      const code = String((error as { code?: unknown }).code ?? "");
      if (code === "ECONNREFUSED" || code === "ETIMEDOUT")
        return {
          ok: false,
          message:
            "PostgreSQL isn't answering. Open Postgres.app and press Start, then try again.",
        };
      if (code === "28P01" || code === "28000")
        return {
          ok: false,
          message:
            "Postgres.app asked for a password for this Mac's user, so VERA can't set up the accounts itself. Ask for help (runbook setup step 2).",
        };
      return {
        ok: false,
        message: scrub(
          `Couldn't set up the accounts: ${(error as Error).message}`,
        ),
      };
    } finally {
      await admin.end().catch(() => undefined);
    }
  }

  private async restoreTestCopy(
    env: Record<string, string>,
    remove: boolean,
  ): Promise<ActionResult> {
    const settings = this.settingsFrom(env);
    if (!settings?.drillPgUrl)
      return {
        ok: false,
        message: "The recovery-test database role isn't configured.",
      };
    const state = await this.state();
    const admin = new URL(settings.drillPgUrl);
    const testsRoot = join(this.home, "recovery-tests");

    if (remove) {
      const test = state.acceptance.restoreTest;
      if (!test || test.removedAt)
        return { ok: true, message: "Nothing to remove." };
      if (
        !/^vera50_test_recovered_\d{14}$/u.test(test.database) ||
        !inside(testsRoot, test.objectRoot)
      )
        return {
          ok: false,
          message: "That test copy isn't one Producer Controls made.",
        };
      const pool = new Pool({ connectionString: admin.toString(), max: 1 });
      try {
        await pool.query(
          `DROP DATABASE IF EXISTS "${test.database}" WITH (FORCE)`,
        );
      } finally {
        await pool.end();
      }
      await rm(dirname(test.objectRoot), { recursive: true, force: true });
      await this.save({
        ...state,
        acceptance: {
          ...state.acceptance,
          restoreTest: { ...test, removedAt: new Date().toISOString() },
        },
      });
      return { ok: true, message: "Test copy removed." };
    }

    if (state.acceptance.restoreTest && !state.acceptance.restoreTest.removedAt)
      return { ok: false, message: "Remove the previous test copy first." };
    const name = await latestBackup(settings);
    if (!name)
      return { ok: false, message: "No backup found in the backup folder." };
    // The key comes from the password manager through a native dialog, so
    // the restore proves the separately kept copy works. It never reaches
    // the browser.
    const pasted = await ask(
      `text returned of (display dialog "Paste the VERA Research backup key from your password manager. VERA uses it once to open a test copy of ${name}." default answer "" with hidden answer with title "Restore a test copy" buttons {"Cancel", "Restore"} default button "Restore")`,
    );
    if (!pasted)
      return { ok: false, message: "Cancelled. Nothing was restored." };
    const key = Buffer.from(pasted.trim(), "base64");
    const stored = await readKeyFile(settings.keyFile).catch(() => undefined);
    if (key.length !== 32 || key.toString("base64") !== pasted.trim())
      return {
        ok: false,
        message:
          "That isn't a VERA backup key. Copy the whole key from the password manager item.",
      };
    if (stored && !keyId(stored).equals(keyId(key)))
      return {
        ok: false,
        message:
          "That key's fingerprint doesn't match this pilot's key. Check you copied the right item.",
      };

    const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
    const folder = join(testsRoot, stamp);
    await ensurePrivateDir(testsRoot);
    await ensurePrivateDir(folder);
    const keyFile = join(folder, "password-manager.key");
    await writeFile(keyFile, `${key.toString("base64")}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const objectRoot = join(folder, "objects");
    try {
      const result = await recoverBackup(
        { ...settings, keyFile },
        join(settings.destination, name),
        objectRoot,
      );
      const restoredUrl = new URL(admin.toString());
      restoredUrl.pathname = `/${result.database}`;
      const restoredPool = new Pool({
        connectionString: restoredUrl.toString(),
        max: 1,
      });
      const livePool = new Pool({ connectionString: settings.pgUrl, max: 1 });
      try {
        const [restored, live, counts] = await Promise.all([
          restoredPool.query<Membership>(MEMBERSHIP_SQL),
          livePool.query<Membership>(MEMBERSHIP_SQL),
          restoredPool.query<{ projects: string; clips: string }>(
            "SELECT (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM clip_candidates) AS clips",
          ),
        ]);
        const restoreTest: RestoreTest = {
          at: new Date().toISOString(),
          backupName: name,
          database: result.database,
          objectRoot: result.objectRoot,
          comparison: compareMemberships(restored.rows, live.rows),
          counts: {
            projects: Number(counts.rows[0]?.projects ?? 0),
            members: restored.rows.length,
            clips: Number(counts.rows[0]?.clips ?? 0),
          },
        };
        const latest = await this.state();
        await this.save({
          ...latest,
          acceptance: { ...latest.acceptance, restoreTest },
        });
        const c = restoreTest.comparison;
        return {
          ok: true,
          message: `Restored and verified ${name}. ${c.restoredOnly.length + c.roleChanged.length} membership difference(s) to review.`,
        };
      } finally {
        await Promise.all([restoredPool.end(), livePool.end()]);
      }
    } catch (error) {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
      return {
        ok: false,
        message: scrub(`Restore failed: ${(error as Error).message}`),
      };
    } finally {
      await rm(keyFile, { force: true }).catch(() => undefined);
    }
  }

  async acceptance(
    op: "record" | "undo" | "sign-off" | "restart",
    input: Record<string, unknown>,
  ): Promise<ActionResult> {
    const state = await this.state();
    const snapshot = await this.snapshot();
    try {
      let acceptance = state.acceptance;
      let archived = state.archived;
      if (op === "record")
        acceptance = recordItem(snapshot, acceptance, String(input.id));
      else if (op === "undo")
        acceptance = undoItem(acceptance, String(input.id));
      else if (op === "sign-off")
        acceptance = signOff(acceptance, String(input.by ?? ""));
      else {
        if (acceptance.restoreTest && !acceptance.restoreTest.removedAt)
          return { ok: false, message: "Remove the restored test copy first." };
        archived = [...archived, acceptance].slice(-10);
        acceptance = newRecord();
      }
      await this.save({ ...state, acceptance, archived });
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
