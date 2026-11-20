/**
 * Scheduled encrypted off-laptop backups, restore drills and status for the
 * Mac pilot (#53). Builds on the #50 consistent backup/restore in
 * `scripts/pilot-data.ts`; this module adds encryption, the off-device copy,
 * verification, retention, drills and visible failure state.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { Pool } from "pg";

import { backupPilot, restorePilot } from "../pilot-data.ts";
import { decryptFile, encryptFile, readKeyFile } from "./backup-crypto.ts";
import { ensurePrivateDir, readState, writeState } from "./files.ts";
import { labelFor, PILOT_JOBS, type PilotJob } from "./launchd.ts";
import { backupName, backupsToPrune, parseBackupName } from "./retention.ts";

const run = promisify(execFile);

export type HostSettings = {
  home: string;
  pgUrl: string;
  objectRoot: string;
  operatorPort: number;
  publicPort: number;
  metricsPort: number;
  destination: string;
  keyFile: string;
  drillPgUrl?: string;
  publicOrigin?: string;
};

export const BACKUP_STALE_HOURS = 36;
export const DRILL_STALE_DAYS = 8;

const inside = (parent: string, child: string) => {
  const diff = relative(resolve(parent), resolve(child));
  return (
    diff === "" ||
    (!diff.startsWith(`..${sep}`) && diff !== ".." && !isAbsolute(diff))
  );
};

export function hostSettings(
  env: Record<string, string | undefined>,
): HostSettings {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required in the pilot env file`);
    return value;
  };
  const absolute = (name: string) => {
    const value = need(name);
    if (!isAbsolute(value) || value.includes("\0"))
      throw new Error(`${name} must be an absolute path`);
    return resolve(value);
  };
  const settings: HostSettings = {
    home: absolute("PILOT_HOME"),
    pgUrl: need("PILOT_PG_URL"),
    objectRoot: absolute("PILOT_OBJECT_ROOT"),
    operatorPort: Number(env.OPERATOR_PORT ?? 43_114),
    publicPort: Number(env.CLOUD_API_PORT ?? 43_111),
    metricsPort: Number(env.PILOT_TUNNEL_METRICS_PORT ?? 43_113),
    destination: absolute("PILOT_BACKUP_DESTINATION"),
    keyFile: absolute("PILOT_BACKUP_KEY_FILE"),
    ...(env.PILOT_DRILL_PG_URL ? { drillPgUrl: env.PILOT_DRILL_PG_URL } : {}),
    ...(env.BROWSER_PUBLIC_ORIGIN
      ? { publicOrigin: env.BROWSER_PUBLIC_ORIGIN }
      : {}),
  };
  // The key must never travel with the backups it protects, and backups must
  // not land inside the data they back up.
  if (inside(settings.destination, settings.keyFile))
    throw new Error(
      "PILOT_BACKUP_KEY_FILE must not be inside the backup destination",
    );
  for (const local of [settings.objectRoot, settings.home])
    if (
      inside(local, settings.destination) ||
      inside(settings.destination, local)
    )
      throw new Error(
        "PILOT_BACKUP_DESTINATION must be separate from pilot data",
      );
  return settings;
}

/** Best-effort description of whether a folder actually leaves this laptop. */
export function destinationKind(path: string, home = homedir()): string {
  if (inside(join(home, "Library/Mobile Documents/com~apple~CloudDocs"), path))
    return "iCloud Drive (syncs off this Mac)";
  if (inside(join(home, "Library/CloudStorage"), path))
    return "cloud-synced folder (syncs off this Mac)";
  if (inside("/Volumes", path)) return "external drive";
  return "WARNING: a folder on this Mac, not off-device";
}

const stateFile = (s: HostSettings, name: string) =>
  join(s.home, "state", `${name}.json`);

type RunRecord = { at: string; message?: string; [key: string]: unknown };
type RunState = { lastSuccess?: RunRecord; lastFailure?: RunRecord };

async function recordRun(
  s: HostSettings,
  name: "backup" | "drill",
  outcome:
    | { ok: true; detail: Record<string, unknown> }
    | { ok: false; message: string },
  now: Date,
): Promise<void> {
  const previous = (await readState<RunState>(stateFile(s, name))) ?? {};
  const next: RunState = outcome.ok
    ? { ...previous, lastSuccess: { at: now.toISOString(), ...outcome.detail } }
    : {
        ...previous,
        lastFailure: { at: now.toISOString(), message: outcome.message },
      };
  await writeState(stateFile(s, name), next);
}

/** A visible macOS notification; failures to notify are never fatal. */
export async function notify(title: string, message: string): Promise<void> {
  const quote = (value: string) =>
    `"${value.replace(/[\\"]/gu, " ").slice(0, 200)}"`;
  await run("osascript", [
    "-e",
    `display notification ${quote(message)} with title ${quote(title)}`,
  ]).catch(() => undefined);
}

/** Single-run lock so an overlapping schedule can never run twice at once. */
async function withLock<T>(
  s: HostSettings,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDir(join(s.home, "state"));
  const path = join(s.home, "state", `${name}.lock`);
  const take = async () => {
    const handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(String(process.pid));
    await handle.close();
  };
  try {
    await take();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holder = Number((await readState<number>(path)) ?? 0);
    let alive = false;
    try {
      if (holder > 0) {
        process.kill(holder, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive)
      throw new Error(`Another ${name} is already running (pid ${holder})`);
    await rm(path, { force: true });
    await take();
  }
  try {
    return await work();
  } finally {
    await rm(path, { force: true });
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function tar(args: string[]): Promise<void> {
  await new Promise<void>((done, fail) => {
    const child = spawn("/usr/bin/tar", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-500);
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : fail(new Error(`tar failed (${code}): ${stderr.trim()}`)),
    );
  });
}

async function assertDestination(s: HostSettings): Promise<void> {
  const info = await lstat(s.destination).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink())
    throw new Error(
      `Backup destination ${s.destination} is missing (is iCloud Drive or the drive available?)`,
    );
}

export type BackupResult = {
  name: string;
  bytes: number;
  sha256: string;
  pruned: string[];
};

export async function runBackup(
  s: HostSettings,
  now = new Date(),
  options: { offline?: boolean } = {},
): Promise<BackupResult> {
  return withLock(s, "backup", async () => {
    const staging = join(
      s.home,
      "staging",
      `backup-${randomBytes(6).toString("hex")}`,
    );
    try {
      await assertDestination(s);
      const key = await readKeyFile(s.keyFile);
      await ensurePrivateDir(join(s.home, "staging"));
      await ensurePrivateDir(staging);
      // #50 protocol: write gate, drain via the loopback operator port,
      // PostgreSQL dump + exact pinned transcript objects + checksummed manifest.
      await backupPilot(s.pgUrl, s.objectRoot, join(staging, "backup"), {
        offline: options.offline ?? false,
        apiOrigin: `http://127.0.0.1:${s.operatorPort}`,
      });
      await tar(["-C", staging, "-cf", join(staging, "archive.tar"), "backup"]);
      const name = backupName(now);
      const encrypted = join(staging, name);
      await encryptFile(join(staging, "archive.tar"), encrypted, key);
      const sha256 = await sha256File(encrypted);
      const target = join(s.destination, name);
      const partial = `${target}.partial`;
      await copyFile(encrypted, partial, constants.COPYFILE_EXCL);
      const handle = await open(partial, "r+");
      await handle.sync();
      await handle.close();
      await rename(partial, target);
      // Re-read the off-device copy: hash and every authenticated record.
      if ((await sha256File(target)) !== sha256)
        throw new Error("Off-device copy does not match the encrypted backup");
      await decryptFile(target, key);
      const bytes = (await stat(target)).size;
      const pruned = await pruneDestination(s, now);
      await recordRun(
        s,
        "backup",
        { ok: true, detail: { name, bytes, sha256, pruned: pruned.length } },
        now,
      );
      return { name, bytes, sha256, pruned };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordRun(s, "backup", { ok: false, message }, now);
      await notify("VERA Research backup FAILED", message);
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
}

async function pruneDestination(s: HostSettings, now: Date): Promise<string[]> {
  const names = await readdir(s.destination);
  const doomed = backupsToPrune(names, now);
  for (const name of doomed)
    await rm(join(s.destination, name), { force: true });
  // Interrupted copies from earlier runs (only our own exact names).
  for (const name of names) {
    const base = name.endsWith(".partial")
      ? name.slice(0, -".partial".length)
      : "";
    const at = base ? parseBackupName(base) : undefined;
    if (at && now.getTime() - at.getTime() > 86_400_000)
      await rm(join(s.destination, name), { force: true });
  }
  return doomed;
}

export async function latestBackup(
  s: HostSettings,
): Promise<string | undefined> {
  const names = (await readdir(s.destination)).filter((n) =>
    parseBackupName(n),
  );
  names.sort();
  return names.at(-1);
}

function drillAdmin(raw: string) {
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.username ||
    !url.password
  )
    throw new Error(
      "PILOT_DRILL_PG_URL must be a credentialed loopback PostgreSQL URL",
    );
  return url;
}

export type DrillResult = { backup: string; database: string; bytes: number };

/**
 * Restores the newest off-device backup into a brand-new disposable database
 * and object folder, verifies it end to end (#50 checks), then deletes both.
 * Never touches the live pilot database or transcript folder.
 */
export async function runRestoreDrill(
  s: HostSettings,
  now = new Date(),
): Promise<DrillResult> {
  return withLock(s, "drill", async () => {
    const staging = join(
      s.home,
      "staging",
      `drill-${randomBytes(6).toString("hex")}`,
    );
    const database = `vera50_test_drill_${now.toISOString().replace(/\D/gu, "").slice(0, 14)}_${randomBytes(3).toString("hex")}`;
    let admin: Pool | undefined;
    let created = false;
    try {
      if (!s.drillPgUrl)
        throw new Error("PILOT_DRILL_PG_URL is required for restore drills");
      const adminUrl = drillAdmin(s.drillPgUrl);
      if (adminUrl.toString() === new URL(s.pgUrl).toString())
        throw new Error("Restore drills must use a separate PostgreSQL role");
      await assertDestination(s);
      const name = await latestBackup(s);
      if (!name) throw new Error("No backup found at the destination to drill");
      const key = await readKeyFile(s.keyFile);
      await ensurePrivateDir(join(s.home, "staging"));
      await ensurePrivateDir(staging);
      const archive = join(staging, "archive.tar");
      const { plaintextBytes } = await decryptFile(
        join(s.destination, name),
        key,
        archive,
      );
      await ensurePrivateDir(join(staging, "extract"));
      await tar(["-C", join(staging, "extract"), "-xf", archive]);
      admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      await admin.query(`CREATE DATABASE "${database}"`);
      created = true;
      const target = new URL(adminUrl.toString());
      target.pathname = `/${database}`;
      await restorePilot(
        join(staging, "extract", "backup"),
        target.toString(),
        join(staging, "restored-objects"),
      );
      await recordRun(
        s,
        "drill",
        { ok: true, detail: { backup: name, bytes: plaintextBytes } },
        now,
      );
      return { backup: name, database, bytes: plaintextBytes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordRun(s, "drill", { ok: false, message }, now);
      await notify("VERA Research restore drill FAILED", message);
      throw error;
    } finally {
      if (admin) {
        if (created)
          await admin
            .query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
            .catch(() => undefined);
        await admin.end();
      }
      await rm(staging, { recursive: true, force: true });
    }
  });
}

/**
 * Disaster recovery: verifies and restores one encrypted backup into a NEW
 * database (named vera50_test_recovered_*, the #50 restore guard) and a NEW
 * object folder, and keeps both. The operator then renames the database and
 * points PILOT_OBJECT_ROOT at the folder (see mac-pilot-hosting.md).
 */
export async function recoverBackup(
  s: HostSettings,
  backupFile: string,
  objectRoot: string,
  now = new Date(),
): Promise<{ database: string; objectRoot: string }> {
  if (!isAbsolute(backupFile) || !isAbsolute(objectRoot))
    throw new Error("Absolute paths required");
  if (!s.drillPgUrl)
    throw new Error(
      "PILOT_DRILL_PG_URL (a role with CREATEDB) is required to recover",
    );
  const adminUrl = drillAdmin(s.drillPgUrl);
  const key = await readKeyFile(s.keyFile);
  const staging = join(
    s.home,
    "staging",
    `recover-${randomBytes(6).toString("hex")}`,
  );
  const database = `vera50_test_recovered_${now.toISOString().replace(/\D/gu, "").slice(0, 14)}`;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  let created = false;
  let restored = false;
  try {
    await ensurePrivateDir(join(s.home, "staging"));
    await ensurePrivateDir(staging);
    const archive = join(staging, "archive.tar");
    await decryptFile(resolve(backupFile), key, archive);
    await ensurePrivateDir(join(staging, "extract"));
    await tar(["-C", join(staging, "extract"), "-xf", archive]);
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const target = new URL(adminUrl.toString());
    target.pathname = `/${database}`;
    await restorePilot(
      join(staging, "extract", "backup"),
      target.toString(),
      resolve(objectRoot),
    );
    restored = true;
    return { database, objectRoot: resolve(objectRoot) };
  } finally {
    // A failed recovery leaves nothing half-restored behind.
    if (created && !restored)
      await admin
        .query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
        .catch(() => undefined);
    await admin.end();
    await rm(staging, { recursive: true, force: true });
  }
}

// ---------- status ----------

async function httpJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(2_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function tcpOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (value: boolean) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(1_500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export type JobState = {
  loaded: boolean;
  running: boolean;
  runs?: number;
  lastExit?: string;
};

export async function launchdJob(job: PilotJob): Promise<JobState> {
  const uid = process.getuid?.() ?? 0;
  try {
    const { stdout } = await run("launchctl", [
      "print",
      `gui/${uid}/${labelFor(job)}`,
    ]);
    const runs = /\bruns = (\d+)/u.exec(stdout)?.[1];
    const lastExit = /last exit code = ([^\n]+)/u.exec(stdout)?.[1]?.trim();
    return {
      loaded: true,
      running: /\bstate = running\b/u.test(stdout),
      ...(runs ? { runs: Number(runs) } : {}),
      ...(lastExit ? { lastExit } : {}),
    };
  } catch {
    return { loaded: false, running: false };
  }
}

export type PilotStatus = Awaited<ReturnType<typeof collectStatus>>;

export async function collectStatus(
  s: HostSettings,
  now = new Date(),
  jobState: (job: PilotJob) => Promise<JobState> = launchdJob,
) {
  const jobs = Object.fromEntries(
    await Promise.all(
      PILOT_JOBS.map(async (job) => [job, await jobState(job)] as const),
    ),
  ) as Record<PilotJob, JobState>;
  const diagnostics = (await httpJson(
    `http://127.0.0.1:${s.operatorPort}/__operator/diagnostics`,
  ).catch(() => undefined)) as
    | {
        process: { startedAt: string; counts: Record<string, number> };
        maintenance: { writesBlocked: boolean; diskPaused: boolean } | null;
      }
    | undefined;
  const tunnelReady = (await fetch(`http://127.0.0.1:${s.metricsPort}/ready`, {
    signal: AbortSignal.timeout(2_000),
  })
    .then((r) => r.ok)
    .catch(() => false)) as boolean;
  const pgUrl = new URL(s.pgUrl);
  const database = await tcpOpen(
    Number(pgUrl.port || 5432),
    pgUrl.hostname.replace(/^\[|\]$/gu, ""),
  );
  const backup = (await readState<RunState>(stateFile(s, "backup"))) ?? {};
  const drill = (await readState<RunState>(stateFile(s, "drill"))) ?? {};
  const restarts =
    (await readState<{ starts: string[] }>(stateFile(s, "api-starts")))
      ?.starts ?? [];
  const hoursSince = (at?: string) =>
    at ? (now.getTime() - new Date(at).getTime()) / 3_600_000 : undefined;
  const free = await statfs(s.objectRoot)
    .then((info) => Number(info.bavail) * Number(info.bsize))
    .catch(() => undefined);
  const backupAge = hoursSince(backup.lastSuccess?.at);
  const drillAge = hoursSince(drill.lastSuccess?.at);
  const problems: string[] = [];
  if (!diagnostics) problems.push("Research API is not running");
  if (!database) problems.push("PostgreSQL is not reachable");
  if (jobs.tunnel.loaded && !tunnelReady)
    problems.push("Tunnel is loaded but not connected to Cloudflare");
  if (backupAge === undefined || backupAge > BACKUP_STALE_HOURS)
    problems.push(
      backupAge === undefined
        ? "No successful backup yet"
        : `Last good backup is ${Math.round(backupAge)} hours old`,
    );
  if (
    backup.lastFailure &&
    (!backup.lastSuccess || backup.lastFailure.at > backup.lastSuccess.at)
  )
    problems.push(
      `Latest backup FAILED: ${backup.lastFailure.message ?? "unknown error"}`,
    );
  if (drillAge === undefined || drillAge > DRILL_STALE_DAYS * 24)
    problems.push(
      drillAge === undefined
        ? "No successful restore drill yet"
        : `Last good restore drill is ${Math.round(drillAge / 24)} days old`,
    );
  if (
    drill.lastFailure &&
    (!drill.lastSuccess || drill.lastFailure.at > drill.lastSuccess.at)
  )
    problems.push(
      `Latest restore drill FAILED: ${drill.lastFailure.message ?? "unknown error"}`,
    );
  if (diagnostics?.maintenance?.diskPaused)
    problems.push("Saving is paused: disk nearly full");
  if (destinationKind(s.destination).startsWith("WARNING"))
    problems.push(destinationKind(s.destination));
  return {
    checkedAt: now.toISOString(),
    publicOrigin: s.publicOrigin ?? null,
    reachableByFriends:
      Boolean(diagnostics) && jobs.tunnel.running && tunnelReady,
    api: diagnostics
      ? {
          running: true,
          since: diagnostics.process.startedAt,
          counts: diagnostics.process.counts,
        }
      : { running: false },
    database: { reachable: database },
    tunnel: { ...jobs.tunnel, connected: tunnelReady },
    jobs,
    restartsLast24h: restarts.filter((at) => (hoursSince(at) ?? 99) <= 24)
      .length,
    backup: {
      ...backup,
      ageHours: backupAge,
      destination: s.destination,
      destinationKind: destinationKind(s.destination),
    },
    drill: { ...drill, ageHours: drillAge },
    disk: { freeBytes: free ?? null },
    problems,
  };
}

const hours = (value?: number) =>
  value === undefined
    ? "never"
    : value < 1
      ? "under an hour ago"
      : value < 48
        ? `${Math.round(value)} hours ago`
        : `${Math.round(value / 24)} days ago`;

export function formatStatus(status: PilotStatus): string {
  const yes = (v: boolean) => (v ? "yes" : "NO");
  const gb = (bytes: number | null) =>
    bytes === null ? "unknown" : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const counts = status.api.running ? status.api.counts : undefined;
  return [
    `VERA Research pilot — ${status.checkedAt}`,
    `Friends can reach it right now: ${yes(status.reachableByFriends)}${status.publicOrigin ? ` (${status.publicOrigin})` : ""}`,
    "  (No uptime guarantee: while this Mac sleeps, restarts or is offline, friends see a Cloudflare error page.)",
    `Research API running: ${yes(status.api.running)}${status.api.running ? ` since ${status.api.since}` : ""}`,
    `PostgreSQL reachable: ${yes(status.database.reachable)}`,
    `Tunnel: ${status.tunnel.loaded ? (status.tunnel.connected ? "connected" : "loaded, NOT connected") : "disconnected (not loaded)"}`,
    `API restarts in last 24h: ${status.restartsLast24h}`,
    counts
      ? `Since start: ${counts.accessDenied ?? 0} blocked by Access, ${counts.signedOut ?? 0} signed-out requests, ${counts.callbackFailed ?? 0} failed sign-ins, ${counts.forbidden ?? 0} refused, ${counts.serverErrors ?? 0} server errors, ${counts.writesPaused ?? 0} paused saves`
      : "Sign-in/auth counters: unavailable (API not running)",
    `Last good backup: ${hours(status.backup.ageHours)} → ${status.backup.destinationKind}`,
    `Last good restore drill: ${hours(status.drill.ageHours)}`,
    `Free disk: ${gb(status.disk.freeBytes)}`,
    status.problems.length
      ? `\nNeeds attention:\n${status.problems.map((p) => `  • ${p}`).join("\n")}`
      : "\nNothing needs attention.",
  ].join("\n");
}
