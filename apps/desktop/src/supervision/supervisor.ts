import type {
  ProcessExit,
  RestartPolicy,
  RuntimeQuiescence,
  ServiceHealth,
  ShutdownPolicy,
  ShutdownQuiescence,
  ShutdownResult,
  StopResult,
  SupervisedProcess,
  SupervisedServiceName,
  SupervisionOptions,
} from "./types.js";

const defaultRestartPolicy: RestartPolicy = {
  maxRestarts: 3,
  initialBackoffMs: 250,
  maxBackoffMs: 5_000,
};

const defaultShutdownPolicy: ShutdownPolicy = {
  quiescencePollMs: 250,
  quiescenceTimeoutMs: 10_000,
  gracefulTerminationMs: 5_000,
};

type ServiceState = {
  readonly service: SupervisedServiceName;
  process: SupervisedProcess | undefined;
  pendingLaunch: Promise<SupervisedProcess> | undefined;
  terminationTask: Promise<boolean> | undefined;
  intentionalStop: boolean;
  lifecycleGeneration: number;
  state: ServiceHealth["state"];
  restartCount: number;
  lastTransition: ServiceHealth["lastTransition"];
};

/**
 * Pure policy for supervising local child processes. Its adapters own Electron,
 * local URLs, child arguments, and credentials; observable state stays closed.
 */
export class LocalServiceSupervisor {
  readonly #launcher;
  readonly #runtimeControl;
  readonly #restartPolicy: RestartPolicy;
  readonly #shutdownPolicy: ShutdownPolicy;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #services = new Map<SupervisedServiceName, ServiceState>();
  #shuttingDown = false;

  constructor(
    services: readonly SupervisedServiceName[],
    options: SupervisionOptions,
  ) {
    if (new Set(services).size !== services.length || services.length === 0) {
      throw new Error("Supervision requires unique services.");
    }
    this.#launcher = options.launcher;
    this.#runtimeControl = options.runtimeControl;
    this.#restartPolicy = resolveRestartPolicy(options.restartPolicy);
    this.#shutdownPolicy = resolveShutdownPolicy(options.shutdownPolicy);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
    for (const service of services) {
      this.#services.set(service, {
        service,
        process: undefined,
        pendingLaunch: undefined,
        terminationTask: undefined,
        intentionalStop: false,
        lifecycleGeneration: 0,
        state: "stopped",
        restartCount: 0,
        lastTransition: "none",
      });
    }
  }

  getStatus(): readonly ServiceHealth[] {
    return [...this.#services.values()].map((service) => ({
      service: service.service,
      state: service.state,
      restartCount: service.restartCount,
      lastTransition: service.lastTransition,
    }));
  }

  async startAll(): Promise<void> {
    await Promise.all(
      [...this.#services.keys()].map((service) => this.start(service)),
    );
  }

  async start(serviceName: SupervisedServiceName): Promise<void> {
    await this.#start(serviceName, true);
  }

  async #start(
    serviceName: SupervisedServiceName,
    manuallyRequested: boolean,
  ): Promise<void> {
    const service = this.#requireService(serviceName);
    if (
      this.#shuttingDown ||
      service.state === "starting" ||
      service.state === "healthy" ||
      service.state === "backing_off" ||
      service.state === "stopping" ||
      service.state === "shutting_down"
    ) {
      return;
    }

    service.intentionalStop = false;
    if (manuallyRequested) {
      service.lifecycleGeneration += 1;
      service.restartCount = 0;
    }
    service.state = "starting";
    let launch: Promise<SupervisedProcess> | undefined;
    try {
      launch = this.#launcher.launch(service.service);
      service.pendingLaunch = launch;
      const process = await launch;
      if (service.pendingLaunch === launch) service.pendingLaunch = undefined;
      service.process = process;
      void process.exited.then(
        (exit) => this.#observeExit(service, process, exit),
        () => this.#observeExit(service, process, { kind: "unexpected" }),
      );
      if (this.#shuttingDown || service.intentionalStop) {
        service.state = this.#shuttingDown ? "shutting_down" : "stopping";
        void process.started.catch(() => undefined);
        return;
      }
      await process.started;
      if (
        !this.#shuttingDown &&
        service.process === process &&
        service.state === "starting"
      ) {
        service.state = "healthy";
        service.lastTransition = "started";
      }
    } catch {
      if (service.pendingLaunch === launch) service.pendingLaunch = undefined;
      if (!this.#shuttingDown && service.state === "starting") {
        const failedProcess = service.process;
        service.process = undefined;
        if (failedProcess) await this.#terminateFailedStart(failedProcess);
        this.#scheduleRestart(service);
      }
    }
  }

  /**
   * Intentionally stop one service (for example, during sign-out) without
   * poisoning the supervisor. A later explicit start is permitted.
   */
  async stop(serviceName: SupervisedServiceName): Promise<StopResult> {
    const service = this.#requireService(serviceName);
    if (this.#shuttingDown) return { forced: false };
    service.intentionalStop = true;
    service.lifecycleGeneration += 1;
    service.state = "stopping";
    service.lastTransition = "stop_requested";
    const forced = await this.#terminateService(service);
    return { forced };
  }

  async shutdown(): Promise<ShutdownResult> {
    this.#shuttingDown = true;
    for (const service of this.#services.values()) {
      service.intentionalStop = true;
      service.state = "shutting_down";
      service.lastTransition = "shutdown_requested";
    }

    const drain = await this.#requestDrain();
    const quiescence = await this.#waitForQuiescence();
    const forcedServices = (
      await Promise.all(
        [...this.#services.values()].map(async (service) =>
          (await this.#terminateService(service)) ? service.service : undefined,
        ),
      )
    ).filter(
      (service): service is SupervisedServiceName => service !== undefined,
    );

    return { drain, quiescence, forcedServices };
  }

  #observeExit(
    service: ServiceState,
    process: SupervisedProcess,
    _exit: ProcessExit,
  ): void {
    if (service.process !== process) return;
    service.process = undefined;
    if (this.#shuttingDown || service.intentionalStop) {
      service.state = "stopped";
      return;
    }
    service.lastTransition = "exited";
    this.#scheduleRestart(service);
  }

  #scheduleRestart(service: ServiceState): void {
    if (this.#shuttingDown || service.intentionalStop) return;
    if (service.restartCount >= this.#restartPolicy.maxRestarts) {
      service.state = "unhealthy";
      service.lastTransition = "restart_exhausted";
      return;
    }
    service.restartCount += 1;
    service.state = "backing_off";
    service.lastTransition = "restart_scheduled";
    const generation = service.lifecycleGeneration;
    const delayMs = Math.min(
      this.#restartPolicy.initialBackoffMs * 2 ** (service.restartCount - 1),
      this.#restartPolicy.maxBackoffMs,
    );
    void this.#sleep(delayMs).then(() => {
      if (
        !this.#shuttingDown &&
        !service.intentionalStop &&
        service.lifecycleGeneration === generation &&
        service.state === "backing_off"
      ) {
        service.state = "stopped";
        return this.#start(service.service, false);
      }
      return undefined;
    });
  }

  async #requestDrain(): Promise<ShutdownResult["drain"]> {
    try {
      await this.#runtimeControl.requestDrain();
      return "requested";
    } catch {
      return "unavailable";
    }
  }

  async #waitForQuiescence(): Promise<ShutdownQuiescence> {
    const deadline = this.#now() + this.#shutdownPolicy.quiescenceTimeoutMs;
    const attempts =
      Math.floor(
        this.#shutdownPolicy.quiescenceTimeoutMs /
          this.#shutdownPolicy.quiescencePollMs,
      ) + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let quiescence: RuntimeQuiescence;
      try {
        quiescence = await this.#runtimeControl.readQuiescence();
      } catch {
        return "unavailable";
      }
      if (quiescence.draining && quiescence.safeToStop) return "safe";
      if (attempt + 1 < attempts) {
        const remaining = Math.max(0, deadline - this.#now());
        await this.#sleep(
          Math.min(this.#shutdownPolicy.quiescencePollMs, remaining),
        );
      }
    }
    return "timeout";
  }

  async #terminateService(service: ServiceState): Promise<boolean> {
    if (service.terminationTask) return service.terminationTask;
    const task = this.#terminateServiceOnce(service);
    service.terminationTask = task;
    try {
      return await task;
    } finally {
      if (service.terminationTask === task) service.terminationTask = undefined;
    }
  }

  async #terminateServiceOnce(service: ServiceState): Promise<boolean> {
    const process =
      service.process ??
      (service.pendingLaunch
        ? await service.pendingLaunch.catch(() => undefined)
        : undefined);
    if (!process) {
      service.state = "stopped";
      return false;
    }
    service.process = process;
    try {
      await process.terminate();
    } catch {
      // A failed graceful signal still receives one forced-kill attempt below.
    }
    const gracefulExit = await this.#waitForExit(
      process,
      this.#shutdownPolicy.gracefulTerminationMs,
    );
    if (gracefulExit) {
      service.process = undefined;
      service.state = "stopped";
      return false;
    }
    try {
      await process.kill();
    } catch {
      // There is no safe retry after the bounded forced-kill attempt.
    }
    service.process = undefined;
    service.state = "stopped";
    service.lastTransition = "termination_forced";
    return true;
  }

  async #terminateFailedStart(process: SupervisedProcess): Promise<void> {
    try {
      await process.terminate();
    } catch {
      // A failed signal still receives one bounded forced-kill attempt.
    }
    if (
      await this.#waitForExit(
        process,
        this.#shutdownPolicy.gracefulTerminationMs,
      )
    ) {
      return;
    }
    try {
      await process.kill();
    } catch {
      // Startup cleanup has no broader authority after one forced attempt.
    }
  }

  async #waitForExit(
    process: SupervisedProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    return Promise.race([
      process.exited.then(
        () => true,
        () => true,
      ),
      this.#sleep(timeoutMs).then(() => false),
    ]);
  }

  #requireService(service: SupervisedServiceName): ServiceState {
    const result = this.#services.get(service);
    if (!result) throw new Error("Unknown supervised service.");
    return result;
  }
}

const resolveRestartPolicy = (
  input: Partial<RestartPolicy> | undefined,
): RestartPolicy => {
  const policy = { ...defaultRestartPolicy, ...input };
  assertPositiveInteger(policy.maxRestarts);
  assertPositiveInteger(policy.initialBackoffMs);
  assertPositiveInteger(policy.maxBackoffMs);
  if (policy.maxBackoffMs < policy.initialBackoffMs) {
    throw new Error("Invalid restart policy.");
  }
  return policy;
};

const resolveShutdownPolicy = (
  input: Partial<ShutdownPolicy> | undefined,
): ShutdownPolicy => {
  const policy = { ...defaultShutdownPolicy, ...input };
  assertPositiveInteger(policy.quiescencePollMs);
  assertPositiveInteger(policy.quiescenceTimeoutMs);
  assertPositiveInteger(policy.gracefulTerminationMs);
  return policy;
};

const assertPositiveInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invalid supervision configuration.");
  }
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
