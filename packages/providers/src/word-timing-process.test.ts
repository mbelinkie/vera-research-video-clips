import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  AlignmentShutdownUnconfirmedError,
  runCancelableAlignment,
} from "./word-timing-process.ts";

function refusal(code: string) {
  return JSON.stringify({
    schemaVersion: "port-refusal/v1",
    port: "aligner",
    code,
    message: "Fixture refusal",
    retryable: false,
  });
}

describe("worker word alignment lifecycle", () => {
  it("requests cooperative cancellation and waits for confirmed shutdown", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "word-timing-cancel-test-"));
    try {
      const marker = join(scratch, "cancel");
      const ready = join(scratch, "ready");
      const stopped = join(scratch, "stopped");
      const controller = new AbortController();
      const reason = new Error("Lease lost");
      const response = runCancelableAlignment(
        process.execPath,
        [
          "-e",
          `const fs = require("node:fs");
          const [ready, stopped, option, cancel] = process.argv.slice(1);
          if (option !== "--cancel-file") process.exit(5);
          fs.writeFileSync(ready, "ready");
          const timer = setInterval(() => {
            if (!fs.existsSync(cancel)) return;
            clearInterval(timer);
            setTimeout(() => {
              fs.writeFileSync(stopped, "stopped");
              process.stdout.write(${JSON.stringify(refusal("cancelled"))});
              process.exitCode = 3;
            }, 25);
          }, 10);`,
          "--",
          ready,
          stopped,
        ],
        marker,
        controller.signal,
      ).catch((error: unknown) => error);
      await vi.waitFor(async () => {
        expect(await readFile(ready, "utf8")).toBe("ready");
      });
      controller.abort(reason);
      expect(await response).toBe(reason);
      expect(await readFile(stopped, "utf8")).toBe("stopped");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each([
    `process.stdout.write(${JSON.stringify(refusal("shutdown-unconfirmed"))}); process.exitCode = 3;`,
    'process.kill(process.pid, "SIGTERM");',
  ])(
    "treats an unconfirmed or abnormal exit as unsafe for cleanup",
    async (code) => {
      await expect(
        runCancelableAlignment(
          process.execPath,
          ["-e", code, "--"],
          "unused-cancellation-marker",
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(AlignmentShutdownUnconfirmedError);
    },
  );
});
