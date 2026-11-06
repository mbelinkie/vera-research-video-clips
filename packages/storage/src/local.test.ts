import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalTranscriptObjectStore } from "./local.ts";
import {
  InvalidLocalObjectCapability,
  LocalStagedUploadUrlIssuer,
} from "./local-urls.ts";

const roots: string[] = [];
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera50-robustness-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const key = "projects/test/transcripts/pinned.json";
const folderFor = (root: string) => {
  const hash = createHash("sha256").update(key).digest("hex");
  return join(root, "objects", hash.slice(0, 2), hash);
};

describe("local immutable object hardening", () => {
  it("refuses corrupted blobs and pointers instead of silently choosing a version", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const bytes = new TextEncoder().encode("verified");
    const result = await store.put({
      key,
      bytes,
      sha256: sha(bytes),
      contentType: "application/json",
    });
    await writeFile(
      join(folderFor(root), "versions", result.versionId + ".blob"),
      "tampered",
    );
    await expect(store.get(key, result.versionId)).rejects.toThrow("checksum");
    await writeFile(join(folderFor(root), "head"), "invalid-head");
    await expect(store.get(key)).rejects.toThrow("head");
  });

  it("rejects symlinked storage directories before escaping the private root", async () => {
    const root = await newRoot();
    const external = await newRoot();
    await symlink(external, join(root, "objects"));
    const store = new LocalTranscriptObjectStore(root);
    const bytes = new Uint8Array([1]);
    await expect(
      store.put({
        key,
        bytes,
        sha256: sha(bytes),
        contentType: "application/json",
      }),
    ).rejects.toThrow("Unsafe");
    expect(await readdir(external)).toEqual([]);
  });

  it("ignores incomplete orphan blob not referenced by metadata/head", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const bytes = new Uint8Array([4]);
    const result = await store.put({
      key,
      bytes,
      sha256: sha(bytes),
      contentType: "application/json",
    });
    const folder = folderFor(root);
    await writeFile(
      join(folder, "versions", "00000000-0000-4000-8000-000000000001.blob"),
      bytes,
    );
    expect((await store.get(key))?.versionId).toBe(result.versionId);
    expect(
      await store.get(key, "00000000-0000-4000-8000-000000000001"),
    ).toBeUndefined();
    expect(await store.list("projects/")).toEqual([key]);
  });
});

describe("local object URL capability", () => {
  it("signs specific method, key and pinned version with expiration", async () => {
    let now = 1_000;
    const signer = new LocalStagedUploadUrlIssuer(
      "http://127.0.0.1:43111/",
      "long-test-fixture-secret-must-stay-out-of-logs",
      () => now,
    );
    const put = new URL(
      await signer.issuePutUrl({ objectKey: key, expiresInSeconds: 30 }),
    );
    const token = put.pathname.split("/").at(-1)!;
    expect(signer.verify(token, "PUT").key).toBe(key);
    expect(() => signer.verify(token, "GET")).toThrow(
      InvalidLocalObjectCapability,
    );
    const get = new URL(
      await signer.issueGetUrl({
        objectKey: key,
        objectVersionId: "pinned-v1",
        expiresInSeconds: 30,
      }),
    );
    expect(
      signer.verify(get.pathname.split("/").at(-1)!, "GET").versionId,
    ).toBe("pinned-v1");
    const [body, signature] = token.split(".");
    const altered =
      body +
      "." +
      (signature!.startsWith("a") ? "b" : "a") +
      signature!.slice(1);
    expect(() => signer.verify(altered, "PUT")).toThrow(
      InvalidLocalObjectCapability,
    );
    now += 31_000;
    expect(() => signer.verify(token, "PUT")).toThrow(
      InvalidLocalObjectCapability,
    );
    await expect(
      signer.issuePutUrl({ objectKey: key, expiresInSeconds: 901 }),
    ).rejects.toThrow("TTL");
  });
});
