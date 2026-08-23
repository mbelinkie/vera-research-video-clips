import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  utilityProcess,
  type UtilityProcess,
} from "electron";

import { CognitoOAuthClient } from "@research-video/auth";
import {
  DesktopApiRequestSchema,
  DesktopApiResponseSchema,
  DesktopAuthStatusSchema,
  DesktopServiceStatusSchema,
  DesktopStatusSchema,
  type DesktopAuthStatus,
  type DesktopServiceStatus,
} from "@research-video/contracts";

import { DesktopAuthenticationBroker } from "./auth/broker.ts";
import { DESKTOP_OAUTH_CALLBACK_URI } from "./auth/callback.ts";
import { EncryptedRefreshTokenStore } from "./auth/refresh-token-store.ts";
import {
  startLoopbackCloudCredentialProxy,
  type LoopbackCloudCredentialProxy,
} from "./cloud-proxy.ts";
import {
  electronSafeStorage,
  MainProcessRefreshTokenFile,
  managedLoginBrowser,
} from "./electron-auth-adapters.ts";
import { desktopIpcChannels, requireTrustedRenderer } from "./ipc.ts";
import { LocalAgentEndpointRegistry } from "./local-agent-endpoint.ts";
import { loadDesktopRuntimeConfiguration } from "./runtime-config.ts";
import {
  LocalServiceSupervisor,
  type ProcessExit,
  type ProcessLauncher,
  type RuntimeControl,
  type SupervisedProcess,
  type SupervisedServiceName,
} from "./supervision/index.ts";

const trustedRendererOrigin = "rvc://app";
const desktopRoot = __dirname;
const rendererRoot = resolve(desktopRoot, "../web");
const serviceRoot = resolve(desktopRoot, "services");
const sessionSecret = randomBytes(32).toString("base64url");
const pendingCallbacks: string[] = [];

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rvc",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: false,
      corsEnabled: false,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let broker: DesktopAuthenticationBroker | undefined;
  let cloudProxy: LoopbackCloudCredentialProxy | undefined;
  let supervisor: LocalServiceSupervisor | undefined;
  let mainWindow: BrowserWindow | undefined;
  const localAgentEndpoint = new LocalAgentEndpointRegistry();
  let publicApiOrigin: string | undefined;
  let quitAllowed = false;
  let quitInProgress = false;
  let startupAuthIssue:
    "configuration_required" | "protected_storage_unavailable" =
    "configuration_required";

  const acceptCallback = (candidate: string) => {
    if (broker) broker.acceptNativeCallback(candidate);
    else if (pendingCallbacks.length < 8) pendingCallbacks.push(candidate);
  };

  app.on("open-url", (event, url) => {
    event.preventDefault();
    acceptCallback(url);
  });
  app.on("second-instance", (_event, argv) => {
    for (const candidate of argv.filter((value) =>
      value.startsWith("research-video-clips:"),
    )) {
      acceptCallback(candidate);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("before-quit", (event) => {
    if (quitAllowed || !supervisor) return;
    event.preventDefault();
    if (quitInProgress) return;
    quitInProgress = true;
    void supervisor
      .shutdown()
      .then(() => cloudProxy?.close())
      .finally(() => {
        quitAllowed = true;
        app.quit();
      });
  });

  void app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    const configuration = await loadDesktopRuntimeConfiguration(userData);
    publicApiOrigin = configuration?.publicApiOrigin;

    const protectedStorageAvailable = await electronSafeStorage
      .isEncryptionAvailable()
      .catch(() => false);
    if (configuration && protectedStorageAvailable) {
      const oauth = new CognitoOAuthClient({
        authority: configuration.cognitoAuthority,
        clientId: configuration.cognitoClientId,
        callbackUri: DESKTOP_OAUTH_CALLBACK_URI,
        logoutUri: "research-video-clips://oauth/logout",
      });
      broker = new DesktopAuthenticationBroker(
        oauth,
        new EncryptedRefreshTokenStore(
          electronSafeStorage,
          new MainProcessRefreshTokenFile(userData),
        ),
        managedLoginBrowser,
      );
      await broker.restore();
      for (const callback of pendingCallbacks.splice(0)) {
        broker.acceptNativeCallback(callback);
      }
      await broker.drainNativeCallbacks();
      cloudProxy = await startLoopbackCloudCredentialProxy({
        cloudOrigin: configuration.publicApiOrigin,
        launchSecret: sessionSecret,
        tokenProvider: () => broker!.getAccessTokenForTrustedProxy(),
      });
    } else if (configuration) {
      startupAuthIssue = "protected_storage_unavailable";
    }

    const runtimeControl: RuntimeControl = {
      requestDrain: () => callLocalRuntime("POST"),
      readQuiescence: () => callLocalRuntime("GET"),
    };
    supervisor = new LocalServiceSupervisor(
      ["local-agent", "transcription-worker"],
      {
        launcher: createElectronProcessLauncher({
          userData,
          workerCloudOrigin: cloudProxy?.origin,
          sessionSecret,
          reportLocalAgentPort: (port) => {
            localAgentEndpoint.activate(port);
          },
          clearLocalAgentPort: (port) => {
            localAgentEndpoint.clear(port);
          },
        }),
        runtimeControl,
      },
    );
    await supervisor.start("local-agent");
    if (broker?.getRendererStatus().state === "signed_in") {
      await supervisor.start("transcription-worker");
    }

    await protocol.handle("rvc", serveTrustedRenderer);
    installIpcHandlers({
      getBroker: () => broker,
      getSupervisor: () => supervisor,
      getPublicApiOrigin: () => publicApiOrigin,
      getLocalAgentPort: () => localAgentEndpoint.currentPort() ?? 0,
      getStartupAuthIssue: () => startupAuthIssue,
      sessionSecret,
    });
    mainWindow = createMainWindow();
    await mainWindow.loadURL("rvc://app/index.html");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        void mainWindow.loadURL("rvc://app/index.html");
      }
    });
  });

  async function callLocalRuntime(method: "GET" | "POST") {
    const port = localAgentEndpoint.currentPort();
    if (port === undefined) throw new Error("Local runtime is unavailable.");
    const path =
      method === "POST" ? "/api/runtime/drain" : "/api/runtime/quiescence";
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${sessionSecret}`,
        origin: trustedRendererOrigin,
        "x-research-video-session": sessionSecret,
      },
    });
    if (!response.ok) throw new Error("Local runtime control unavailable.");
    const value = (await response.json()) as {
      draining?: unknown;
      safeToStop?: unknown;
      quiescence?: { draining?: unknown; safeToStop?: unknown };
    };
    const candidate = value.quiescence ?? value;
    if (
      typeof candidate.draining !== "boolean" ||
      typeof candidate.safeToStop !== "boolean"
    ) {
      throw new Error("Local runtime control unavailable.");
    }
    return {
      draining: candidate.draining,
      safeToStop: candidate.safeToStop,
    };
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Research Video Clips",
    width: 1_440,
    height: 960,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: "#111318",
    show: false,
    webPreferences: {
      preload: join(desktopRoot, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  return window;
}

async function serveTrustedRenderer(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.hostname !== "app" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return new Response("Not found", { status: 404 });
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = resolve(rendererRoot, relativePath);
  const containment = relative(rendererRoot, filePath);
  if (
    containment.startsWith(`..${sep}`) ||
    containment === ".." ||
    containment.includes(`..${sep}`)
  ) {
    return new Response("Not found", { status: 404 });
  }
  try {
    return new Response(await readFile(filePath), {
      status: 200,
      headers: {
        "content-type": contentType(extname(filePath)),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function installIpcHandlers(options: {
  getBroker(): DesktopAuthenticationBroker | undefined;
  getSupervisor(): LocalServiceSupervisor | undefined;
  getPublicApiOrigin(): string | undefined;
  getLocalAgentPort(): number;
  getStartupAuthIssue():
    "configuration_required" | "protected_storage_unavailable";
  sessionSecret: string;
}) {
  ipcMain.handle(desktopIpcChannels.getStatus, async (event) => {
    requireTrustedRenderer(event);
    const broker = options.getBroker();
    await broker?.drainNativeCallbacks();
    if (broker?.getRendererStatus().state === "signed_in") {
      await options.getSupervisor()?.start("transcription-worker");
    }
    return DesktopStatusSchema.parse({
      auth: rendererAuthStatus(broker, options.getStartupAuthIssue()),
      services: rendererServiceStatus(options.getSupervisor()),
    });
  });
  ipcMain.handle(desktopIpcChannels.signIn, async (event) => {
    requireTrustedRenderer(event);
    const broker = options.getBroker();
    if (!broker) return unavailableAuthStatus(options.getStartupAuthIssue());
    await broker.beginSignIn();
    return DesktopAuthStatusSchema.parse(
      rendererAuthStatus(broker, options.getStartupAuthIssue()),
    );
  });
  ipcMain.handle(desktopIpcChannels.signOut, async (event) => {
    requireTrustedRenderer(event);
    const broker = options.getBroker();
    if (!broker) return unavailableAuthStatus(options.getStartupAuthIssue());
    await options.getSupervisor()?.stop("transcription-worker");
    await broker.signOut();
    return DesktopAuthStatusSchema.parse(
      rendererAuthStatus(broker, options.getStartupAuthIssue()),
    );
  });
  ipcMain.handle(desktopIpcChannels.request, async (event, rawInput) => {
    requireTrustedRenderer(event);
    const input = DesktopApiRequestSchema.parse(rawInput);
    const broker = options.getBroker();
    let accessToken: string;
    try {
      accessToken = await broker!.getAccessTokenForTrustedProxy();
    } catch {
      return DesktopApiResponseSchema.parse({
        status: 401,
        body: JSON.stringify({
          error: {
            code: "authentication_required",
            message: "Sign in required.",
          },
        }),
        contentType: "application/json",
      });
    }
    const localPort = options.getLocalAgentPort();
    const base =
      input.target === "cloud"
        ? options.getPublicApiOrigin()
        : localPort === 0
          ? undefined
          : `http://127.0.0.1:${localPort}`;
    if (!base) {
      return DesktopApiResponseSchema.parse({
        status: 503,
        body: JSON.stringify({
          error: {
            code: "configuration_required",
            message: "Cloud configuration is required.",
          },
        }),
        contentType: "application/json",
      });
    }
    const target = new URL(input.path, `${base}/`);
    if (!target.pathname.startsWith("/api/")) {
      return DesktopApiResponseSchema.parse({
        status: 400,
        body: JSON.stringify({
          error: { code: "invalid_request", message: "Invalid API path." },
        }),
        contentType: "application/json",
      });
    }
    const response = await fetch(target, {
      method: input.method,
      headers: {
        accept: "application/json",
        authorization:
          input.target === "local"
            ? `Bearer ${options.sessionSecret}`
            : `Bearer ${accessToken}`,
        ...(input.contentType ? { "content-type": input.contentType } : {}),
        ...(input.target === "local"
          ? {
              origin: trustedRendererOrigin,
              "x-research-video-session": options.sessionSecret,
            }
          : {}),
      },
      ...(input.body !== undefined ? { body: input.body } : {}),
      redirect: "error",
    });
    return DesktopApiResponseSchema.parse({
      status: response.status,
      body: await response.text(),
      ...(response.headers.get("content-type")
        ? { contentType: response.headers.get("content-type")! }
        : {}),
    });
  });
}

function rendererAuthStatus(
  broker: DesktopAuthenticationBroker | undefined,
  startupIssue: "configuration_required" | "protected_storage_unavailable",
): DesktopAuthStatus {
  if (!broker) return unavailableAuthStatus(startupIssue);
  const status = broker.getRendererStatus();
  return DesktopAuthStatusSchema.parse(
    status.state === "signed_in"
      ? {
          state: "signed_in",
          expiresAt: new Date(status.expiresAt).toISOString(),
        }
      : status,
  );
}

function unavailableAuthStatus(
  issue: "configuration_required" | "protected_storage_unavailable",
): DesktopAuthStatus {
  return DesktopAuthStatusSchema.parse({
    state: "unavailable",
    issue,
  });
}

function rendererServiceStatus(
  supervisor: LocalServiceSupervisor | undefined,
): DesktopServiceStatus[] {
  if (!supervisor) return [];
  return supervisor.getStatus().map((status) =>
    DesktopServiceStatusSchema.parse({
      service:
        status.service === "local-agent"
          ? "local_agent"
          : "transcription_worker",
      state:
        status.state === "unhealthy"
          ? "failed"
          : status.state === "shutting_down"
            ? "draining"
            : status.state === "backing_off"
              ? "backing_off"
              : status.state,
      restartCount: status.restartCount,
      ...(status.lastTransition === "restart_exhausted"
        ? { issue: "unexpected_exit" }
        : {}),
    }),
  );
}

function createElectronProcessLauncher(input: {
  userData: string;
  workerCloudOrigin: string | undefined;
  sessionSecret: string;
  reportLocalAgentPort(port: number): void;
  clearLocalAgentPort(port: number): void;
}): ProcessLauncher {
  return {
    async launch(service: SupervisedServiceName): Promise<SupervisedProcess> {
      if (service === "export-worker") {
        throw new Error("Export execution is owned by the local agent.");
      }
      const environment: Record<string, string> = {
        NODE_ENV: "production",
        APP_RUNTIME_ROLE:
          service === "local-agent" ? "desktop-local" : "desktop-worker",
        DATA_DIR: join(input.userData, "data"),
        PUBLIC_API_ORIGIN: input.workerCloudOrigin ?? "https://invalid.local",
      };
      let modulePath: string;
      if (service === "local-agent") {
        modulePath = join(serviceRoot, "local-agent.mjs");
        environment.LOCAL_AGENT_HOST = "127.0.0.1";
        environment.LOCAL_AGENT_PORT = "0";
        environment.DESKTOP_SESSION_SECRET = input.sessionSecret;
      } else {
        if (!input.workerCloudOrigin) {
          throw new Error("Worker credential proxy unavailable.");
        }
        modulePath = join(serviceRoot, "transcription-worker.mjs");
        environment.PUBLIC_API_ORIGIN = input.workerCloudOrigin;
        environment.WORKER_AUTHORIZATION = `Bearer ${input.sessionSecret}`;
        environment.WORKER_MODE = "continuous";
        environment.WORKER_EXECUTION_LOCATION = "local";
      }
      const child = utilityProcess.fork(modulePath, [], {
        env: environment,
        stdio: "ignore",
        serviceName:
          service === "local-agent"
            ? "Research Video Clips Local Agent"
            : "Research Video Clips Transcription Worker",
      });
      let reportedLocalPort: number | undefined;
      const ready =
        service === "local-agent"
          ? waitForLocalAgentReady(
              child,
              (port) => {
                reportedLocalPort = port;
                input.reportLocalAgentPort(port);
              },
              input.clearLocalAgentPort,
            )
          : undefined;
      if (service === "local-agent") {
        const clearReportedPort = () => {
          if (reportedLocalPort !== undefined) {
            input.clearLocalAgentPort(reportedLocalPort);
            reportedLocalPort = undefined;
          }
        };
        child.once("exit", clearReportedPort);
        child.once("error", clearReportedPort);
      }
      return wrapUtilityProcess(child, ready);
    },
  };
}

function wrapUtilityProcess(
  child: UtilityProcess,
  ready: Promise<void> | undefined,
): SupervisedProcess {
  const exited = new Promise<ProcessExit>((resolveExit) => {
    child.once("exit", (code) =>
      resolveExit({ kind: code === 0 ? "clean" : "unexpected" }),
    );
    child.once("error", () => resolveExit({ kind: "launch_failed" }));
  });
  const spawned = new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const started = spawned.then(async () => {
    await ready;
  });
  return {
    started,
    exited,
    terminate: () => {
      child.kill();
    },
    kill: () => {
      const pid = child.pid;
      if (pid) process.kill(pid, "SIGKILL");
    },
  };
}

async function waitForLocalAgentReady(
  child: UtilityProcess,
  reportPort: (port: number) => void,
  clearPort: (port: number) => void,
): Promise<void> {
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("error", onFailure);
      child.removeListener("exit", onExit);
    };
    const onFailure = () => {
      cleanup();
      rejectPort(new Error("Local service failed before readiness."));
    };
    const onExit = () => onFailure();
    const onMessage = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        Object.keys(message).length !== 2 ||
        (message as { type?: unknown }).type !== "local-agent-ready" ||
        !Number.isSafeInteger((message as { port?: unknown }).port) ||
        Number((message as { port: number }).port) < 1 ||
        Number((message as { port: number }).port) > 65_535
      ) {
        return;
      }
      cleanup();
      const port = (message as { port: number }).port;
      reportPort(port);
      resolvePort(port);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectPort(new Error("Local service health check timed out."));
    }, 10_000);
    child.on("message", onMessage);
    child.once("error", onFailure);
    child.once("exit", onExit);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (!response.ok) throw new Error("Local service health check failed.");
  } catch (error) {
    clearPort(port);
    throw error;
  }
}

function contentType(extension: string): string {
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
