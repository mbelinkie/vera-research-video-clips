import { randomUUID } from "node:crypto";

import {
  LocalRuntimeDrainResultSchema,
  LocalRuntimeQuiescenceSchema,
  type LocalOperationClass,
  type LocalOperationCorrelation,
  type LocalRuntimeDrainResult,
  type LocalRuntimeQuiescence,
} from "@research-video/contracts";
import type { LocalRuntimeQuiescenceEvidence } from "@research-video/db-local";
import {
  SpawnMediaCommandRunner,
  type MediaCommandResult,
  type MediaCommandRunner,
} from "@research-video/media";

type RuntimeOperation = {
  operation: LocalOperationClass;
  exclusiveKey?: string;
};

export class LocalRuntimeDrainingError extends Error {
  readonly code = "runtime_draining";
  readonly statusCode = 409;

  constructor() {
    super("The local export runtime is draining and cannot claim new work.");
  }
}

export class LocalRuntimeOperationConflictError extends Error {
  readonly code = "runtime_operation_conflict";
  readonly statusCode = 409;

  constructor() {
    super("The same local operation is already active.");
  }
}

export class LocalRuntimeCoordinator {
  readonly #readEvidence: () => LocalRuntimeQuiescenceEvidence;
  readonly #now: () => Date;
  readonly #active = new Map<string, RuntimeOperation>();
  #activeChildProcessCount = 0;
  #draining = false;
  #drainCorrelationId: string | undefined;

  constructor(
    readEvidence: () => LocalRuntimeQuiescenceEvidence,
    now: () => Date = () => new Date(),
  ) {
    this.#readEvidence = readEvidence;
    this.#now = now;
  }

  beginDrain(): LocalRuntimeDrainResult {
    this.#draining = true;
    this.#drainCorrelationId ??= randomUUID();
    return LocalRuntimeDrainResultSchema.parse({
      operation: {
        operation: "runtime",
        correlationId: this.#drainCorrelationId,
      },
      quiescence: this.getQuiescence(),
    });
  }

  isDraining(): boolean {
    return this.#draining;
  }

  getQuiescence(): LocalRuntimeQuiescence {
    const evidence = this.#readEvidence();
    const activeOperations = {
      clipLibrary: this.#count("clip_library"),
      artifact: this.#count("artifact"),
      authoring: this.#count("authoring"),
      transcript: this.#count("transcript"),
      export: this.#count("export"),
      runtime: this.#count("runtime"),
    };
    const activeOperationCount = Object.values(activeOperations).reduce(
      (sum, count) => sum + count,
      0,
    );
    const safeToStop =
      this.#draining &&
      activeOperationCount === 0 &&
      this.#activeChildProcessCount === 0 &&
      evidence.activeSourceLifecycleCount === 0;
    return LocalRuntimeQuiescenceSchema.parse({
      schemaVersion: 1,
      draining: this.#draining,
      safeToStop,
      activeOperationCount,
      activeOperations,
      activeChildProcessCount: this.#activeChildProcessCount,
      activeSourceLifecycleCount: evidence.activeSourceLifecycleCount,
      durableWork: {
        pendingAcceptance: evidence.pendingAcceptance,
        accepted: evidence.accepted,
        executing: evidence.executing,
        complete: evidence.complete,
        failed: evidence.failed,
        canceled: evidence.canceled,
        needsAttention: evidence.needsAttention,
        recoveryRequired: evidence.recoveryRequired,
      },
      checkedAt: this.#now().toISOString(),
    });
  }

  beginOperation(
    operation: LocalOperationClass,
    options: { allowDuringDrain?: boolean; exclusiveKey?: string } = {},
  ): { correlation: LocalOperationCorrelation; finish(): void } {
    if (this.#draining && !options.allowDuringDrain) {
      throw new LocalRuntimeDrainingError();
    }
    if (
      options.exclusiveKey &&
      [...this.#active.values()].some(
        (active) => active.exclusiveKey === options.exclusiveKey,
      )
    ) {
      throw new LocalRuntimeOperationConflictError();
    }
    const token = randomUUID();
    const correlationId = randomUUID();
    this.#active.set(token, {
      operation,
      ...(options.exclusiveKey ? { exclusiveKey: options.exclusiveKey } : {}),
    });
    let finished = false;
    return {
      correlation: { operation, correlationId },
      finish: () => {
        if (finished) return;
        finished = true;
        this.#active.delete(token);
      },
    };
  }

  createTrackingMediaCommandRunner(
    delegate: MediaCommandRunner = new SpawnMediaCommandRunner(),
  ): MediaCommandRunner {
    return {
      run: async (
        executable: string,
        args: readonly string[],
        options?: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<MediaCommandResult> => {
        this.#activeChildProcessCount += 1;
        try {
          return await delegate.run(executable, args, options);
        } finally {
          this.#activeChildProcessCount -= 1;
        }
      },
    };
  }

  #count(operation: LocalOperationClass): number {
    let count = 0;
    for (const active of this.#active.values()) {
      if (active.operation === operation) count += 1;
    }
    return count;
  }
}
