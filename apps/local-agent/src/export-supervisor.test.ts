import { describe, expect, it, vi } from "vitest";

import {
  LocalExportSupervisor,
  type LocalExportSupervisorDependencies,
} from "./export-supervisor.ts";

function createHarness(
  overrides: Partial<LocalExportSupervisorDependencies> = {},
) {
  const calls: string[] = [];
  const dependencies: LocalExportSupervisorDependencies = {
    canRun: () => true,
    isDraining: () => false,
    register: async () => {
      calls.push("register");
    },
    heartbeat: async () => {
      calls.push("heartbeat");
    },
    nextAcceptedLoggedRequestId: () => undefined,
    claimLoggedRequestId: async () => undefined,
    processLogged: async (requestId) => {
      calls.push(`logged:${requestId}`);
    },
    nextExportOnlyRequestId: () => undefined,
    processExportOnly: async (requestId) => {
      calls.push(`export-only:${requestId}`);
    },
    schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => undefined,
    ...overrides,
  };
  return { calls, dependencies };
}

describe("local export supervisor", () => {
  it("starts its bounded automatic lane when enabled", async () => {
    let accepted = "accepted-automatic" as string | undefined;
    let scheduled = false;
    const processLogged = vi.fn(async () => {
      accepted = undefined;
    });
    const harness = createHarness({
      nextAcceptedLoggedRequestId: () => accepted,
      processLogged,
      schedule: (callback) => {
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(callback);
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);

    supervisor.enable();
    await vi.waitFor(() => expect(processLogged).toHaveBeenCalledTimes(1));
    await supervisor.pause();

    expect(harness.calls).toEqual(["register"]);
    expect(supervisor.snapshot().state).toBe("paused");
  });

  it("serializes logged delivery work before projectless export work", async () => {
    const harness = createHarness({
      claimLoggedRequestId: async () => "logged-1",
      nextExportOnlyRequestId: () => "local-1",
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);

    supervisor.enable();
    await supervisor.runOnce();

    expect(harness.calls).toEqual([
      "register",
      "logged:logged-1",
      "export-only:local-1",
    ]);
    expect(supervisor.snapshot()).toEqual({
      state: "idle",
      enabled: true,
      registered: true,
    });
  });

  it("recovers an accepted logged request before making a fresh claim", async () => {
    const claim = vi.fn(async () => "new-claim");
    const harness = createHarness({
      nextAcceptedLoggedRequestId: () => "accepted-before-restart",
      claimLoggedRequestId: claim,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);

    supervisor.enable();
    await supervisor.runOnce();

    expect(claim).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([
      "register",
      "logged:accepted-before-restart",
    ]);
  });

  it("never overlaps processing cycles", async () => {
    let finish!: () => void;
    const processLogged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const harness = createHarness({
      nextAcceptedLoggedRequestId: () => "accepted-1",
      processLogged,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();

    const first = supervisor.runOnce();
    const second = supervisor.runOnce();
    await vi.waitFor(() => expect(processLogged).toHaveBeenCalledTimes(1));
    finish();
    await Promise.all([first, second]);

    expect(processLogged).toHaveBeenCalledTimes(1);
  });

  it("heartbeats the same durable registration before its cloud TTL", async () => {
    let now = 0;
    const harness = createHarness({ now: () => now });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();
    await supervisor.runOnce();

    now = 20_000;
    await supervisor.runOnce();

    expect(harness.calls).toEqual(["register", "heartbeat"]);
  });

  it("does no new work while draining or paused by readiness", async () => {
    const register = vi.fn(async () => undefined);
    const draining = createHarness({
      isDraining: () => true,
      register,
    });
    const drainingSupervisor = new LocalExportSupervisor(draining.dependencies);
    drainingSupervisor.enable();
    await drainingSupervisor.runOnce();
    expect(register).not.toHaveBeenCalled();
    expect(drainingSupervisor.snapshot()).toMatchObject({
      state: "paused",
      enabled: true,
      issue: "configuration_required",
    });

    const unavailable = createHarness({
      canRun: () => false,
      register,
    });
    const unavailableSupervisor = new LocalExportSupervisor(
      unavailable.dependencies,
    );
    unavailableSupervisor.enable();
    await unavailableSupervisor.runOnce();
    expect(register).not.toHaveBeenCalled();
    expect(unavailableSupervisor.snapshot().state).toBe("paused");
  });

  it("cannot cross a pause boundary while registration is in flight", async () => {
    let releaseRegistration!: () => void;
    const claim = vi.fn(async () => "claimed-after-sign-out");
    const processLogged = vi.fn(async () => undefined);
    const harness = createHarness({
      register: () =>
        new Promise<void>((resolve) => {
          releaseRegistration = resolve;
        }),
      claimLoggedRequestId: claim,
      processLogged,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();
    const cycle = supervisor.runOnce();
    await vi.waitFor(() => expect(releaseRegistration).toBeTypeOf("function"));

    const pausing = supervisor.pause();
    releaseRegistration();
    await Promise.all([cycle, pausing]);

    expect(claim).not.toHaveBeenCalled();
    expect(processLogged).not.toHaveBeenCalled();
    expect(supervisor.snapshot()).toMatchObject({
      state: "paused",
      enabled: false,
    });
  });

  it("cannot register after pause while readiness is in flight", async () => {
    let releaseReadiness!: () => void;
    const register = vi.fn(async () => undefined);
    const harness = createHarness({
      canRun: () =>
        new Promise<boolean>((resolve) => {
          releaseReadiness = () => resolve(true);
        }),
      register,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();
    const cycle = supervisor.runOnce();
    await vi.waitFor(() => expect(releaseReadiness).toBeTypeOf("function"));

    const pausing = supervisor.pause();
    releaseReadiness();
    await Promise.all([cycle, pausing]);

    expect(register).not.toHaveBeenCalled();
    expect(supervisor.snapshot()).toEqual({
      state: "paused",
      enabled: false,
      registered: false,
    });
  });

  it("durably leaves an in-flight claim accepted without starting it after pause", async () => {
    let releaseClaim!: () => void;
    const processLogged = vi.fn(async () => undefined);
    const harness = createHarness({
      claimLoggedRequestId: () =>
        new Promise<string>((resolve) => {
          releaseClaim = () => resolve("accepted-for-later-recovery");
        }),
      processLogged,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();
    const cycle = supervisor.runOnce();
    await vi.waitFor(() => expect(releaseClaim).toBeTypeOf("function"));

    const pausing = supervisor.pause();
    releaseClaim();
    await Promise.all([cycle, pausing]);

    expect(processLogged).not.toHaveBeenCalled();
    expect(supervisor.snapshot().state).toBe("paused");
  });

  it("classifies failures without exposing their sensitive message", async () => {
    const harness = createHarness({
      register: async () => {
        throw Object.assign(new Error("token=/private/secret"), {
          statusCode: 401,
        });
      },
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();

    await expect(supervisor.runOnce()).rejects.toThrow();

    expect(supervisor.snapshot()).toEqual({
      state: "backing_off",
      enabled: true,
      registered: false,
      issue: "authentication_required",
    });
    expect(JSON.stringify(supervisor.snapshot())).not.toContain("secret");
    supervisor.enable();
    expect(supervisor.snapshot()).toMatchObject({
      state: "backing_off",
      issue: "authentication_required",
    });
  });

  it("stops fresh scheduling and waits for the active durable operation", async () => {
    let finish!: () => void;
    let operationSettled = false;
    const processLogged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            operationSettled = true;
            resolve();
          };
        }),
    );
    const harness = createHarness({
      nextAcceptedLoggedRequestId: () => "accepted-1",
      processLogged,
    });
    const supervisor = new LocalExportSupervisor(harness.dependencies);
    supervisor.enable();
    const cycle = supervisor.runOnce();
    await vi.waitFor(() =>
      expect(supervisor.snapshot().state).toBe("processing_logged"),
    );

    const stopping = supervisor.stop();
    await Promise.resolve();
    expect(operationSettled).toBe(false);
    expect(supervisor.snapshot().state).toBe("stopped");
    finish();
    await Promise.all([cycle, stopping]);
    await supervisor.runOnce();

    expect(processLogged).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({
      state: "stopped",
      enabled: false,
    });
  });
});
