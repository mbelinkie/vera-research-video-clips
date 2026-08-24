import { access, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve } from "node:path";

const MAX_TOP_LEVEL_ENTRIES = 256;
const MAX_TOTAL_NODES = 4_096;
const MAX_DIRECTORY_DEPTH = 32;

export type TranscriptionScratchNodeKind =
  "directory" | "regular_file" | "symlink" | "other";

export interface TranscriptionScratchFileSystem {
  ensureDirectory(path: string): Promise<void>;
  realpath(path: string): Promise<string>;
  inspect(path: string): Promise<TranscriptionScratchNodeKind>;
  list(path: string): Promise<readonly string[]>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type TranscriptionScratchSweepResult = Readonly<{
  scratchRoot: string;
  removedEntryCount: number;
}>;

/**
 * A startup-only recovery pass for private, job-scoped worker scratch. It
 * deliberately has no cloud/control-plane dependency: an unsafe or failed
 * cleanup stops this worker before it can claim another job.
 */
export async function sweepAbandonedTranscriptionScratch(
  configuredRoot: string,
  fileSystem: TranscriptionScratchFileSystem = nodeFileSystem,
): Promise<TranscriptionScratchSweepResult> {
  const requestedRoot = resolveConfiguredRoot(configuredRoot);
  await fileSystem.ensureDirectory(requestedRoot);
  const declaredRootKind = await fileSystem.inspect(requestedRoot);
  if (declaredRootKind === "symlink") {
    throw new TranscriptionScratchSweepError("scratch_root_symlink");
  }
  if (declaredRootKind !== "directory") {
    throw new TranscriptionScratchSweepError("invalid_scratch_root");
  }

  const scratchRoot = resolve(await fileSystem.realpath(requestedRoot));
  if (!isSafeScratchRoot(scratchRoot)) {
    throw new TranscriptionScratchSweepError("invalid_scratch_root");
  }
  if ((await fileSystem.inspect(scratchRoot)) !== "directory") {
    throw new TranscriptionScratchSweepError("invalid_scratch_root");
  }

  const entries = await fileSystem.list(scratchRoot);
  if (entries.length > MAX_TOP_LEVEL_ENTRIES) {
    throw new TranscriptionScratchSweepError("sweep_limit_exceeded");
  }

  let inspectedNodes = 0;
  const candidates: string[] = [];
  for (const entry of entries) {
    const candidate = resolveContainedScratchPath(scratchRoot, entry);
    inspectedNodes = await assertSafeScratchTree({
      root: scratchRoot,
      path: candidate,
      depth: 1,
      inspectedNodes,
      fileSystem,
    });
    candidates.push(candidate);
  }

  for (const candidate of candidates) {
    // Recheck the direct candidate after the read-only tree inspection. This
    // makes a changed entry fail closed rather than allowing recursive cleanup
    // to follow a replacement symlink.
    const kind = await fileSystem.inspect(candidate);
    if (
      kind === "symlink" ||
      (kind !== "directory" && kind !== "regular_file")
    ) {
      throw new TranscriptionScratchSweepError("unsafe_scratch_entry");
    }
    try {
      await fileSystem.remove(candidate);
    } catch {
      throw new TranscriptionScratchSweepError("scratch_cleanup_failed");
    }
    if (await fileSystem.exists(candidate)) {
      throw new TranscriptionScratchSweepError("scratch_cleanup_failed");
    }
  }

  return { scratchRoot, removedEntryCount: candidates.length };
}

/** A containment guard kept separate so malformed directory entries are testable. */
export function resolveContainedScratchPath(
  root: string,
  entry: string,
): string {
  if (
    !entry ||
    entry === "." ||
    entry === ".." ||
    entry.includes("/") ||
    entry.includes("\\") ||
    entry.includes("\0")
  ) {
    throw new TranscriptionScratchSweepError("unsafe_scratch_entry");
  }
  const candidate = resolve(root, entry);
  if (!isContainedPath(root, candidate)) {
    throw new TranscriptionScratchSweepError("unsafe_scratch_entry");
  }
  return candidate;
}

export class TranscriptionScratchSweepError extends Error {
  readonly code:
    | "invalid_scratch_root"
    | "scratch_root_symlink"
    | "unsafe_scratch_entry"
    | "sweep_limit_exceeded"
    | "scratch_cleanup_failed";

  constructor(
    code:
      | "invalid_scratch_root"
      | "scratch_root_symlink"
      | "unsafe_scratch_entry"
      | "sweep_limit_exceeded"
      | "scratch_cleanup_failed",
  ) {
    super(`Transcript scratch recovery requires attention (${code}).`);
    this.code = code;
  }
}

async function assertSafeScratchTree(input: {
  root: string;
  path: string;
  depth: number;
  inspectedNodes: number;
  fileSystem: TranscriptionScratchFileSystem;
}): Promise<number> {
  if (input.depth > MAX_DIRECTORY_DEPTH) {
    throw new TranscriptionScratchSweepError("sweep_limit_exceeded");
  }
  const inspectedNodes = input.inspectedNodes + 1;
  if (inspectedNodes > MAX_TOTAL_NODES) {
    throw new TranscriptionScratchSweepError("sweep_limit_exceeded");
  }
  if (!isContainedPath(input.root, input.path)) {
    throw new TranscriptionScratchSweepError("unsafe_scratch_entry");
  }
  const kind = await input.fileSystem.inspect(input.path);
  if (kind === "symlink" || kind === "other") {
    throw new TranscriptionScratchSweepError("unsafe_scratch_entry");
  }
  if (kind === "regular_file") return inspectedNodes;

  let count = inspectedNodes;
  const children = await input.fileSystem.list(input.path);
  for (const child of children) {
    count = await assertSafeScratchTree({
      ...input,
      path: resolveContainedScratchPath(input.path, child),
      depth: input.depth + 1,
      inspectedNodes: count,
    });
  }
  return count;
}

function resolveConfiguredRoot(configuredRoot: string): string {
  if (!configuredRoot || configuredRoot.includes("\0")) {
    throw new TranscriptionScratchSweepError("invalid_scratch_root");
  }
  const root = resolve(configuredRoot);
  if (!isSafeScratchRoot(root)) {
    throw new TranscriptionScratchSweepError("invalid_scratch_root");
  }
  return root;
}

function isSafeScratchRoot(root: string): boolean {
  return root !== parse(root).root;
}

function isContainedPath(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference.length > 0 &&
    !difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    difference !== ".." &&
    !isAbsolute(difference)
  );
}

const nodeFileSystem: TranscriptionScratchFileSystem = {
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true, mode: 0o700 });
  },
  realpath,
  inspect: async (path) => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "regular_file";
    return "other";
  },
  list: (path) => readdir(path),
  remove: async (path) => {
    await rm(path, {
      recursive: true,
      force: false,
      maxRetries: 2,
      retryDelay: 25,
    });
  },
  exists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
};
