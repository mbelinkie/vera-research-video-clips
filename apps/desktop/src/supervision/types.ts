/**
 * The desktop shell supplies the concrete Electron utility-process adapter.
 * This boundary deliberately contains no executable paths, arguments, URLs,
 * tokens, child output, or error messages so it is safe to surface as status.
 */
export const supervisedServiceNames = [
  "local-agent",
  "transcription-worker",
  "export-worker",
] as const;

export type SupervisedServiceName = (typeof supervisedServiceNames)[number];

export type ProcessExit = Readonly<{
  kind: "clean" | "unexpected" | "launch_failed";
}>;

export interface SupervisedProcess {
  /** Resolves only after the process reports that it has started. */
  readonly started: Promise<void>;
  /** Resolves when the process exits. Process details stay in the adapter. */
  readonly exited: Promise<ProcessExit>;
  terminate(): void | Promise<void>;
  kill(): void | Promise<void>;
}

export interface ProcessLauncher {
  launch(service: SupervisedServiceName): Promise<SupervisedProcess>;
}

export type ServiceHealthState =
  | "stopped"
  | "starting"
  | "healthy"
  | "backing_off"
  | "stopping"
  | "unhealthy"
  | "shutting_down";

export type ServiceTransition =
  | "none"
  | "started"
  | "exited"
  | "restart_scheduled"
  | "restart_exhausted"
  | "stop_requested"
  | "shutdown_requested"
  | "termination_forced";

export type ServiceHealth = Readonly<{
  service: SupervisedServiceName;
  state: ServiceHealthState;
  restartCount: number;
  lastTransition: ServiceTransition;
}>;

/** A closed, fail-closed subset of the M6 runtime response. */
export type RuntimeQuiescence = Readonly<{
  draining: boolean;
  safeToStop: boolean;
}>;

export interface RuntimeControl {
  requestDrain(): Promise<RuntimeQuiescence>;
  readQuiescence(): Promise<RuntimeQuiescence>;
}

export interface RestartPolicy {
  readonly maxRestarts: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
}

export interface ShutdownPolicy {
  readonly quiescencePollMs: number;
  readonly quiescenceTimeoutMs: number;
  readonly gracefulTerminationMs: number;
}

export type ShutdownQuiescence = "safe" | "timeout" | "unavailable";

export type ShutdownDrain = "requested" | "unavailable";

export type ShutdownResult = Readonly<{
  drain: ShutdownDrain;
  quiescence: ShutdownQuiescence;
  forcedServices: readonly SupervisedServiceName[];
}>;

export type StopResult = Readonly<{
  forced: boolean;
}>;

export type SupervisionOptions = Readonly<{
  launcher: ProcessLauncher;
  runtimeControl: RuntimeControl;
  restartPolicy?: Partial<RestartPolicy>;
  shutdownPolicy?: Partial<ShutdownPolicy>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;
