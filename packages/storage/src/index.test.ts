import { describe, expect, it } from "vitest";

import { MemoryTranscriptObjectStore } from "./index.ts";

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
