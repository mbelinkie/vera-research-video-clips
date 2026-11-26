import { expect, test, type Page } from "@playwright/test";
import {
  LibraryItemSchema,
  LibrarySourceSchema,
  type LibraryItem,
  type LibrarySource,
} from "@research-video/contracts";

const id = (number: number) =>
  `019fbd01-1c70-72ea-8dbc-${number.toString().padStart(12, "0")}`;
const projectId = id(1);
const userId = id(2);
const articleId = id(3);
const videoId = id(4);
const articleText =
  "First  line.\nLiteral <strong>markup</strong> followed by a quote.\nEnd.";
const now = "2026-11-25T12:00:00.000Z";
const confirmed = (value: string) => ({ value, state: "confirmed" as const });

async function research(page: Page, options: { reader?: boolean } = {}) {
  const article = LibrarySourceSchema.parse({
    projectId,
    id: articleId,
    kind: "web_page",
    version: 1,
    bibliography: {
      title: { value: "A fixture article", state: "automatic" },
      url: confirmed("https://example.org/article"),
    },
    details: { extraction: { status: "ready", text: articleText } },
  });
  const video = LibrarySourceSchema.parse({
    projectId,
    id: videoId,
    kind: "youtube",
    version: 1,
    bibliography: { title: confirmed("A fixture video") },
    sourceIdentity: {
      schemaVersion: 1,
      provider: "youtube",
      providerMediaId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    },
    details: {},
  });
  const sources: LibrarySource[] = [
    article,
    video,
    ...(
      [
        "image",
        "audio",
        "local_video",
        "pdf",
        "offline",
        "provider_video",
      ] as const
    ).map((kind, index) =>
      LibrarySourceSchema.parse({
        projectId,
        id: id(10 + index),
        kind,
        version: 1,
        details: {},
        bibliography: { title: confirmed(`Fixture ${kind}`) },
      }),
    ),
    ...Array.from({ length: 100 }, (_, index) =>
      LibrarySourceSchema.parse({
        projectId,
        id: id(100 + index),
        kind: "offline",
        version: 1,
        details: {},
        bibliography: { title: confirmed(`More source ${index + 1}`) },
      }),
    ),
  ];
  const items: LibraryItem[] = [
    {
      kind: "clip",
      sourceId: videoId,
      content: { startMs: 0, endMs: 2000, text: "A clip excerpt" },
    },
    {
      kind: "audio",
      sourceId: id(11),
      content: {
        startMs: 10,
        endMs: 1000,
        title: "Ambient audio",
        role: "ambience",
      },
    },
    {
      kind: "still",
      sourceId: id(10),
      content: { title: "A retained still", credit: "Fixture photographer" },
    },
  ].map((item, index) =>
    LibraryItemSchema.parse({
      ...item,
      id: id(300 + index),
      projectId,
      createdBy: userId,
      topics: ["Evidence"],
      notes: "",
      version: 1,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const sent: unknown[] = [];
  const counts: Record<string, { total: number; unread: number }> = {
    [articleId]: { total: 2, unread: 1 },
    [videoId]: { total: 2, unread: 1 },
  };
  await page.route("**/cloud-api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname
      .replace("/cloud-api", "")
      .replace(`/api/projects/${projectId}`, "");
    const method = req.method();
    const query = url.searchParams;
    const offset = Number(query.get("offset") ?? "0");
    const limit = Number(query.get("limit") ?? "30");
    const kind = query.get("kind");
    const topic = query.get("topic");
    const sourceId = query.get("sourceId");
    const q = query.get("q")?.toLowerCase() ?? "";
    const logger = query.get("logger");

    if (path === "/api/projects")
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Research fixture",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            createdAt: now,
            updatedAt: now,
            version: 1,
            memberCount: 1,
            currentUserRole: options.reader ? "viewer" : "owner",
          },
        ],
      });
    if (path === "/clip-tags") return route.fulfill({ json: ["Evidence"] });
    if (path === "/sources" && method === "GET")
      return route.fulfill({
        json: sources
          .filter(
            (source) =>
              (!kind || source.kind === kind) &&
              (source.bibliography.title?.value ?? "")
                .toLowerCase()
                .includes(q) &&
              (!topic ||
                items.some(
                  (item) =>
                    item.sourceId === source.id && item.topics.includes(topic),
                )),
          )
          .slice(offset, offset + limit),
      });
    if (path === "/items" && method === "GET")
      return route.fulfill({
        json: items
          .filter(
            (item) =>
              (!kind || item.kind === kind) &&
              (!sourceId || item.sourceId === sourceId) &&
              (!topic || item.topics.includes(topic)) &&
              (!logger || item.createdBy === logger) &&
              (!q || JSON.stringify(item.content).toLowerCase().includes(q)),
          )
          .slice(offset, offset + limit),
      });
    if (path === "/items" && method === "POST") {
      const draft = req.postDataJSON();
      sent.push(draft);
      const item = LibraryItemSchema.parse({
        kind: "quote",
        id: id(350),
        projectId,
        sourceId: draft.sourceId,
        createdBy: userId,
        content: draft.content,
        topics: draft.topics,
        notes: draft.notes,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      items.unshift(item);
      return route.fulfill({ json: item, status: 201 });
    }
    if (path === "/source-discussion-counts")
      return route.fulfill({
        json: Object.fromEntries(
          (query.get("ids") ?? "")
            .split(",")
            .filter((source) => source in counts)
            .map((source) => [source, counts[source]]),
        ),
      });
    if (path === `/sources/${videoId}/youtube-details`) {
      return route.fulfill({
        json: {
          sourceId: videoId,
          title: "A fixture video",
          reason: null,
          moments: [],
          url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        },
      });
    }
    const match = /^\/sources\/([^/]+)(.*)$/u.exec(path);
    if (match) {
      const source = sources.find((record) => record.id === match[1]);
      if (!source) return route.fulfill({ status: 404, json: {} });
      if (match[2] === "" && method === "GET")
        return route.fulfill({ json: source });
      if (match[2] === "" && method === "PATCH") {
        const body = req.postDataJSON();
        expect(body.expectedVersion).toBe(source.version);
        Object.assign(source.bibliography, body.bibliography);
        source.version += 1;
        return route.fulfill({ json: source });
      }
      if (match[2] === "/extension-captures")
        return route.fulfill({ json: [] });
      if (match[2] === "/discussion" && method === "GET")
        return route.fulfill({
          json: {
            canReply: !options.reader,
            more: false,
            comments: [
              {
                id: id(50),
                authorName: "Reader One",
                body: "Already read",
                createdAt: now,
                unread: false,
              },
              {
                id: id(51),
                authorName: "Reader Two",
                body: "Unread source reply",
                createdAt: now,
                unread: !!counts[source.id]?.unread,
              },
            ],
          },
        });
      if (match[2] === "/discussion/read") {
        expect(req.postDataJSON()).toEqual([id(51)]);
        counts[source.id] = { total: 2, unread: 0 };
        return route.fulfill({ json: { [source.id]: counts[source.id] } });
      }
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${userId}|fixture:research`);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Research sources" }),
  ).toBeVisible();
  return { sent, sources };
}

test("pages mixed Sources, filters by Topic and notices a newly arrived source", async ({
  page,
}) => {
  const { sources } = await research(page);
  const catalog = page.getByRole("region", { name: "Research sources" });
  await expect(
    catalog.getByRole("button", { name: "A fixture article" }),
  ).toBeVisible();
  for (let index = 0; index < 3; index += 1)
    await catalog.getByRole("button", { name: "Next" }).click();
  await expect(
    catalog.getByRole("button", { name: "More source 100" }),
  ).toBeVisible();
  await catalog.getByLabel("Topic").selectOption("Evidence");
  await expect(
    catalog.getByRole("button", { name: "A fixture video" }),
  ).toBeVisible();
  await expect(
    catalog.getByRole("button", { name: "A fixture article" }),
  ).toHaveCount(0);
  await catalog.getByLabel("Topic").selectOption("");
  await expect(
    catalog.getByRole("button", { name: "A fixture article" }),
  ).toBeVisible();
  sources.unshift({
    ...sources[0]!,
    id: id(900),
    bibliography: { title: confirmed("Extension arrival") },
  });
  const arrival = catalog
    .getByRole("listitem")
    .filter({ hasText: "Extension arrival" });
  await expect(arrival.getByText("New", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
});

test("logs the exact article selection, confirms citation fields, and opens the quote from Library", async ({
  page,
}) => {
  const { sent } = await research(page);
  const title = page.getByRole("button", {
    name: "A fixture article",
    exact: true,
  });
  await title.press("Enter");
  await expect(page).toHaveURL(new RegExp(`sourceId=${articleId}`));
  const text = page.getByLabel("Clean article text");
  await expect(text).toContainText("Literal <strong>markup</strong>");
  const selected = "line.\nLiteral <strong>markup</strong>";
  await text.evaluate((element, quote) => {
    const node = element.firstChild!;
    const start = node.textContent!.indexOf(quote);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + quote.length);
    selection.removeAllRanges();
    selection.addRange(range);
  }, selected);
  await page.getByRole("button", { name: "Log quote", exact: true }).click();
  expect(sent).toEqual([
    expect.objectContaining({
      kind: "quote",
      sourceId: articleId,
      content: {
        text: selected,
        surroundingWords: {
          before: "First  ",
          after: " followed by a quote.\nEnd.",
        },
      },
    }),
  ]);
  await expect(
    page
      .getByRole("complementary", { name: "Saved quotes" })
      .getByRole("button", { name: /Literal/ }),
  ).toBeFocused();
  await expect(text.locator("mark")).toHaveText(selected);
  await page.getByRole("button", { name: "Details & citation" }).click();
  await expect(page.getByText("Found automatically")).toBeVisible();
  await page.getByRole("button", { name: "Confirm title" }).click();
  await page.getByRole("button", { name: "Save citation" }).click();
  await expect(page.getByText("Citation saved.")).toBeVisible();
  await page.getByRole("button", { name: "Back to Sources" }).click();
  await expect(title).toBeFocused();
  await page
    .getByRole("navigation", { name: "Research", exact: true })
    .getByRole("button", { name: "Library" })
    .click();
  const library = page.getByRole("region", { name: "Research library" });
  await expect(library.getByText("A clip excerpt")).toBeVisible();
  await expect(library.getByText("Ambient audio")).toBeVisible();
  await expect(library.getByText("Fixture photographer")).toBeVisible();
  await library.getByLabel("Item kind").selectOption("quote");
  await library.getByRole("button", { name: "View quote" }).click();
  await expect(
    library.getByRole("heading", { name: "Quote details" }),
  ).toBeFocused();
  await library.getByRole("button", { name: "Open source" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Saved quotes" })
      .getByRole("button", { name: /Literal/ }),
  ).toBeVisible();
});

test("shows the same read counts on sources and workspaces and retains the article reply draft", async ({
  page,
}) => {
  await research(page);
  const article = page
    .getByRole("listitem")
    .filter({ hasText: "A fixture article" });
  await expect(article.getByText("Comments · 2 · 1 new")).toBeVisible();
  await article.getByRole("button").click();
  const control = page.getByRole("button", {
    name: "Comments · 2 · 1 new",
    exact: true,
  });
  await control.click();
  const dialog = page.getByRole("dialog", { name: "Source comments" });
  await expect(dialog.getByText("Already read")).toBeVisible();
  await expect(dialog.getByText("New", { exact: true })).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "Reply" }).fill("An unsent reply");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Comments · 2", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Page picture", exact: true }).click();
  await expect(page.getByText("No saved picture for this view.")).toBeVisible();
  await page.getByRole("button", { name: "Comments · 2", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Reply" })).toHaveValue(
    "An unsent reply",
  );
  await dialog.getByRole("button", { name: "Close comments" }).click();
  await page.getByRole("button", { name: "Back to Sources" }).click();
  await expect(
    article.getByText("Comments · 2", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "A fixture video", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "YouTube source view" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Comments · 2 · 1 new", exact: true })
    .click();
  await expect(dialog.getByText("New", { exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close comments" }).click();
  await expect(
    page.getByRole("button", { name: "Comments · 2", exact: true }),
  ).toBeFocused();
});
