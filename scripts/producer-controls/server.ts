/**
 * Producer Controls (#107): a page on this Mac only, for setting up,
 * operating and accepting the friends-only Research pilot without Terminal.
 *
 *   npm run controls                 # live, opens the browser
 *   npm run controls -- --demo       # example data, changes nothing
 *   npm run controls -- install-app  # one-time: ~/Applications launcher
 *
 * It runs separately from the Research API and the tunnel, so it keeps
 * working when either is down. It listens on 127.0.0.1 only, refuses any
 * request that came through a proxy or tunnel, checks the Host header
 * against DNS rebinding, and requires a per-launch token on every API call.
 */
import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  acceptanceComment,
  itemViews,
  progress,
  STAGES,
} from "./acceptance.ts";
import { DemoProvider, SCENARIOS, type ScenarioId } from "./demo.ts";
import {
  LiveProvider,
  repoRoot,
  type ActionResult,
  type Provider,
} from "./live.ts";
import {
  ACTIONS,
  ago,
  diagnosticSummary,
  overview,
  setupSteps,
  type ActionId,
} from "./model.ts";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 43_115;

/** Requests that came through Cloudflare or any proxy are never served. */
const PROXY_HEADERS = [
  "cf-connecting-ip",
  "cf-ray",
  "cf-access-jwt-assertion",
  "cf-ipcountry",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
  "via",
];

type Operation = {
  id: string;
  action: ActionId;
  label: string;
  startedAt: string;
  finishedAt?: string;
  state: "running" | "succeeded" | "failed";
  message?: string;
  output?: string;
};

export type ControlsServer = {
  server: Server;
  token: string;
  port: number;
  provider: Provider;
  close(): Promise<void>;
};

const send = (
  res: ServerResponse,
  status: number,
  body: string,
  type = "application/json; charset=utf-8",
) => {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(body);
};
const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value));

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export async function startControls(options: {
  provider: Provider;
  port?: number;
  token?: string;
}): Promise<ControlsServer> {
  const { provider } = options;
  const token = options.token ?? randomBytes(24).toString("base64url");
  const tokenBuffer = Buffer.from(token);
  let port = options.port ?? DEFAULT_PORT;
  let operation: Operation | undefined;
  const history: Operation[] = [];

  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = () => allowedHosts().map((host) => `http://${host}`);
  const tokenOk = (req: IncomingMessage) => {
    const given = Buffer.from(String(req.headers["x-controls-token"] ?? ""));
    return (
      given.length === tokenBuffer.length && timingSafeEqual(given, tokenBuffer)
    );
  };

  async function statePayload() {
    const now = new Date();
    const [snapshot, controls] = await Promise.all([
      provider.snapshot(),
      provider.state(),
    ]);
    const views = itemViews(snapshot, controls.acceptance, now);
    return {
      mode: provider.mode,
      snapshot,
      overview: overview(snapshot, now),
      steps: setupSteps(snapshot, now),
      ages: {
        backup: ago(snapshot.backup.lastSuccessAt, now),
        drill: ago(snapshot.recovery.lastDrillAt, now),
        edge: ago(snapshot.edge.checkedAt, now),
      },
      actions: Object.fromEntries(
        Object.entries(ACTIONS).map(([id, action]) => [id, action.label]),
      ),
      acceptance: {
        stages: STAGES.map((stage) => ({
          ...stage,
          items: stage.items.map((item) => views.find((v) => v.id === item.id)),
        })),
        record: controls.acceptance,
        progress: progress(controls.acceptance),
        comment: acceptanceComment(snapshot, controls.acceptance),
      },
      operation,
      history: history.slice(-12).reverse(),
      ...(provider instanceof DemoProvider
        ? { demo: { scenarios: SCENARIOS, current: provider.scenarioId } }
        : {}),
    };
  }

  function start(action: ActionId, input: Record<string, unknown>) {
    const op: Operation = {
      id: randomBytes(6).toString("hex"),
      action,
      label: ACTIONS[action].label,
      startedAt: new Date().toISOString(),
      state: "running",
    };
    operation = op;
    void provider
      .act(action, input)
      .catch((error: unknown): ActionResult => ({
        ok: false,
        message: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
      }))
      .then((result) => {
        Object.assign(op, {
          state: result.ok ? "succeeded" : "failed",
          finishedAt: new Date().toISOString(),
          message: result.message,
          ...(result.output ? { output: result.output } : {}),
        });
        history.push(op);
        if (history.length > 50) history.shift();
      });
    return op;
  }

  const server = createServer((req, res) => {
    void (async () => {
      // Local-only boundary.
      if (PROXY_HEADERS.some((name) => req.headers[name] !== undefined))
        return send(
          res,
          403,
          "Producer Controls only answers on this Mac.",
          "text/plain",
        );
      if (!allowedHosts().includes(String(req.headers.host ?? "")))
        return send(res, 421, "Unexpected host.", "text/plain");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/healthz")
        return send(res, 200, "ok", "text/plain");
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        const html = await readFile(join(here, "public/index.html"), "utf8");
        return send(
          res,
          200,
          html.replace("__CONTROLS_TOKEN__", token),
          "text/html; charset=utf-8",
        );
      }
      if (
        req.method === "GET" &&
        (path === "/app.js" || path === "/styles.css")
      )
        return send(
          res,
          200,
          await readFile(join(here, "public", path.slice(1)), "utf8"),
          path.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
        );

      if (!path.startsWith("/api/"))
        return send(res, 404, "Not found.", "text/plain");
      if (!tokenOk(req))
        return json(res, 403, { message: "Reload Producer Controls." });
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigins().includes(String(origin)))
        return json(res, 403, { message: "Wrong origin." });

      if (req.method === "GET" && path === "/api/state")
        return json(res, 200, await statePayload());
      if (req.method === "GET" && path === "/api/diagnostics")
        return send(
          res,
          200,
          diagnosticSummary(await provider.snapshot()),
          "text/plain; charset=utf-8",
        );
      if (req.method !== "POST")
        return json(res, 405, { message: "Not allowed." });
      if (
        !String(req.headers["content-type"] ?? "").startsWith(
          "application/json",
        )
      )
        return json(res, 415, { message: "JSON only." });
      const input = await body(req);

      if (path === "/api/action") {
        const action = String(input.action ?? "") as ActionId;
        if (!(action in ACTIONS))
          return json(res, 400, { message: "Unknown action." });
        if (operation?.state === "running")
          return json(res, 409, {
            message: `Wait for “${operation.label}” to finish.`,
          });
        const params =
          input.input && typeof input.input === "object"
            ? (input.input as Record<string, unknown>)
            : {};
        return json(res, 202, { operation: start(action, params) });
      }
      if (path === "/api/acceptance") {
        const op = String(input.op ?? "");
        if (!["record", "undo", "sign-off", "restart"].includes(op))
          return json(res, 400, { message: "Unknown step." });
        const result = await provider.acceptance(
          op as "record" | "undo" | "sign-off" | "restart",
          input,
        );
        return json(res, result.ok ? 200 : 409, result);
      }
      if (path === "/api/demo" && provider instanceof DemoProvider) {
        const scenario = String(input.scenario ?? "");
        if (scenario in SCENARIOS) provider.setScenario(scenario as ScenarioId);
        if (input.simulate === "sleep" || input.simulate === "wake")
          provider.simulate(input.simulate);
        operation = undefined;
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { message: "Not found." });
    })().catch(() => {
      if (!res.headersSent)
        json(res, 500, {
          message: "Producer Controls hit an error. Try again.",
        });
    });
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") port = address.port;
      done();
    });
  });
  return {
    server,
    token,
    get port() {
      return port;
    },
    provider,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

// ---------------------------------------------------------------------------
// One-time launcher: an app in ~/Applications, so the Producer never needs
// Terminal again. It starts the panel if it isn't running, then opens it.

export function launcherScript(options: {
  repoRoot: string;
  nodePath: string;
  port: number;
  logFile: string;
}): string {
  const q = (value: string) => JSON.stringify(value);
  const url = `http://127.0.0.1:${options.port}/`;
  return [
    `set repoPath to ${q(options.repoRoot)}`,
    `set nodePath to ${q(options.nodePath)}`,
    `set logPath to ${q(options.logFile)}`,
    "try",
    `  do shell script "/usr/bin/curl -fsS --max-time 1 ${url}healthz"`,
    "on error",
    // Only the server is backgrounded, with every stream detached, so
    // `do shell script` returns at once instead of waiting on the server.
    `  do shell script "cd " & quoted form of repoPath & " || exit 1; /usr/bin/nohup " & quoted form of nodePath & " --import tsx scripts/producer-controls/server.ts --no-open < /dev/null >> " & quoted form of logPath & " 2>&1 &"`,
    "  repeat 20 times",
    "    delay 0.5",
    "    try",
    `      do shell script "/usr/bin/curl -fsS --max-time 1 ${url}healthz"`,
    "      exit repeat",
    "    end try",
    "  end repeat",
    "end try",
    `open location ${q(url)}`,
  ].join("\n");
}

async function installApp(port: number) {
  const apps = join(homedir(), "Applications");
  const target = join(apps, "VERA Producer Controls.app");
  const logDir = join(homedir(), "Library/Logs");
  await mkdir(apps, { recursive: true });
  await mkdir(logDir, { recursive: true });
  const script = launcherScript({
    repoRoot,
    nodePath: process.execPath,
    port,
    logFile: join(logDir, "VERA Producer Controls.log"),
  });
  await rm(target, { recursive: true, force: true });
  await run("/usr/bin/osacompile", ["-o", target, "-e", script]);
  process.stdout.write(
    `Installed ${target}.\nOpen it from Applications (or drag it to the Dock). Producer Controls runs on this Mac only.\n`,
  );
}

async function main(argv: string[]) {
  const flag = (name: string) =>
    argv.find((arg) => arg === name || arg.startsWith(`${name}=`));
  const portArg = flag("--port");
  const port = portArg ? Number(portArg.split("=")[1]) : DEFAULT_PORT;
  if (argv[0] === "install-app") return installApp(port);
  const demoArg = flag("--demo");
  const provider: Provider = demoArg
    ? new DemoProvider(
        (demoArg.split("=")[1] as ScenarioId | undefined) ?? "recovery-needed",
      )
    : new LiveProvider();
  const controls = await startControls({ provider, port });
  const url = `http://127.0.0.1:${controls.port}/`;
  process.stdout.write(
    `Producer Controls${demoArg ? " (example data)" : ""}: ${url}\nThis Mac only. Close this window or press Ctrl-C to stop.\n`,
  );
  if (!flag("--no-open"))
    await run("/usr/bin/open", [url]).catch(() => undefined);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
