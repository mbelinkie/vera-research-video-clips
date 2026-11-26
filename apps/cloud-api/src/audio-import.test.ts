import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import {
  AudioPeakCount,
  type AudioSpeechTranscript,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { authenticateDevBearer, createCloudApi } from "./app.ts";

const durationMs = 25_000;
const peaks = Array.from(
  { length: AudioPeakCount },
  (_, i) => i / AudioPeakCount,
);
const originalSha256 = "f".repeat(64);
const sourceUrl = "https://audio.example.org/room-tone.wav";

function fixtureWav(milliseconds: number) {
  const size = milliseconds * 16;
  const bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(size, 40);
  bytes.writeInt16LE(100, 44);
  return bytes;
}

const preview = fixtureWav(15_000);
const fullAudio = fixtureWav(durationMs);
const reader = vi.fn(async (_url: string) => fullAudio);
const prepare = vi.fn(async (_bytes: Buffer) => ({
  mimeType: "audio/wav" as const,
  durationMs,
  peaks,
}));

const publicTranscriber = vi.fn(async (_sourceId: string, bytes: Buffer) => ({
  audioSha256: createHash("sha256").update(bytes).digest("hex"),
  language: "en",
  model: "fixture",
  segments: [{ startMs: 1000, endMs: 2000, text: "Public speech fixture" }],
}));

class CorruptibleStore extends MemoryTranscriptObjectStore {
  corrupt = false;

  override async get(key: string, versionId?: string) {
    const stored = await super.get(key, versionId);
    if (!stored || !this.corrupt) return stored;
    const bytes = stored.bytes.slice();
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    return { ...stored, bytes };
  }
}
const store = new CorruptibleStore();
let db: PGlite;
let cloud: ReturnType<typeof createCloudApi>;
const owner = randomUUID();
const viewer = randomUUID();
const outsider = randomUUID();
let projectPath: string;
let audioPath: string;

function auth(userId: string) {
  return { authorization: `Bearer ${userId}|fixture:${userId}` };
}

beforeAll(async () => {
  db = new PGlite();
  await runCloudMigrations(db);
  cloud = createCloudApi({
    catalog: new SharedProjectCatalog(db, store),
    authenticate: authenticateDevBearer,
    publicAudioReader: reader,
    publicAudioPreparation: prepare,
    transcribePublicAudio: publicTranscriber,
  });
  for (const [id, displayName] of [
    [owner, "Audio owner"],
    [viewer, "Audio viewer"],
    [outsider, "Other user"],
  ] as const) {
    const registered = await cloud.inject({
      method: "POST",
      url: "/api/session/register",
      headers: auth(id),
      payload: { displayName },
    });
    expect(registered.statusCode, registered.body).toBe(200);
  }
  const project = await cloud.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Audio fixture" },
  });
  expect(project.statusCode, project.body).toBe(201);
  projectPath = `/api/projects/${project.json<{ id: string }>().id}`;
  audioPath = projectPath + "/audio";
  expect(
    (
      await cloud.inject({
        method: "POST",
        url: projectPath + "/members",
        headers: auth(owner),
        payload: { userId: viewer, role: "viewer" },
      })
    ).statusCode,
  ).toBe(204);
}, 30_000);

afterAll(async () => {
  await cloud?.close();
  await db?.close();
});

function importFile(key: string, changes = {}) {
  return cloud.inject({
    method: "POST",
    url: audioPath + "/from-file",
    headers: auth(owner),
    payload: {
      idempotencyKey: key,
      title: "Generated room tone",
      role: "ambience",
      originalSha256,
      durationMs,
      peaks,
      previewBase64: preview.toString("base64"),
      ...changes,
    },
  });
}

it("publishes only the preview for a file and saves a named Library selection", async () => {
  const response = await importFile("file-fixture");
  expect(response.statusCode, response.body).toBe(201);
  const source = response.json();
  expect(source).toMatchObject({
    kind: "audio",
    details: { durationMs, role: "ambience" },
  });
  expect((await importFile("file-fixture")).json().id).toBe(source.id);
  expect(
    (await importFile("file-fixture", { title: "Different title" })).statusCode,
  ).toBe(409);

  const manifestPath = `${audioPath}/${source.id}`;
  const manifest = await cloud.inject({
    url: manifestPath,
    headers: auth(viewer),
  });
  expect(manifest.statusCode, manifest.body).toBe(200);
  expect(manifest.json()).toEqual({
    durationMs,
    peaks,
    playbackDurationMs: 15_000,
    mimeType: "audio/wav",
    playbackSha256: createHash("sha256").update(preview).digest("hex"),
    origin: { kind: "file", originalSha256 },
  });
  expect(
    (await cloud.inject({ url: manifestPath, headers: auth(outsider) }))
      .statusCode,
  ).toBe(403);

  const playback = await cloud.inject({
    url: manifestPath + "/playback",
    headers: auth(viewer),
  });
  expect(playback.statusCode).toBe(200);
  expect(playback.headers["cache-control"]).toBe("private, no-store");
  expect(playback.rawPayload).toEqual(preview);
  expect(
    (
      await cloud.inject({
        url: manifestPath + "/playback",
        headers: auth(outsider),
      })
    ).statusCode,
  ).toBe(403);

  const payload = {
    idempotencyKey: "named-audio",
    kind: "audio",
    sourceId: source.id,
    content: {
      title: "Late room tone",
      startMs: 17_000,
      endMs: 22_000,
      role: "ambience",
    },
    topics: ["Room tone", "Edit"],
  };
  const save = await cloud.inject({
    method: "POST",
    url: projectPath + "/items",
    headers: auth(owner),
    payload,
  });
  expect(save.statusCode, save.body).toBe(201);
  const listed = await cloud.inject({
    url: projectPath + "/items?kind=audio&topic=Room%20tone",
    headers: auth(viewer),
  });
  expect(listed.json()).toMatchObject([
    { content: payload.content, topics: ["Edit", "Room tone"] },
  ]);
  const invalid = await cloud.inject({
    method: "POST",
    url: projectPath + "/items",
    headers: auth(owner),
    payload: {
      ...payload,
      idempotencyKey: "bad-bounds",
      content: { ...payload.content, endMs: durationMs + 1 },
    },
  });
  expect(invalid.statusCode, invalid.body).toBe(409);
});

it("keeps a verified public audio copy and rejects corrupted object bytes", async () => {
  const response = await cloud.inject({
    method: "POST",
    url: audioPath + "/from-url",
    headers: auth(owner),
    payload: {
      idempotencyKey: "url-fixture",
      title: "Public fixture",
      url: sourceUrl,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  expect(reader).toHaveBeenCalledWith(sourceUrl);
  expect(prepare).toHaveBeenCalledWith(fullAudio);
  const source = response.json();
  expect(source.bibliography.url?.value).toBe(sourceUrl);
  const path = `${audioPath}/${source.id}/playback`;
  const playback = await cloud.inject({ url: path, headers: auth(owner) });
  expect(playback.statusCode).toBe(200);
  expect(playback.rawPayload).toEqual(fullAudio);
  store.corrupt = true;
  try {
    const corrupted = await cloud.inject({ url: path, headers: auth(owner) });
    expect(corrupted.statusCode, corrupted.body).toBe(503);
  } finally {
    store.corrupt = false;
  }
});

it("rejects oversized previews, signed URLs and unauthorized URL imports before fetching", async () => {
  reader.mockClear();
  const invalidFile = await importFile("invalid-file", {
    previewBase64: fixtureWav(16_000).toString("base64"),
  });
  expect(invalidFile.statusCode, invalidFile.body).toBe(400);
  const send = (user: string, url: string) =>
    cloud.inject({
      method: "POST",
      url: audioPath + "/from-url",
      headers: auth(user),
      payload: { idempotencyKey: "rejected-url", title: "Rejected audio", url },
    });
  expect((await send(viewer, sourceUrl)).statusCode).toBe(403);
  expect(
    (await send(owner, sourceUrl + "?X-Amz-Signature=fixture")).statusCode,
  ).toBe(400);
  expect(reader).not.toHaveBeenCalled();
});

it("does not publish a source if its stored playback cannot be verified", async () => {
  store.corrupt = true;
  try {
    const failed = await importFile("failed-storage", {
      title: "Failed storage fixture",
    });
    expect(failed.statusCode, failed.body).toBe(503);
  } finally {
    store.corrupt = false;
  }
  const sources = await cloud.inject({
    url: projectPath + "/sources?kind=audio&q=Failed%20storage%20fixture",
    headers: auth(owner),
  });
  expect(sources.statusCode, sources.body).toBe(200);
  expect(sources.json()).toEqual([]);
});

it("stores Speech transcript text for project readers and binds it to the original", async () => {
  const source = (
    await importFile("speech-fixture", { role: "speech" })
  ).json();
  const path = `${audioPath}/${source.id}/transcript`;
  const transcript: AudioSpeechTranscript = {
    audioSha256: originalSha256,
    language: "en",
    model: "fixture",
    segments: [
      { startMs: 17_000, endMs: 22_000, text: "Recorded beyond the preview" },
    ],
  };
  const publish = (
    user: string,
    changes: Partial<AudioSpeechTranscript> = {},
  ) =>
    cloud.inject({
      method: "POST",
      url: path,
      headers: auth(user),
      payload: { mode: "file", transcript: { ...transcript, ...changes } },
    });
  const read = (user: string) =>
    cloud.inject({ url: path, headers: auth(user) });
  expect((await read(viewer)).json()).toEqual({ transcript: null });
  expect((await publish(viewer)).statusCode).toBe(403);
  expect((await read(outsider)).statusCode).toBe(403);
  expect(
    (await publish(owner, { audioSha256: "a".repeat(64) })).statusCode,
  ).toBe(409);
  expect(
    (
      await publish(owner, {
        segments: [{ ...transcript.segments[0]!, endMs: durationMs + 1 }],
      })
    ).statusCode,
  ).toBe(409);
  const saved = await publish(owner);
  expect(saved.statusCode, saved.body).toBe(200);
  expect((await publish(owner, { model: "another-run" })).json()).toEqual(
    transcript,
  );
  expect((await read(viewer)).json()).toEqual({ transcript });
  const attemptedRemoteTranscription = await cloud.inject({
    method: "POST",
    url: path,
    headers: auth(owner),
    payload: { mode: "url" },
  });
  expect(attemptedRemoteTranscription.statusCode).toBe(400);
});

it("transcribes a verified public asset once without downloading the URL again", async () => {
  publicTranscriber.mockClear();
  const response = await cloud.inject({
    method: "POST",
    url: audioPath + "/from-url",
    headers: auth(owner),
    payload: {
      idempotencyKey: "public-speech-fixture",
      title: "Public speech",
      url: sourceUrl,
      role: "speech",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const source = response.json();
  reader.mockClear();
  const path = `${audioPath}/${source.id}/transcript`;
  const transcribe = (user: string) =>
    cloud.inject({
      method: "POST",
      url: path,
      headers: auth(user),
      payload: { mode: "url" },
    });
  expect((await transcribe(viewer)).statusCode).toBe(403);
  const first = await transcribe(owner);
  expect(first.statusCode, first.body).toBe(200);
  expect((await transcribe(owner)).json()).toEqual(first.json());
  expect(publicTranscriber).toHaveBeenCalledExactlyOnceWith(
    source.id,
    fullAudio,
    durationMs,
    expect.any(AbortSignal),
  );
  expect(reader).not.toHaveBeenCalled();
});
