import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const fixtures: { app: ReturnType<typeof createCloudApi>; database: PGlite }[] =
  [];

afterEach(async () => {
  for (const { app, database } of fixtures.splice(0)) {
    await app.close();
    await database.close();
  }
});

function createFixture() {
  const database = new PGlite();
  const app = createCloudApi({
    catalog: new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    ),
    authenticate: authenticateDevBearer,
  });
  fixtures.push({ app, database });
  return {
    database,
    async register(label: string) {
      const id = randomUUID();
      const headers = { authorization: `Bearer ${id}|fixture:${label}` };
      const request = (
        method: "POST" | "GET" | "PATCH" | "DELETE",
        url: string,
        payload?: Record<string, unknown>,
      ) =>
        app.inject({
          method,
          url,
          headers,
          ...(payload === undefined ? {} : { payload }),
        });
      expect(
        (await request("POST", "/api/session/register", { displayName: label }))
          .statusCode,
      ).toBe(200);
      const read = async <T = VersionedRecord>(
        method: "POST" | "GET" | "PATCH",
        url: string,
        payload?: Record<string, unknown>,
      ) => {
        const result = await request(method, url, payload);
        expect(result.statusCode, result.body).toBe(
          method === "POST" ? 201 : 200,
        );
        return result.json<T>();
      };
      return { id, read, request };
    },
  };
}

type VersionedRecord = { id: string; version: number };

function confirmed(value: string) {
  return { value, state: "confirmed" };
}

const sourceIdentity = {
  schemaVersion: 1,
  provider: "youtube",
  providerMediaId: "M7lc1UVf-VE",
  canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
};

function clipFixture(idempotencyKey: string, identity = sourceIdentity) {
  const selection = {
    trackId: randomUUID(),
    transcriptVersion: 1,
    firstSegmentId: randomUUID(),
    lastSegmentId: randomUUID(),
    transcriptStartMs: 300,
    transcriptEndMs: 2_900,
    exportStartMs: 0,
    exportEndMs: 3_400,
    text: "Preserve the selected transcript",
    timingPrecision: "cue",
  };
  const originalText = "Garder le passage sélectionné";
  return {
    idempotencyKey,
    video: {
      youtubeVideoId: identity.providerMediaId,
      canonicalUrl: identity.canonicalUrl,
      title: "Fixture interview",
      channel: "Fixture archive",
    },
    selection,
    englishText: selection.text,
    originalText,
    notes: "Original notes",
    tags: ["Opening"],
  };
}

describe("project Library API", () => {
  it("stores exact offline quotes and edits display text independently through deletion", async () => {
    const { database, register } = createFixture();
    await runCloudMigrations(database);
    const { id: logger, request, read } = await register("quote-logger");
    const viewer = await register("quote-viewer");
    const { id: projectId } = await read("POST", "/api/projects", {
      name: "Quote fixture",
    });
    const base = `/api/projects/${projectId}`;
    const otherProject = await read("POST", "/api/projects", {
      name: "Other project",
    });
    await request("POST", `${base}/members`, {
      userId: viewer.id,
      role: "viewer",
    });
    const { id: sourceId } = await read("POST", `${base}/sources`, {
      kind: "offline",
      details: { subtype: "book" },
    });
    const text = "  “A first line.”\nThe next line.  ";
    const content = {
      text,
      location: "p. 42, second paragraph",
      surroundingWords: { before: "Before ", after: " after" },
      highlight: {
        page: 42,
        rectangles: [{ x: 0.2, y: 0.3, width: 0.5, height: 0.1 }],
      },
      citationOverride: "Example, p. 42.",
    };
    const input = {
      sourceId,
      kind: "quote",
      content,
      topics: ["Archive"],
      notes: "Use in opening.",
    };
    const quote = await read("POST", `${base}/items`, input);
    const item = `${base}/items/${quote.id}`;
    expect(await read("GET", item)).toMatchObject({
      ...input,
      createdBy: logger,
    });
    expect(quote).toHaveProperty("content", content);
    expect(
      (
        await request("POST", `${base}/items`, {
          ...input,
          content: { text: "  \n" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", `${base}/items`, {
          ...input,
          content: { text, latestDisplayText: "Injected on create" },
        })
      ).statusCode,
    ).toBe(400);

    const display = {
      expectedVersion: 1,
      latestDisplayText: "  A shortened line.  ",
    };
    expect((await viewer.request("PATCH", item, display)).statusCode).toBe(403);
    expect(
      (
        await request("PATCH", item, {
          ...display,
          content: { text: "Overwrite" },
        })
      ).statusCode,
    ).toBe(400);
    expect(await read("PATCH", item, display)).toMatchObject({
      version: 2,
      content: { ...content, latestDisplayText: display.latestDisplayText },
    });
    expect((await request("PATCH", item, display)).statusCode).toBe(409);
    const speakerOnly = { ...content, speaker: "Ada Example" };
    expect(
      await read("PATCH", item, { expectedVersion: 2, content: speakerOnly }),
    ).toMatchObject({
      version: 3,
      content: { ...speakerOnly, latestDisplayText: display.latestDisplayText },
    });
    const attributed = { ...speakerOnly, speakerTitle: "Archivist" };
    expect(
      await read("PATCH", item, { expectedVersion: 3, content: attributed }),
    ).toMatchObject({
      version: 4,
      content: { ...attributed, latestDisplayText: display.latestDisplayText },
    });
    const list = `${base}/items?kind=quote&sourceId=${sourceId}&logger=${logger}&topic=archive&q=Archivist`;
    expect(await viewer.read("GET", list)).toEqual([
      expect.objectContaining({
        id: quote.id,
        content: {
          ...attributed,
          latestDisplayText: display.latestDisplayText,
        },
      }),
    ]);
    expect(
      await read("GET", `${base}/items?kind=quote&sourceId=${randomUUID()}`),
    ).toEqual([]);
    expect(
      (await viewer.request("DELETE", item, { expectedVersion: 4 })).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          "DELETE",
          `/api/projects/${otherProject.id}/items/${quote.id}`,
          { expectedVersion: 4 },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await request("DELETE", item, { expectedVersion: 3 })).statusCode,
    ).toBe(409);
    const still = await read("POST", `${base}/items`, {
      kind: "still",
      sourceId,
      content: {},
    });
    expect(
      (
        await request("DELETE", `${base}/items/${still.id}`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await request("DELETE", item, { expectedVersion: 4 })).statusCode,
    ).toBe(204);
    expect((await request("GET", item)).statusCode).toBe(404);
    expect(await read("GET", list)).toEqual([]);
    expect((await read("GET", `${base}/sources/${sourceId}`)).id).toBe(
      sourceId,
    );
  });

  it("reuses legacy and concurrent article sources within a project and honors URL edits", async () => {
    const { database, register } = createFixture();
    await runCloudMigrations(database);
    const { read, request } = await register("article-logger");
    const { id } = await read("POST", "/api/projects", {
      name: "Article fixture",
    });
    const { id: otherProject } = await read("POST", "/api/projects", {
      name: "Other articles",
    });
    const base = `/api/projects/${id}`;
    const sourceRequest = (url: string, idempotencyKey?: string) => ({
      kind: "web_page",
      bibliography: { url: confirmed(url), title: confirmed("Incoming title") },
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    const addSource = (url: string, key?: string) =>
      read("POST", `${base}/sources`, sourceRequest(url, key));
    const url =
      "https://example.org/article?edition=2&section=a&section=b#intro";
    const originalUrl = url.replace("#", "&utm_medium=email#");
    const legacyId = randomUUID();
    await database.query(
      "INSERT INTO library_sources (project_id,id,kind,bibliography) VALUES($1,$2,'web_page',$3)",
      [
        id,
        legacyId,
        JSON.stringify({
          url: confirmed(originalUrl),
          title: confirmed("Saved title"),
        }),
      ],
    );
    const captured = url.replace("#", "&%75tm_source=one&fbclid=two#");
    expect(await addSource(captured, "capture-retry")).toMatchObject({
      id: legacyId,
      bibliography: {
        title: confirmed("Saved title"),
        url: confirmed(originalUrl),
      },
    });
    const laterCapture = url.replace("#", "&gclid=three#");
    expect((await addSource(laterCapture)).id).toBe(legacyId);
    for (const [index, locator] of [captured, laterCapture].entries()) {
      const source = await addSource(locator);
      await read("POST", `${base}/items`, {
        sourceId: source.id,
        kind: "quote",
        content: { text: `Quote ${index + 1}` },
      });
    }
    expect(
      await read("GET", `${base}/items?kind=quote&sourceId=${legacyId}`),
    ).toHaveLength(2);
    const distinct = await addSource(url.replace("edition=2", "edition=3"));
    expect(distinct.id).not.toBe(legacyId);
    expect(
      (
        await addSource(
          url.replace("section=a&section=b", "section=b&section=a"),
        )
      ).id,
    ).not.toBe(legacyId);
    expect(
      (
        await read(
          "POST",
          `/api/projects/${otherProject}/sources`,
          sourceRequest(captured),
        )
      ).id,
    ).not.toBe(legacyId);

    const [first, second] = await Promise.all([
      addSource("https://example.org/new?utm_medium=email", "first"),
      addSource("https://example.org/new?utm_source=search", "second"),
    ]);
    expect(first.id).toBe(second.id);
    expect(
      (
        await request("PATCH", `${base}/sources/${distinct.id}`, {
          expectedVersion: 1,
          bibliography: { url: confirmed(captured) },
        })
      ).statusCode,
    ).toBe(409);

    const corrected = "https://example.org/corrected?edition=2";
    await read("PATCH", `${base}/sources/${legacyId}`, {
      expectedVersion: 1,
      bibliography: { url: confirmed(corrected) },
    });
    expect((await addSource(corrected + "&utm_source=bar")).id).toBe(legacyId);
    expect((await addSource(captured, "capture-retry")).id).toBe(legacyId);
    expect(
      (
        await request(
          "POST",
          `${base}/sources`,
          sourceRequest(corrected, "capture-retry"),
        )
      ).statusCode,
    ).toBe(409);
    expect((await addSource(captured)).id).not.toBe(legacyId);
  });

  it("logs and edits each kind with project-scoped lookup and optimistic versions", async () => {
    const { database, register } = createFixture();
    await runCloudMigrations(database);
    const { id: ownerId, read, request } = await register("library-owner");
    const viewer = await register("library-viewer");
    const outsider = await register("library-outsider");
    const project = await read("POST", "/api/projects", { name: "Library" });
    const base = `/api/projects/${project.id}`;
    expect(
      (
        await request("POST", `${base}/members`, {
          userId: viewer.id,
          role: "viewer",
        })
      ).statusCode,
    ).toBe(204);

    let offlineId = "";
    const sourceDetails = {
      youtube: { durationMs: 3_000 },
      web_page: { accessedDate: "2026-01-03" },
      pdf: { pageCount: 3 },
      offline: { subtype: "book" },
      image: { width: 400, height: 600 },
      audio: { role: "ambience" },
      local_video: { sourceLanguage: "en" },
    };
    for (const [kind, details] of Object.entries(sourceDetails)) {
      const bibliography = {
        title: { value: `Library ${kind}`, state: "automatic" },
      };
      const input = {
        kind,
        bibliography,
        details,
        ...(kind === "youtube" ? { sourceIdentity } : {}),
      };
      const createInput = {
        ...input,
        ...(kind === "offline" ? { idempotencyKey: "library fixture" } : {}),
      };
      const source = await read("POST", `${base}/sources`, createInput);
      const url = `${base}/sources/${source.id}`;
      const loaded = await read("GET", url);
      expect(loaded).toMatchObject({ ...input, id: source.id, version: 1 });
      expect(loaded).toHaveProperty("bibliography", bibliography);
      if (kind === "offline") {
        offlineId = source.id;
        expect(loaded).not.toHaveProperty("sourceIdentity");
      }

      const changed = { title: confirmed(`Revised ${kind}`) };
      expect(
        await read("PATCH", url, { expectedVersion: 1, bibliography: changed }),
      ).toMatchObject({ bibliography: changed, version: 2 });
      if (kind === "offline") {
        expect(
          await read("POST", `${base}/sources`, createInput),
        ).toMatchObject({
          id: source.id,
          bibliography: changed,
          version: 2,
        });
        expect(
          (
            await request("POST", `${base}/sources`, {
              ...createInput,
              bibliography: changed,
            })
          ).statusCode,
        ).toBe(409);
      }
      expect(
        (await request("PATCH", url, { expectedVersion: 1, bibliography }))
          .statusCode,
      ).toBe(409);
      const listed = await read<VersionedRecord[]>(
        "GET",
        `${base}/sources?kind=${kind}&q=REVISED`,
      );
      expect(listed.map(({ id }) => id)).toEqual([source.id]);
    }

    expect(
      (
        await request("POST", `${base}/sources`, {
          kind: "youtube",
          bibliography: {},
          details: {},
        })
      ).statusCode,
    ).toBe(400);

    const quote =
      "  The transcript says “100%” in line one.\nLine two stays verbatim.  ";
    const itemContents = {
      clip: { startMs: 230, endMs: 930, title: "Opening shot" },
      quote: { text: quote, speaker: "Ada Example" },
      still: { title: "Archive image", credit: "City Archive" },
      audio: { startMs: 1_000, endMs: 2_400, text: "Archive audio" },
    };
    const itemIds: string[] = [];
    for (const [kind, content] of Object.entries(itemContents)) {
      const input = {
        kind,
        sourceId: offlineId,
        content,
        topics: ["Opening"],
        notes: "Raw notes",
      };
      const createInput = {
        ...input,
        ...(kind === "quote" ? { idempotencyKey: "library fixture" } : {}),
      };
      const item = await read("POST", `${base}/items`, createInput);
      itemIds.push(item.id);
      const url = `${base}/items/${item.id}`;
      const loaded = await read("GET", url);
      expect(loaded).toMatchObject({
        ...input,
        id: item.id,
        createdBy: ownerId,
        version: 1,
      });

      const revisedContent = { ...content, title: "Revised title" };
      expect(
        await read("PATCH", url, {
          expectedVersion: 1,
          content: revisedContent,
          notes: "Revised usage",
          topics: ["Theme"],
        }),
      ).toMatchObject({
        content: revisedContent,
        notes: "Revised usage",
        topics: ["Theme"],
        version: 2,
      });
      if (kind === "quote") {
        expect(await read("POST", `${base}/items`, createInput)).toMatchObject({
          id: item.id,
          content: revisedContent,
          notes: "Revised usage",
          topics: ["Theme"],
          version: 2,
        });
        expect(
          (
            await request("POST", `${base}/items`, {
              ...createInput,
              notes: "A different log",
            })
          ).statusCode,
        ).toBe(409);
      }
      expect(
        (await request("PATCH", url, { expectedVersion: 1, notes: "Stale" }))
          .statusCode,
      ).toBe(409);
      const query = new URLSearchParams({
        kind,
        topic: "Theme",
        logger: ownerId,
        q: "REVISED",
      });
      const listed = await read<VersionedRecord[]>(
        "GET",
        `${base}/items?${query}`,
      );
      expect(listed.map(({ id }) => id)).toEqual([item.id]);
    }

    const literal = await read("GET", `${base}/items?q=%25`);
    expect(literal).toEqual([
      expect.objectContaining({
        kind: "quote",
        content: {
          text: quote,
          speaker: "Ada Example",
          title: "Revised title",
        },
      }),
    ]);
    expect(await read("GET", `${base}/items?logger=${viewer.id}`)).toEqual([]);
    expect(await read("GET", `${base}/items?topic=Opening`)).toEqual([]);
    expect(await read("GET", `${base}/sources?topic=Theme`)).toEqual([
      expect.objectContaining({ id: offlineId }),
    ]);

    const listed = await read<VersionedRecord[]>("GET", `${base}/items`);
    const orderedIds = listed.map(({ id }) => id);
    expect(orderedIds.toSorted()).toEqual(itemIds.toSorted());
    const page = await read<VersionedRecord[]>(
      "GET",
      `${base}/items?limit=2&offset=1`,
    );
    expect(page.map(({ id }) => id)).toEqual(orderedIds.slice(1, 3));
    expect(await read("GET", `${base}/items?limit=2&offset=4`)).toEqual([]);
    for (const invalidQuery of [
      "limit=0",
      "limit=101",
      "offset=-1",
      "offset=100001",
    ]) {
      expect(
        (await request("GET", `${base}/items?${invalidQuery}`)).statusCode,
      ).toBe(400);
    }

    expect(
      (await viewer.request("GET", `${base}/sources/${offlineId}`)).statusCode,
    ).toBe(200);
    expect(
      (await viewer.request("GET", `${base}/items/${itemIds[0]}`)).statusCode,
    ).toBe(200);
    expect(
      (
        await viewer.request("PATCH", `${base}/items/${itemIds[0]}`, {
          expectedVersion: 2,
          notes: "Viewer edit",
        })
      ).statusCode,
    ).toBe(403);
    expect((await outsider.request("GET", `${base}/items`)).statusCode).toBe(
      403,
    );
    expect((await outsider.request("GET", `${base}/sources`)).statusCode).toBe(
      403,
    );

    const other = await read("POST", "/api/projects", {
      name: "Other project",
    });
    const otherBase = `/api/projects/${other.id}`;
    expect(
      (await request("GET", `${otherBase}/sources/${offlineId}`)).statusCode,
    ).toBe(404);
    expect(
      (await request("GET", `${otherBase}/items/${itemIds[0]}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await request("POST", `${otherBase}/items`, {
          sourceId: offlineId,
          kind: "quote",
          content: { text: "Cross-project source" },
        })
      ).statusCode,
    ).toBe(404);
  }, 45_000);

  it("shares YouTube source identity and transcript-backed clips with the legacy API", async () => {
    const { database, register } = createFixture();
    await runCloudMigrations(database);
    const { read } = await register("shared-library-owner");
    const project = await read("POST", "/api/projects", {
      name: "Shared YouTube Library",
    });
    const base = `/api/projects/${project.id}`;
    const clipInput = clipFixture("library-fixture:legacy-clip");
    await read("POST", `${base}/clips`, clipInput);
    const sourcesBefore = await read<VersionedRecord[]>(
      "GET",
      `${base}/sources`,
    );
    expect(sourcesBefore).toHaveLength(1);
    const [source] = sourcesBefore;
    if (!source)
      throw new Error("Missing the source created by the legacy clip API");
    expect(source).toMatchObject({ kind: "youtube", sourceIdentity });
    const sourceUrl = `${base}/sources/${source.id}`;
    expect(
      await read("PATCH", sourceUrl, {
        expectedVersion: source.version,
        bibliography: { title: confirmed("Verified archive title") },
      }),
    ).toMatchObject({
      bibliography: {
        title: confirmed("Verified archive title"),
        url: { value: sourceIdentity.canonicalUrl },
      },
      details: { channel: "Fixture archive" },
    });

    const itemInput = {
      kind: "clip",
      sourceId: source.id,
      clip: clipFixture("library-fixture:backed-clip"),
    };
    const item = await read("POST", `${base}/items`, itemInput);
    await expect(
      database.query(
        `INSERT INTO library_items(id,project_id,source_id,kind,content,created_by)
       SELECT id,project_id,video_id,'still','{}'::jsonb,created_by FROM clip_candidates WHERE id=$1`,
        [item.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    expect(item).toMatchObject({
      sourceId: source.id,
      kind: "clip",
      content: { startMs: 0, endMs: 3_400, text: itemInput.clip.englishText },
      notes: itemInput.clip.notes,
      topics: itemInput.clip.tags,
    });
    expect(await read("GET", `${base}/clips/${item.id}`)).toMatchObject({
      id: item.id,
      selection: itemInput.clip.selection,
    });
    expect(await read("POST", `${base}/items`, itemInput)).toEqual(item);

    const quote = await read("POST", `${base}/items`, {
      kind: "quote",
      sourceId: source.id,
      content: { text: "Preserve this project Library item." },
    });
    await expect(
      database.query(
        "DELETE FROM project_videos WHERE project_id = $1 AND video_id = $2",
        [project.id, source.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await read("GET", `${base}/items/${quote.id}`)).toEqual(quote);

    const nativeIdentity = {
      ...sourceIdentity,
      providerMediaId: "F1xTur3A-01",
      canonicalUrl: "https://www.youtube.com/watch?v=F1xTur3A-01",
    };
    const native = await read("POST", `${base}/sources`, {
      kind: "youtube",
      sourceIdentity: nativeIdentity,
      bibliography: { title: confirmed("Native source") },
    });
    const legacy = await read(
      "POST",
      `${base}/clips`,
      clipFixture("library-fixture:native-then-legacy", nativeIdentity),
    );
    const sources = await read<VersionedRecord[]>(
      "GET",
      `${base}/sources?kind=youtube`,
    );
    expect(sources.map(({ id }) => id).toSorted()).toEqual(
      [source.id, native.id].toSorted(),
    );
    expect(await read("GET", `${base}/items/${legacy.id}`)).toMatchObject({
      sourceId: native.id,
    });
  });

  it("upgrades legacy clips and preserves their snapshots, dependents and shared version", async () => {
    const { database, register } = createFixture();
    const migrations = fileURLToPath(
      new URL("../../../packages/db-cloud/migrations/", import.meta.url),
    );
    const legacyMigrations = await mkdtemp(join(tmpdir(), "library-legacy-"));
    try {
      const filenames = (await readdir(migrations)).filter((filename) =>
        /^000[1-9]_.*\.sql$/u.test(filename),
      );
      expect(filenames).toHaveLength(9);
      await Promise.all(
        filenames.map((filename) =>
          copyFile(
            join(migrations, filename),
            join(legacyMigrations, filename),
          ),
        ),
      );
      await runCloudMigrations(database, legacyMigrations);
    } finally {
      await rm(legacyMigrations, { recursive: true, force: true });
    }

    const { id: ownerId, read, request } = await register("legacy-owner");
    const project = await read("POST", "/api/projects", {
      name: "Legacy Library",
    });
    const base = `/api/projects/${project.id}`;
    const input = clipFixture("fixture:legacy-library-clip");
    const { selection, originalText } = input;
    const legacy = await read("POST", `${base}/clips`, input);
    const clipUrl = `${base}/clips/${legacy.id}`;
    const unrelatedProject = await read("POST", "/api/projects", {
      name: "Unrelated project",
    });
    const exported = await read("POST", `${clipUrl}/exports`, {
      idempotencyKey: "fixture:legacy-library-export",
      sourceLanguageClass: "confirmed_english",
      preset: {
        presetVersion: 1,
        name: "Fixture MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          maxWidth: 1_920,
          frameRate: "source",
          audioCodec: "aac",
          audioKilobitsPerSecond: 192,
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
    });
    const savedClip = await read("GET", clipUrl);
    const exportRows = () =>
      database.query(
        `SELECT id, job_id, video_snapshot, selection_snapshot, preset_snapshot
       FROM export_requests WHERE clip_id = $1 AND project_id = $2`,
        [legacy.id, project.id],
      );
    const savedExports = (await exportRows()).rows;
    expect(savedExports).toMatchObject([{ id: exported.id }]);
    const before = await database.query<{ video_id: string }>(
      "SELECT video_id FROM clip_candidates WHERE id = $1",
      [legacy.id],
    );
    const videoId = before.rows[0]?.video_id;
    expect(videoId).toBeDefined();

    const unlinkedIdentity = {
      ...sourceIdentity,
      providerMediaId: "F1xTur3A-02",
      canonicalUrl: "https://www.youtube.com/watch?v=F1xTur3A-02",
    };
    const unlinkedInput = clipFixture(
      "fixture:unlinked-clip",
      unlinkedIdentity,
    );
    unlinkedInput.video.title = "Title from the saved clip";
    const unlinkedClip = await read("POST", `${base}/clips`, unlinkedInput);
    const {
      rows: [unlinkedVideo],
    } = await database.query<{ video_id: string }>(
      "SELECT video_id FROM clip_candidates WHERE id = $1",
      [unlinkedClip.id],
    );
    if (!unlinkedVideo) throw new Error("Missing the unlinked clip fixture");
    const unlinkedId = unlinkedVideo.video_id;
    await database.query(
      "DELETE FROM project_videos WHERE project_id = $1 AND video_id = $2",
      [project.id, unlinkedId],
    );
    await database.query("UPDATE videos SET title = $1 WHERE id = $2", [
      "Global title from unrelated research",
      unlinkedId,
    ]);

    // The pilot checkpoint adds these provider columns and a project-scoped comment FK.
    await database.exec(`
      ALTER TABLE videos ADD COLUMN source_provider text, ADD COLUMN provider_media_id text,
        ADD COLUMN source_fingerprint_evidence jsonb;
      UPDATE videos SET source_provider = 'youtube', provider_media_id = youtube_video_id;
      ALTER TABLE videos ALTER COLUMN source_provider SET NOT NULL,
        ALTER COLUMN provider_media_id SET NOT NULL,
        ADD UNIQUE (source_provider, provider_media_id);
      ALTER TABLE clip_candidates ADD COLUMN source_provider text, ADD COLUMN provider_media_id text;
      UPDATE clip_candidates SET source_provider = 'youtube', provider_media_id = youtube_video_id;
      ALTER TABLE clip_candidates ALTER COLUMN source_provider SET NOT NULL,
        ALTER COLUMN provider_media_id SET NOT NULL,
        ADD CONSTRAINT clip_candidates_project_identity UNIQUE (project_id, id);
      CREATE TABLE clip_comments (
        id uuid PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        clip_id uuid NOT NULL,
        author_id uuid NOT NULL REFERENCES users(id),
        author_handle text NOT NULL,
        author_display_name text NOT NULL,
        body text,
        FOREIGN KEY (project_id, clip_id) REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE
      );
    `);
    const commentId = randomUUID();
    await database.query(
      `INSERT INTO clip_comments (id, project_id, clip_id, author_id, author_handle, author_display_name, body)
       VALUES ($1, $2, $3, $4, 'legacy-owner', 'Legacy Owner', 'Fixture comment')`,
      [commentId, project.id, legacy.id, ownerId],
    );

    const pilotVideoId = randomUUID();
    const pilotIdentity = {
      schemaVersion: 1,
      provider: "tiktok",
      providerMediaId: "1234567890123456789",
      canonicalUrl: "https://www.tiktok.com/@example/video/1234567890123456789",
    };
    await database.query(
      `INSERT INTO videos (id, youtube_video_id, source_provider, provider_media_id, canonical_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        pilotVideoId,
        "synthetic-provider-fixture",
        pilotIdentity.provider,
        pilotIdentity.providerMediaId,
        pilotIdentity.canonicalUrl,
      ],
    );
    await database.query(
      "INSERT INTO project_videos (project_id, video_id) VALUES ($1, $2)",
      [project.id, pilotVideoId],
    );

    expect(await runCloudMigrations(database)).not.toHaveLength(0);
    expect(await runCloudMigrations(database)).toEqual([]);
    expect(await read("GET", clipUrl)).toEqual(savedClip);
    expect(
      (
        await database.query(
          "SELECT id, project_id, clip_id, body FROM clip_comments WHERE id = $1",
          [commentId],
        )
      ).rows,
    ).toEqual([
      {
        id: commentId,
        project_id: project.id,
        clip_id: legacy.id,
        body: "Fixture comment",
      },
    ]);
    expect((await exportRows()).rows).toEqual(savedExports);
    await expect(
      database.query("UPDATE clip_comments SET project_id = $1 WHERE id = $2", [
        unrelatedProject.id,
        commentId,
      ]),
    ).rejects.toMatchObject({ code: "23503" });

    const source = await read("GET", `${base}/sources/${videoId}`);
    expect(source).toMatchObject({
      id: videoId,
      kind: "youtube",
      sourceIdentity,
    });
    expect(source).toHaveProperty("bibliography", {
      title: { value: "Fixture interview" },
      url: { value: sourceIdentity.canonicalUrl },
    });
    const youtubeSources = await read<VersionedRecord[]>(
      "GET",
      `${base}/sources?kind=youtube`,
    );
    expect(youtubeSources.map(({ id }) => id)).toEqual(
      [videoId, unlinkedId].sort(),
    );
    expect(await read("GET", `${base}/sources/${unlinkedId}`)).toMatchObject({
      id: unlinkedId,
      sourceIdentity: unlinkedIdentity,
      bibliography: {
        title: { value: unlinkedInput.video.title },
        url: { value: unlinkedIdentity.canonicalUrl },
      },
    });
    expect(await read("GET", `${base}/items?kind=clip`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: unlinkedClip.id, sourceId: unlinkedId }),
      ]),
    );
    expect(
      (
        await database.query(
          "SELECT 1 FROM project_videos WHERE project_id = $1 AND video_id = $2",
          [project.id, unlinkedId],
        )
      ).rows,
    ).toEqual([]);
    expect(await read("GET", `${base}/sources?kind=provider_video`)).toEqual([
      expect.objectContaining({
        id: pilotVideoId,
        sourceIdentity: pilotIdentity,
      }),
    ]);

    const itemUrl = `${base}/items/${legacy.id}`;
    const item = await read("GET", itemUrl);
    const content = {
      startMs: 0,
      endMs: 3_400,
      text: selection.text,
      originalText,
    };
    expect(item).toMatchObject({
      id: legacy.id,
      sourceId: videoId,
      kind: "clip",
      content,
      createdBy: ownerId,
      topics: ["Opening"],
      notes: "Original notes",
      version: savedClip.version,
    });
    const fromLegacy = await read("PATCH", clipUrl, {
      expectedVersion: item.version,
      notes: "Edited in legacy",
      tags: ["Legacy edit"],
    });
    expect(await read("GET", itemUrl)).toMatchObject({
      content,
      notes: "Edited in legacy",
      topics: ["Legacy edit"],
      version: fromLegacy.version,
    });
    expect(
      (
        await request("PATCH", itemUrl, {
          expectedVersion: item.version,
          notes: "Stale edit",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request("PATCH", itemUrl, {
          expectedVersion: fromLegacy.version,
          content: { ...content, endMs: 3_500 },
        })
      ).statusCode,
    ).toBe(409);

    const fromLibrary = await read("PATCH", itemUrl, {
      expectedVersion: fromLegacy.version,
      notes: "Edited in Library",
      topics: ["Library edit"],
    });
    expect(await read("GET", clipUrl)).toEqual({
      ...savedClip,
      notes: "Edited in Library",
      tags: ["Library edit"],
      version: fromLibrary.version,
      updatedAt: expect.any(String),
    });
    expect(
      (
        await request("PATCH", clipUrl, {
          expectedVersion: fromLegacy.version,
          notes: "Stale from legacy",
          tags: ["Stale from legacy"],
        })
      ).statusCode,
    ).toBe(409);
  });
});
