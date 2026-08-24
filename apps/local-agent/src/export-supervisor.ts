const RegistrationRefreshMs = 45_000;
const HeartbeatIntervalMs = 20_000;
const IdleDelayMs = 5_000;
const ErrorDelayMs = 1_000;
const MaxErrorDelayMs = 30_000;

export type LocalExportSupervisorState =
  | "paused"
  | "idle"
  | "processing_logged"
  | "processing_export_only"
  | "backing_off"
  | "stopped";

export type LocalExportSupervisorIssue =
  | "authentication_required"
  | "cloud_unavailable"
  | "configuration_required"
  | "worker_unavailable";

export type LocalExportSupervisorSnapshot = Readonly<{
  state: LocalExportSupervisorState;
  enabled: boolean;
  registered: boolean;
  issue?: LocalExportSupervisorIssue;
}>;

export interface LocalExportSupervisorDependencies {
  canRun(): boolean | Promise<boolean>;
  isDraining(): boolean;
  register(): Promise<void>;
  heartbeat(): Promise<void>;
  nextAcceptedLoggedRequestId(): string | undefined;
  claimLoggedRequestId(): Promise<string | undefined>;
  processLogged(requestId: string): Promise<void>;
  nextExportOnlyRequestId(): string | undefined;
  processExportOnly(requestId: string): Promise<void>;
  now?(): number;
  schedule?(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  cancelSchedule?(timer: ReturnType<typeof setTimeout>): void;
}

/**
 * One bounded scheduler around the existing durable export boundaries. It does
 * not own acquisition, rendering, cancellation, reconciliation, or cleanup.
 */
export class LocalExportSupervisor {
  readonly #now: () => number;
  readonly #schedule: NonNullable<
    LocalExportSupervisorDependencies["schedule"]
  >;
  readonly #cancelSchedule: NonNullable<
    LocalExportSupervisorDependencies["cancelSchedule"]
  >;
  #enabled = false;
  #stopped = false;
  #registeredAt: number | undefined;
  #heartbeatAt: number | undefined;
  #state: LocalExportSupervisorState = "paused";
  #issue: LocalExportSupervisorIssue | undefined;
  #failures = 0;
  #cycle: Promise<void> | undefined;
  #registration: Promise<void> | undefined;
  #loopTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #processedWork = false;

  constructor(
    private readonly dependencies: LocalExportSupervisorDependencies,
  ) {
    this.#now = dependencies.now ?? Date.now;
    this.#schedule = dependencies.schedule ?? setTimeout;
    this.#cancelSchedule = dependencies.cancelSchedule ?? clearTimeout;
  }

  enable(): void {
    if (this.#stopped) return;
    if (this.#enabled) {
      this.#scheduleLoop(0);
      return;
    }
    this.#enabled = true;
    this.#issue = undefined;
    if (this.#state === "paused" || this.#state === "backing_off") {
      this.#state = "idle";
    }
    this.#scheduleLoop(0);
  }

  async pause(): Promise<void> {
    if (this.#stopped) return;
    this.#enabled = false;
    this.#registeredAt = undefined;
    this.#heartbeatAt = undefined;
    this.#state = "paused";
    this.#clearTimers();
    await Promise.allSettled(
      [this.#cycle, this.#registration].filter(
        (operation): operation is Promise<void> => operation !== undefined,
      ),
    );
    this.#registeredAt = undefined;
    this.#heartbeatAt = undefined;
    if (!this.#stopped) this.#state = "paused";
  }

  async stop(): Promise<void> {
    this.#enabled = false;
    this.#stopped = true;
    this.#state = "stopped";
    this.#clearTimers();
    await Promise.allSettled(
      [this.#cycle, this.#registration].filter(
        (operation): operation is Promise<void> => operation !== undefined,
      ),
    );
    this.#registeredAt = undefined;
    this.#heartbeatAt = undefined;
    this.#state = "stopped";
  }

  snapshot(): LocalExportSupervisorSnapshot {
    return {
      state: this.#state,
      enabled: this.#enabled,
      registered: this.#registeredAt !== undefined,
      ...(this.#issue ? { issue: this.#issue } : {}),
    };
  }

  async runOnce(): Promise<void> {
    if (this.#cycle) return this.#cycle;
    this.#cycle = this.#runCycle().finally(() => {
      this.#cycle = undefined;
    });
    return this.#cycle;
  }

  async #runCycle(): Promise<void> {
    if (!this.#enabled || this.#stopped) return;
    this.#processedWork = false;
    if (this.dependencies.isDraining() || !(await this.dependencies.canRun())) {
      this.#registeredAt = undefined;
      this.#heartbeatAt = undefined;
      this.#state = "paused";
      this.#issue = "configuration_required";
      return;
    }
    if (!this.#canStartWork()) return;

    try {
      await this.#ensureRegistered();
      if (!this.#canStartWork()) return;
      let loggedRequestId = this.dependencies.nextAcceptedLoggedRequestId();
      if (!loggedRequestId) {
        if (!this.#canStartWork()) return;
        loggedRequestId = await this.dependencies.claimLoggedRequestId();
      }
      if (!this.#canStartWork()) return;
      if (loggedRequestId) {
        this.#processedWork = true;
        this.#state = "processing_logged";
        await this.dependencies.processLogged(loggedRequestId);
      }

      if (!this.#canStartWork()) return;
      const exportOnlyRequestId = this.dependencies.nextExportOnlyRequestId();
      if (exportOnlyRequestId) {
        if (!this.#canStartWork()) return;
        this.#processedWork = true;
        this.#state = "processing_export_only";
        await this.dependencies.processExportOnly(exportOnlyRequestId);
      }
      this.#failures = 0;
      this.#issue = undefined;
      this.#state = "idle";
    } catch (error) {
      this.#registeredAt = undefined;
      this.#heartbeatAt = undefined;
      this.#failures += 1;
      this.#issue = classifySupervisorIssue(error);
      this.#state = "backing_off";
      throw error;
    }
  }

  async #ensureRegistered(): Promise<void> {
    const now = this.#now();
    if (
      this.#registeredAt === undefined ||
      now - this.#registeredAt >= RegistrationRefreshMs
    ) {
      await this.#serializeRegistration(async () => {
        await this.dependencies.register();
        if (!this.#canStartWork()) return;
        const registeredAt = this.#now();
        this.#registeredAt = registeredAt;
        this.#heartbeatAt = registeredAt;
        this.#scheduleHeartbeat();
      });
      return;
    }
    if (
      this.#heartbeatAt === undefined ||
      now - this.#heartbeatAt >= HeartbeatIntervalMs
    ) {
      await this.#heartbeat();
    }
  }

  #canStartWork(): boolean {
    return this.#enabled && !this.#stopped && !this.dependencies.isDraining();
  }

  async #heartbeat(): Promise<void> {
    await this.#serializeRegistration(async () => {
      if (!this.#enabled || this.#stopped || this.dependencies.isDraining()) {
        return;
      }
      if (!(await this.dependencies.canRun())) {
        this.#registeredAt = undefined;
        this.#heartbeatAt = undefined;
        return;
      }
      if (!this.#canStartWork()) return;
      await this.dependencies.heartbeat();
      if (!this.#canStartWork()) return;
      this.#heartbeatAt = this.#now();
    });
  }

  async #serializeRegistration(operation: () => Promise<void>): Promise<void> {
    if (this.#registration) return this.#registration;
    this.#registration = operation().finally(() => {
      this.#registration = undefined;
    });
    return this.#registration;
  }

  #scheduleLoop(delayMs: number): void {
    if (!this.#enabled || this.#stopped || this.#loopTimer) return;
    this.#loopTimer = this.#schedule(() => {
      this.#loopTimer = undefined;
      void this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          if (!this.#enabled || this.#stopped) return;
          const delay =
            this.#state === "backing_off"
              ? Math.min(
                  ErrorDelayMs * 2 ** Math.max(0, this.#failures - 1),
                  MaxErrorDelayMs,
                )
              : IdleDelayMs;
          const nextDelay =
            this.#state === "backing_off"
              ? delay
              : this.#processedWork
                ? 0
                : delay;
          this.#scheduleLoop(nextDelay);
        });
    }, delayMs);
  }

  #scheduleHeartbeat(): void {
    if (!this.#enabled || this.#stopped || this.#heartbeatTimer) return;
    this.#heartbeatTimer = this.#schedule(() => {
      this.#heartbeatTimer = undefined;
      void this.#heartbeat()
        .catch((error) => {
          this.#registeredAt = undefined;
          this.#heartbeatAt = undefined;
          this.#issue = classifySupervisorIssue(error);
          this.#state = "backing_off";
        })
        .finally(() => this.#scheduleHeartbeat());
    }, HeartbeatIntervalMs);
  }

  #clearTimers(): void {
    if (this.#loopTimer) this.#cancelSchedule(this.#loopTimer);
    if (this.#heartbeatTimer) this.#cancelSchedule(this.#heartbeatTimer);
    this.#loopTimer = undefined;
    this.#heartbeatTimer = undefined;
  }
}

function classifySupervisorIssue(error: unknown): LocalExportSupervisorIssue {
  const candidate = error as { statusCode?: number; code?: string };
  if (
    candidate.statusCode === 401 ||
    candidate.statusCode === 403 ||
    candidate.code === "authentication_required" ||
    candidate.code === "authorization_denied"
  ) {
    return "authentication_required";
  }
  if (
    candidate.statusCode === 502 ||
    candidate.statusCode === 503 ||
    candidate.code?.includes("cloud")
  ) {
    return "cloud_unavailable";
  }
  if (
    candidate.code?.includes("configuration") ||
    candidate.code?.includes("provider") ||
    candidate.code?.includes("tool")
  ) {
    return "configuration_required";
  }
  return "worker_unavailable";
}
