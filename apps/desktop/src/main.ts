import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type OpenDialogOptions,
  type UtilityProcess,
} from "electron";

import { CognitoOAuthClient } from "@research-video/auth";
import {
  DesktopApiRequestSchema,
  DesktopApiResponseSchema,
  DesktopAuthStatusSchema,
  DesktopServiceStatusSchema,
  DesktopStatusSchema,
  HealthResponseSchema,
  ModelDownloadProgressSchema,
  ReadinessReportSchema,
  SetupActionSchema,
  SetupSelectionTargetSchema,
  SetupSnapshotSchema,
  type ComponentHealth,
  type DesktopAuthStatus,
  type DesktopServiceStatus,
  type ModelDownloadProgress,
  type SetupSelectionTarget,
  type SetupSnapshot,
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
import {
  desktopIpcChannels,
  isLocalTranscriptWorkspaceRequest,
  isPrivateDesktopSetupPath,
  requireTrustedRenderer,
} from "./ipc.ts";
import {
  applyModelPinAvailability,
  mergeDesktopReadiness,
  modelDownloadCanCancel,
  parseTrustedRuntimePaths,
  resolveWorkerConfiguration,
  setupActionRequiresRuntimeRestart,
  shouldRunExportSupervisor,
  shouldRunTranscriptionWorker,
} from "./desktop-setup-policy.ts";
import { LocalAgentEndpointRegistry } from "./local-agent-endpoint.ts";
import {
  ModelDownloadCanceledError,
  downloadPinnedModel,
} from "./model-download.ts";
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
const nativeActionSecret = randomBytes(32).toString("base64url");
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
          nativeActionSecret,
          getLocalAgentPort: () => localAgentEndpoint.currentPort() ?? 0,
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
      await setLocalExportSupervisorEnabled({
        port: localAgentEndpoint.currentPort() ?? 0,
        sessionSecret,
        nativeActionSecret,
        enabled: true,
      });
      await supervisor.start("transcription-worker");
    }

    await protocol.handle("rvc", serveTrustedRenderer);
    installIpcHandlers({
      getBroker: () => broker,
      getSupervisor: () => supervisor,
      getPublicApiOrigin: () => publicApiOrigin,
      getLocalAgentPort: () => localAgentEndpoint.currentPort() ?? 0,
      getStartupAuthIssue: () => startupAuthIssue,
      getWhisperModelPin: () => configuration?.whisperModelPin,
      getModelsDirectory: () => join(userData, "models"),
      sessionSecret,
      nativeActionSecret,
      getMainWindow: () => mainWindow,
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
  getWhisperModelPin():
    | {
        name: string;
        url: string;
        byteSize: number;
        sha256: string;
      }
    | undefined;
  getModelsDirectory(): string;
  getMainWindow(): BrowserWindow | undefined;
  getStartupAuthIssue():
    "configuration_required" | "protected_storage_unavailable";
  sessionSecret: string;
  nativeActionSecret: string;
}) {
  let activeModelDownload:
    | {
        controller: AbortController;
        progress: ModelDownloadProgress;
      }
    | undefined;
  const updateModelDownloadProgress = (progress: ModelDownloadProgress) => {
    activeModelDownload = activeModelDownload
      ? { ...activeModelDownload, progress }
      : activeModelDownload;
    options
      .getMainWindow()
      ?.webContents.send(
        desktopIpcChannels.modelDownloadProgress,
        ModelDownloadProgressSchema.parse(progress),
      );
    return progress;
  };
  const requestSetup = async (
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; native?: boolean },
  ): Promise<unknown> => {
    const port = options.getLocalAgentPort();
    if (port === 0) throw new Error("Desktop setup service is unavailable.");
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.sessionSecret}`,
        origin: trustedRendererOrigin,
        "x-research-video-session": options.sessionSecret,
        ...(init.native
          ? { "x-research-video-native-action": options.nativeActionSecret }
          : {}),
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: "error",
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => undefined)) as
        { error?: { code?: unknown } } | undefined;
      const code = failure?.error?.code;
      const message =
        code === "invalid_root" || code === "invalid_path"
          ? "The selected folder is not a canonical writable folder."
          : code === "invalid_tool" || code === "tool_probe_failed"
            ? "The selected executable is missing required capabilities or changed during validation."
            : code === "invalid_model" || code === "model_pin_invalid"
              ? "The selected Whisper model does not match the configured size and SHA-256."
              : "Desktop setup action failed.";
      throw new Error(message);
    }
    return response.json();
  };
  const readSetup = async () =>
    SetupSnapshotSchema.parse(
      await requestSetup("/api/desktop-setup", { method: "GET" }),
    );
  const readLocalReadiness = async () =>
    ReadinessReportSchema.parse(
      await requestSetup("/api/readiness", { method: "GET" }),
    );
  const reconcileTranscriptionWorker = async () => {
    const supervisor = options.getSupervisor();
    const broker = options.getBroker();
    if (!supervisor || options.getLocalAgentPort() === 0) return;
    let shouldRun = false;
    try {
      const [snapshot, localReadiness] = await Promise.all([
        readSetup(),
        readLocalReadiness(),
      ]);
      shouldRun = shouldRunTranscriptionWorker({
        signedIn: broker?.getRendererStatus().state === "signed_in",
        snapshot,
        localReadiness,
      });
    } catch {
      shouldRun = false;
    }
    const worker = supervisor
      .getStatus()
      .find((status) => status.service === "transcription-worker");
    if (shouldRun) await supervisor.start("transcription-worker");
    else if (worker && worker.state !== "stopped") {
      await supervisor.stop("transcription-worker");
    }
  };
  const reconcileExportSupervisor = async () => {
    const broker = options.getBroker();
    if (options.getLocalAgentPort() === 0) return;
    let shouldRun = false;
    try {
      const [snapshot, localReadiness] = await Promise.all([
        readSetup(),
        readLocalReadiness(),
      ]);
      shouldRun = shouldRunExportSupervisor({
        signedIn: broker?.getRendererStatus().state === "signed_in",
        snapshot,
        localReadiness,
      });
    } catch {
      shouldRun = false;
    }
    await setLocalExportSupervisorEnabled({
      port: options.getLocalAgentPort(),
      sessionSecret: options.sessionSecret,
      nativeActionSecret: options.nativeActionSecret,
      enabled: shouldRun,
    });
  };
  const reconcileLocalWorkers = async () => {
    await reconcileExportSupervisor();
    await reconcileTranscriptionWorker();
  };
  const restartConfiguredRuntime = async () => {
    const supervisor = options.getSupervisor();
    if (!supervisor) return;
    await supervisor.stop("transcription-worker");
    const drain = (await requestSetup("/api/runtime/drain", {
      method: "POST",
    })) as { quiescence?: { draining?: unknown; safeToStop?: unknown } };
    let safe =
      drain.quiescence?.draining === true &&
      drain.quiescence.safeToStop === true;
    for (let attempt = 0; !safe && attempt < 40; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const result = (await requestSetup("/api/runtime/quiescence", {
        method: "GET",
      })) as { draining?: unknown; safeToStop?: unknown };
      safe = result.draining === true && result.safeToStop === true;
    }
    if (!safe) {
      throw new Error(
        "Local work is still active; setup will apply after it drains.",
      );
    }
    await supervisor.stop("local-agent");
    await supervisor.start("local-agent");
    await reconcileLocalWorkers();
  };
  const readReadiness = async () => {
    const localReport = await readLocalReadiness();
    const checkedAt = new Date().toISOString();
    const local = applyModelPinAvailability(
      localReport,
      Boolean(options.getWhisperModelPin()),
      checkedAt,
    );
    const external = await desktopReadinessComponents({
      checkedAt,
      broker: options.getBroker(),
      supervisor: options.getSupervisor(),
      publicApiOrigin: options.getPublicApiOrigin(),
    });
    return mergeDesktopReadiness({
      checkedAt,
      local,
      external,
    });
  };

  ipcMain.handle(desktopIpcChannels.getStatus, async (event) => {
    requireTrustedRenderer(event);
    const broker = options.getBroker();
    await broker?.drainNativeCallbacks();
    await reconcileLocalWorkers();
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
    await reconcileLocalWorkers();
    return DesktopAuthStatusSchema.parse(
      rendererAuthStatus(broker, options.getStartupAuthIssue()),
    );
  });
  ipcMain.handle(desktopIpcChannels.signOut, async (event) => {
    requireTrustedRenderer(event);
    const broker = options.getBroker();
    if (!broker) return unavailableAuthStatus(options.getStartupAuthIssue());
    await setLocalExportSupervisorEnabled({
      port: options.getLocalAgentPort(),
      sessionSecret: options.sessionSecret,
      nativeActionSecret: options.nativeActionSecret,
      enabled: false,
    });
    await options.getSupervisor()?.stop("transcription-worker");
    await broker.signOut();
    return DesktopAuthStatusSchema.parse(
      rendererAuthStatus(broker, options.getStartupAuthIssue()),
    );
  });
  ipcMain.handle(desktopIpcChannels.getSetup, async (event) => {
    requireTrustedRenderer(event);
    return readSetup();
  });
  ipcMain.handle(desktopIpcChannels.getReadiness, async (event) => {
    requireTrustedRenderer(event);
    return ReadinessReportSchema.parse(await readReadiness());
  });
  ipcMain.handle(desktopIpcChannels.updateSetup, async (event, rawAction) => {
    requireTrustedRenderer(event);
    const action = SetupActionSchema.parse(rawAction);
    const snapshot = SetupSnapshotSchema.parse(
      await requestSetup("/api/desktop-setup/actions", {
        method: "POST",
        body: action,
      }),
    );
    if (setupActionRequiresRuntimeRestart(action)) {
      await restartConfiguredRuntime();
    } else {
      await reconcileLocalWorkers();
    }
    return snapshot;
  });
  ipcMain.handle(
    desktopIpcChannels.chooseSetupTarget,
    async (event, rawTarget) => {
      requireTrustedRenderer(event);
      const target = SetupSelectionTargetSchema.parse(rawTarget);
      const dialogOptions: OpenDialogOptions = {
        title: dialogTitleForSetupTarget(target),
        properties:
          target === "output_root" || target === "cache_root"
            ? ["openDirectory", "createDirectory", "noResolveAliases"]
            : ["openFile", "noResolveAliases"],
      };
      const parent = options.getMainWindow();
      const selected = parent
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (selected.canceled || selected.filePaths.length !== 1)
        return readSetup();
      // The dialog result is intentionally sent only over the authenticated
      // main-to-local-agent native action boundary. It never crosses IPC back
      // to the renderer, including on validation failure.
      const pin = options.getWhisperModelPin();
      if (target === "whisper_model" && !pin) {
        throw new Error("Whisper model selection is not configured.");
      }
      const snapshot = SetupSnapshotSchema.parse(
        await requestSetup("/api/desktop-setup/native-selection", {
          method: "POST",
          native: true,
          body: {
            target,
            path: selected.filePaths[0],
            ...(target === "whisper_model" && pin
              ? { pin: localModelPin(pin) }
              : {}),
          },
        }),
      );
      await restartConfiguredRuntime();
      return snapshot;
    },
  );
  ipcMain.handle(desktopIpcChannels.startModelDownload, async (event) => {
    requireTrustedRenderer(event);
    if (activeModelDownload) return activeModelDownload.progress;
    const pin = options.getWhisperModelPin();
    if (!pin) throw new Error("Whisper model download is not configured.");
    const controller = new AbortController();
    const initial = ModelDownloadProgressSchema.parse({
      target: "whisper_model",
      state: "preparing",
      bytesDownloaded: 0,
      expectedBytes: pin.byteSize,
    });
    activeModelDownload = { controller, progress: initial };
    void (async () => {
      try {
        const candidatePath = await downloadPinnedModel({
          modelsDirectory: options.getModelsDirectory(),
          pin,
          signal: controller.signal,
          fetch: net.fetch,
          onProgress: (update) => {
            updateModelDownloadProgress(
              ModelDownloadProgressSchema.parse({
                target: "whisper_model",
                state: "downloading",
                ...update,
              }),
            );
          },
        });
        if (controller.signal.aborted) throw new ModelDownloadCanceledError();
        updateModelDownloadProgress(
          ModelDownloadProgressSchema.parse({
            target: "whisper_model",
            state: "verifying",
            bytesDownloaded: pin.byteSize,
            expectedBytes: pin.byteSize,
          }),
        );
        if (controller.signal.aborted) throw new ModelDownloadCanceledError();
        // Promotion includes the local agent's second size/hash verification and
        // atomic activation. Once entered it is intentionally non-cancelable.
        updateModelDownloadProgress(
          ModelDownloadProgressSchema.parse({
            target: "whisper_model",
            state: "promoting",
            bytesDownloaded: pin.byteSize,
            expectedBytes: pin.byteSize,
          }),
        );
        await requestSetup("/api/desktop-setup/model-download/activate", {
          method: "POST",
          native: true,
          body: {
            target: "whisper_model",
            path: candidatePath,
            pin: localModelPin(pin),
          },
        });
        await restartConfiguredRuntime();
        updateModelDownloadProgress(
          ModelDownloadProgressSchema.parse({
            target: "whisper_model",
            state: "completed",
            bytesDownloaded: pin.byteSize,
            expectedBytes: pin.byteSize,
          }),
        );
      } catch (error) {
        const current = activeModelDownload?.progress;
        updateModelDownloadProgress(
          ModelDownloadProgressSchema.parse({
            target: "whisper_model",
            state:
              error instanceof ModelDownloadCanceledError
                ? "canceled"
                : "failed",
            bytesDownloaded: current?.bytesDownloaded ?? 0,
            expectedBytes: pin.byteSize,
          }),
        );
      } finally {
        activeModelDownload = undefined;
      }
    })();
    return initial;
  });
  ipcMain.handle(desktopIpcChannels.cancelModelDownload, async (event) => {
    requireTrustedRenderer(event);
    const active = activeModelDownload;
    if (!active) throw new Error("No model download is active.");
    if (!modelDownloadCanCancel(active.progress.state)) {
      throw new Error("Model activation has started and cannot be canceled.");
    }
    active.controller.abort();
    return updateModelDownloadProgress(
      ModelDownloadProgressSchema.parse({
        ...active.progress,
        state: "canceled",
      }),
    );
  });
  ipcMain.handle(desktopIpcChannels.request, async (event, rawInput) => {
    requireTrustedRenderer(event);
    const input = DesktopApiRequestSchema.parse(rawInput);
    if (isPrivateDesktopSetupPath(input.path)) {
      return DesktopApiResponseSchema.parse({
        status: 403,
        body: JSON.stringify({
          error: {
            code: "forbidden",
            message: "This desktop action requires the typed native bridge.",
          },
        }),
        contentType: "application/json",
      });
    }
    const broker = options.getBroker();
    let accessToken: string | undefined;
    let offlineReviewCapability: string | undefined;
    if (isLocalTranscriptWorkspaceRequest(input)) {
      try {
        offlineReviewCapability = broker?.getOfflineReviewCapability();
        if (!offlineReviewCapability) throw new Error("signed out");
      } catch {
        return DesktopApiResponseSchema.parse({
          status: 401,
          body: JSON.stringify({
            error: {
              code: "authentication_required",
              message: "Sign in required before reviewing cached transcripts.",
            },
          }),
          contentType: "application/json",
        });
      }
    }
    if (input.target === "cloud") {
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
            : `Bearer ${accessToken!}`,
        ...(input.contentType ? { "content-type": input.contentType } : {}),
        ...(input.target === "local"
          ? {
              origin: trustedRendererOrigin,
              "x-research-video-session": options.sessionSecret,
              ...(offlineReviewCapability
                ? {
                    "x-research-video-offline-review": offlineReviewCapability,
                  }
                : {}),
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

function localModelPin(pin: {
  name: string;
  byteSize: number;
  sha256: string;
}) {
  return {
    displayName: pin.name,
    expectedBytes: pin.byteSize,
    expectedSha256: pin.sha256,
    version: pin.name,
  };
}

async function desktopReadinessComponents(input: {
  checkedAt: string;
  broker: DesktopAuthenticationBroker | undefined;
  supervisor: LocalServiceSupervisor | undefined;
  publicApiOrigin: string | undefined;
}): Promise<ComponentHealth[]> {
  const authentication: ComponentHealth =
    input.broker?.getRendererStatus().state === "signed_in"
      ? {
          component: "authentication",
          state: "ready",
          reason: "ready",
          remediation: "none",
          checkedAt: input.checkedAt,
        }
      : {
          component: "authentication",
          state: "needs_action",
          reason: "authentication_required",
          remediation: "sign_in",
          checkedAt: input.checkedAt,
        };
  const worker = input.supervisor
    ?.getStatus()
    .find((status) => status.service === "transcription-worker");
  const transcriptionWorker: ComponentHealth =
    worker?.state === "healthy"
      ? {
          component: "transcription_worker",
          state: "ready",
          reason: "ready",
          remediation: "none",
          checkedAt: input.checkedAt,
        }
      : {
          component: "transcription_worker",
          state: worker?.state === "backing_off" ? "degraded" : "needs_action",
          reason:
            worker?.state === "stopped"
              ? "worker_disabled"
              : "worker_unavailable",
          remediation: worker?.state === "stopped" ? "enable_worker" : "retry",
          checkedAt: input.checkedAt,
        };
  const desktop: ComponentHealth = {
    component: "desktop",
    state: "ready",
    reason: "ready",
    remediation: "none",
    checkedAt: input.checkedAt,
  };
  if (!input.publicApiOrigin) {
    return [
      desktop,
      authentication,
      {
        component: "network",
        state: "needs_action",
        reason: "configuration_required",
        remediation: "retry",
        checkedAt: input.checkedAt,
      },
      {
        component: "cloud_api",
        state: "needs_action",
        reason: "configuration_required",
        remediation: "retry",
        checkedAt: input.checkedAt,
      },
      transcriptionWorker,
    ];
  }
  try {
    const response = await fetch(new URL("/health", input.publicApiOrigin), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    const health = HealthResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    const cloudReady =
      response.ok && health.success && health.data.service === "cloud-api";
    return [
      desktop,
      authentication,
      {
        component: "network",
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt: input.checkedAt,
      },
      cloudReady
        ? {
            component: "cloud_api",
            state: "ready",
            reason: "ready",
            remediation: "none",
            checkedAt: input.checkedAt,
          }
        : {
            component: "cloud_api",
            state: "blocked",
            reason: "cloud_unavailable",
            remediation: "retry",
            checkedAt: input.checkedAt,
          },
      transcriptionWorker,
    ];
  } catch {
    return [
      desktop,
      authentication,
      {
        component: "network",
        state: "blocked",
        reason: "network_unavailable",
        remediation: "retry",
        checkedAt: input.checkedAt,
      },
      {
        component: "cloud_api",
        state: "blocked",
        reason: "cloud_unavailable",
        remediation: "retry",
        checkedAt: input.checkedAt,
      },
      transcriptionWorker,
    ];
  }
}

function dialogTitleForSetupTarget(target: SetupSelectionTarget): string {
  switch (target) {
    case "output_root":
      return "Choose output folder";
    case "cache_root":
      return "Choose cache folder";
    case "ffmpeg":
      return "Choose FFmpeg executable";
    case "ffprobe":
      return "Choose FFprobe executable";
    case "yt_dlp":
      return "Choose yt-dlp executable";
    case "whisper_cli":
      return "Choose whisper-cli executable";
    case "whisper_model":
      return "Choose Whisper model";
  }
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
  nativeActionSecret: string;
  getLocalAgentPort(): number;
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
        environment.DESKTOP_NATIVE_ACTION_SECRET = input.nativeActionSecret;
      } else {
        if (!input.workerCloudOrigin) {
          throw new Error("Worker credential proxy unavailable.");
        }
        const workerConfiguration = await readTrustedWorkerConfiguration(input);
        modulePath = join(serviceRoot, "transcription-worker.mjs");
        environment.DATA_DIR = join(
          workerConfiguration.cacheRoot,
          "Research Video Clips Cache",
        );
        environment.PUBLIC_API_ORIGIN = input.workerCloudOrigin;
        environment.WORKER_AUTHORIZATION = `Bearer ${input.sessionSecret}`;
        environment.WORKER_MODE = "continuous";
        environment.WORKER_EXECUTION_LOCATION = "local";
        environment.CAPTION_PROVIDER = workerConfiguration.captionProvider;
        environment.MEDIA_PROVIDER = workerConfiguration.mediaProvider;
        environment.SPEECH_TO_TEXT_PROVIDER = "whisper-cpp";
        environment.TRANSLATION_PROVIDER =
          workerConfiguration.translationProvider;
        environment.YT_DLP_PATH = workerConfiguration.ytDlp;
        environment.WHISPER_CPP_PATH = workerConfiguration.whisperCli;
        environment.WHISPER_CPP_MODEL_PATH = workerConfiguration.whisperModel;
        environment.WHISPER_CPP_MODEL_NAME =
          workerConfiguration.whisperModelName;
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

async function setLocalExportSupervisorEnabled(input: {
  port: number;
  sessionSecret: string;
  nativeActionSecret: string;
  enabled: boolean;
}): Promise<void> {
  if (input.port === 0) return;
  const response = await fetch(
    `http://127.0.0.1:${input.port}/api/desktop-setup/export-supervisor`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.sessionSecret}`,
        "content-type": "application/json",
        origin: trustedRendererOrigin,
        "x-research-video-session": input.sessionSecret,
        "x-research-video-native-action": input.nativeActionSecret,
      },
      body: JSON.stringify({ enabled: input.enabled }),
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new Error("Local export supervision is unavailable.");
  }
}

async function readTrustedWorkerConfiguration(input: {
  getLocalAgentPort(): number;
  sessionSecret: string;
  nativeActionSecret: string;
}) {
  const port = input.getLocalAgentPort();
  if (port === 0) throw new Error("Local setup is unavailable.");
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${input.sessionSecret}`,
    origin: trustedRendererOrigin,
    "x-research-video-session": input.sessionSecret,
  };
  const [snapshotResponse, runtimeResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/desktop-setup`, {
      headers,
      redirect: "error",
    }),
    fetch(`http://127.0.0.1:${port}/api/desktop-setup/runtime-config`, {
      headers: {
        ...headers,
        "x-research-video-native-action": input.nativeActionSecret,
      },
      redirect: "error",
    }),
  ]);
  if (!snapshotResponse.ok || !runtimeResponse.ok) {
    throw new Error("Local setup is unavailable.");
  }
  const snapshot = await snapshotResponse.json();
  const paths = parseTrustedRuntimePaths(await runtimeResponse.json());
  return resolveWorkerConfiguration(snapshot, paths);
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
