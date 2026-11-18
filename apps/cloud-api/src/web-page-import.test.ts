import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { createLocalAgent } from "../../local-agent/src/app.ts";
import { createWebPageImporter } from "../../local-agent/src/web-page/import.ts";
import { authenticateDevBearer, createCloudApi } from "./app.ts";

const address = "https://fixture.example/story?edition=2";
const article = `<!doctype html><html><head>
  <title>Fixture article</title>
  <meta name="author" content="Example Author">
  <meta property="og:site_name" content="Fixture Gazette">
  <meta property="article:published_time" content="2026-01-03">
  <link rel="canonical" href="/story">
  </head><body><nav>Noise link</nav><main><article>
  <p>Researchers recorded several observations in a small field notebook. The group later compared each observation with photographs from the site and corrected its notes about the surroundings.</p>
  <p>The second team found the <em>same pattern</em> after repeating the survey. This passage will be useful as a quote for a future script about field research.</p>
  <img src="https://assets.fixture.example/illustration.png">
  <iframe src="https://assets.fixture.example/frame"></iframe>
  <script>throw new Error("fixture script");</script>
  </article></main><footer>Noise footer</footer></body></html>`;

const reader = vi.fn(async (url: string) => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from(article),
  finalUrl: url,
  redactedFinalUrl: url,
  trace: {
    actualConnectionCount: 1,
    dnsAdmissions: [],
    peerConnections: [],
    redirectChain: [],
    tls: {
      availability: "not_applicable" as const,
      protocol: null,
      cipher: null,
      peerCertificateSha256: null,
      unavailableReason: null,
    },
  },
}));

let database: PGlite;
let cloud: ReturnType<typeof createCloudApi>;
let local: ReturnType<typeof createLocalAgent>;
let project: string;
const headers = (id: string) => ({
  authorization: `Bearer ${id}|fixture:${id}`,
});

beforeAll(async () => {
  database = new PGlite();
  await runCloudMigrations(database);
  cloud = createCloudApi({
    catalog: new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    ),
    authenticate: authenticateDevBearer,
  });
  local = createLocalAgent({
    importWebPage: createWebPageImporter(
      "http://catalog.fixture.example",
      reader,
      async (url, options) => {
        const response = await cloud.inject({
          method: options?.method === "HEAD" ? "HEAD" : "POST",
          url: String(url),
          headers: options?.headers as Record<string, string>,
          ...(typeof options?.body === "string" && { payload: options.body }),
        });
        return new Response(
          response.statusCode === 204 ? null : response.body,
          { status: response.statusCode },
        );
      },
    ),
  });
}, 30_000);

beforeEach(async () => {
  reader.mockClear();
  owner = await register();
  const response = await cloud.inject({
    method: "POST",
    url: "/api/projects",
    payload: { name: "Test project" },
    headers: headers(owner),
  });
  expect(response.statusCode).toBe(201);
  project = `/api/projects/${response.json<{ id: string }>().id}`;
});

let owner: string;
async function register() {
  const id = randomUUID();
  const response = await cloud.inject({
    method: "POST",
    url: "/api/session/register",
    payload: { displayName: "Synthetic user" },
    headers: headers(id),
  });
  expect(response.statusCode).toBe(200);
  return id;
}

afterAll(async () => {
  await local.close();
  await cloud.close();
  await database.close();
});

function add(payload: Record<string, unknown>, actor = owner) {
  return local.inject({
    method: "POST",
    url: `${project}/web-page-sources`,
    payload,
    headers: headers(actor),
  });
}

describe("web page imports through the Mac agent and project catalog", () => {
  it("stores automatic fields and clean text and lets the user confirm a field", async () => {
    const result = await add({ mode: "public_url", url: address });
    expect(result.statusCode, result.body).toBe(200);
    const source = result.json();
    expect(source.bibliography).toEqual({
      title: { value: "Fixture article", state: "automatic" },
      authors: { value: ["Example Author"], state: "automatic" },
      publication: { value: "Fixture Gazette", state: "automatic" },
      date: { value: "2026-01-03", state: "automatic" },
      url: { value: "https://fixture.example/story", state: "automatic" },
    });
    expect(source.details.extraction.status).toBe("ready");
    expect(source.details.extraction.text).toContain("same pattern");
    expect(source.details.extraction.text).not.toMatch(
      /Noise|fixture script|iframe/,
    );
    const edited = await cloud.inject({
      method: "PATCH",
      url: `${project}/sources/${source.id}`,
      headers: headers(owner),
      payload: {
        expectedVersion: 1,
        bibliography: {
          title: { value: "Corrected title", state: "confirmed" },
        },
      },
    });
    expect(edited.json()).toMatchObject({
      bibliography: {
        title: { value: "Corrected title", state: "confirmed" },
        authors: { state: "automatic" },
      },
      details: source.details,
    });
    const reused = await add({
      mode: "extension",
      url: "https://fixture.example/story?utm_source=sample",
      html: article,
      metadata: { title: "Later automatic title" },
    });
    expect(reused.statusCode, reused.body).toBe(200);
    expect(reused.json()).toEqual(edited.json());
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("stores supplied metadata and HTML-derived text with missing fields blank and no page fetch", async () => {
    const result = await add({
      mode: "extension",
      url: address,
      idempotencyKey: "extension fixture",
      metadata: { title: "Title from the extension" },
      html: article.replace(
        /<meta name="author"[^>]+>|<meta property="article:published_time"[^>]+>/gu,
        "",
      ),
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      bibliography: {
        title: { value: "Title from the extension", state: "automatic" },
      },
      details: { extraction: { status: "ready" } },
    });
    expect(result.json().bibliography).not.toHaveProperty("authors");
    expect(result.json().bibliography).not.toHaveProperty("date");
    expect(result.body).not.toContain("fixture script");
    expect(reader).not.toHaveBeenCalled();
  });

  it("retains a blocked source and accepts a typed quote against it", async () => {
    reader.mockImplementationOnce(async (url) => ({
      ...(await reader(url)),
      status: 403,
      body: Buffer.from("Private response marker"),
    }));
    const result = await add({ mode: "public_url", url: address });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      bibliography: {},
      details: {
        submittedUrl: address,
        extraction: { status: "failed", reason: "blocked" },
      },
    });
    expect(result.body).not.toContain("Private response marker");
    const quote = await cloud.inject({
      method: "POST",
      url: `${project}/items`,
      headers: headers(owner),
      payload: {
        kind: "quote",
        sourceId: result.json().id,
        content: { text: "A typed quote." },
      },
    });
    expect(quote.statusCode, quote.body).toBe(201);
  });

  it("preserves metadata on a page with no readable text", async () => {
    const result = await add({
      mode: "extension",
      url: address,
      html: "<html><head><title>Index page</title></head><body><nav>Menu</nav></body></html>",
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      bibliography: { title: { value: "Index page" } },
      details: { extraction: { status: "failed", reason: "no_article" } },
    });
  });

  it("denies a viewer and an outsider before page access", async () => {
    const viewer = await register();
    expect(
      (
        await cloud.inject({
          method: "POST",
          url: `${project}/members`,
          headers: headers(owner),
          payload: { userId: viewer, role: "viewer" },
        })
      ).statusCode,
    ).toBe(204);
    for (const actor of [viewer, await register()]) {
      expect(
        (await add({ mode: "public_url", url: address }, actor)).statusCode,
      ).toBe(403);
    }
    expect(reader).not.toHaveBeenCalled();
  });
});
