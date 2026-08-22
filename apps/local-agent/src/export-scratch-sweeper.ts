import { lstat, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { loadConfig, type AppConfig } from "@research-video/config";
import {
  LocalExportQueue,
  type LocalLoggedExportSourceGroupCleanupClaim,
  type LocalSourceScratchCleanupClaim,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  cleanupExportSourceScratch,
  removeEmptyExportSourceScratchJobDirectory,
  resolveExportSourceScratchAttemptDirectory,
} from "@research-video/media";

const DefaultSweepLimit = 10;
const MaxSweepLimit = 25;

export type LocalSourceScratchSweepResult = {
  status: "complete";
  claimed: number;
  deleted: number;
  cleanupFailed: number;
  restoredComplete: number;
  markedNeedsUserAction: number;
  legacyUnsupported: number;
};

export type LocalSourceScratchSweepDependencies = {
  queue: LocalExportQueue;
  dataRoot: string;
};

/**
 * Runs one bounded recovery pass. It intentionally has no polling, scheduler,
 * media acquisition, rendering, or cloud interaction.
 */
export async function runLocalSourceScratchSweep(
  input: { limit?: number; recoverOrphanedGroups?: boolean } = {},
  dependencies: LocalSourceScratchSweepDependencies,
): Promise<LocalSourceScratchSweepResult> {
  const limit = input.limit ?? DefaultSweepLimit;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MaxSweepLimit) {
    throw Object.assign(new Error("Source scratch cleanup limit is invalid."), {
      code: "source_scratch_cleanup_limit_invalid",
    });
  }
  const legacyUnsupported =
    dependencies.queue.countLegacySourceScratchRecoveryRows();
  const groupClaims = dependencies.queue.claimLoggedExportSourceGroupCleanup(
    limit,
    {
      ...(input.recoverOrphanedGroups ? { recoverOrphanedJoined: true } : {}),
    },
  );
  const remaining = limit - groupClaims.length;
  const claims =
    remaining > 0
      ? dependencies.queue.claimSourceScratchCleanup(remaining)
      : [];
  const result: LocalSourceScratchSweepResult = {
    status: "complete",
    claimed: groupClaims.length + claims.length,
    deleted: 0,
    cleanupFailed: 0,
    restoredComplete: 0,
    markedNeedsUserAction: 0,
    legacyUnsupported,
  };
  for (const claim of groupClaims) {
    try {
      await removeExactSourceGroupScratch(dependencies.dataRoot, claim);
      const settlement =
        dependencies.queue.completeLoggedExportSourceGroupCleanupClaim(claim);
      result.deleted += 1;
      if (settlement.restoredComplete) result.restoredComplete += 1;
      if (settlement.markedNeedsUserAction) result.markedNeedsUserAction += 1;
    } catch (error) {
      try {
        dependencies.queue.failLoggedExportSourceGroupCleanupClaim(
          claim,
          safeSweepFailureMessage(error),
        );
        result.cleanupFailed += 1;
      } catch (settlementError) {
        const candidate = settlementError as { code?: unknown };
        if (candidate.code === "source_scratch_cleanup_claim_lost") continue;
        throw settlementError;
      }
    }
  }
  for (const claim of claims) {
    try {
      await removeExactSourceScratchAttempt(dependencies.dataRoot, claim);
      const settlement =
        dependencies.queue.completeSourceScratchCleanupClaim(claim);
      result.deleted += 1;
      if (settlement.restoredComplete) result.restoredComplete += 1;
      if (settlement.markedNeedsUserAction) result.markedNeedsUserAction += 1;
    } catch (error) {
      try {
        dependencies.queue.failSourceScratchCleanupClaim(
          claim,
          safeSweepFailureMessage(error),
        );
        result.cleanupFailed += 1;
      } catch (settlementError) {
        const candidate = settlementError as { code?: unknown };
        if (candidate.code === "source_scratch_cleanup_claim_lost") continue;
        throw settlementError;
      }
    }
  }
  return result;
}

async function removeExactSourceGroupScratch(
  dataRoot: string,
  claim: LocalLoggedExportSourceGroupCleanupClaim,
): Promise<void> {
  await cleanupExportSourceScratch({
    scratchRoot: join(dataRoot, "jobs", "export-source-groups"),
    jobId: claim.groupId,
    attempt: 1,
  });
}

export async function runConfiguredLocalSourceScratchSweep(
  input: { limit?: number } = {},
  options: { config?: AppConfig } = {},
): Promise<LocalSourceScratchSweepResult> {
  const config = options.config ?? loadConfig();
  const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
  try {
    runLocalMigrations(database);
    return await runLocalSourceScratchSweep(input, {
      queue: new LocalExportQueue(database),
      dataRoot: config.dataDir,
    });
  } finally {
    database.close();
  }
}

async function removeExactSourceScratchAttempt(
  dataRoot: string,
  claim: LocalSourceScratchCleanupClaim,
): Promise<void> {
  const root = resolve(dataRoot);
  const jobsRoot = join(root, "jobs");
  const scratchRoot = join(jobsRoot, "export-source-scratch");
  const target = resolveExportSourceScratchAttemptDirectory({
    scratchRoot,
    jobId: claim.jobId,
    attempt: claim.attempt,
  });
  if (
    !isStrictChild(root, jobsRoot) ||
    !isStrictChild(jobsRoot, scratchRoot) ||
    !isStrictChild(scratchRoot, join(scratchRoot, claim.jobId)) ||
    !isStrictChild(join(scratchRoot, claim.jobId), target)
  ) {
    throw new SourceScratchSweepError("Source scratch target is invalid.");
  }
  for (const directory of [
    root,
    jobsRoot,
    scratchRoot,
    join(scratchRoot, claim.jobId),
  ]) {
    const exists = await assertDirectoryOrAbsent(directory);
    if (!exists) return;
  }
  const targetEntry = await lstatOrAbsent(target);
  if (!targetEntry) return;
  if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
    throw new SourceScratchSweepError("Source scratch target is invalid.");
  }
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 2,
    retryDelay: 100,
  });
  if (await lstatOrAbsent(target)) {
    throw new SourceScratchSweepError(
      "Source scratch cleanup did not remove the exact attempt directory.",
    );
  }
  await removeEmptyExportSourceScratchJobDirectory({
    scratchRoot,
    jobId: claim.jobId,
  });
}

async function assertDirectoryOrAbsent(path: string): Promise<boolean> {
  const entry = await lstatOrAbsent(path);
  if (!entry) return false;
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new SourceScratchSweepError(
      "Configured source scratch root is invalid.",
    );
  }
  return true;
}

async function lstatOrAbsent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new SourceScratchSweepError(
      "Source scratch cleanup could not inspect its target.",
    );
  }
}

function isStrictChild(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return Boolean(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

function safeSweepFailureMessage(error: unknown): string {
  if (error instanceof SourceScratchSweepError) return error.message;
  return "Source scratch cleanup could not remove the exact attempt directory.";
}

class SourceScratchSweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceScratchSweepError";
  }
}

function parseSweepCommandLine(
  argv: readonly string[],
): { limit?: number } | { error: { code: string; message: string } } {
  if (argv.length === 0) return {};
  if (argv.length !== 2 || argv[0] !== "--limit") {
    return {
      error: {
        code: "invalid_arguments",
        message: "Usage: export:recover-source-scratch [--limit <1-25>]",
      },
    };
  }
  const limit = Number(argv[1]);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MaxSweepLimit) {
    return {
      error: {
        code: "source_scratch_cleanup_limit_invalid",
        message:
          "Source scratch cleanup limit must be an integer from 1 through 25.",
      },
    };
  }
  return { limit };
}

export async function runSourceScratchSweepCommand(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const parsed = parseSweepCommandLine(argv);
  if ("error" in parsed) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", ...parsed })}\n`,
    );
    return 2;
  }
  try {
    process.stdout.write(
      `${JSON.stringify(await runConfiguredLocalSourceScratchSweep(parsed))}\n`,
    );
    return 0;
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        status: "failed",
        error: {
          code: "source_scratch_cleanup_failed",
          message: "Source scratch cleanup could not complete.",
        },
      })}\n`,
    );
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runSourceScratchSweepCommand();
