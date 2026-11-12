import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalTranscriptObjectStore,
  MemoryTranscriptObjectStore,
} from "./index.ts";

describe("memory transcript object store", () => {
  it("copies bytes and lists project-scoped keys", async () => {
    const store = new MemoryTranscriptObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);

    await store.put({
      key: "projects/project-a/transcripts/manifest.json",
      bytes,
      contentType: "application/json",
      sha256: "a".repeat(64),
    });
    bytes[0] = 9;

    const saved = await store.get(
      "projects/project-a/transcripts/manifest.json",
    );
    expect(saved?.bytes[0]).toBe(1);
    expect(await store.list("projects/project-a/")).toHaveLength(1);
    expect(await store.list("projects/project-b/")).toHaveLength(0);
  });

  it("preserves immutable versions and returns the newest by default", async () => {
    const store = new MemoryTranscriptObjectStore();
    const first = await store.put({
      key: "projects/a/transcripts/cues.json",
      bytes: new Uint8Array([1]),
      contentType: "application/json",
      sha256: "a".repeat(64),
    });
    const second = await store.put({
      key: first.key,
      bytes: new Uint8Array([2]),
      contentType: "application/json",
      sha256: "b".repeat(64),
    });

    expect((await store.get(first.key, first.versionId))?.bytes[0]).toBe(1);
    expect((await store.get(first.key))?.versionId).toBe(second.versionId);
  });
});

// R1 #50: proposed isolated filesystem adapter contract, not a claim that the
// catalog's upload/download grant path is integrated or the store is crash-safe.
const localRoots: string[] = [];
const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera50-local-store-"));
  localRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    localRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local transcript object store (R1 #50 candidate)", () => {
  it("publishes verified bytes and reopens exact immutable versions", async () => {
    const root = await newRoot();
    const key = "projects/fixture/transcripts/manifest.json";
    const firstBytes = bytes("first transcript");
    const secondBytes = bytes("second transcript");
    const store = new LocalTranscriptObjectStore(root);
    const first = await store.put({
      key,
      bytes: firstBytes,
      contentType: "application/json",
      sha256: sha256(firstBytes),
    });
    firstBytes[0] = 0;
    const second = await store.put({
      key,
      bytes: secondBytes,
      contentType: "application/json",
      sha256: sha256(secondBytes),
    });
    expect(first.versionId).not.toBe(second.versionId);

    const reopened = new LocalTranscriptObjectStore(root);
    const old = await reopened.get(key, first.versionId);
    const current = await reopened.get(key);
    expect(old?.bytes).toEqual(bytes("first transcript"));
    expect(old?.sha256).toBe(sha256(bytes("first transcript")));
    expect(old?.contentType).toBe("application/json");
    expect(current?.versionId).toBe(second.versionId);
    expect(current?.bytes).toEqual(secondBytes);
    expect(await reopened.list("projects/fixture/")).toEqual([key]);
    expect(await reopened.get(key, "nonexistent-version")).toBeUndefined();
  });

  it("rejects an incorrect digest without publishing a version", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const key = "projects/fixture/transcripts/wrong-hash.json";
    await expect(
      store.put({
        key,
        bytes: bytes("real bytes"),
        contentType: "application/json",
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow();
    const reopened = new LocalTranscriptObjectStore(root);
    expect(await reopened.get(key)).toBeUndefined();
    expect(await reopened.list("projects/fixture/")).toEqual([]);
  });

  it("preserves historical versions when deleting the visible key", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const key = "projects/fixture/transcripts/historical.json";
    const data = bytes("keep this immutable version");
    const published = await store.put({
      key,
      bytes: data,
      contentType: "application/json",
      sha256: sha256(data),
    });
    await store.delete(key);

    const reopened = new LocalTranscriptObjectStore(root);
    expect(await reopened.get(key)).toBeUndefined();
    expect(await reopened.list("projects/fixture/")).toEqual([]);
    expect((await reopened.get(key, published.versionId))?.bytes).toEqual(data);
  });

  it("rejects unsafe object keys before any external path can be written", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const data = bytes("safe fixture");
    for (const key of [
      "../escape.json",
      "/absolute.json",
      "projects/../escape.json",
      "projects/./escape.json",
      "projects//escape.json",
      "projects\\escape.json",
      "projects/fixture/\u0000escape.json",
    ]) {
      await expect(
        store.put({
          key,
          bytes: data,
          contentType: "application/json",
          sha256: sha256(data),
        }),
      ).rejects.toThrow();
    }
    expect(await store.list("projects/")).toEqual([]);
  });

  it("preserves two independently published concurrent versions", async () => {
    const root = await newRoot();
    const key = "projects/fixture/transcripts/parallel.json";
    const one = bytes("writer one");
    const two = bytes("writer two");
    const [left, right] = await Promise.all([
      new LocalTranscriptObjectStore(root).put({
        key,
        bytes: one,
        contentType: "application/json",
        sha256: sha256(one),
      }),
      new LocalTranscriptObjectStore(root).put({
        key,
        bytes: two,
        contentType: "application/json",
        sha256: sha256(two),
      }),
    ]);
    expect(left.versionId).not.toBe(right.versionId);
    const reopened = new LocalTranscriptObjectStore(root);
    expect((await reopened.get(key, left.versionId))?.bytes).toEqual(one);
    expect((await reopened.get(key, right.versionId))?.bytes).toEqual(two);
  });
});
