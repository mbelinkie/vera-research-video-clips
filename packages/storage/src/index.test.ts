import { describe, expect, it, vi } from "vitest";

import {
  MemoryTranscriptObjectStore,
  ObjectStoreSizeLimitError,
  S3TranscriptObjectStore,
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

  it("rejects an oversized pinned object before returning its bytes", async () => {
    const store = new MemoryTranscriptObjectStore();
    const stored = await store.put({
      key: "projects/a/manual-import/original.srt",
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "application/x-subrip",
      sha256: "a".repeat(64),
    });

    await expect(
      store.getBounded(stored.key, stored.versionId, 3),
    ).rejects.toBeInstanceOf(ObjectStoreSizeLimitError);
    await expect(
      store.getBounded(stored.key, stored.versionId, 4),
    ).resolves.toMatchObject({ versionId: stored.versionId });
  });

  it("deletes only the exact pinned version", async () => {
    const store = new MemoryTranscriptObjectStore();
    const first = await store.put({
      key: "projects/a/manual-import/original.srt",
      bytes: new Uint8Array([1]),
      contentType: "application/x-subrip",
      sha256: "a".repeat(64),
    });
    const second = await store.put({
      key: first.key,
      bytes: new Uint8Array([2]),
      contentType: "application/x-subrip",
      sha256: "b".repeat(64),
    });

    await expect(store.deleteVersion(first.key, first.versionId)).resolves.toBe(
      true,
    );
    await expect(
      store.get(first.key, first.versionId),
    ).resolves.toBeUndefined();
    await expect(store.get(first.key)).resolves.toMatchObject({
      versionId: second.versionId,
    });
    await expect(store.deleteVersion(first.key, first.versionId)).resolves.toBe(
      false,
    );
  });
});

describe("S3 transcript object store", () => {
  it("uses authoritative content length to reject before buffering", async () => {
    const transformToByteArray = vi.fn(async () => new Uint8Array(32));
    const client = {
      send: vi.fn(async () => ({
        Body: { transformToByteArray },
        ContentLength: 32,
        VersionId: "version-1",
      })),
    };
    const store = new S3TranscriptObjectStore(
      client as unknown as ConstructorParameters<
        typeof S3TranscriptObjectStore
      >[0],
      "fixture-bucket",
    );

    await expect(
      store.getBounded("private/import/original.srt", "version-1", 16),
    ).rejects.toBeInstanceOf(ObjectStoreSizeLimitError);
    expect(transformToByteArray).not.toHaveBeenCalled();
  });

  it("deletes an exact S3 object version without creating a delete marker for newer data", async () => {
    const client = { send: vi.fn(async (_command: unknown) => ({})) };
    const store = new S3TranscriptObjectStore(
      client as unknown as ConstructorParameters<
        typeof S3TranscriptObjectStore
      >[0],
      "fixture-bucket",
    );

    await expect(
      store.deleteVersion("private/import/original.srt", "version-1"),
    ).resolves.toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0]?.[0] as
      { input: unknown } | undefined;
    expect(command?.input).toEqual({
      Bucket: "fixture-bucket",
      Key: "private/import/original.srt",
      VersionId: "version-1",
    });
  });
});
