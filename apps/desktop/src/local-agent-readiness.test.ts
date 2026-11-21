import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalAgentStartupTimeoutMs,
  waitForLocalAgentReady,
} from "./local-agent-readiness.ts";

function start() {
  const child = new EventEmitter();
  const report = vi.fn();
  const clear = vi.fn();
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const ready = waitForLocalAgentReady(
    child as unknown as UtilityProcess,
    report,
    clear,
  );
  return { child, ready, report, clear, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local-agent startup readiness", () => {
  it("allows slow full model validation but waits for the exact ready message and health", async () => {
    vi.useFakeTimers();
    const { child, ready, report, clear, fetch } = start();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(report).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    child.emit("message", { type: "local-agent-ready", port: 0 });
    child.emit("message", {
      type: "local-agent-ready",
      port: 43123,
      extra: true,
    });
    expect(report).not.toHaveBeenCalled();
    child.emit("message", { type: "local-agent-ready", port: 43123 });
    await ready;
    expect(report).toHaveBeenCalledExactlyOnceWith(43123);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:43123/health",
    );
    expect(clear).not.toHaveBeenCalled();
    expect(child.listenerCount("message")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still bounds startup and ignores late messages after the deadline", async () => {
    vi.useFakeTimers();
    const { child, ready, report, fetch } = start();
    const rejected = expect(ready).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(LocalAgentStartupTimeoutMs);
    await rejected;
    child.emit("message", { type: "local-agent-ready", port: 43123 });
    expect(report).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(child.listenerCount("exit")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails immediately if the child exits", async () => {
    vi.useFakeTimers();
    const { child, ready, report } = start();
    const rejected = expect(ready).rejects.toThrow("failed before readiness");
    child.emit("exit", 1);
    await rejected;
    expect(report).not.toHaveBeenCalled();
    expect(child.listenerCount("message")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a reported endpoint if its health check fails", async () => {
    const { child, ready, clear, fetch } = start();
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const rejected = expect(ready).rejects.toThrow("health check failed");
    child.emit("message", { type: "local-agent-ready", port: 43123 });
    await rejected;
    expect(clear).toHaveBeenCalledExactlyOnceWith(43123);
  });
});
