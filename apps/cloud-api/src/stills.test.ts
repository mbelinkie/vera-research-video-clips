import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { LocalTranscriptObjectStore } from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const WIDTH = 4;
const HEIGHT = 2;
const PNG = makePng(WIDTH, HEIGHT);
const PNG_SHA256 = createHash("sha256").update(PNG).digest("hex");
const PAGE_URL = "https://fixture.example/research-page";
const SOURCE_URL = "https://images.fixture.example/figure.png";

let database: PGlite;
let store: CorruptibleStore;
let cloud: ReturnType<typeof createCloudApi>;
let objectRoot = "";

const defaultReader = async (url: string) => ({
  bytes: Buffer.from(PNG),
  finalUrl: `${url}?resolved=1`,
});
const reader = vi.fn(defaultReader);

beforeAll(async () => {
  database = new PGlite();
  await runCloudMigrations(database);
  objectRoot = await mkdtemp(join(tmpdir(), "vera-stills-"));
  store = new CorruptibleStore(objectRoot);
  cloud = createCloudApi({
    catalog: new SharedProjectCatalog(database, store),
    authenticate: authenticateDevBearer,
    publicStillReader: reader,
  });
}, 30_000);

afterAll(async () => {
  await cloud?.close();
  await database?.close();
  if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
});

function auth(userId: string) {
  return { authorization: `Bearer ${userId}|fixture:${userId}` };
}

function resetReader() {
  reader.mockReset();
  reader.mockImplementation(defaultReader);
}

async function register(label: string) {
  const id = randomUUID();
  const response = await cloud.inject({
    method: "POST",
    url: "/api/session/register",
    headers: auth(id),
    payload: { displayName: label },
  });
  expect(response.statusCode, response.body).toBe(200);
  return id;
}

async function project(owner: string, name = "Still fixture") {
  const response = await cloud.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

async function addViewer(projectId: string, owner: string, viewer: string) {
  const response = await cloud.inject({
    method: "POST",
    url: `/api/projects/${projectId}/members`,
    headers: auth(owner),
    payload: { userId: viewer, role: "viewer" },
  });
  expect(response.statusCode, response.body).toBe(204);
}

function metadata(
  idempotencyKey: string,
  title = "Synthetic research still",
): Record<string, unknown> {
  return {
    idempotencyKey,
    title,
    topics: ["Research", "Synthetic"],
    credit: "Fixture photographer",
    licence: "CC BY 4.0",
    usageNote: "Generated pixels for API verification.",
    altText: "A synthetic two-row fixture image.",
  };
}

function multipart(
  fields: Record<string, unknown>,
  bytes: Buffer = PNG,
  filename = "fixture.png",
  contentType = "image/png",
) {
  const boundary = `still-fixture-${randomUUID()}`;
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(fields)}\r\n`,
    ),
  ];
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}

function postFile(
  projectId: string,
  owner: string,
  fields: Record<string, unknown>,
  bytes: Buffer = PNG,
) {
  const form = multipart(fields, bytes);
  return cloud.inject({
    method: "POST",
    url: `/api/projects/${projectId}/stills/from-file`,
    headers: { ...auth(owner), ...form.headers },
    payload: form.payload,
  });
}

async function createWebPageSource(projectId: string, owner: string) {
  const response = await cloud.inject({
    method: "POST",
    url: `/api/projects/${projectId}/sources`,
    headers: auth(owner),
    payload: {
      kind: "web_page",
      bibliography: { url: { value: PAGE_URL, state: "confirmed" } },
      details: { submittedUrl: PAGE_URL },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

describe("retained Library still HTTP API", () => {
  it("imports a supplied file, verifies pinned private bytes, and preserves metadata", async () => {
    const owner = await register("file owner");
    const projectId = await project(owner);
    const result = await postFile(projectId, owner, metadata("file-1"));
    expect(result.statusCode, result.body).toBe(201);
    const item = result.json<{
      id: string;
      sourceId: string;
      kind: string;
      topics: string[];
      content: Record<string, unknown>;
    }>();
    expect(item).toMatchObject({
      kind: "still",
      topics: ["Research", "Synthetic"],
      content: {
        title: "Synthetic research still",
        credit: "Fixture photographer",
        licence: "CC BY 4.0",
        usageNote: "Generated pixels for API verification.",
      },
    });

    const manifest = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${item.id}/assets`,
      headers: auth(owner),
    });
    expect(manifest.statusCode, manifest.body).toBe(200);
    expect(manifest.json()).toMatchObject({
      assets: {
        original: {
          sha256: PNG_SHA256,
          byteCount: PNG.byteLength,
          mimeType: "image/png",
          width: WIDTH,
          height: HEIGHT,
        },
      },
      provenance: {
        kind: "file",
        inputSha256: PNG_SHA256,
      },
    });

    for (const role of ["original", "display", "thumbnail"]) {
      const bytes = await cloud.inject({
        method: "GET",
        url: `/api/projects/${projectId}/stills/${item.id}/assets/${role}`,
        headers: auth(owner),
      });
      expect(bytes.statusCode, bytes.body).toBe(200);
      expect(bytes.headers["content-type"]).toMatch(/^image\//u);
      expect(bytes.rawPayload.byteLength).toBeGreaterThan(0);
    }
    const original = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${item.id}/assets/original`,
      headers: auth(owner),
    });
    expect(original.rawPayload).toEqual(PNG);
  });

  it("imports a public URL once, keeps the retained assets after egress breaks, and records redirect provenance", async () => {
    const owner = await register("url owner");
    const projectId = await project(owner);
    resetReader();
    reader.mockResolvedValueOnce({
      bytes: Buffer.from(PNG),
      finalUrl: "https://cdn.fixture.example/retained.png",
    });
    const result = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: {
        ...metadata("url-1", "URL still"),
        url: SOURCE_URL,
        pageUrl: PAGE_URL,
      },
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(reader).toHaveBeenCalledTimes(1);
    const item = result.json<{ id: string }>();
    const manifest = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${item.id}/assets`,
      headers: auth(owner),
    });
    expect(manifest.json()).toMatchObject({
      provenance: {
        kind: "url",
        sourceUrl: SOURCE_URL,
        resolvedUrl: "https://cdn.fixture.example/retained.png",
        pageUrl: PAGE_URL,
        inputSha256: PNG_SHA256,
      },
    });

    reader.mockRejectedValueOnce(new Error("source went offline"));
    for (const role of ["original", "display", "thumbnail"]) {
      const retained = await cloud.inject({
        method: "GET",
        url: `/api/projects/${projectId}/stills/${item.id}/assets/${role}`,
        headers: auth(owner),
      });
      expect(retained.statusCode, retained.body).toBe(200);
      expect(retained.rawPayload.byteLength).toBeGreaterThan(0);
      if (role === "original") expect(retained.rawPayload).toEqual(PNG);
    }
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("supports a page screenshot and a normalized crop with explicit lineage", async () => {
    const owner = await register("page owner");
    const projectId = await project(owner);
    const sourceId = await createWebPageSource(projectId, owner);
    const pageCrop = {
      ...metadata("page-1", "Page screenshot"),
      sourceId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      pageUrl: PAGE_URL,
    };
    const pageForm = multipart(pageCrop);
    const page = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-page-picture`,
      headers: { ...auth(owner), ...pageForm.headers },
      payload: pageForm.payload,
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageItem = page.json<{ id: string; sourceId: string }>();
    expect(pageItem.sourceId).toBe(sourceId);
    const pageManifest = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${pageItem.id}/assets`,
      headers: auth(owner),
    });
    expect(pageManifest.json()).toMatchObject({
      provenance: {
        kind: "page_picture",
        pageUrl: PAGE_URL,
        crop: pageCrop.crop,
      },
    });

    const cropped = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/${pageItem.id}/crop`,
      headers: auth(owner),
      payload: {
        ...metadata("crop-1", "Half screenshot"),
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
      },
    });
    expect(cropped.statusCode, cropped.body).toBe(201);
    const croppedItem = cropped.json<{ id: string; sourceId: string }>();
    expect(croppedItem.sourceId).toBe(sourceId);
    const croppedManifest = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${croppedItem.id}/assets`,
      headers: auth(owner),
    });
    expect(croppedManifest.json()).toMatchObject({
      assets: { original: { width: 2, height: HEIGHT } },
      provenance: {
        kind: "still_crop",
        parentItemId: pageItem.id,
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
      },
    });
  });

  it("crops exact retained pixels into a second immutable item, with lineage and guarded retries", async () => {
    const owner = await register("pixel crop owner");
    const viewer = await register("pixel crop viewer");
    const outsider = await register("pixel crop outsider");
    const projectId = await project(owner);
    const otherProjectId = await project(outsider, "Isolated crop project");
    await addViewer(projectId, owner, viewer);
    const parentResponse = await postFile(
      projectId,
      owner,
      metadata("pixel-parent"),
    );
    expect(parentResponse.statusCode, parentResponse.body).toBe(201);
    const parent = parentResponse.json<{ id: string; sourceId: string }>();
    const assetPath = (id: string, role = "original") =>
      `/api/projects/${projectId}/stills/${id}/assets/${role}`;
    const manifestPath = (id: string) =>
      `/api/projects/${projectId}/stills/${id}/assets`;
    const get = (url: string) =>
      cloud.inject({ method: "GET", url, headers: auth(owner) });

    const beforeBytes = await get(assetPath(parent.id));
    const beforeDisplay = await get(assetPath(parent.id, "display"));
    const beforeManifest = await get(manifestPath(parent.id));
    expect(beforeBytes.statusCode).toBe(200);
    expect(beforeBytes.rawPayload).toEqual(PNG);
    const parentDigest = beforeManifest.json<{
      assets: { original: { sha256: string; versionId: string } };
    }>().assets.original;
    expect(parentDigest.sha256).toBe(PNG_SHA256);

    // Floor left/top and ceil right/bottom on the oriented four-by-two raster:
    // x=[1,3), y=[1,2), so the two exact lower-row source pixels survive.
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 };
    const payload = { ...metadata("pixel-child", "Exact retained crop"), crop };
    const cropPath = `/api/projects/${projectId}/stills/${parent.id}/crop`;
    const childResponse = await cloud.inject({
      method: "POST",
      url: cropPath,
      headers: auth(owner),
      payload,
    });
    expect(childResponse.statusCode, childResponse.body).toBe(201);
    const child = childResponse.json<{
      id: string;
      sourceId: string;
      kind: string;
      topics: string[];
      content: { credit: string; licence: string; usageNote: string };
    }>();
    expect(child.id).not.toBe(parent.id);
    expect(child).toMatchObject({
      kind: "still",
      sourceId: parent.sourceId,
      topics: ["Research", "Synthetic"],
      content: {
        credit: "Fixture photographer",
        licence: "CC BY 4.0",
        usageNote: "Generated pixels for API verification.",
      },
    });

    const childManifestResponse = await get(manifestPath(child.id));
    expect(childManifestResponse.statusCode, childManifestResponse.body).toBe(
      200,
    );
    expect(childManifestResponse.json()).toMatchObject({
      assets: {
        original: { mimeType: "image/webp", width: 2, height: 1 },
        display: { width: 2, height: 1 },
      },
      provenance: {
        kind: "still_crop",
        parentItemId: parent.id,
        inputSha256: PNG_SHA256,
        crop,
      },
    });
    for (const role of ["original", "display"] as const) {
      const saved = await get(assetPath(child.id, role));
      expect(saved.statusCode, saved.body).toBe(200);
      const { data, info } = await sharp(saved.rawPayload)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 2, height: 1, channels: 4 });
      expect(data).toEqual(
        Buffer.from([0xec, 0x99, 0x55, 0xff, 0x22, 0x99, 0x55, 0xff]),
      );
    }

    const replay = await cloud.inject({
      method: "POST",
      url: cropPath,
      headers: auth(owner),
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ id: string }>().id).toBe(child.id);
    const divergent = await cloud.inject({
      method: "POST",
      url: cropPath,
      headers: auth(owner),
      payload: { ...payload, crop: { x: 0, y: 0, width: 1, height: 1 } },
    });
    expect(divergent.statusCode, divergent.body).toBe(409);

    // Full edge selection and a single-column crop at x=1-width remain valid.
    const edge = await cloud.inject({
      method: "POST",
      url: cropPath,
      headers: auth(owner),
      payload: {
        ...metadata("pixel-edge"),
        crop: { x: 0.75, y: 0, width: 0.25, height: 1 },
      },
    });
    expect(edge.statusCode, edge.body).toBe(201);
    expect(
      (await get(manifestPath(edge.json<{ id: string }>().id))).json(),
    ).toMatchObject({
      assets: { original: { width: 1, height: HEIGHT } },
    });
    for (const [index, invalid] of [
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
      { x: -0.01, y: 0, width: 0.5, height: 1 },
      { x: 0, y: -0.01, width: 1, height: 0.5 },
      { x: 0.9, y: 0, width: 0.2, height: 1 },
      { x: 0, y: 0.9, width: 1, height: 0.2 },
    ].entries()) {
      const denied = await cloud.inject({
        method: "POST",
        url: cropPath,
        headers: auth(owner),
        payload: { ...metadata(`pixel-invalid-${index}`), crop: invalid },
      });
      expect(denied.statusCode, JSON.stringify(invalid)).toBe(400);
    }
    for (const [actor, expected] of [
      [viewer, 403],
      [outsider, 403],
    ] as const) {
      const denied = await cloud.inject({
        method: "POST",
        url: cropPath,
        headers: auth(actor),
        payload: { ...metadata(`unauthorized-${actor}`), crop },
      });
      expect(denied.statusCode).toBe(expected);
    }
    const foreign = await cloud.inject({
      method: "POST",
      url: `/api/projects/${otherProjectId}/stills/${parent.id}/crop`,
      headers: auth(outsider),
      payload: { ...metadata("foreign-crop"), crop },
    });
    expect(foreign.statusCode).toBe(404);
    const afterBytes = await get(assetPath(parent.id));
    const afterDisplay = await get(assetPath(parent.id, "display"));
    const afterManifest = await get(manifestPath(parent.id));
    expect(afterBytes.rawPayload).toEqual(beforeBytes.rawPayload);
    expect(afterDisplay.rawPayload).toEqual(beforeDisplay.rawPayload);
    expect(afterManifest.json()).toEqual(beforeManifest.json());
    expect(
      afterManifest.json<{
        assets: { original: { sha256: string; versionId: string } };
      }>().assets.original,
    ).toEqual(parentDigest);
    const count = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM library_items WHERE project_id=$1 AND kind='still'",
      [projectId],
    );
    expect(count.rows[0]?.count).toBe("3");
  });

  it("replays only an identical idempotent import and rejects divergent retries", async () => {
    const owner = await register("replay owner");
    const projectId = await project(owner);
    const first = await postFile(projectId, owner, metadata("retry-1"));
    expect(first.statusCode, first.body).toBe(201);
    const replay = await postFile(projectId, owner, metadata("retry-1"));
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ id: string }>().id).toBe(
      first.json<{ id: string }>().id,
    );
    const mismatch = await postFile(
      projectId,
      owner,
      metadata("retry-1", "A different title"),
    );
    expect(mismatch.statusCode, mismatch.body).toBe(409);

    resetReader();
    reader.mockResolvedValueOnce({
      bytes: Buffer.from(PNG),
      finalUrl: SOURCE_URL,
    });
    const urlFirst = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: { ...metadata("retry-url"), url: SOURCE_URL },
    });
    expect(urlFirst.statusCode, urlFirst.body).toBe(201);
    const urlReplay = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: { ...metadata("retry-url"), url: SOURCE_URL },
    });
    expect(urlReplay.statusCode, urlReplay.body).toBe(201);
    expect(urlReplay.json<{ id: string }>().id).toBe(
      urlFirst.json<{ id: string }>().id,
    );
    reader.mockResolvedValueOnce({
      bytes: Buffer.from(makePng(WIDTH + 2, HEIGHT)),
      finalUrl: SOURCE_URL,
    });
    const changedBytes = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: { ...metadata("retry-url"), url: SOURCE_URL },
    });
    expect(changedBytes.statusCode, changedBytes.body).toBe(409);
    const urlMismatch = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: {
        ...metadata("retry-url"),
        url: "https://other.fixture/image.png",
      },
    });
    expect(urlMismatch.statusCode, urlMismatch.body).toBe(409);
  });

  it("checks membership before fetching, and isolates assets from outsiders and other projects", async () => {
    const owner = await register("authorized owner");
    const viewer = await register("authorized viewer");
    const outsider = await register("outsider");
    const projectId = await project(owner);
    const otherProjectId = await project(outsider, "Other project");
    await addViewer(projectId, owner, viewer);
    resetReader();
    const denied = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(viewer),
      payload: { ...metadata("viewer-url"), url: SOURCE_URL },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(reader).not.toHaveBeenCalled();

    const created = await postFile(projectId, owner, metadata("private-1"));
    const itemId = created.json<{ id: string }>().id;
    expect(
      (
        await cloud.inject({
          method: "GET",
          url: `/api/projects/${projectId}/stills/${itemId}/assets`,
          headers: auth(outsider),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await cloud.inject({
          method: "GET",
          url: `/api/projects/${otherProjectId}/stills/${itemId}/assets/original`,
          headers: auth(outsider),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("leaves no item for failed or malformed imports and reports invalid crop/size errors", async () => {
    const owner = await register("failure owner");
    const projectId = await project(owner);
    const before = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM library_items WHERE project_id=$1",
      [projectId],
    );
    resetReader();
    reader.mockRejectedValueOnce(new Error("offline URL"));
    const failed = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-url`,
      headers: auth(owner),
      payload: { ...metadata("failed-url"), url: SOURCE_URL },
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(400);
    const after = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM library_items WHERE project_id=$1",
      [projectId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

    const malformed = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-file`,
      headers: {
        ...auth(owner),
        "content-type": "multipart/form-data; boundary=missing-image",
      },
      payload: Buffer.from(
        '--missing-image\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}\r\n--missing-image--\r\n',
      ),
    });
    expect(malformed.statusCode).toBe(400);

    const pageSourceId = await createWebPageSource(projectId, owner);
    const badCropForm = multipart({
      ...metadata("bad-crop"),
      sourceId: pageSourceId,
      crop: { x: 0.9, y: 0, width: 0.5, height: 1 },
    });
    const badCrop = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/stills/from-page-picture`,
      headers: { ...auth(owner), ...badCropForm.headers },
      payload: badCropForm.payload,
    });
    expect(badCrop.statusCode).toBe(400);

    const oversized = await postFile(
      projectId,
      owner,
      metadata("oversized"),
      Buffer.alloc(20 * 1024 * 1024 + 1),
    );
    expect(oversized.statusCode).toBe(413);
  });

  it("returns 404 for legacy stills and 503 when a pinned retained object is corrupt", async () => {
    const owner = await register("storage owner");
    const projectId = await project(owner);
    const source = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/sources`,
      headers: auth(owner),
      payload: { kind: "offline", details: { subtype: "other" } },
    });
    expect(source.statusCode).toBe(201);
    const legacy = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/items`,
      headers: auth(owner),
      payload: {
        kind: "still",
        sourceId: source.json<{ id: string }>().id,
        content: { title: "Legacy still" },
      },
    });
    expect(legacy.statusCode).toBe(201);
    expect(
      (
        await cloud.inject({
          method: "GET",
          url: `/api/projects/${projectId}/stills/${legacy.json<{ id: string }>().id}/assets`,
          headers: auth(owner),
        })
      ).statusCode,
    ).toBe(404);

    const created = await postFile(projectId, owner, metadata("corrupt-1"));
    const itemId = created.json<{ id: string }>().id;
    const keys = await database.query<{ object_key: string }>(
      "SELECT object_key FROM library_still_assets WHERE project_id=$1 AND item_id=$2",
      [projectId, itemId],
    );
    expect(keys.rows.length).toBe(3);
    store.corrupt = true;
    const corrupt = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${itemId}/assets/display`,
      headers: auth(owner),
    });
    expect(corrupt.statusCode, corrupt.body).toBe(503);
    store.corrupt = false;
    store.missing = true;
    const missing = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/stills/${itemId}/assets/original`,
      headers: auth(owner),
    });
    expect(missing.statusCode, missing.body).toBe(503);
    store.missing = false;
  });
});

class CorruptibleStore extends LocalTranscriptObjectStore {
  corrupt = false;
  missing = false;

  override async get(key: string, versionId?: string) {
    if (this.missing) return undefined;
    const object = await super.get(key, versionId);
    if (!object || !this.corrupt) return object;
    const bytes = Buffer.from(object.bytes);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    return { ...object, bytes };
  }
}

function makePng(width: number, height: number): Buffer {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      rows[pixel] = x < width / 2 ? 0xec : 0x22;
      rows[pixel + 1] = y === 0 ? 0x72 : 0x99;
      rows[pixel + 2] = 0x55;
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
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
