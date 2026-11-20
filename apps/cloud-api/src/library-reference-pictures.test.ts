import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { createCloudApi, authenticateDevBearer } from "./app.ts";

let database: PGlite;
class FaultyStore extends MemoryTranscriptObjectStore {
  corrupt = false;
  failPut = false;
  failAfterPuts: number | null = null;
  override async get(key: string, versionId?: string) {
    const value = await super.get(key, versionId);
    if (!value || !this.corrupt) return value;
    const bytes = Buffer.from(value.bytes);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    return { ...value, bytes };
  }
  override async put(input: Parameters<MemoryTranscriptObjectStore["put"]>[0]) {
    if (this.failAfterPuts !== null && --this.failAfterPuts === 0) {
      this.failAfterPuts = null;
      throw new Error("simulated mid-upload store failure");
    }
    if (this.failPut) throw new Error("simulated store failure");
    return super.put(input);
  }
}
let store: FaultyStore;
let cloud: ReturnType<typeof createCloudApi>;
let png: Buffer;
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const auth = (id: string) => ({ authorization: `Bearer ${id}|fixture:${id}` });
const path = (project: string, kind: "source" | "quote", id: string) =>
  `/api/projects/${project}/library-reference-pictures/${kind}/${id}`;

beforeAll(async () => {
  database = new PGlite();
  await runCloudMigrations(database);
  store = new FaultyStore();
  cloud = createCloudApi({
    catalog: new SharedProjectCatalog(database, store),
    authenticate: authenticateDevBearer,
  });
  png = await sharp({
    create: { width: 6, height: 4, channels: 4, background: "#e0bcd9" },
  })
    .png()
    .toBuffer();
}, 30_000);
afterAll(async () => {
  await cloud?.close();
  await database?.close();
});

async function register(name: string) {
  const id = randomUUID();
  const response = await cloud.inject({
    method: "POST",
    url: "/api/session/register",
    headers: auth(id),
    payload: { displayName: name },
  });
  expect(response.statusCode, response.body).toBe(200);
  return id;
}
async function project(owner: string) {
  const response = await cloud.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Reference photo fixture" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}
async function source(
  projectId: string,
  owner: string,
  kind: "offline" | "web_page" = "offline",
) {
  const response = await cloud.inject({
    method: "POST",
    url: `/api/projects/${projectId}/sources`,
    headers: auth(owner),
    payload: {
      kind,
      bibliography: {
        title: { value: "Source title", state: "confirmed" },
        ...(kind === "web_page"
          ? {
              url: { value: "https://example.org/article", state: "confirmed" },
            }
          : {}),
      },
      details:
        kind === "offline"
          ? { subtype: "book" }
          : { submittedUrl: "https://example.org/article" },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}
async function quote(projectId: string, owner: string, sourceId: string) {
  const response = await cloud.inject({
    method: "POST",
    url: `/api/projects/${projectId}/items`,
    headers: auth(owner),
    payload: {
      kind: "quote",
      sourceId,
      content: {
        text: "  Never normalize this quote.  ",
        speaker: "Speaker",
        surroundingWords: { before: "Original context" },
      },
      topics: ["Books"],
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}
function multipart(
  image = png,
  metadata: unknown = { expectedRevisionId: null },
) {
  const boundary = `fixture-${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="picture.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  };
}
function upload(
  projectId: string,
  kind: "source" | "quote",
  id: string,
  actor: string,
  revision: string | null = null,
  image = png,
) {
  const form = multipart(image, { expectedRevisionId: revision });
  return cloud.inject({
    method: "POST",
    url: path(projectId, kind, id),
    headers: { ...auth(actor), ...form.headers },
    payload: form.payload,
  });
}
function read(
  projectId: string,
  kind: "source" | "quote",
  id: string,
  actor: string,
  suffix = "",
) {
  return cloud.inject({
    method: "GET",
    url: path(projectId, kind, id) + suffix,
    headers: auth(actor),
  });
}

describe("project-owned reference pictures", () => {
  it("retains a book cover as three verified immutable private roles, not a Library still", async () => {
    const owner = await register("cover owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner);
    const response = await upload(projectId, "source", sourceId, owner);
    expect(response.statusCode, response.body).toBe(201);
    const manifest = response.json<{
      revisionId: string;
      assets: Record<
        string,
        {
          sha256: string;
          mimeType: string;
          width: number;
          height: number;
          versionId: string;
        }
      >;
    }>();
    expect(manifest.revisionId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(Object.keys(manifest.assets).sort()).toEqual([
      "display",
      "original",
      "thumbnail",
    ]);
    expect(manifest.assets.original).toMatchObject({
      sha256: sha(png),
      mimeType: "image/png",
      width: 6,
      height: 4,
    });
    expect(manifest.assets.display).toMatchObject({
      mimeType: "image/webp",
      width: 6,
      height: 4,
    });
    expect(manifest.assets.thumbnail).toMatchObject({
      mimeType: "image/webp",
      width: 6,
      height: 4,
    });
    const fetched = await read(projectId, "source", sourceId, owner);
    expect(fetched.statusCode, fetched.body).toBe(200);
    expect(fetched.headers["cache-control"]).toBe("private, no-store");
    expect(fetched.json()).toEqual(manifest);
    const original = await read(
      projectId,
      "source",
      sourceId,
      owner,
      "/original",
    );
    expect(original.statusCode, original.body).toBe(200);
    expect(original.headers["x-content-type-options"]).toBe("nosniff");
    expect(original.headers["content-disposition"]).toBe("attachment");
    expect(original.rawPayload).toEqual(png);
    const display = await read(
      projectId,
      "source",
      sourceId,
      owner,
      "/display",
    );
    expect(display.statusCode, display.body).toBe(200);
    expect(display.headers["content-type"]).toContain("image/webp");
    const none = await database.query(
      "SELECT id FROM library_items WHERE project_id=$1",
      [projectId],
    );
    expect(none.rows).toHaveLength(0);
    const pictures = await database.query<{
      object_key: string;
      object_version_id: string;
    }>(
      "SELECT object_key,object_version_id FROM library_reference_pictures WHERE project_id=$1",
      [projectId],
    );
    expect(pictures.rows).toHaveLength(3);
    expect(
      pictures.rows.every((row) =>
        row.object_key.includes(`/source/${sourceId}/`),
      ),
    ).toBe(true);
  });

  it("attaches to a quote on a web page without altering quote text or extension provenance", async () => {
    const owner = await register("quote picture owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner, "web_page");
    const itemId = await quote(projectId, owner, sourceId);
    expect((await upload(projectId, "quote", itemId, owner)).statusCode).toBe(
      201,
    );
    expect(
      (await read(projectId, "quote", itemId, owner, "/thumbnail")).statusCode,
    ).toBe(200);
    const item = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/items/${itemId}`,
      headers: auth(owner),
    });
    expect(item.json()).toMatchObject({
      kind: "quote",
      content: {
        text: "  Never normalize this quote.  ",
        surroundingWords: { before: "Original context" },
      },
    });
    expect((await read(projectId, "source", sourceId, owner)).statusCode).toBe(
      404,
    );
  });

  it("rejects viewer writes before store use, outsider reads and cross-project lookups", async () => {
    const owner = await register("permission owner");
    const viewer = await register("permission viewer");
    const stranger = await register("stranger");
    const projectId = await project(owner);
    const foreignProject = await project(stranger);
    const sourceId = await source(projectId, owner);
    const member = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/members`,
      headers: auth(owner),
      payload: { userId: viewer, role: "viewer" },
    });
    expect(member.statusCode, member.body).toBe(204);
    const before = (
      await store.list(`projects/${projectId}/library/reference-pictures`)
    ).length;
    expect(
      (await upload(projectId, "source", sourceId, viewer)).statusCode,
    ).toBe(403);
    expect(
      (await store.list(`projects/${projectId}/library/reference-pictures`))
        .length,
    ).toBe(before);
    expect(
      (await upload(projectId, "source", sourceId, stranger)).statusCode,
    ).toBe(403);
    expect(
      (await upload(foreignProject, "source", sourceId, stranger)).statusCode,
    ).toBe(404);
    expect(
      (await upload(projectId, "source", sourceId, owner)).statusCode,
    ).toBe(201);
    expect((await read(projectId, "source", sourceId, viewer)).statusCode).toBe(
      200,
    );
    expect(
      (await read(projectId, "source", sourceId, stranger)).statusCode,
    ).toBe(403);
    expect(
      (await read(foreignProject, "source", sourceId, stranger)).statusCode,
    ).toBe(404);
    expect(
      (await read(foreignProject, "source", sourceId, stranger, "/original"))
        .statusCode,
    ).toBe(404);
    expect(
      (await read(projectId, "source", sourceId, viewer, "/original"))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await cloud.inject({
          method: "DELETE",
          url: path(projectId, "source", sourceId),
          headers: auth(viewer),
          payload: { expectedRevisionId: randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("requires offline source or quote owner, preserving isolation from source kinds and other items", async () => {
    const owner = await register("owner kind");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner, "web_page");
    const itemId = await quote(projectId, owner, sourceId);
    expect(
      (await upload(projectId, "source", sourceId, owner)).statusCode,
    ).toBe(404);
    expect((await upload(projectId, "quote", sourceId, owner)).statusCode).toBe(
      404,
    );
    expect((await upload(projectId, "source", itemId, owner)).statusCode).toBe(
      404,
    );
    expect((await read(projectId, "quote", sourceId, owner)).statusCode).toBe(
      404,
    );
    // Even a genuine still row is not an eligible quote-picture owner.
    const stillId = randomUUID();
    await database.query(
      `INSERT INTO library_items(id,project_id,source_id,kind,content,created_by)
       VALUES($1,$2,$3,'still','{}'::jsonb,$4)`,
      [stillId, projectId, sourceId, owner],
    );
    expect((await upload(projectId, "quote", stillId, owner)).statusCode).toBe(
      404,
    );
  });

  it("replaces atomically with optimistic revision guards and clears the active picture", async () => {
    const owner = await register("replacement owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner);
    const first = (await upload(projectId, "source", sourceId, owner)).json<{
      revisionId: string;
      assets: { original: { sha256: string } };
    }>();
    const otherPng = await sharp({
      create: { width: 3, height: 2, channels: 4, background: "#11aacc" },
    })
      .png()
      .toBuffer();
    const stale = await upload(
      projectId,
      "source",
      sourceId,
      owner,
      randomUUID(),
      otherPng,
    );
    expect(stale.statusCode, stale.body).toBe(409);
    expect((await read(projectId, "source", sourceId, owner)).json()).toEqual(
      first,
    );
    const secondRes = await upload(
      projectId,
      "source",
      sourceId,
      owner,
      first.revisionId,
      otherPng,
    );
    expect(secondRes.statusCode, secondRes.body).toBe(201);
    const second = secondRes.json<{
      revisionId: string;
      assets: { original: { sha256: string } };
    }>();
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(second.assets.original.sha256).toBe(sha(otherPng));
    expect(
      (await read(projectId, "source", sourceId, owner, "/original"))
        .rawPayload,
    ).toEqual(otherPng);
    const oldRows = await database.query(
      "SELECT * FROM library_reference_pictures WHERE project_id=$1 AND owner_id=$2",
      [projectId, sourceId],
    );
    expect(oldRows.rows).toHaveLength(3);
    expect(
      (
        await cloud.inject({
          method: "DELETE",
          url: path(projectId, "source", sourceId),
          headers: auth(owner),
          payload: { expectedRevisionId: first.revisionId },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await cloud.inject({
          method: "DELETE",
          url: path(projectId, "source", sourceId),
          headers: auth(owner),
          payload: { expectedRevisionId: second.revisionId },
        })
      ).statusCode,
    ).toBe(204);
    expect((await read(projectId, "source", sourceId, owner)).statusCode).toBe(
      404,
    );
    expect(
      (await upload(projectId, "source", sourceId, owner)).statusCode,
    ).toBe(201);
  });

  it("keeps a prior picture when replacement fails halfway through storage", async () => {
    const owner = await register("mid-upload failure owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner);
    const first = (await upload(projectId, "source", sourceId, owner)).json<{
      revisionId: string;
    }>();
    const replacement = await sharp({
      create: { width: 2, height: 3, channels: 4, background: "#cc3333" },
    })
      .png()
      .toBuffer();
    store.failAfterPuts = 2;
    try {
      const failed = await upload(
        projectId,
        "source",
        sourceId,
        owner,
        first.revisionId,
        replacement,
      );
      expect(failed.statusCode, failed.body).toBe(503);
    } finally {
      store.failAfterPuts = null;
    }
    expect((await read(projectId, "source", sourceId, owner)).json()).toEqual(
      first,
    );
    expect(
      (await read(projectId, "source", sourceId, owner, "/original"))
        .rawPayload,
    ).toEqual(png);
    const rows = await database.query<{ revision_id: string }>(
      `SELECT revision_id FROM library_reference_pictures WHERE project_id=$1 AND owner_id=$2`,
      [projectId, sourceId],
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((row) => row.revision_id === first.revisionId)).toBe(
      true,
    );
  });

  it("enforces project-scoped owner foreign keys and cascades pointers on deletion", async () => {
    const owner = await register("fk owner");
    const otherOwner = await register("fk other owner");
    const projectId = await project(owner);
    const otherProject = await project(otherOwner);
    const sourceId = await source(projectId, owner);
    expect(
      (await upload(projectId, "source", sourceId, owner)).statusCode,
    ).toBe(201);
    await expect(
      database.query(
        `INSERT INTO library_reference_pictures(
         project_id,owner_kind,owner_id,source_id,role,revision_id,object_key,
         object_version_id,sha256,byte_size,mime_type,width,height
       ) VALUES($1,'source',$2,$2,'original',$3,'wrong-project','v1',$4,1,'image/png',1,1)`,
        [otherProject, sourceId, randomUUID(), sha(png)],
      ),
    ).rejects.toThrow();
    await database.query(
      `DELETE FROM library_sources WHERE project_id=$1 AND id=$2`,
      [projectId, sourceId],
    );
    const rows = await database.query(
      `SELECT owner_id FROM library_reference_pictures WHERE project_id=$1`,
      [projectId],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("rejects invalid metadata, fake rasters, oversized images and incomplete multipart without pointers", async () => {
    const owner = await register("invalid owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner);
    const malformed = multipart(Buffer.from("not an image"));
    expect(
      (
        await cloud.inject({
          method: "POST",
          url: path(projectId, "source", sourceId),
          headers: { ...auth(owner), ...malformed.headers },
          payload: malformed.payload,
        })
      ).statusCode,
    ).toBe(400);
    const badMeta = multipart(png, { expectedRevisionId: "not-uuid" });
    expect(
      (
        await cloud.inject({
          method: "POST",
          url: path(projectId, "source", sourceId),
          headers: { ...auth(owner), ...badMeta.headers },
          payload: badMeta.payload,
        })
      ).statusCode,
    ).toBe(400);
    const huge = Buffer.alloc(20 * 1024 * 1024 + 1, 1);
    const giant = multipart(huge);
    expect(
      (
        await cloud.inject({
          method: "POST",
          url: path(projectId, "source", sourceId),
          headers: { ...auth(owner), ...giant.headers },
          payload: giant.payload,
        })
      ).statusCode,
    ).toBe(413);
    expect((await read(projectId, "source", sourceId, owner)).statusCode).toBe(
      404,
    );
  });

  it("detects object-store corruption, incomplete uploads and pinned version loss", async () => {
    const owner = await register("integrity owner");
    const projectId = await project(owner);
    const sourceId = await source(projectId, owner);
    store.failPut = true;
    try {
      expect(
        (await upload(projectId, "source", sourceId, owner)).statusCode,
      ).toBe(503);
    } finally {
      store.failPut = false;
    }
    expect((await read(projectId, "source", sourceId, owner)).statusCode).toBe(
      404,
    );
    const good = await upload(projectId, "source", sourceId, owner);
    expect(good.statusCode, good.body).toBe(201);
    store.corrupt = true;
    try {
      expect(
        (await read(projectId, "source", sourceId, owner, "/original"))
          .statusCode,
      ).toBe(503);
    } finally {
      store.corrupt = false;
    }
    const restored = await read(
      projectId,
      "source",
      sourceId,
      owner,
      "/original",
    );
    expect(restored.statusCode, restored.body).toBe(200);
    const row = await database.query<{
      object_key: string;
      object_version_id: string;
    }>(
      "SELECT object_key,object_version_id FROM library_reference_pictures WHERE project_id=$1 AND owner_id=$2 AND role='original'",
      [projectId, sourceId],
    );
    const key = row.rows[0]!.object_key;
    await store.delete(key);
    expect(
      (await read(projectId, "source", sourceId, owner, "/original"))
        .statusCode,
    ).toBe(503);
  });
});
