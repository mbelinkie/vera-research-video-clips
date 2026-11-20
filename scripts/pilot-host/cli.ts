/**
 * `npm run pilot -- <command>`: run and operate the friends-only Mac pilot (#53).
 *
 * Every command reads its settings from the private env file named by
 * PILOT_ENV_FILE (default: ~/Library/Application Support/VERA Research Pilot/pilot.env).
 * See docs/operations/mac-pilot-hosting.md.
 */
import { execFile, spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
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
function assertFriendFacing(env: Record<string, string>) {
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
  return config;
}

async function runApi(): Promise<number> {
  const { env, settings } = await loadEnv();
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: homedir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ...env,
  };
  assertFriendFacing(childEnv);
  await access(join(repoRoot, "dist/web/index.html")).catch(() => {
    throw new Error(
      "Built website missing: run `npm run build:web` before starting the pilot",
    );
  });
  await ensurePrivateDir(join(settings.home, "logs"));
  const startsFile = join(settings.home, "state", "api-starts.json");
  const starts =
    (await readState<{ starts: string[] }>(startsFile))?.starts ?? [];
  await writeState(startsFile, {
    starts: [...starts, new Date().toISOString()].slice(-50),
  });
  const log = new RotatingLog(join(settings.home, "logs", "api.log"));
  await log.write(
    `[${new Date().toISOString()}] starting Research API (pid ${process.pid})\n`,
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/cloud-api/src/main.ts"],
    {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk: Buffer) => void log.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => void log.write(chunk));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    // Clean shutdown gets 30s (launchd ExitTimeOut is 40s) before SIGKILL.
    setTimeout(() => child.kill("SIGKILL"), 30_000).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const code = await new Promise<number>((done) =>
    child.once("exit", (exitCode, signal) =>
      done(exitCode ?? (signal ? 1 : 0)),
    ),
  );
  await log.write(
    `[${new Date().toISOString()}] Research API exited (${code}${stopping ? ", requested" : ""})\n`,
  );
  return stopping ? 0 : code || 1;
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
async function unload(job: PilotJob) {
  await launchctl(["bootout", `${domain()}/${labelFor(job)}`]).catch(
    () => undefined,
  );
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
    tunnelConfig: join(settings.home, "cloudflared.yml"),
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

async function tunnelConfig() {
  const { env, settings } = await loadEnv();
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
  await writeFile(path, text, { mode: 0o600 });
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
    case "connect":
      await load("tunnel");
      process.stdout.write(
        "Tunnel started: invited friends can reach Research while this Mac is awake.\n",
      );
      return 0;
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
