import { describe, expect, it, vi } from "vitest";

import type { LocalRuntimeQuiescenceEvidence } from "@research-video/db-local";
import type {
  MediaCommandResult,
  MediaCommandRunner,
} from "@research-video/media";

import {
  LocalRuntimeCoordinator,
  LocalRuntimeDrainingError,
  LocalRuntimeOperationConflictError,
} from "./local-runtime.ts";

const idleEvidence = (): LocalRuntimeQuiescenceEvidence => ({
  pendingAcceptance: 0,
  accepted: 0,
  executing: 0,
  complete: 0,
  failed: 0,
  canceled: 0,
  needsAttention: 0,
  recoveryRequired: 0,
  activeSourceLifecycleCount: 0,
});

describe("local runtime coordinator", () => {
  it("drains idempotently and orders new claims against active work", () => {
    const runtime = new LocalRuntimeCoordinator(
      idleEvidence,
      () => new Date("2026-08-23T12:00:00.000Z"),
    );
    const active = runtime.beginOperation("export", {
      exclusiveKey: "claim",
    });
    const first = runtime.beginDrain();
    const second = runtime.beginDrain();
    expect(first.operation).toEqual(second.operation);
    expect(first.quiescence).toMatchObject({
      draining: true,
      safeToStop: false,
      activeOperationCount: 1,
      activeOperations: { export: 1 },
    });
    expect(() => runtime.beginOperation("export")).toThrow(
      LocalRuntimeDrainingError,
    );
    const recovery = runtime.beginOperation("export", {
      allowDuringDrain: true,
      exclusiveKey: "recovery",
    });
    expect(() =>
      runtime.beginOperation("export", {
        allowDuringDrain: true,
        exclusiveKey: "recovery",
      }),
    ).toThrow(LocalRuntimeOperationConflictError);
    recovery.finish();
    active.finish();
    active.finish();
    expect(runtime.getQuiescence()).toMatchObject({
      safeToStop: true,
      activeOperationCount: 0,
    });
  });

  it("counts a media child until the exact runner promise settles", async () => {
    let finish!: () => void;
    const delegate: MediaCommandRunner = {
      run: vi.fn(
        () =>
          new Promise<MediaCommandResult>((resolve) => {
            finish = () => resolve({ stdout: "sensitive", stderr: "secret" });
          }),
      ),
    };
    const runtime = new LocalRuntimeCoordinator(idleEvidence);
    const runner = runtime.createTrackingMediaCommandRunner(delegate);
    const command = runner.run("ffmpeg", ["/private/source.mp4"]);
    expect(runtime.beginDrain().quiescence).toMatchObject({
      safeToStop: false,
      activeChildProcessCount: 1,
    });
    expect(JSON.stringify(runtime.getQuiescence())).not.toContain("private");
    expect(JSON.stringify(runtime.getQuiescence())).not.toContain("ffmpeg");
    finish();
    await command;
    expect(runtime.getQuiescence()).toMatchObject({
      safeToStop: true,
      activeChildProcessCount: 0,
    });
  });

  it("reconstructs unsafe execution and cleanup truth after process restart", () => {
    const unsafe = new LocalRuntimeCoordinator(() => ({
      ...idleEvidence(),
      executing: 1,
      recoveryRequired: 1,
      activeSourceLifecycleCount: 2,
    }));
    expect(unsafe.beginDrain().quiescence).toMatchObject({
      draining: true,
      safeToStop: false,
      activeChildProcessCount: 0,
      activeSourceLifecycleCount: 2,
      durableWork: { executing: 1, recoveryRequired: 1 },
    });

    const checkpointed = new LocalRuntimeCoordinator(() => ({
      ...idleEvidence(),
      executing: 1,
      recoveryRequired: 1,
    }));
    expect(checkpointed.beginDrain().quiescence).toMatchObject({
      safeToStop: true,
      durableWork: { executing: 1, recoveryRequired: 1 },
    });

    const restarted = new LocalRuntimeCoordinator(idleEvidence);
    expect(restarted.getQuiescence().draining).toBe(false);
    expect(restarted.beginDrain().quiescence.safeToStop).toBe(true);
  });
});
