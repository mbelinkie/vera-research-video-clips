import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveContainedScratchPath,
  sweepAbandonedTranscriptionScratch,
  TranscriptionScratchSweepError,
  type TranscriptionScratchFileSystem,
} from "./transcription-scratch-sweeper.ts";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

async function temporaryScratchRoot() {
  const parent = await mkdtemp(join(tmpdir(), "rvc-transcription-scratch-"));
  temporaryDirectories.add(parent);
  // Return a missing dedicated root so the first test also covers creation.
  return join(parent, "transcription-scratch");
}

describe("transcription scratch startup sweep", () => {
  it("creates an empty dedicated root and is idempotent", async () => {
    const root = await temporaryScratchRoot();

    await expect(
      sweepAbandonedTranscriptionScratch(root),
    ).resolves.toMatchObject({
      removedEntryCount: 0,
    });
    await expect(
      sweepAbandonedTranscriptionScratch(root),
    ).resolves.toMatchObject({
      removedEntryCount: 0,
    });
  });

  it("removes a contained abandoned job directory and verifies its absence", async () => {
    const root = await temporaryScratchRoot();
    const job = join(root, "019fbb95-cd76-7920-93fa-e23ba755e301-a1-abandoned");
    await mkdir(join(job, "provider"), { recursive: true });
    await writeFile(join(job, "provider", "partial-audio.m4a"), "fixture");

    await expect(
      sweepAbandonedTranscriptionScratch(root),
    ).resolves.toMatchObject({
      removedEntryCount: 1,
    });
    await expect(access(job)).rejects.toThrow();
    await expect(
      sweepAbandonedTranscriptionScratch(root),
    ).resolves.toMatchObject({
      removedEntryCount: 0,
    });
  });

  it("refuses a symlink entry without following or removing its target", async () => {
    const root = await temporaryScratchRoot();
    const outside = join(
      tmpdir(),
      `rvc-transcription-outside-${Date.now()}-${Math.random()}`,
    );
    temporaryDirectories.add(outside);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "must-remain.txt"), "fixture");
    await mkdir(root, { recursive: true });
    await symlink(
      outside,
      join(root, "019fbb95-cd76-7920-93fa-e23ba755e302-a1-link"),
    );

    await expect(
      sweepAbandonedTranscriptionScratch(root),
    ).rejects.toMatchObject({
      code: "unsafe_scratch_entry",
    });
    await expect(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(join(outside, "must-remain.txt"), "utf8"),
      ),
    ).resolves.toBe("fixture");
  });

  it("refuses non-regular entries before deletion", async () => {
    const fileSystem = fakeFileSystem({
      root: "directory",
      "/private/scratch/socket": "other",
    });

    await expect(
      sweepAbandonedTranscriptionScratch("/private/scratch", fileSystem),
    ).rejects.toMatchObject({ code: "unsafe_scratch_entry" });
    expect(fileSystem.remove).not.toHaveBeenCalled();
  });

  it("fails closed when deletion cannot be verified", async () => {
    const fileSystem = fakeFileSystem({
      root: "directory",
      "/private/scratch/orphan": "regular_file",
    });
    fileSystem.remove.mockRejectedValueOnce(new Error("permission denied"));

    await expect(
      sweepAbandonedTranscriptionScratch("/private/scratch", fileSystem),
    ).rejects.toMatchObject({ code: "scratch_cleanup_failed" });
  });

  it("rejects malformed entry names before any candidate path can escape", () => {
    expect(() =>
      resolveContainedScratchPath("/private/scratch", "../outside"),
    ).toThrow(TranscriptionScratchSweepError);
    expect(() =>
      resolveContainedScratchPath("/private/scratch", "child/escape"),
    ).toThrow(TranscriptionScratchSweepError);
  });
});

function fakeFileSystem(
  kinds: Record<string, "directory" | "regular_file" | "symlink" | "other">,
) {
  const root = "/private/scratch";
  const entries = Object.keys(kinds)
    .filter((path) => path !== "root")
    .map((path) => path.slice(`${root}/`.length))
    .filter((name) => !name.includes("/"));
  return {
    ensureDirectory: vi.fn(async () => undefined),
    realpath: vi.fn(async () => root),
    inspect: vi.fn(async (path: string) =>
      path === root ? kinds.root! : kinds[path]!,
    ),
    list: vi.fn(async (path: string) => (path === root ? entries : [])),
    remove: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
  } satisfies TranscriptionScratchFileSystem & {
    remove: ReturnType<typeof vi.fn>;
  };
}
