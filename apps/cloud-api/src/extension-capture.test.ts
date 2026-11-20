import { deflateSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const TOP = makePng(4, 2, 0x26);
const PASSAGE = makePng(4, 2);

const store = new MemoryTranscriptObjectStore();
let database: PGlite;
let cloud: ReturnType<typeof createCloudApi>;

beforeAll(async () => {
  database = new PGlite();
  await runCloudMigrations(database);
  cloud = createCloudApi({
    catalog: new SharedProjectCatalog(database, store),
    authenticate: authenticateDevBearer,
  });
}, 30_000);

afterAll(async () => {
  await cloud?.close();
  await database?.close();
});

function auth(userId: string) {
  return { authorization: `Bearer ${userId}|extension-test:${userId}` };
}

async function register(label: string) {
  const id = crypto.randomUUID();
  const response = await cloud.inject({
    method: "POST",
    url: "/api/session/register",
    headers: auth(id),
    payload: { displayName: label },
  });
  expect(response.statusCode, response.body).toBe(200);
  return id;
}

async function createProject(owner: string) {
  const response = await cloud.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Extension capture fixture" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

function captureBody(
  requestId: string,
  url = "https://fixture.example/story?utm_source=test",
) {
  return {
    kind: "quote",
    requestId,
    url,
    metadata: {
      title: "Fixture story",
      authors: ["A. Researcher"],
      publication: "Fixture Gazette",
      date: "2026-01-03",
      url: "https://www.fixture.example/story",
    },
    articleText:
      "The clean article text came from the active browser tab, not a server fetch.",
    top: { data: TOP.toString("base64"), width: 4, height: 2 },
    passage: { data: PASSAGE.toString("base64"), width: 4, height: 2 },
    quote: {
      text: "  exact\nquote  ",
      surroundingWords: { before: "before", after: "after" },
      speaker: "Speaker",
      speakerTitle: "Editor",
      highlight: {
        rectangles: [{ x: 0.25, y: 0, width: 0.5, height: 1 }],
      },
    },
    topics: ["Field work", "Archive"],
    notes: "Keep the line break exactly as captured.",
  };
}

describe("browser extension project capture ingress", () => {
  it("saves a page source and quote atomically, pins PNG revisions, and replays", async () => {
    const owner = await register("capture owner");
    const viewer = await register("capture viewer");
    const projectId = await createProject(owner);
    const membership = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/members`,
      headers: auth(owner),
      payload: { userId: viewer, role: "viewer" },
    });
    expect(membership.statusCode, membership.body).toBe(204);

    const requestId = crypto.randomUUID();
    const body = captureBody(requestId);
    const saved = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: body,
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const receipt = saved.json<{
      captureId: string;
      kind: string;
      sourceId: string;
      itemId: string;
      assets: Array<Record<string, unknown>>;
    }>();
    expect(receipt).toMatchObject({
      captureId: requestId,
      kind: "quote",
      assets: [
        {
          role: "passage",
          revisionId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
          provenance: {
            kind: "user_supplied",
            source: "browser_extension",
            principal: { principalKind: "user" },
            sourceUrlDigest: expect.stringMatching(/^sha256:/),
          },
          width: 4,
          height: 2,
          pixelRectangles: [{ x: 1, y: 0, width: 2, height: 2 }],
        },
        { role: "top", width: 4, height: 2, pixelRectangles: [] },
      ],
    });

    const item = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/items/${receipt.itemId}`,
      headers: auth(owner),
    });
    expect(item.statusCode, item.body).toBe(200);
    expect(
      item.json<{ content: { text: string }; notes: string }>(),
    ).toMatchObject({
      content: { text: "  exact\nquote  " },
      notes: "Keep the line break exactly as captured.",
    });

    const manifest = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/extension-captures/${requestId}`,
      headers: auth(viewer),
    });
    expect(manifest.statusCode, manifest.body).toBe(200);
    expect(manifest.json<{ sourceId: string }>().sourceId).toBe(
      receipt.sourceId,
    );

    const passage = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/extension-captures/${requestId}/assets/passage?revisionId=${receipt.assets[0]!.revisionId}`,
      headers: auth(viewer),
    });
    expect(passage.statusCode, passage.body).toBe(200);
    expect(passage.headers["content-type"]).toMatch(/^image\/png/u);
    expect(Buffer.from(passage.rawPayload)).toEqual(PASSAGE);

    expect(
      (
        await cloud.inject({
          method: "GET",
          url: `/api/projects/${projectId}/extension-captures/${requestId}/assets/passage?revisionId=${crypto.randomUUID()}`,
          headers: auth(viewer),
        })
      ).statusCode,
    ).toBe(404);

    const replay = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: body,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ itemId: string }>().itemId).toBe(receipt.itemId);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM library_items WHERE project_id=$1",
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe("1");

    const conflict = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: { ...body, notes: "different request" },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
  });

  it("repairs missing pictures on the original quote and preserves existing revisions on retry", async () => {
    const owner = await register("repair owner");
    const projectId = await createProject(owner);
    const input = captureBody(crypto.randomUUID());
    const post = (payload: object) =>
      cloud.inject({
        method: "POST",
        url: `/api/projects/${projectId}/extension-captures`,
        headers: auth(owner),
        payload,
      });
    const original = await post({
      ...input,
      passage: undefined,
      quote: { text: input.quote.text },
    });
    expect(original.statusCode).toBe(201);
    const receipt = original.json();
    expect(receipt.missingPictures).toEqual(["passage"]);
    const repair = {
      ...input,
      requestId: crypto.randomUUID(),
      repairCaptureId: receipt.captureId,
    };
    expect(
      (await post({ ...repair, quote: { text: "other passage" } })).statusCode,
    ).toBe(409);
    const saved = await post(repair);
    expect(saved.statusCode, saved.body).toBe(201);
    const result = saved.json();
    expect(result).toMatchObject({
      captureId: receipt.captureId,
      itemId: receipt.itemId,
      sourceId: receipt.sourceId,
      missingPictures: [],
    });
    expect(result.assets).toContainEqual(receipt.assets[0]);
    expect(result.assets).toHaveLength(2);
    expect((await post(repair)).json()).toEqual(result);
    const item = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/items/${receipt.itemId}`,
      headers: auth(owner),
    });
    expect(item.json().content.highlight).toEqual(input.quote.highlight);
  });

  it("keeps page/audio captures itemless, reuses page sources, and denies outsiders", async () => {
    const owner = await register("page owner");
    const outsider = await register("page outsider");
    const projectId = await createProject(owner);
    const pageId = crypto.randomUUID();
    const page = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: {
        kind: "page",
        requestId: pageId,
        url: "https://fixture.example/article?utm_campaign=one",
        metadata: { title: "Page" },
        articleText: "Visible article text",
        top: { data: TOP.toString("base64"), width: 4, height: 2 },
      },
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageReceipt = page.json<{ sourceId: string; itemId?: string }>();
    expect(pageReceipt.itemId).toBeUndefined();

    const repeated = captureBody(
      crypto.randomUUID(),
      "https://fixture.example/article?utm_campaign=two",
    );
    repeated.metadata.url = "https://fixture.example/article";
    const quote = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: repeated,
    });
    expect(quote.statusCode, quote.body).toBe(201);
    expect(quote.json<{ sourceId: string }>().sourceId).toBe(
      pageReceipt.sourceId,
    );

    const audio = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: {
        kind: "audio",
        requestId: crypto.randomUUID(),
        url: "https://media.fixture.example/interview.mp3",
        pageUrl: "https://fixture.example/article",
        title: "Interview audio",
      },
    });
    expect(audio.statusCode, audio.body).toBe(201);
    expect(audio.json<{ itemId?: string }>().itemId).toBeUndefined();

    const denied = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/extension-captures/${pageId}`,
      headers: auth(outsider),
    });
    expect(denied.statusCode, denied.body).toBe(403);
  });

  it("keeps the source and quote invisible until both pinned images verify, then permits retry", async () => {
    const owner = await register("Retry fixture");
    const projectId = await createProject(owner);
    const requestId = crypto.randomUUID();
    const payload = captureBody(requestId);
    const url = `/api/projects/${projectId}/extension-captures`;
    const get = store.get.bind(store);
    const mock = vi
      .spyOn(store, "get")
      .mockImplementation(async (key, versionId) => {
        const object = await get(key, versionId);
        if (object && versionId && key.includes("/passage/"))
          return { ...object, bytes: TOP };
        return object;
      });
    try {
      expect(
        (
          await cloud.inject({
            method: "POST",
            url,
            headers: auth(owner),
            payload,
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      mock.mockRestore();
    }
    for (const table of [
      "library_sources",
      "library_items",
      "extension_captures",
      "extension_capture_assets",
    ]) {
      expect(
        (
          await database.query(`SELECT 1 FROM ${table} WHERE project_id=$1`, [
            projectId,
          ])
        ).rows,
      ).toEqual([]);
    }
    const saved = await cloud.inject({
      method: "POST",
      url,
      headers: auth(owner),
      payload,
    });
    expect(saved.statusCode, saved.body).toBe(201);
    for (const [role, expected] of [
      ["top", TOP],
      ["passage", PASSAGE],
    ] as const) {
      const read = await cloud.inject({
        method: "GET",
        url: `${url}/${requestId}/assets/${role}`,
        headers: auth(owner),
      });
      expect(read.rawPayload).toEqual(expected);
    }
  });
  it("rejects mismatched PNG dimensions before creating catalog rows", async () => {
    const owner = await register("invalid capture owner");
    const projectId = await createProject(owner);
    const response = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/extension-captures`,
      headers: auth(owner),
      payload: {
        kind: "page",
        requestId: crypto.randomUUID(),
        url: "https://fixture.example/invalid",
        metadata: {},
        top: { data: TOP.toString("base64"), width: 5, height: 2 },
      },
    });
    expect(response.statusCode, response.body).toBe(400);
    const captures = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM extension_captures WHERE project_id=$1",
      [projectId],
    );
    expect(captures.rows[0]?.count).toBe("0");
  });
});

function makePng(width: number, height: number, blue = 0x55): Buffer {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      rows[pixel] = x < width / 2 ? 0xec : 0x22;
      rows[pixel + 1] = y === 0 ? 0x72 : 0x99;
      rows[pixel + 2] = blue;
      rows[pixel + 3] = 0xff;
    }
  }
  const signature = Buffer.from("\x89PNG\r\n\x1a\n", "binary");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
    return Buffer.concat([length, name, data, crc]);
  };
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
