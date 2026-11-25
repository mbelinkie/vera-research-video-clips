import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  LanguageCapabilityResultSchema,
  normalizeLanguageTag,
  type LanguageCapabilityResult,
} from "@research-video/contracts";

import {
  LocalArgosModelError,
  type ArgosModelDescriptor,
  type LocalArgosModelManager,
} from "./local-argos-model-manager.ts";
import {
  ProviderExecutionError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./index.ts";

export type ArgosSidecarRunner = {
  run(input: {
    executable: string;
    args: readonly string[];
    stdin: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<string>;
};

export class SpawnArgosSidecarRunner implements ArgosSidecarRunner {
  async run(input: {
    executable: string;
    args: readonly string[];
    stdin: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<string> {
    validateExecutable(input.executable);
    return new Promise((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const maxOutputBytes = 4 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      const append = (value: string, chunk: Buffer) => {
        const next = value + chunk.toString("utf8");
        if (Buffer.byteLength(next) > maxOutputBytes) {
          terminate(child.pid);
          return next.slice(-maxOutputBytes);
        }
        return next;
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      const timeout = setTimeout(() => terminate(child.pid), input.timeoutMs);
      timeout.unref?.();
      const abort = () => terminate(child.pid);
      input.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", () =>
        finish(
          new ProviderExecutionError(
            "The local Argos sidecar could not start.",
          ),
        ),
      );
      child.once("close", (code) => {
        if (input.signal?.aborted)
          return finish(
            input.signal.reason ??
              new ProviderExecutionError("Local translation was canceled."),
          );
        if (code !== 0)
          return finish(
            new ProviderExecutionError("The local Argos sidecar failed."),
          );
        finish(undefined, stdout);
      });
      child.stdin.end(input.stdin, "utf8");
      let settled = false;
      function finish(error?: unknown, value?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value ?? "");
      }
      void stderr;
    });
  }
}

export type ArgosLocalTranslationProviderOptions = {
  executable: string;
  manager: LocalArgosModelManager;
  resolveModel(
    sourceLanguage: string,
    targetLanguage: string,
  ): ArgosModelDescriptor | undefined;
  runner?: ArgosSidecarRunner;
  timeoutMs?: number;
  leaseTtlMs?: number;
  now?: () => string;
};

/** Capability data comes solely from the signed local catalog route resolver. */
export class ArgosLocalTranslationProvider implements TranslationProvider {
  readonly #executable: string;
  readonly #manager: LocalArgosModelManager;
  readonly #resolveModel: ArgosLocalTranslationProviderOptions["resolveModel"];
  readonly #runner: ArgosSidecarRunner;
  readonly #timeoutMs: number;
  readonly #leaseTtlMs: number;
  readonly #now: () => string;

  constructor(options: ArgosLocalTranslationProviderOptions) {
    validateExecutable(options.executable);
    this.#executable = options.executable;
    this.#manager = options.manager;
    this.#resolveModel = options.resolveModel;
    this.#runner = options.runner ?? new SpawnArgosSidecarRunner();
    this.#timeoutMs = boundedPositive(options.timeoutMs ?? 120_000, "timeout");
    this.#leaseTtlMs = boundedPositive(
      options.leaseTtlMs ?? 10 * 60_000,
      "lease TTL",
    );
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  checkLanguagePair(
    sourceLanguage: string,
    targetLanguage: string,
  ): LanguageCapabilityResult {
    const source = normalizeLanguageTag(sourceLanguage);
    const target = normalizeLanguageTag(targetLanguage);
    return LanguageCapabilityResultSchema.parse({
      state: this.#resolveModel(source, target) ? "supported" : "unsupported",
      provider: "argos-local",
      operation: "translation",
      sourceLanguage: source,
      targetLanguage: target,
      version: "signed-local-argos-catalog-v1",
      ...(this.#resolveModel(source, target)
        ? {}
        : { reason: "language_pair_not_approved" }),
    });
  }

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    const source = normalizeLanguageTag(input.sourceLanguage);
    const target = normalizeLanguageTag(input.targetLanguage);
    const model = this.#resolveModel(source, target);
    if (!model)
      throw new ProviderExecutionError(
        "No approved local Argos model supports this language pair.",
      );
    validateSegments(input.segments);
    const now = this.#now();
    let acquired: Awaited<ReturnType<LocalArgosModelManager["acquireLease"]>>;
    try {
      acquired = await this.#manager.acquireLease({
        model,
        holderId: `argos-translation:${randomUUID()}`,
        now,
        ttlMs: this.#leaseTtlMs,
      });
    } catch (error) {
      throw localProviderError(error);
    }
    try {
      const stdout = await this.#runner.run({
        executable: this.#executable,
        args: [
          "--model",
          acquired.modelPath,
          "--source-language",
          source,
          "--target-language",
          target,
          "--input-format",
          "jsonl",
          "--output-format",
          "jsonl",
        ],
        stdin:
          input.segments
            .map((segment) =>
              JSON.stringify({ id: segment.id, text: segment.text }),
            )
            .join("\n") + "\n",
        timeoutMs: this.#timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return {
        provider: "argos-local",
        model: model.id,
        segments: parseSidecarOutput(stdout, input.segments),
      };
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      throw new ProviderExecutionError(
        "The local Argos sidecar returned invalid output.",
      );
    } finally {
      await this.#manager.releaseLease(acquired.lease, this.#now());
    }
  }
}

function parseSidecarOutput(
  stdout: string,
  input: TranslationRequest["segments"],
): Array<{ sourceSegmentId: string; text: string }> {
  if (Buffer.byteLength(stdout) > 4 * 1024 * 1024)
    throw new ProviderExecutionError(
      "The local Argos sidecar returned excessive output.",
    );
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== input.length)
    throw new ProviderExecutionError(
      "The local Argos sidecar returned an incomplete translation.",
    );
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ProviderExecutionError(
        "The local Argos sidecar returned invalid JSON.",
      );
    }
    if (!value || typeof value !== "object")
      throw new ProviderExecutionError(
        "The local Argos sidecar returned an invalid translation record.",
      );
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id !== input[index]!.id ||
      typeof record.text !== "string" ||
      !record.text.trim() ||
      Buffer.byteLength(record.text) > 100_000
    ) {
      throw new ProviderExecutionError(
        "The local Argos sidecar returned mismatched translation segments.",
      );
    }
    return { sourceSegmentId: record.id, text: record.text.trim() };
  });
}

function validateSegments(segments: TranslationRequest["segments"]): void {
  if (
    segments.length === 0 ||
    segments.length > 500 ||
    Buffer.byteLength(JSON.stringify(segments)) > 1_000_000
  ) {
    throw new ProviderExecutionError(
      "Local translation input exceeds its bounded sidecar request limit.",
    );
  }
  const ids = new Set<string>();
  for (const segment of segments) {
    if (
      !segment.id.trim() ||
      !segment.text.trim() ||
      Buffer.byteLength(segment.text) > 100_000 ||
      ids.has(segment.id)
    ) {
      throw new ProviderExecutionError(
        "Local translation input contains invalid segments.",
      );
    }
    ids.add(segment.id);
  }
}

function localProviderError(error: unknown): ProviderExecutionError {
  if (error instanceof LocalArgosModelError)
    return new ProviderExecutionError(
      `Local Argos model is unavailable (${error.code}).`,
    );
  return new ProviderExecutionError("Local Argos model is unavailable.");
}

function validateExecutable(value: string): void {
  if (!value.trim() || value.includes("\0"))
    throw new ProviderExecutionError(
      "Local Argos sidecar executable is invalid.",
    );
}

function boundedPositive(value: number, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 12 * 60 * 60 * 1_000
  ) {
    throw new ProviderExecutionError(`Local Argos ${label} is invalid.`);
  }
  return value;
}

function terminate(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    // A child may have already exited; no provider data belongs in this path.
  }
}
