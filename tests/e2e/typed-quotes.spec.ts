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
  content: { text: string; location?: string };
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
  const quotes: Quote[] = [];
  const sourcePosts: Array<Record<string, unknown>> = [];
  const quotePosts: Array<Record<string, unknown>> = [];
  await page.route("**/cloud-api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/cloud-api/u, "");
    const method = request.method();
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
      return route.fulfill({
        json: quotes.filter((item) => item.sourceId === wanted),
      });
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
  return { workspace, sourcePosts, quotePosts, quotes };
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
