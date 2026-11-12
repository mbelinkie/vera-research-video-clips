/** One-process supervisor for an isolated, loopback-only personal Research instance. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "@research-video/config";

type Identity = {
  userId: string;
  externalSubject: string;
  signingSecret: string;
};
const identityPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function assertPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error(
      "Managed Research requires private, non-symlink directories (0700).",
    );
}

async function readIdentity(path: string): Promise<Identity> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0)
      throw new Error(
        "Managed Research identity must be a private regular file (0600).",
      );
    const parsed: unknown = JSON.parse(await handle.readFile("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("userId" in parsed) ||
      typeof parsed.userId !== "string" ||
      !identityPattern.test(parsed.userId) ||
      !("externalSubject" in parsed) ||
      typeof parsed.externalSubject !== "string" ||
      !/^managed:[0-9a-f-]{36}$/iu.test(parsed.externalSubject) ||
      !("signingSecret" in parsed) ||
      typeof parsed.signingSecret !== "string" ||
      !/^[0-9a-f]{96}$/iu.test(parsed.signingSecret)
    )
      throw new Error("Invalid private Managed Research identity file.");
    return parsed as Identity;
  } finally {
    await handle.close();
  }
}

async function stableIdentity(path: string): Promise<Identity> {
  const identityPath = join(path, "identity.json");
  const generated: Identity = {
    userId: randomUUID(),
    externalSubject: `managed:${randomUUID()}`,
    signingSecret: randomBytes(48).toString("hex"),
  };
  // Exclusive creation: never replace an existing user's private credentials.
  try {
    const handle = await open(
      identityPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(generated));
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readIdentity(identityPath);
}

/** Safe to call in tests; does not spawn a process or access a user's default data. */
export async function managedResearchEnvironment(
  source: NodeJS.ProcessEnv,
  root = resolve(source.DATA_DIR ?? join(homedir(), ".vera-research-managed")),
): Promise<NodeJS.ProcessEnv> {
  const incompatible: Record<string, string> = {
    NODE_ENV: "development",
    VERA_RUNTIME_MODE: "managed-local",
    CLOUD_AUTH_MODE: "development",
    DATABASE_MODE: "pglite",
    OBJECT_STORE_MODE: "local",
    QUEUE_MODE: "memory",
    LOCAL_AGENT_HOST: "127.0.0.1",
    CLOUD_API_HOST: "127.0.0.1",
    WORKER_MODE: "continuous",
    WORKER_EXECUTION_LOCATION: "local",
  };
  for (const [key, required] of Object.entries(incompatible)) {
    if (source[key] !== undefined && source[key] !== required)
      throw new Error(`Managed Research refuses incompatible ${key}.`);
  }
  if (
    Object.keys(source).some(
      (key) => key.startsWith("VITE_") && key !== "VITE_MANAGED_RESEARCH",
    )
  )
    throw new Error(
      "Managed Research refuses ambient VITE_ browser variables.",
    );
  if (source.VITE_MANAGED_RESEARCH && source.VITE_MANAGED_RESEARCH !== "true")
    throw new Error("Managed Research refuses a conflicting browser mode.");
  const dataDir = resolve(root);
  await assertPrivateDirectory(dataDir);
  const objectRoot = join(dataDir, "transcript-objects");
  await assertPrivateDirectory(objectRoot);
  const identity = await stableIdentity(dataDir);
  const authorization = `Bearer ${identity.userId}|${identity.externalSubject}`;
  if (
    source.WORKER_AUTHORIZATION &&
    source.WORKER_AUTHORIZATION !== authorization
  )
    throw new Error("Managed Research refuses a different worker credential.");
  if (
    source.MANAGED_RESEARCH_AUTHORIZATION &&
    source.MANAGED_RESEARCH_AUTHORIZATION !== authorization
  )
    throw new Error("Managed Research refuses a different proxy credential.");
  if (
    source.PILOT_OBJECT_ROOT &&
    resolve(source.PILOT_OBJECT_ROOT) !== objectRoot
  )
    throw new Error("Managed Research refuses an external object root.");
  if (
    source.LOCAL_UPLOAD_SIGNING_SECRET &&
    source.LOCAL_UPLOAD_SIGNING_SECRET !== identity.signingSecret
  )
    throw new Error("Managed Research refuses a different signing secret.");
  const env = {
    ...source,
    ...incompatible,
    DATA_DIR: dataDir,
    PILOT_OBJECT_ROOT: objectRoot,
    WORKER_AUTHORIZATION: authorization,
    MANAGED_RESEARCH_AUTHORIZATION: authorization,
    MANAGED_RESEARCH_CSRF: randomBytes(32).toString("hex"),
    LOCAL_UPLOAD_SIGNING_SECRET: identity.signingSecret,
    VITE_MANAGED_RESEARCH: "true",
  };
  loadConfig(env); // Check all provider, port and local-security invariants before starting children.
  return env;
}

type Service = {
  name: string;
  child: ChildProcess;
  exited: Promise<number | null>;
};

async function assertLoopbackPortsAvailable(ports: number[]): Promise<void> {
  if (new Set(ports).size !== ports.length)
    throw new Error("Managed Research service ports must be distinct.");
  for (const port of ports) {
    await new Promise<void>((resolveReady, reject) => {
      const probe = createServer();
      probe.once("error", () =>
        reject(new Error(`Managed Research port ${port} is unavailable.`)),
      );
      probe.listen(port, "127.0.0.1", () => {
        probe.close((error) => (error ? reject(error) : resolveReady()));
      });
    });
  }
}

async function waitForHealth(url: string, service: Service) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null || service.child.signalCode !== null)
      throw new Error(`${service.name} exited before becoming ready.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      /* Service has not bound yet. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${service.name} did not become ready on its loopback port.`);
}

export async function startResearch(): Promise<void> {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env = await managedResearchEnvironment(process.env);
  const config = loadConfig(env);
  await assertLoopbackPortsAvailable([
    config.cloudApiPort,
    config.localAgentPort,
    config.webPort,
  ]);
  const services: Service[] = [];
  let stopping = false;
  let finish!: () => void;
  const done = new Promise<void>((resolveDone) => {
    finish = resolveDone;
  });
  const spawnService = (name: string, args: string[]) => {
    const child = spawn(process.execPath, args, {
      cwd: repo,
      env,
      shell: false,
      stdio: "inherit",
    });
    const exited = new Promise<number | null>((resolveExit) => {
      child.once("error", () => resolveExit(null));
      child.once("exit", (code) => resolveExit(code));
    });
    const service = { name, child, exited };
    services.push(service);
    void exited.then((code) => {
      if (!stopping) {
        process.stderr.write(
          `${name} stopped unexpectedly (${code ?? "signal"}).\n`,
        );
        process.exitCode = 1;
        void stop();
      }
    });
    return service;
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    // Stop claiming first. The worker handles its own abort, lease and scratch cleanup.
    for (const service of [...services].reverse()) {
      if (service.child.exitCode === null && service.child.signalCode === null)
        service.child.kill("SIGTERM");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        service.exited,
        new Promise<void>((resolveWait) => {
          timeout = setTimeout(
            resolveWait,
            service.name === "worker" ? 30_000 : 5_000,
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (service.child.exitCode === null && service.child.signalCode === null)
        service.child.kill("SIGKILL"); // only a child created by this launcher
    }
    finish();
  };
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  try {
    const cloud = spawnService("cloud API", [
      "--import",
      "tsx",
      "apps/cloud-api/src/main.ts",
    ]);
    await waitForHealth(
      `http://127.0.0.1:${config.cloudApiPort}/health`,
      cloud,
    );
    if (stopping) return;
    const local = spawnService("local agent", [
      "--import",
      "tsx",
      "apps/local-agent/src/main.ts",
    ]);
    await waitForHealth(
      `http://127.0.0.1:${config.localAgentPort}/health`,
      local,
    );
    if (stopping) return;
    spawnService("worker", ["--import", "tsx", "apps/worker/src/main.ts"]);
    const web = spawnService("web", [
      join(repo, "node_modules/vite/bin/vite.js"),
      "--config",
      "apps/web/vite.config.ts",
    ]);
    await waitForHealth(`http://127.0.0.1:${config.webPort}/`, web);
    if (!stopping)
      process.stdout.write(
        `Research running at http://127.0.0.1:${config.webPort}/ (Ctrl+C to stop).\n`,
      );
    await done;
  } catch (error) {
    process.exitCode = 1;
    await stop();
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await startResearch();
}
