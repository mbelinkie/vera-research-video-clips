import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type {
  PutObjectInput,
  StoredObject,
  TranscriptObjectStore,
} from "./index.ts";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const versionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertTranscriptObjectKey(key: string): void {
  if (
    key.length < 1 ||
    key.length > 1024 ||
    key.startsWith("/") ||
    /[\\\u0000-\u001f\u007f]/u.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe transcript object key");
}

export function checkedTranscriptSha256(
  bytes: Uint8Array,
  expected: string,
): string {
  const actual = digest(bytes);
  if (!/^[0-9a-f]{64}$/u.test(expected) || actual !== expected) {
    throw new Error("Transcript checksum mismatch");
  }
  return actual;
}

/** A small append-only, no-symlink, version-addressed store for one private local volume. */
export class LocalTranscriptObjectStore implements TranscriptObjectStore {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root))
      throw new Error("Local transcript root must be absolute");
    this.root = resolve(root);
  }

  private folder(key: string) {
    const hash = createHash("sha256").update(key).digest("hex");
    return join(this.root, "objects", hash.slice(0, 2), hash);
  }

  private async verifyDirectory(path: string, create = false) {
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Unsafe transcript directory");
    }
    if (path === this.root && (stat.mode & 0o077) !== 0) {
      throw new Error("Transcript root must be private (mode 0700)");
    }
  }

  private async ensureFolder(key: string) {
    await this.verifyDirectory(this.root, true);
    const objects = join(this.root, "objects");
    await this.verifyDirectory(objects, true);
    await this.syncDir(this.root);
    const hashFolder = join(
      objects,
      createHash("sha256").update(key).digest("hex").slice(0, 2),
    );
    await this.verifyDirectory(hashFolder, true);
    await this.syncDir(objects);
    const folder = this.folder(key);
    await this.verifyDirectory(folder, true);
    await this.syncDir(hashFolder);
    await this.verifyDirectory(join(folder, "versions"), true);
    await this.syncDir(folder);
    return folder;
  }

  private async checkedFolder(key: string) {
    const folder = this.folder(key);
    await this.verifyDirectory(this.root);
    await this.verifyDirectory(join(this.root, "objects"));
    await this.verifyDirectory(
      join(
        this.root,
        "objects",
        createHash("sha256").update(key).digest("hex").slice(0, 2),
      ),
    );
    await this.verifyDirectory(folder);
    return folder;
  }

  private async readFile(path: string): Promise<Buffer | undefined> {
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("Unsafe transcript file");
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  private async syncDir(folder: string) {
    const handle = await open(
      folder,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async writeExclusive(path: string, bytes: Uint8Array) {
    const handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async writeHead(folder: string, value: string) {
    const temp = join(folder, ".head-" + randomUUID());
    await this.writeExclusive(temp, Buffer.from(value));
    const { rename } = await import("node:fs/promises");
    await rename(temp, join(folder, "head"));
    await this.syncDir(folder);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertTranscriptObjectKey(input.key);
    checkedTranscriptSha256(input.bytes, input.sha256);
    if (!input.contentType || input.contentType.length > 200)
      throw new Error("Invalid content type");
    const bytes = input.bytes.slice();
    const folder = await this.ensureFolder(input.key);
    const versions = join(folder, "versions");
    const versionId = randomUUID();
    // Write and sync the blob *before* publishing the immutable metadata. An
    // interrupted blob without metadata is never visible as a version.
    await this.writeExclusive(join(versions, versionId + ".blob"), bytes);
    await this.writeExclusive(
      join(versions, versionId + ".json"),
      Buffer.from(
        JSON.stringify({
          key: input.key,
          versionId,
          contentType: input.contentType,
          byteSize: bytes.byteLength,
          sha256: input.sha256,
        }),
      ),
    );
    await this.syncDir(versions);
    // Concurrent writers get distinct immutable versions. Head is replaceable
    // atomically; either winner is valid and all historical versions survive.
    await this.writeHead(folder, versionId);
    return { ...input, bytes, versionId };
  }

  /**
   * Isolated restore only. Keep original immutable IDs so catalog references
   * remain valid. Unlike put(), this never chooses a visible head implicitly.
   * Refuses collisions even when bytes are identical.
   */
  async restoreVerifiedVersion(
    input: PutObjectInput & { versionId: string },
  ): Promise<void> {
    assertTranscriptObjectKey(input.key);
    if (!versionPattern.test(input.versionId))
      throw new Error("Invalid restored version identity");
    checkedTranscriptSha256(input.bytes, input.sha256);
    const folder = await this.ensureFolder(input.key);
    const versions = join(folder, "versions");
    await this.writeExclusive(
      join(versions, input.versionId + ".blob"),
      input.bytes,
    );
    await this.writeExclusive(
      join(versions, input.versionId + ".json"),
      Buffer.from(
        JSON.stringify({
          key: input.key,
          versionId: input.versionId,
          contentType: input.contentType,
          byteSize: input.bytes.byteLength,
          sha256: input.sha256,
        }),
      ),
    );
    await this.syncDir(versions);
  }

  async restoreVisibleHead(
    key: string,
    versionId: string | null,
  ): Promise<void> {
    assertTranscriptObjectKey(key);
    const folder = await this.checkedFolder(key);
    if (versionId && !(await this.get(key, versionId)))
      throw new Error("Missing restored visible version");
    await this.writeHead(folder, versionId ?? "deleted");
  }

  async get(
    key: string,
    versionId?: string,
  ): Promise<StoredObject | undefined> {
    assertTranscriptObjectKey(key);
    let folder: string;
    try {
      folder = await this.checkedFolder(key);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    const current = versionId
      ? undefined
      : await this.readFile(join(folder, "head"));
    const selected = versionId ?? current?.toString("utf8");
    if (!selected || selected === "deleted") return undefined;
    if (!versionPattern.test(selected))
      return versionId
        ? undefined
        : Promise.reject(new Error("Corrupt transcript head"));
    await this.verifyDirectory(join(folder, "versions"));
    const metadataBytes = await this.readFile(
      join(folder, "versions", selected + ".json"),
    );
    if (!metadataBytes) {
      if (!versionId) throw new Error("Missing current transcript metadata");
      return undefined;
    }
    let metadata: {
      key: string;
      versionId: string;
      contentType: string;
      byteSize: number;
      sha256: string;
    };
    try {
      metadata = JSON.parse(metadataBytes.toString("utf8"));
    } catch {
      throw new Error("Corrupt transcript metadata");
    }
    if (
      metadata.key !== key ||
      metadata.versionId !== selected ||
      typeof metadata.contentType !== "string" ||
      metadata.contentType.length === 0 ||
      metadata.contentType.length > 200 ||
      !Number.isSafeInteger(metadata.byteSize) ||
      metadata.byteSize < 0
    ) {
      throw new Error("Corrupt transcript identity");
    }
    const data = await this.readFile(
      join(folder, "versions", selected + ".blob"),
    );
    if (!data || data.byteLength !== metadata.byteSize)
      throw new Error("Missing or truncated transcript object");
    checkedTranscriptSha256(data, metadata.sha256);
    return {
      key,
      versionId: selected,
      bytes: new Uint8Array(data),
      contentType: metadata.contentType,
      sha256: metadata.sha256,
    };
  }

  async delete(key: string): Promise<boolean> {
    assertTranscriptObjectKey(key);
    const previous = await this.get(key);
    if (!previous) return false;
    const folder = await this.checkedFolder(key);
    await this.writeHead(folder, "deleted");
    return true;
  }

  async list(prefix: string): Promise<string[]> {
    const objects = join(this.root, "objects");
    try {
      await this.verifyDirectory(this.root);
      await this.verifyDirectory(objects);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const keys: string[] = [];
    for (const shard of await readdir(objects)) {
      if (!/^[0-9a-f]{2}$/u.test(shard))
        throw new Error("Unexpected transcript shard");
      const shardPath = join(objects, shard);
      await this.verifyDirectory(shardPath);
      for (const hash of await readdir(shardPath)) {
        if (!/^[0-9a-f]{64}$/u.test(hash) || !hash.startsWith(shard))
          throw new Error("Unexpected transcript identity");
        const folder = join(shardPath, hash);
        await this.verifyDirectory(folder);
        const current = await this.readFile(join(folder, "head"));
        if (!current || current.toString("utf8") === "deleted") continue;
        const versionId = current.toString("utf8");
        if (!versionPattern.test(versionId))
          throw new Error("Corrupt transcript head");
        const metadataBytes = await this.readFile(
          join(folder, "versions", versionId + ".json"),
        );
        if (!metadataBytes)
          throw new Error("Missing current transcript metadata");
        let key: string;
        try {
          key = JSON.parse(metadataBytes.toString("utf8")).key;
        } catch {
          throw new Error("Corrupt transcript metadata");
        }
        assertTranscriptObjectKey(key);
        if (this.folder(key) !== folder)
          throw new Error("Corrupt transcript identity");
        // Must not report a corrupted object as a valid visible key.
        if (!(await this.get(key)))
          throw new Error("Missing transcript object");
        if (key.startsWith(prefix)) keys.push(key);
      }
    }
    return keys.sort();
  }
}
