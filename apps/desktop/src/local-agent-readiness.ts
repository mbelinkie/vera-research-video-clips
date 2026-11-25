import type { UtilityProcess } from "electron";

// Cold startup includes full checksum verification of the approved speech model.
// Keep the deadline bounded, but allow slow disks to finish verifying it.
export const LocalAgentStartupTimeoutMs = 120_000;

export async function waitForLocalAgentReady(
  child: Pick<UtilityProcess, "on" | "once" | "removeListener">,
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
    }, LocalAgentStartupTimeoutMs);
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
