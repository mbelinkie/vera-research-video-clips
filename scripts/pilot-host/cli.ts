/**
 * `npm run pilot -- <command>`: run and operate the friends-only Mac pilot (#53).
 *
 * Every command reads its settings from the private env file named by
 * PILOT_ENV_FILE (default: ~/Library/Application Support/VERA Research Pilot/pilot.env).
 * See docs/operations/mac-pilot-hosting.md.
 */
import { execFile, spawn } from "node:child_process";
import { access, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadConfig } from "../../packages/config/src/index.ts";
import { createKeyFile, keyId, readKeyFile } from "./backup-crypto.ts";
import {
  ensurePrivateDir,
  readPrivateEnvFile,
  readState,
  RotatingLog,
  writeState,
} from "./files.ts";
import { labelFor, renderPlist, type PilotJob } from "./launchd.ts";
import {
  collectStatus,
  destinationKind,
  formatStatus,
  clearStaleBackupGate,
  hostSettings,
  recoverBackup,
  runBackup,
  runRestoreDrill,
} from "./operations.ts";
import { renderTunnelConfig } from "./tunnel.ts";

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultEnvFile = join(
  homedir(),
  "Library/Application Support/VERA Research Pilot/pilot.env",
);
const agentsDir = join(homedir(), "Library/LaunchAgents");
const DEV_API_PORT = 43_111;

async function loadEnv() {
  const envFile = process.env.PILOT_ENV_FILE ?? defaultEnvFile;
  const fileEnv = await readPrivateEnvFile(envFile);
  const env: Record<string, string> = {
    PILOT_HOME: dirname(envFile),
    ...fileEnv,
  };
  // pg_dump/pg_restore are invoked by name; put the configured tools first.
  if (env.PILOT_PG_BIN)
    process.env.PATH = `${env.PILOT_PG_BIN}:${process.env.PATH ?? ""}`;
  return { envFile, env, settings: hostSettings(env) };
}

/** The friend-facing API must be production, Mac pilot, browser auth and Access. */
export function assertFriendFacing(env: Record<string, string>) {
  const config = loadConfig(env);
  if (
    config.nodeEnv !== "production" ||
    config.runtimeMode !== "mac-pilot" ||
    config.cloudAuthMode !== "browser" ||
    !config.cloudflareAccessAud
  )
    throw new Error(
      "The pilot env file must select NODE_ENV=production, VERA_RUNTIME_MODE=mac-pilot, CLOUD_AUTH_MODE=browser and Cloudflare Access",
    );
  // The development API defaults to 43111 and trusts bearer identities. The
  // tunnel must point at a port a development server never uses.
  if (config.cloudApiPort === DEV_API_PORT)
    throw new Error(
      `Set CLOUD_API_PORT to a dedicated pilot port (for example 43211), not the development default ${DEV_API_PORT}`,
    );
  return config;
}

/**
 * Runs one child under this process, pipes its output into a size-capped
 * rotating log, forwards SIGTERM for a clean shutdown and exits non-zero on
 * an unrequested exit so launchd restarts it.
 */
async function supervise(options: {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  log: RotatingLog;
  /** Optional watchdog: return false to stop the child (exit 1). */
  healthy?: () => Promise<boolean>;
}): Promise<number> {
  const { log } = options;
  await log.write(
    `[${new Date().toISOString()}] starting ${options.name} (supervisor pid ${process.pid})\n`,
  );
  const child = spawn(options.command, options.args, {
    cwd: repoRoot,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => void log.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => void log.write(chunk));
  let stopping = false;
  let unhealthy = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    // Clean shutdown gets 30s (launchd ExitTimeOut is 40s) before SIGKILL.
    setTimeout(() => child.kill("SIGKILL"), 30_000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  let failures = 0;
  const watchdog = options.healthy
    ? setInterval(() => {
        void options.healthy!().then((ok) => {
          failures = ok ? 0 : failures + 1;
          if (failures >= 3 && !stopping) {
            unhealthy = true;
            void log.write(
              `[${new Date().toISOString()}] ${options.name}: health check failed 3 times; stopping\n`,
            );
            stop();
          }
        });
      }, 20_000)
    : undefined;
  const code = await new Promise<number>((done) => {
    child.once("error", () => done(1));
    child.once("exit", (exitCode, signal) =>
      done(exitCode ?? (signal ? 1 : 0)),
    );
  });
  if (watchdog) clearInterval(watchdog);
  await log.write(
    `[${new Date().toISOString()}] ${options.name} exited (${code}${stopping && !unhealthy ? ", requested" : ""})\n`,
  );
  return stopping && !unhealthy ? 0 : code || 1;
}

const childEnvFrom = (env: Record<string, string>): Record<string, string> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: homedir(),
  LANG: process.env.LANG ?? "en_US.UTF-8",
  ...env,
});

async function runApi(): Promise<number> {
  const { env, settings } = await loadEnv();
  const childEnv = childEnvFrom(env);
  assertFriendFacing(childEnv);
  await access(join(repoRoot, "dist/web/index.html")).catch(() => {
    throw new Error(
      "Built website missing: run `npm run build:web` before starting the pilot",
    );
  });
  await ensurePrivateDir(join(settings.home, "logs"));
  const log = new RotatingLog(join(settings.home, "logs", "api.log"));
  await clearStaleBackupGate(settings, (line) => log.write(line));
  const startsFile = join(settings.home, "state", "api-starts.json");
  const starts =
    (await readState<{ starts: string[] }>(startsFile))?.starts ?? [];
  await writeState(startsFile, {
    starts: [...starts, new Date().toISOString()].slice(-50),
  });
  // A backup killed while the API keeps running would otherwise leave saving
  // paused until the next restart. Re-check every minute; only a gate whose
  // recorded owner is provably gone is ever removed.
  const gateSweep = setInterval(() => {
    void clearStaleBackupGate(settings, (line) => log.write(line), {
      waitMs: 0,
    }).catch(() => undefined);
  }, 60_000);
  try {
    return await supervise({
      name: "Research API",
      command: process.execPath,
      args: ["--import", "tsx", "apps/cloud-api/src/main.ts"],
      env: childEnv,
      log,
    });
  } finally {
    clearInterval(gateSweep);
  }
}

/**
 * True only when the friends-only pilot API (not a development server) is
 * the one answering on this Mac: its loopback operator port is up and reports
 * the expected public origin.
 */
async function pilotApiIsOrigin(
  operatorPort: number,
  publicOrigin: string,
  publicPort: number,
): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${operatorPort}/__operator/diagnostics`,
      { signal: AbortSignal.timeout(2_000), redirect: "error" },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      publicOrigin?: unknown;
      publicPort?: unknown;
    };
    // Same origin AND the same port the tunnel config points at.
    return body.publicOrigin === publicOrigin && body.publicPort === publicPort;
  } catch {
    return false;
  }
}

async function runTunnel(): Promise<number> {
  const { env, settings } = await loadEnv();
  const config = assertFriendFacing(childEnvFrom(env));
  const cloudflared = env.PILOT_CLOUDFLARED ?? process.env.PILOT_CLOUDFLARED;
  if (!cloudflared?.startsWith("/"))
    throw new Error(
      "PILOT_CLOUDFLARED must be the absolute path to cloudflared",
    );
  await ensurePrivateDir(join(settings.home, "logs"));
  const log = new RotatingLog(join(settings.home, "logs", "tunnel.log"));
  const isOrigin = () =>
    pilotApiIsOrigin(
      config.operatorPort,
      config.browserPublicOrigin!,
      config.cloudApiPort,
    );
  // Never forward friends to whatever happens to hold the port.
  if (!(await isOrigin())) {
    await log.write(
      `[${new Date().toISOString()}] tunnel not started: the pilot API is not running on this Mac\n`,
    );
    return 1; // launchd retries after its throttle interval
  }
  return supervise({
    name: "Cloudflare tunnel",
    command: cloudflared,
    args: [
      "tunnel",
      "--no-autoupdate",
      "--config",
      await writeTunnelConfig(env, settings),
      "run",
    ],
    env: childEnvFrom({}),
    log,
    healthy: isOrigin,
  });
}

async function launchctl(args: string[]) {
  await run("launchctl", args);
}
const domain = () => `gui/${process.getuid?.() ?? 0}`;
const plistPath = (job: PilotJob) => join(agentsDir, `${labelFor(job)}.plist`);
async function load(job: PilotJob) {
  await launchctl(["bootstrap", domain(), plistPath(job)]).catch(
    (error: Error) => {
      if (!/already|service already loaded|37:/iu.test(error.message))
        throw error;
    },
  );
}
async function isLoaded(job: PilotJob): Promise<boolean> {
  return run("launchctl", ["print", `${domain()}/${labelFor(job)}`]).then(
    () => true,
    () => false,
  );
}
/** Stops a job and proves it is gone; only "was not loaded" is tolerated. */
async function unload(job: PilotJob) {
  try {
    await launchctl(["bootout", `${domain()}/${labelFor(job)}`]);
  } catch (error) {
    const text = String((error as { stderr?: unknown }).stderr ?? error);
    if (
      !/No such process|Could not find|not find specified service/iu.test(text)
    )
      throw new Error(`Could not stop ${labelFor(job)}: ${text.trim()}`);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await isLoaded(job))) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`${labelFor(job)} is still loaded; it may still be running`);
}

async function install(flags: Set<string>) {
  const { envFile, env, settings } = await loadEnv();
  assertFriendFacing({ PATH: process.env.PATH ?? "", ...env });
  const cloudflared =
    env.PILOT_CLOUDFLARED ??
    (await run("/usr/bin/which", ["cloudflared"])
      .then((r) => r.stdout.trim())
      .catch(() => ""));
  if (!cloudflared)
    throw new Error(
      "cloudflared not found: install it or set PILOT_CLOUDFLARED",
    );
  const launchd = {
    nodePath: process.execPath,
    repoRoot,
    envFile,
    logDir: join(settings.home, "logs"),
    path: [
      env.PILOT_PG_BIN,
      dirname(process.execPath),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]
      .filter(Boolean)
      .join(":"),
    cloudflaredPath: cloudflared,
    backupHour: Number(env.PILOT_BACKUP_HOUR ?? 3),
    drillWeekday: Number(env.PILOT_DRILL_WEEKDAY ?? 0),
  };
  await ensurePrivateDir(launchd.logDir);
  for (const job of ["api", "tunnel", "backup", "drill"] as const) {
    const plist = renderPlist(job, launchd);
    if (flags.has("--dry-run")) {
      process.stdout.write(`--- ${plistPath(job)}\n${plist}`);
      continue;
    }
    await writeFile(plistPath(job), plist, { mode: 0o644 });
  }
  if (flags.has("--dry-run")) return;
  process.stdout.write(`Wrote LaunchAgents to ${agentsDir}.\n`);
  if (flags.has("--load")) {
    for (const job of ["api", "backup", "drill"] as const) await load(job);
    process.stdout.write(
      "Started the Research API and scheduled backups/drills on this Mac only.\nFriends cannot reach it until you run `npm run pilot -- connect`.\n",
    );
  }
}

/**
 * Renders cloudflared.yml from the validated env. run-tunnel calls this on
 * every start, so the tunnel can never follow a stale saved file to a port
 * other than the pilot's own.
 */
async function writeTunnelConfig(
  env: Record<string, string>,
  settings: { home: string; metricsPort: number },
): Promise<string> {
  const config = assertFriendFacing({ PATH: process.env.PATH ?? "", ...env });
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required in the pilot env file`);
    return value;
  };
  const text = renderTunnelConfig({
    tunnelId: need("PILOT_TUNNEL_ID"),
    credentialsFile: need("PILOT_TUNNEL_CREDENTIALS"),
    hostname: new URL(config.browserPublicOrigin!).hostname,
    originPort: config.cloudApiPort,
    operatorPort: config.operatorPort,
    metricsPort: settings.metricsPort,
    accessTeamName: new URL(config.cloudflareAccessTeamDomain!).hostname.split(
      ".",
    )[0]!,
    accessAud: config.cloudflareAccessAud!,
  });
  const path = join(settings.home, "cloudflared.yml");
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, path);
  return path;
}

async function tunnelConfig() {
  const { env, settings } = await loadEnv();
  const path = await writeTunnelConfig(env, settings);
  process.stdout.write(`Wrote ${path}\n`);
}

async function backupKey(action: string | undefined) {
  const { settings } = await loadEnv();
  if (action === "create") {
    await ensurePrivateDir(dirname(settings.keyFile));
    await createKeyFile(settings.keyFile);
    process.stdout.write(
      `Created ${settings.keyFile}.\nNow run \`npm run pilot -- backup-key show\` and save the key in your password manager.\nWithout it, no backup can ever be restored if this Mac is lost.\n`,
    );
  } else if (action === "show") {
    const key = await readKeyFile(settings.keyFile);
    process.stdout.write(
      `Backup key (store in your password manager, never in the backup folder):\n${key.toString("base64")}\nFingerprint: ${keyId(key).toString("hex")}\n`,
    );
  } else if (action === "fingerprint") {
    process.stdout.write(
      `${keyId(await readKeyFile(settings.keyFile)).toString("hex")}\n`,
    );
  } else throw new Error("Usage: backup-key create|show|fingerprint");
}

async function check() {
  const { env, settings } = await loadEnv();
  const results: Array<[string, () => Promise<unknown>]> = [
    [
      "Pilot settings are valid (production, Mac pilot, browser sign-in, Access)",
      async () => assertFriendFacing({ PATH: process.env.PATH ?? "", ...env }),
    ],
    ["Website is built", () => access(join(repoRoot, "dist/web/index.html"))],
    [
      "pg_dump and pg_restore are available",
      () =>
        run("pg_dump", ["--version"]).then(() =>
          run("pg_restore", ["--version"]),
        ),
    ],
    ["Backup key is private and valid", () => readKeyFile(settings.keyFile)],
    [
      `Backup destination exists (${destinationKind(settings.destination)})`,
      () => access(settings.destination),
    ],
    [
      "Restore drill database role is configured",
      async () => {
        if (!settings.drillPgUrl) throw new Error("PILOT_DRILL_PG_URL missing");
      },
    ],
  ];
  let failed = 0;
  for (const [label, test] of results) {
    try {
      await test();
      process.stdout.write(`ok    ${label}\n`);
    } catch (error) {
      failed++;
      process.stdout.write(
        `FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  return failed === 0 ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
  switch (command) {
    case "run-api":
      return runApi();
    case "run-tunnel":
      return runTunnel();
    case "backup": {
      const { settings } = await loadEnv();
      const result = await runBackup(settings, new Date(), {
        offline: flags.has("--offline"),
      });
      process.stdout.write(
        `Backup ${result.name} (${result.bytes} bytes) verified at ${settings.destination}; pruned ${result.pruned.length}.\n`,
      );
      return 0;
    }
    case "drill": {
      const { settings } = await loadEnv();
      const result = await runRestoreDrill(settings);
      process.stdout.write(
        `Restore drill passed for ${result.backup}; disposable database removed.\n`,
      );
      return 0;
    }
    case "recover": {
      const [file, objectRoot] = rest.filter((arg) => !arg.startsWith("--"));
      if (!file || !objectRoot)
        throw new Error(
          "Usage: recover /absolute/backup.verabk /absolute/new-empty-object-folder",
        );
      const { settings } = await loadEnv();
      const result = await recoverBackup(settings, file, objectRoot);
      process.stdout.write(
        `Recovered and verified into database ${result.database} and ${result.objectRoot}.\nFollow "Disaster recovery" in docs/operations/mac-pilot-hosting.md to switch over.\n`,
      );
      return 0;
    }
    case "status": {
      const { settings } = await loadEnv();
      const status = await collectStatus(settings);
      process.stdout.write(
        flags.has("--json")
          ? `${JSON.stringify(status, null, 2)}\n`
          : `${formatStatus(status)}\n`,
      );
      return status.problems.length === 0 ? 0 : 2;
    }
    case "check":
      return check();
    case "install":
      await install(flags);
      return 0;
    case "tunnel-config":
      await tunnelConfig();
      return 0;
    case "backup-key":
      await backupKey(rest[0]);
      return 0;
    case "connect": {
      const { env } = await loadEnv();
      const config = assertFriendFacing(childEnvFrom(env));
      if (
        !(await pilotApiIsOrigin(
          config.operatorPort,
          config.browserPublicOrigin!,
          config.cloudApiPort,
        ))
      )
        throw new Error(
          "The pilot API is not running on this Mac; run `npm run pilot -- start` first",
        );
      await load("tunnel");
      process.stdout.write(
        "Tunnel started: invited friends can reach Research while this Mac is awake.\n",
      );
      return 0;
    }
    case "disconnect":
      await unload("tunnel");
      process.stdout.write(
        "Tunnel stopped: nobody outside this Mac can reach Research now.\n",
      );
      return 0;
    case "start":
      await load("api");
      process.stdout.write(
        "Research API started on this Mac (friends still need `connect`).\n",
      );
      return 0;
    case "stop":
      await unload("tunnel");
      await unload("api");
      process.stdout.write(
        "Tunnel and Research API stopped. Backups stay scheduled.\n",
      );
      return 0;
    default:
      process.stdout.write(
        "Usage: npm run pilot -- <check|status [--json]|backup|drill|recover FILE DIR|connect|disconnect|start|stop|install [--load|--dry-run]|tunnel-config|backup-key create|show|fingerprint>\n",
      );
      return command ? 1 : 0;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    async (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
