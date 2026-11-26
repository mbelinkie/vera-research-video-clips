import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { z } from "zod";

import { ProviderExecutionError } from "./index.ts";

const refusalSchema = z.object({
  schemaVersion: z.literal("port-refusal/v1"),
  port: z.enum(["aligner", "audio-prep"]),
  code: z.enum([
    "capability-missing",
    "runtime-missing",
    "input-invalid",
    "provider-failed",
    "timeout",
    "cancelled",
    "shutdown-unconfirmed",
    "consent-missing",
  ]),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export class AlignmentShutdownUnconfirmedError extends Error {
  readonly code = "alignment_shutdown_unconfirmed";

  constructor() {
    super(
      "Word alignment shutdown could not be confirmed. Temporary audio was retained.",
    );
  }
}

export async function runCancelableAlignment(
  executable: string,
  args: readonly string[],
  cancelPath: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args, "--cancel-file", cancelPath], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let settled = false;
    let stdout = "";
    let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(confirmationTimer);
      signal.removeEventListener("abort", requestCancellation);
      if (error) reject(error);
      else resolve();
    };
    const requestCancellation = () => {
      if (settled || confirmationTimer) return;
      try {
        writeFileSync(cancelPath, "", { mode: 0o600, flag: "wx" });
      } catch {
        // Still await confirmation. A filesystem error is not a reason to stop
        // supervising the aligner or discard audio that may still be in use.
      }
      confirmationTimer = setTimeout(() => {
        child.unref();
        child.stdout.destroy();
        finish(new AlignmentShutdownUnconfirmedError());
      }, 60_000);
      confirmationTimer.unref();
    };
    const deadline = setTimeout(requestCancellation, 65 * 60_000);
    deadline.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-8192);
    });
    child.once("error", () =>
      finish(
        child.pid === undefined
          ? new ProviderExecutionError("Could not run the local word aligner.")
          : new AlignmentShutdownUnconfirmedError(),
      ),
    );
    child.once("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }
      const refusal = code === 3 ? parseRefusal(stdout) : undefined;
      const confirmedCancel =
        refusal?.port === "aligner" && refusal.code === "cancelled";
      finish(
        !refusal ||
          refusal.code === "shutdown-unconfirmed" ||
          (confirmationTimer !== undefined && !confirmedCancel)
          ? new AlignmentShutdownUnconfirmedError()
          : new ProviderExecutionError(
              confirmedCancel
                ? "Local word alignment was canceled."
                : "Word alignment failed. Check the local alignment setup and inputs.",
            ),
      );
    });
    signal.addEventListener("abort", requestCancellation, { once: true });
    if (signal.aborted) requestCancellation();
  }).catch((error: unknown) => {
    if (error instanceof AlignmentShutdownUnconfirmedError) throw error;
    signal.throwIfAborted();
    throw error;
  });
  signal.throwIfAborted();
}

function parseRefusal(stdout: string) {
  try {
    return refusalSchema.parse(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}
