import { expect, test, type Page } from "@playwright/test";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
const otherProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee44";
const ownerId = "019fbb95-cd76-7920-93fa-e23ba755ee36";
const bookId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
const webSourceId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
const firstQuoteId = "019fbb95-cd76-7920-93fa-e23ba755ee45";
const secondQuoteId = "019fbb95-cd76-7920-93fa-e23ba755ee46";
const now = "2026-11-20T12:00:00.000Z";

type Source = {
  id: string;
  projectId: string;
  kind: string;
  bibliography: { title: { value: string; state: string } };
  details: object;
  version: number;
};
type Quote = {
  id: string;
  projectId: string;
  sourceId: string;
  kind: "quote";
  version: number;
  content: {
    text: string;
    location?: string;
    speaker?: string;
    speakerTitle?: string;
    citationOverride?: string;
    title?: string;
    latestDisplayText?: string;
    surroundingWords?: { before?: string; after?: string };
    highlight?: {
      page: number;
      rectangles: { x: number; y: number; width: number; height: number }[];
    };
  };
  notes: string;
  topics: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function source(
  id: string,
  title: string,
  kind: "offline" | "web_page",
  project = projectId,
): Source {
  return {
    id,
    projectId: project,
    kind,
    bibliography: { title: { value: title, state: "confirmed" } },
    details:
      kind === "offline"
        ? { subtype: "book" }
        : {
            submittedUrl: "https://example.org/paywall",
            extraction: { status: "failed", reason: "blocked" },
          },
    version: 1,
  };
}

async function fixture(
  page: Page,
  options: {
    failedFirstSource?: boolean;
    failedFirstQuote?: boolean;
    failedFirstPicture?: boolean;
    staleFirstEdit?: boolean;
    extensionQuote?: boolean;
    manyQuotes?: boolean;
    manySources?: boolean;
    twoProjects?: boolean;
  } = {},
) {
  const sources: Source[] = [
    source(webSourceId, "Paywalled archive", "web_page"),
  ];
  if (options.manySources) {
    for (let i = 0; i < 21; i++) {
      sources.push(
        source(
          `019fbb95-cd76-7920-93fa-${(0xe23ba755ee70 + i).toString(16)}`,
          `Research book ${String(i).padStart(2, "0")}`,
          "offline",
        ),
      );
    }
  }
  const quotes: Quote[] = options.extensionQuote
    ? [
        {
          id: firstQuoteId,
          projectId,
          sourceId: webSourceId,
          kind: "quote",
          version: 1,
          notes: "Original extension note",
          topics: ["Archive"],
          content: {
            text: "  Exact extension capture.  ",
            latestDisplayText: "Placed script wording",
            speaker: "Incorrect speaker",
            speakerTitle: "Incorrect role",
            location: "p. 99",
            citationOverride: "Old citation",
            title: "Captured document title",
            surroundingWords: { before: "Before", after: "After" },
            highlight: {
              page: 3,
              rectangles: [{ x: 0.2, y: 0.3, width: 0.2, height: 0.1 }],
            },
          },
          createdBy: ownerId,
          createdAt: now,
          updatedAt: now,
        },
      ]
    : [];
  if (options.manyQuotes) {
    for (let index = 0; index < 101; index++) {
      quotes.push({
        id: `019fbb95-cd76-7920-93fa-${(0xe23ba755eea0 + index).toString(16)}`,
        projectId,
        sourceId: webSourceId,
        kind: "quote",
        version: 1,
        content: { text: `Existing quote ${index}` },
        notes: "",
        topics: [],
        createdBy: ownerId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  const sourcePosts: Array<Record<string, unknown>> = [];
  const quotePosts: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const picturePosts: string[] = [];
  const pictures = new Map<string, string>();
  // A real 1x1 PNG; the read path is served as private authenticated bytes.
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/cloud-api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/cloud-api/u, "");
    const method = request.method();
    const pictureMatch = path.match(
      new RegExp(
        `^/api/projects/${projectId}/library-reference-pictures/(source|quote)/([^/]+)(?:/(display))?$`,
        "u",
      ),
    );
    if (pictureMatch) {
      const key = `${pictureMatch[1]}/${pictureMatch[2]}`;
      if (method === "POST") {
        picturePosts.push(key);
        if (options.failedFirstPicture && picturePosts.length === 1)
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "unavailable",
                message: "Photo storage unavailable",
                retryable: true,
              },
            },
          });
        pictures.set(key, "019fbb95-cd76-7920-93fa-e23ba755ee99");
        return route.fulfill({
          status: 201,
          json: { revisionId: pictures.get(key), assets: {} },
        });
      }
      if (
        method === "GET" &&
        pictureMatch[3] === "display" &&
        pictures.has(key)
      )
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: pixel,
        });
      if (method === "GET" && pictures.has(key))
        return route.fulfill({
          json: { revisionId: pictures.get(key), assets: {} },
        });
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "not_found", message: "No photo", retryable: false },
        },
      });
    }
    if (path === "/api/projects" && method === "GET") {
      return route.fulfill({
        json: [projectId, ...(options.twoProjects ? [otherProjectId] : [])].map(
          (id, index) => ({
            id,
            name: index === 0 ? "Fixture research" : "Another project",
            description: "",
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      });
    }
    if (path === `/api/projects/${projectId}/sources` && method === "GET") {
      const search = (url.searchParams.get("q") ?? "").toLowerCase();
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return route.fulfill({
        json: sources
          .filter((item) =>
            item.bibliography.title.value.toLowerCase().includes(search),
          )
          .slice(offset, offset + limit),
      });
    }
    if (path === `/api/projects/${projectId}/sources` && method === "POST") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      sourcePosts.push(payload);
      if (options.failedFirstSource && sourcePosts.length === 1) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "unavailable",
              message: "Source temporarily unavailable",
              retryable: true,
            },
          },
        });
      }
      const created: Source = {
        ...source(
          bookId,
          (payload.bibliography as { title: { value: string } }).title.value,
          "offline",
        ),
        bibliography: payload.bibliography as Source["bibliography"],
        details: payload.details as object,
      };
      sources.unshift(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (path === `/api/projects/${projectId}/items` && method === "GET") {
      const wanted = url.searchParams.get("sourceId");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      return route.fulfill({
        json: quotes
          .filter((item) => item.sourceId === wanted)
          .slice(offset, offset + limit),
      });
    }
    const itemMatch = path.match(
      new RegExp(`^/api/projects/${projectId}/items/([^/]+)$`, "u"),
    );
    if (itemMatch && method === "GET") {
      const item = quotes.find((quote) => quote.id === itemMatch[1]);
      return route.fulfill(item ? { json: item } : { status: 404, json: {} });
    }
    if (itemMatch && method === "PATCH") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      patches.push(payload);
      const item = quotes.find((quote) => quote.id === itemMatch[1]);
      if (!item) return route.fulfill({ status: 404, json: {} });
      if (
        (options.staleFirstEdit && patches.length === 1) ||
        payload.expectedVersion !== item.version
      ) {
        if (options.staleFirstEdit && patches.length === 1) item.version++;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "conflict",
              message: "Version has changed",
              retryable: false,
            },
          },
        });
      }
      item.content = { ...(payload.content as Quote["content"]) };
      if (options.extensionQuote)
        item.content.latestDisplayText = "Placed script wording";
      item.topics = payload.topics as string[];
      item.notes = payload.notes as string;
      item.version++;
      return route.fulfill({ json: item });
    }
    if (path === `/api/projects/${projectId}/items` && method === "POST") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      quotePosts.push(payload);
      if (options.failedFirstQuote && quotePosts.length === 1) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "unavailable",
              message: "Try the same quote again",
              retryable: true,
            },
          },
        });
      }
      const created: Quote = {
        id: quotes.length === 0 ? firstQuoteId : secondQuoteId,
        projectId,
        sourceId: payload.sourceId as string,
        kind: "quote",
        version: 1,
        content: payload.content as Quote["content"],
        notes: payload.notes as string,
        topics: payload.topics as string[],
        createdBy: ownerId,
        createdAt: now,
        updatedAt: now,
      };
      quotes.unshift(created);
      return route.fulfill({ status: 201, json: created });
    }
    // Other workspaces load independently and must not affect this fixture.
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "not_found",
          message: "Fixture endpoint unavailable",
          retryable: false,
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${ownerId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Target project")).toHaveValue(projectId);
  const workspace = page.getByRole("region", { name: "Typed quotes" });
  await workspace.getByRole("button", { name: "+ Add" }).click();
  await workspace
    .getByRole("button", { name: "Typed quote", exact: true })
    .click();
  return {
    workspace,
    sourcePosts,
    quotePosts,
    quotes,
    patches,
    picturePosts,
    pictures,
  };
}

test("creates an offline book, saves exact text, then adds another quote without recreating the source", async ({
  page,
}) => {
  const { workspace, sourcePosts, quotePosts, quotes } = await fixture(page);
  await workspace.getByRole("button", { name: "New offline source" }).click();
  await workspace.getByLabel("Source title").fill("A Synthetic History");
  await workspace
    .getByLabel("Authors (one per line)")
    .fill("Ada, Lovelace\nExample Writer");
  await workspace.getByLabel("Publisher").fill("Fixture Press");
  await workspace.getByLabel("Publication date").fill("1984");
  const exact = "  A verbatim passage.\nSecond line.  ";
  await workspace.getByLabel("Quote text").fill(exact);
  await workspace.getByLabel("Page / location").fill("p. 42");
  await workspace
    .getByLabel("Topics (comma-separated)")
    .fill("History, Evidence");
  await workspace.getByLabel("Quote note").fill("For the introduction");
  await workspace.getByRole("button", { name: "Save and add another" }).click();
  await expect(
    workspace.getByText("Quote saved. Add another to the same source."),
  ).toBeVisible();
  await expect(
    workspace.getByText("Selected source: A Synthetic History"),
  ).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toHaveValue("");
  await expect(workspace.getByLabel("Quote text")).toBeFocused();
  expect(sourcePosts).toHaveLength(1);
  expect(sourcePosts[0]?.kind).toBe("offline");
  expect(
    (sourcePosts[0]?.bibliography as { authors: { value: string[] } }).authors
      .value,
  ).toEqual(["Ada, Lovelace", "Example Writer"]);
  expect(
    (sourcePosts[0]?.bibliography as { url?: unknown }).url,
  ).toBeUndefined();
  expect(quotePosts[0]?.content).toMatchObject({
    text: exact,
    location: "p. 42",
  });
  expect(quotePosts[0]?.topics).toEqual(["History", "Evidence"]);

  await workspace.getByLabel("Quote text").fill("Second passage");
  await workspace.getByLabel("Page / location").fill("p. 43");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  await expect(
    workspace.getByLabel("Saved quote: Second passage"),
  ).toBeFocused();
  expect(sourcePosts).toHaveLength(1);
  expect(quotePosts).toHaveLength(2);
  expect(quotePosts[0]?.sourceId).toBe(bookId);
  expect(quotePosts[1]?.sourceId).toBe(bookId);
  expect(quotePosts[1]?.idempotencyKey).not.toEqual(
    quotePosts[0]?.idempotencyKey,
  );
  expect(quotes.map((quote) => quote.content.text)).toEqual([
    "Second passage",
    exact,
  ]);
});

test("searches and pages existing sources, then adds a quote to a failed-extraction web page", async ({
  page,
}) => {
  const { workspace, sourcePosts, quotePosts } = await fixture(page, {
    manySources: true,
  });
  await expect(
    workspace.getByRole("button", { name: "Load more sources" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Load more sources" }).click();
  await expect(
    workspace.getByRole("button", { name: /Research book 20/ }),
  ).toBeVisible();
  await workspace.getByLabel("Search existing sources").fill("Paywall");
  await workspace.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: /Paywalled archive/ }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace.getByLabel("Quote text").fill("A reader's typed citation");
  await workspace.getByLabel("Speaker name").fill("Witness");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  expect(sourcePosts).toHaveLength(0);
  expect(quotePosts).toHaveLength(1);
  expect(quotePosts[0]?.sourceId).toBe(webSourceId);
  expect(quotePosts[0]?.content).toMatchObject({ speaker: "Witness" });
});

test("a failed quote POST retries with the same intent key and never duplicates a successfully created source", async ({
  page,
}) => {
  const { workspace, sourcePosts, quotePosts } = await fixture(page, {
    failedFirstQuote: true,
  });
  await workspace.getByRole("button", { name: "New offline source" }).click();
  await workspace.getByLabel("Source title").fill("Retry Fixture Book");
  await workspace.getByLabel("Quote text").fill("Important words");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace
      .getByRole("alert")
      .filter({ hasText: "Try the same quote again" }),
  ).toBeVisible();
  await expect(
    workspace.getByText("Selected source: Retry Fixture Book"),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  expect(sourcePosts).toHaveLength(1);
  expect(quotePosts).toHaveLength(2);
  expect(quotePosts[1]?.idempotencyKey).toBe(quotePosts[0]?.idempotencyKey);
  expect(quotePosts[1]?.sourceId).toBe(bookId);
});

test("changing projects discards the other project's source results and unsaved quote", async ({
  page,
}) => {
  const { workspace } = await fixture(page, { twoProjects: true });
  await expect(
    workspace.getByRole("button", { name: /Paywalled archive/ }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace.getByLabel("Quote text").fill("Private first-project draft");
  await page.getByLabel("Target project").selectOption(otherProjectId);
  const next = page.getByRole("region", { name: "Typed quotes" });
  await expect(next.getByRole("button", { name: "+ Add" })).toBeVisible();
  await next.getByRole("button", { name: "+ Add" }).click();
  await next.getByRole("button", { name: "Typed quote", exact: true }).click();
  await expect(next.getByLabel("Quote text")).toHaveValue("");
  await expect(next.getByText("Private first-project draft")).toHaveCount(0);
  await expect(
    next.getByRole("button", { name: /Paywalled archive/ }),
  ).toHaveCount(0);
  await expect(
    next.getByText("Selected source: Paywalled archive"),
  ).toHaveCount(0);
});

test("a failed source creation retries with the original idempotency key and quote text", async ({
  page,
}) => {
  const { workspace, sourcePosts, quotePosts } = await fixture(page, {
    failedFirstSource: true,
  });
  await workspace.getByRole("button", { name: "New offline source" }).click();
  await workspace.getByLabel("Source title").fill("A book after outage");
  await workspace.getByLabel("Quote text").fill("Exact draft retained");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace
      .getByRole("alert")
      .filter({ hasText: "Source temporarily unavailable" }),
  ).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toHaveValue(
    "Exact draft retained",
  );
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  expect(sourcePosts).toHaveLength(2);
  expect(sourcePosts[0]?.idempotencyKey).toBe(sourcePosts[1]?.idempotencyKey);
  expect(quotePosts).toHaveLength(1);
  expect(quotePosts[0]?.sourceId).toBe(bookId);
});

test("edits extension quotes without replacing retained capture geometry, attribution title or script text", async ({
  page,
}) => {
  const { workspace, patches, quotes, quotePosts } = await fixture(page, {
    extensionQuote: true,
  });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await expect(
    workspace.getByRole("button", { name: /Edit quote:.*Exact extension/ }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: /Edit quote:.*Exact extension/ })
    .click();
  await expect(workspace.getByLabel("Quote text")).toHaveValue(
    "  Exact extension capture.  ",
  );
  await expect(workspace.getByLabel("Quote text")).toBeFocused();
  await workspace.getByLabel("Quote text").fill("  Corrected exact text.  ");
  await workspace.getByLabel("Speaker name").fill("");
  await workspace.getByLabel("Speaker title / role").fill("");
  await workspace.getByLabel("Page / location").fill("");
  await workspace.getByLabel("Citation override").fill("");
  await workspace.getByLabel("Topics (comma-separated)").fill("New Topic");
  await workspace.getByLabel("Quote note").fill("");
  await workspace.getByRole("button", { name: "Save changes" }).click();
  await expect(workspace.getByText("Quote changes saved.")).toBeVisible();
  expect(quotePosts).toHaveLength(0);
  expect(patches).toHaveLength(1);
  expect(patches[0]?.expectedVersion).toBe(1);
  const patched = patches[0]?.content as Record<string, unknown>;
  expect(patched).toMatchObject({
    text: "  Corrected exact text.  ",
    title: "Captured document title",
    surroundingWords: { before: "Before", after: "After" },
    highlight: {
      page: 3,
      rectangles: [{ x: 0.2, y: 0.3, width: 0.2, height: 0.1 }],
    },
  });
  for (const cleared of [
    "speaker",
    "speakerTitle",
    "location",
    "citationOverride",
    "latestDisplayText",
  ])
    expect(patched).not.toHaveProperty(cleared);
  expect(patches[0]).not.toHaveProperty("sourceId");
  expect(quotes[0]?.content.latestDisplayText).toBe("Placed script wording");
  expect(quotes[0]?.topics).toEqual(["New Topic"]);
  expect(quotes[0]?.notes).toBe("");
  await workspace
    .getByRole("button", { name: /Edit quote:.*Corrected exact/ })
    .click();
  await expect(workspace.getByLabel("Quote text")).toHaveValue(
    "  Corrected exact text.  ",
  );
  await expect(workspace.getByLabel("Speaker name")).toHaveValue("");
});

test("a version conflict retains the unsaved correction until explicit reload, then saves a fresh version", async ({
  page,
}) => {
  const { workspace, patches, quotes } = await fixture(page, {
    extensionQuote: true,
    staleFirstEdit: true,
  });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace
    .getByRole("button", { name: /Edit quote:.*Exact extension/ })
    .click();
  await workspace.getByLabel("Quote text").fill("My unsaved correction");
  await workspace.getByRole("button", { name: "Save changes" }).click();
  await expect(workspace.getByText(/changed elsewhere/)).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toHaveValue(
    "My unsaved correction",
  );
  await expect(
    workspace.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  expect(patches).toHaveLength(1);
  await workspace.getByRole("button", { name: /Reload latest quote/ }).click();
  await expect(workspace.getByLabel("Quote text")).toHaveValue(
    "  Exact extension capture.  ",
  );
  await workspace.getByLabel("Quote text").fill("Correction after reload");
  await workspace.getByRole("button", { name: "Save changes" }).click();
  await expect(workspace.getByText("Quote changes saved.")).toBeVisible();
  expect(patches.map((patch) => patch.expectedVersion)).toEqual([1, 2]);
  expect(quotes[0]?.content.text).toBe("Correction after reload");
});

test("a typed quote can be reopened and edited after its first save", async ({
  page,
}) => {
  const { workspace, patches } = await fixture(page);
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace.getByLabel("Quote text").fill("First edition");
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Edit quote: First edition" })
    .click();
  await workspace.getByLabel("Quote text").fill("Revised edition");
  await workspace.getByRole("button", { name: "Save changes" }).click();
  await expect(
    workspace.getByLabel("Saved quote: Revised edition"),
  ).toBeVisible();
  expect(patches[0]?.expectedVersion).toBe(1);
});

test("quotes beyond the first Library page can be edited with the same form", async ({
  page,
}) => {
  const { workspace, patches } = await fixture(page, { manyQuotes: true });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await expect(
    workspace.getByRole("button", { name: "Load more saved quotes" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Load more saved quotes" })
    .click();
  await workspace
    .getByRole("button", { name: "Edit quote: Existing quote 100" })
    .click();
  await workspace.getByLabel("Quote text").fill("Edited quote on second page");
  await workspace.getByRole("button", { name: "Save changes" }).click();
  await expect(workspace.getByText("Quote changes saved.")).toBeVisible();
  expect(patches[0]?.expectedVersion).toBe(1);
});

test("picture failure keeps the committed quote and retries only its photo, then reads the retained preview", async ({
  page,
}) => {
  const { workspace, quotePosts, picturePosts } = await fixture(page, {
    failedFirstPicture: true,
  });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace.getByLabel("Quote text").fill("Photo fixture quote");
  await workspace.getByLabel("Quote photo (optional)").setInputFiles({
    name: "quote.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(workspace.getByAltText("Quote photo preview")).toBeVisible();
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText(/Quote saved, but its picture upload failed/),
  ).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toBeDisabled();
  await workspace.getByRole("button", { name: "Retry pictures" }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  expect(quotePosts).toHaveLength(1);
  expect(picturePosts).toEqual([
    `quote/${firstQuoteId}`,
    `quote/${firstQuoteId}`,
  ]);
  await workspace
    .getByRole("button", { name: "Edit quote: Photo fixture quote" })
    .click();
  await expect(workspace.getByAltText("Quote photo preview")).toBeVisible();
});

test("a permanently rejected optional picture can be omitted without losing the saved quote", async ({
  page,
}) => {
  const { workspace, quotePosts, picturePosts } = await fixture(page);
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace
    .getByLabel("Quote text")
    .fill("Quote survives an invalid image");
  await workspace.getByLabel("Quote photo (optional)").setInputFiles({
    name: "not-a-picture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  });
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(workspace.getByText(/picture upload failed/)).toBeVisible();
  await workspace
    .getByRole("button", { name: "Continue without pictures" })
    .click();
  await expect(
    workspace.getByText("Quote saved without the selected pictures."),
  ).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toBeEnabled();
  expect(quotePosts).toHaveLength(1);
  expect(picturePosts).toHaveLength(0);
});

test("an offline cover and quote picture attach to the correct independent owners", async ({
  page,
}) => {
  const { workspace, picturePosts, sourcePosts, quotePosts } =
    await fixture(page);
  const photo = {
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  await workspace.getByRole("button", { name: "New offline source" }).click();
  await workspace.getByLabel("Source title").fill("Cover-bearing book");
  await workspace
    .getByLabel("Source cover photo (optional)")
    .setInputFiles(photo);
  await workspace.getByLabel("Quote text").fill("Quote with photo");
  await workspace.getByLabel("Quote photo (optional)").setInputFiles(photo);
  await workspace.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    workspace.getByText("Quote saved to this source."),
  ).toBeVisible();
  expect(sourcePosts).toHaveLength(1);
  expect(quotePosts).toHaveLength(1);
  expect(picturePosts).toEqual([`source/${bookId}`, `quote/${firstQuoteId}`]);
  await expect(
    workspace.getByAltText("Source cover photo preview"),
  ).toBeVisible();
});

test("retrying a failed source cover preserves Save and add another without duplicating either record", async ({
  page,
}) => {
  const { workspace, sourcePosts, quotePosts, picturePosts } = await fixture(
    page,
    { failedFirstPicture: true },
  );
  await workspace.getByRole("button", { name: "New offline source" }).click();
  await workspace.getByLabel("Source title").fill("Retry cover book");
  await workspace.getByLabel("Source cover photo (optional)").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await workspace.getByLabel("Quote text").fill("Retain my first quote");
  await workspace.getByRole("button", { name: "Save and add another" }).click();
  await expect(
    workspace.getByText(/Quote saved, but its picture upload failed/),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Retry pictures" }).click();
  await expect(
    workspace.getByText("Quote saved. Add another to the same source."),
  ).toBeVisible();
  await expect(workspace.getByLabel("Quote text")).toHaveValue("");
  await expect(workspace.getByLabel("Quote text")).toBeFocused();
  expect(sourcePosts).toHaveLength(1);
  expect(quotePosts).toHaveLength(1);
  expect(picturePosts).toEqual([`source/${bookId}`, `source/${bookId}`]);
});

test("project change drops a pending quote picture and never uploads it to the next project", async ({
  page,
}) => {
  const { workspace, quotePosts, picturePosts } = await fixture(page, {
    twoProjects: true,
  });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace.getByLabel("Quote text").fill("Private picture draft");
  await workspace.getByLabel("Quote photo (optional)").setInputFiles({
    name: "private.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByLabel("Target project").selectOption(otherProjectId);
  const next = page.getByRole("region", { name: "Typed quotes" });
  await next.getByRole("button", { name: "+ Add" }).click();
  await next.getByRole("button", { name: "Typed quote", exact: true }).click();
  await expect(next.getByLabel("Quote text")).toHaveValue("");
  await expect(next.getByText("Pending upload: private.png")).toHaveCount(0);
  await expect(next.getByAltText("Quote photo preview")).toHaveCount(0);
  expect(quotePosts).toHaveLength(0);
  expect(picturePosts).toHaveLength(0);
});

test("compact width retains quote edit, source lock and upload controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const { workspace } = await fixture(page, { extensionQuote: true });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace
    .getByRole("button", { name: /Edit quote:.*Exact extension/ })
    .click();
  await expect(workspace.getByLabel("Quote text")).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Change source" }),
  ).toBeDisabled();
  await expect(workspace.getByLabel("Quote photo (optional)")).toBeVisible();
  // The legacy transcription queue overflows at this width independently;
  // #80 must keep its own editor/details within its allotted compact column.
  const overflow = await workspace.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  expect(overflow).toBe(false);
});

test("wide view docks saved excerpts beside the editable quote and preserves focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { workspace } = await fixture(page, { extensionQuote: true });
  await workspace.getByRole("button", { name: /Paywalled archive/ }).click();
  await workspace
    .getByRole("button", { name: /Edit quote:.*Exact extension/ })
    .click();
  const form = await workspace.locator(".typed-quotes-form").boundingBox();
  const saved = await workspace.locator(".typed-quotes-saved").boundingBox();
  expect(form).not.toBeNull();
  expect(saved).not.toBeNull();
  expect(form!.x + form!.width).toBeLessThan(saved!.x);
  await expect(workspace.getByLabel("Quote text")).toBeFocused();
});
