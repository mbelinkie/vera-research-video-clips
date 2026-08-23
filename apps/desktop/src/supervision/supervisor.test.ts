import { describe, expect, it, vi } from "vitest";

import { createHttpRuntimeControl } from "./http-runtime-control.js";
import { LocalServiceSupervisor } from "./supervisor.js";
import type {
  ProcessExit,
  RuntimeControl,
  SupervisedProcess,
} from "./types.js";

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const processFixture = (options: { exitOnTerminate?: boolean } = {}) => {
  const started = deferred<void>();
  const exited = deferred<ProcessExit>();
  const terminate = vi.fn(async () => {
    if (options.exitOnTerminate) exited.resolve({ kind: "clean" });
  });
  const kill = vi.fn(async () => undefined);
  const process: SupervisedProcess = {
    started: started.promise,
    exited: exited.promise,
    terminate,
    kill,
  };
  return { process, started, exited, terminate, kill };
};

const runningRuntime = (safeToStop = true): RuntimeControl => ({
  requestDrain: vi.fn(async () => ({ draining: true, safeToStop })),
  readQuiescence: vi.fn(async () => ({ draining: true, safeToStop })),
});

const immediateSleep = async (): Promise<void> => undefined;

describe("LocalServiceSupervisor", () => {
  it("observes a healthy start without exposing process detail in health", async () => {
    const child = processFixture();
    const launcher = { launch: vi.fn(async () => child.process) };
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher,
      runtimeControl: runningRuntime(),
      sleep: immediateSleep,
    });

    const start = supervisor.startAll();
    child.started.resolve();
    await start;

    expect(supervisor.getStatus()).toEqual([
      {
        service: "local-agent",
        state: "healthy",
        restartCount: 0,
        lastTransition: "started",
      },
    ]);
    expect(JSON.stringify(supervisor.getStatus())).not.toContain("token");
    expect(JSON.stringify(supervisor.getStatus())).not.toContain("/");
  });

  it("caps exponential restart attempts and becomes unhealthy", async () => {
    const first = processFixture();
    const second = processFixture();
    const third = processFixture();
    const children = [first, second, third];
    let nextChild = 0;
    const launcher = {
      launch: vi.fn(async () => children[nextChild++]!.process),
    };
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher,
      runtimeControl: runningRuntime(),
      restartPolicy: { maxRestarts: 2, initialBackoffMs: 1, maxBackoffMs: 2 },
      sleep: immediateSleep,
    });

    const start = supervisor.startAll();
    first.started.resolve();
    await start;
    first.exited.resolve({ kind: "unexpected" });
    await vi.waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(2));
    second.started.resolve();
    await vi.waitFor(() =>
      expect(supervisor.getStatus()[0]?.state).toBe("healthy"),
    );

    second.exited.resolve({ kind: "unexpected" });
    await vi.waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(3));
    third.started.resolve();
    await vi.waitFor(() =>
      expect(supervisor.getStatus()[0]?.state).toBe("healthy"),
    );

    third.exited.resolve({ kind: "unexpected" });
    await vi.waitFor(() =>
      expect(supervisor.getStatus()[0]).toMatchObject({
        state: "unhealthy",
        restartCount: 2,
        lastTransition: "restart_exhausted",
      }),
    );
  });

  it("terminates a spawned child whose readiness check fails", async () => {
    const child = processFixture({ exitOnTerminate: true });
    const process: SupervisedProcess = {
      ...child.process,
      started: Promise.reject(new Error("readiness failed")),
    };
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher: { launch: vi.fn(async () => process) },
      runtimeControl: runningRuntime(),
      sleep: () => new Promise(() => undefined),
    });

    await supervisor.start("local-agent");

    expect(child.terminate).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    expect(supervisor.getStatus()[0]).toMatchObject({ state: "backing_off" });
  });

  it("drains, observes safe quiescence, then gracefully terminates", async () => {
    const child = processFixture({ exitOnTerminate: true });
    const runtime = runningRuntime(true);
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher: { launch: vi.fn(async () => child.process) },
      runtimeControl: runtime,
      sleep: immediateSleep,
    });
    const start = supervisor.startAll();
    child.started.resolve();
    await start;

    await expect(supervisor.shutdown()).resolves.toEqual({
      drain: "requested",
      quiescence: "safe",
      forcedServices: [],
    });
    expect(runtime.requestDrain).toHaveBeenCalledOnce();
    expect(runtime.readQuiescence).toHaveBeenCalledOnce();
    expect(child.terminate).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("times out unsafe quiescence and force-kills a nonresponsive child", async () => {
    const child = processFixture();
    let clock = 0;
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher: { launch: vi.fn(async () => child.process) },
      runtimeControl: runningRuntime(false),
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      shutdownPolicy: {
        quiescencePollMs: 5,
        quiescenceTimeoutMs: 10,
        gracefulTerminationMs: 5,
      },
    });
    const start = supervisor.startAll();
    child.started.resolve();
    await start;

    await expect(supervisor.shutdown()).resolves.toEqual({
      drain: "requested",
      quiescence: "timeout",
      forcedServices: ["local-agent"],
    });
    expect(child.terminate).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not restart a crashing child after shutdown has begun", async () => {
    const child = processFixture();
    const drain = deferred<{ draining: boolean; safeToStop: boolean }>();
    const runtime: RuntimeControl = {
      requestDrain: vi.fn(() => drain.promise),
      readQuiescence: vi.fn(async () => ({ draining: true, safeToStop: true })),
    };
    const launcher = { launch: vi.fn(async () => child.process) };
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher,
      runtimeControl: runtime,
      sleep: immediateSleep,
    });
    const start = supervisor.startAll();
    child.started.resolve();
    await start;

    const shutdown = supervisor.shutdown();
    child.exited.resolve({ kind: "unexpected" });
    drain.resolve({ draining: true, safeToStop: true });
    await shutdown;

    expect(launcher.launch).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()[0]).toMatchObject({ state: "stopped" });
  });

  it("intentionally stops one service without restarting it, then permits a new start", async () => {
    const first = processFixture({ exitOnTerminate: true });
    const second = processFixture();
    const children = [first, second];
    let nextChild = 0;
    const launcher = {
      launch: vi.fn(async () => children[nextChild++]!.process),
    };
    const runtime = runningRuntime();
    const supervisor = new LocalServiceSupervisor(["transcription-worker"], {
      launcher,
      runtimeControl: runtime,
      sleep: immediateSleep,
    });
    const initialStart = supervisor.start("transcription-worker");
    first.started.resolve();
    await initialStart;

    await expect(supervisor.stop("transcription-worker")).resolves.toEqual({
      forced: false,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(first.kill).not.toHaveBeenCalled();
    expect(runtime.requestDrain).not.toHaveBeenCalled();
    expect(launcher.launch).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()[0]).toMatchObject({
      state: "stopped",
      lastTransition: "stop_requested",
    });

    const restart = supervisor.start("transcription-worker");
    second.started.resolve();
    await restart;
    expect(launcher.launch).toHaveBeenCalledTimes(2);
    expect(supervisor.getStatus()[0]).toMatchObject({
      state: "healthy",
      restartCount: 0,
      lastTransition: "started",
    });
  });

  it("force-kills an intentionally stopped nonresponsive service", async () => {
    const child = processFixture();
    let clock = 0;
    const supervisor = new LocalServiceSupervisor(["export-worker"], {
      launcher: { launch: vi.fn(async () => child.process) },
      runtimeControl: runningRuntime(),
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      shutdownPolicy: { gracefulTerminationMs: 5 },
    });
    const start = supervisor.start("export-worker");
    child.started.resolve();
    await start;

    await expect(supervisor.stop("export-worker")).resolves.toEqual({
      forced: true,
    });
    expect(child.terminate).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()[0]).toMatchObject({
      state: "stopped",
      lastTransition: "termination_forced",
    });
  });

  it("cancels a pending backoff when a service is intentionally stopped", async () => {
    const first = processFixture();
    const sleepResolvers: Array<() => void> = [];
    const launcher = { launch: vi.fn(async () => first.process) };
    const supervisor = new LocalServiceSupervisor(["local-agent"], {
      launcher,
      runtimeControl: runningRuntime(),
      sleep: async () =>
        new Promise<void>((resolve) => {
          sleepResolvers.push(resolve);
        }),
    });
    const start = supervisor.startAll();
    first.started.resolve();
    await start;
    first.exited.resolve({ kind: "unexpected" });
    await vi.waitFor(() =>
      expect(supervisor.getStatus()[0]).toMatchObject({ state: "backing_off" }),
    );

    await supervisor.stop("local-agent");
    expect(launcher.launch).toHaveBeenCalledOnce();
    sleepResolvers.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();

    expect(launcher.launch).toHaveBeenCalledOnce();
    expect(supervisor.getStatus()[0]).toMatchObject({ state: "stopped" });
  });
});

describe("createHttpRuntimeControl", () => {
  it("uses only authenticated M6 runtime routes and accepts the drain envelope", async () => {
    const transport = {
      request: vi.fn(async () => ({
        status: 200,
        body: { quiescence: { draining: true, safeToStop: true } },
      })),
    };
    const runtime = createHttpRuntimeControl(
      transport,
      "Bearer local-session-secret",
    );

    await expect(runtime.requestDrain()).resolves.toEqual({
      draining: true,
      safeToStop: true,
    });
    expect(transport.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/runtime/drain",
      authorization: "Bearer local-session-secret",
    });
  });
});
