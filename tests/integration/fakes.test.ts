import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { JobSchema } from "@research-video/contracts";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { MemoryJobQueue } from "@research-video/sync";

describe("fake infrastructure", () => {
  it("moves a queued artifact through the fake queue and object store", async () => {
    const queue = new MemoryJobQueue<ReturnType<typeof JobSchema.parse>>();
    const store = new MemoryTranscriptObjectStore();
    const bytes = new TextEncoder().encode('{"schemaVersion":1}');
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const job = JobSchema.parse({
      id: "019fbb95-cd76-7920-93fa-e23ba755e301",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e302",
      kind: "transcription",
      state: "queued",
      idempotencyKey: "fixture:publish",
      attempt: 0,
      payload: { key: "projects/fixture/transcripts/manifest.json" },
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    });

    await queue.send("message-1", job);
    const delivery = await queue.receive();
    const key = delivery?.payload.payload.key;
    expect(typeof key).toBe("string");
    await store.put({
      key: key as string,
      bytes,
      contentType: "application/json",
      sha256,
    });
    await queue.acknowledge(delivery!.receipt);

    expect((await store.get(key as string))?.sha256).toBe(sha256);
    expect(await queue.receive()).toBeUndefined();
  });
});
