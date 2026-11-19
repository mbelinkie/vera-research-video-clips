import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSyntheticExtensionFixture,
  FIXTURE_AFTER,
  FIXTURE_BEFORE,
  FIXTURE_QUOTE,
  type SyntheticFixture,
} from "./extension-fixture.ts";

const enabled = process.env.VERA_EXTENSION_REAL_CHROME === "1";
const destination = process.env.VERA_EXTENSION_DESTINATION_URL;
const projectName = process.env.VERA_EXTENSION_PROJECT_NAME;
const sourceExtensionPath = resolve(
  process.env.VERA_EXTENSION_DIR ?? "apps/chrome-extension",
);

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function stageExtensionForChrome() {
  const manifest = record(
    JSON.parse(
      await readFile(join(sourceExtensionPath, "manifest.json"), "utf8"),
    ),
  );
  const optionalHosts = array(manifest.optional_host_permissions).filter(
    (value): value is string => typeof value === "string",
  );
  if (!optionalHosts.includes("http://127.0.0.1/*")) {
    throw new Error(
      "The source extension must retain its loopback optional host permission",
    );
  }
  const stagedPath = await mkdtemp(join(tmpdir(), "vera-extension-staged-"));
  await cp(sourceExtensionPath, stagedPath, { recursive: true });
  const { optional_host_permissions: _optional, ...stagedBase } = manifest;
  await writeFile(
    join(stagedPath, "manifest.json"),
    JSON.stringify(
      {
        ...stagedBase,
        // Chrome's optional-host permission prompt is browser chrome and is
        // not automatable through Playwright. The captureVisibleTab API also
        // requires activeTab or <all_urls>; the disposable staging copy uses
        // the latter so a synthetic local page can exercise the real capture
        // code without a browser-chrome permission handoff.
        host_permissions: ["<all_urls>"],
      },
      null,
      2,
    ),
  );
  return stagedPath;
}

async function launchDisposableChrome(extensionPath: string) {
  const requestedProfile = process.env.VERA_EXTENSION_PROFILE_DIR;
  const profile =
    requestedProfile ??
    (await mkdtemp(join(tmpdir(), "vera-extension-chrome-")));
  const executablePath = process.env.VERA_EXTENSION_CHROME_PATH;
  const options = {
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    headless: process.env.VERA_EXTENSION_HEADLESS === "1",
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  };
  const context = await chromium.launchPersistentContext(profile, options);
  return {
    context,
    profile,
    cleanupProfile: requestedProfile === undefined,
  };
}

async function extensionId(context: BrowserContext) {
  const worker =
    context
      .serviceWorkers()
      .find((candidate) => candidate.url().startsWith("chrome-extension://")) ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const id = new URL(worker.url()).hostname;
  if (!id) throw new Error("The unpacked extension service worker has no ID");
  return id;
}

async function waitForConfirmation(context: BrowserContext, id: string) {
  const prefix = `chrome-extension://${id}/confirm.html#`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = context
      .pages()
      .find((candidate) => candidate.url().startsWith(prefix));
    if (page) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return page;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("The extension did not open its confirmation page");
}

// Playwright cannot click Chrome's browser toolbar or invoke a browser-level
// command shortcut. Open the unpacked popup document and click its real action
// button instead; the button sends the same runtime message used by the
// toolbar popup, while the article remains the active tab for activeTab.
async function triggerPopupCapture(
  article: Page,
  context: BrowserContext,
  id: string,
  kind: "quote" | "page" = "quote",
) {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const confirmationPromise = waitForConfirmation(context, id);
    // Page.bringToFront is the CDP operation that changes Chrome's active
    // tab; Playwright's page helper only changes the automation target here.
    const articleCdp = await context.newCDPSession(article);
    await articleCdp.send("Page.bringToFront");
    // A direct Playwright click would activate this synthetic popup tab and
    // revoke the article's activeTab context. Dispatch the same popup button
    // handler while the CDP-selected article remains active; manual browser
    // chrome checks cover the toolbar/context-menu/shortcut gesture itself.
    await popup.evaluate((captureKind) => {
      const button = document.querySelector<HTMLButtonElement>(
        `button[data-kind="${captureKind}"]`,
      );
      if (!button) throw new Error("The extension popup action is missing");
      button.click();
    }, kind);
    try {
      return await confirmationPromise;
    } catch (error) {
      const status = await popup.locator("#status").textContent();
      throw new Error(
        `The extension did not open its confirmation page (${status?.trim() || "no popup status"})`,
        { cause: error },
      );
    }
  } finally {
    await popup.close().catch(() => undefined);
  }
}

async function pairThroughOptions(
  context: BrowserContext,
  id: string,
  origin: string,
) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel("VERA address").fill(origin);
  const pairPagePromise = context.waitForEvent("page", { timeout: 10_000 });
  await options.getByRole("button", { name: "Connect to VERA" }).click();
  const pairPage = await pairPagePromise;
  await pairPage.waitForLoadState("domcontentloaded");
  const code = await options.locator("#code").textContent();
  if (!code || !/^\d{8}$/u.test(code)) {
    throw new Error("Options did not show an eight-digit pairing code");
  }
  await pairPage.getByLabel("Connection code").fill(code);
  await pairPage.getByRole("button", { name: "Connect extension" }).click();
  await expect(pairPage.getByRole("status")).toContainText("Connected");
  await pairPage.close();
  await options.getByRole("button", { name: "Check connection" }).click();
  await expect(options.getByRole("status")).toContainText("Connected");
  await options.close();
}

async function ensureProject(
  context: BrowserContext,
  origin: string,
  name: string,
) {
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const create = page.getByLabel("Create a project");
  if ((await create.count()) > 0) {
    await create.fill(name);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(page.getByText(`Created project “${name}”.`)).toBeVisible();
  }
  await page.close();
}

async function chooseProject(page: Page, name: string) {
  const control = page.getByLabel("Destination project", { exact: false });
  await expect(control).toBeVisible();
  const tagName = await control.evaluate((element) => element.tagName);
  if (tagName === "SELECT") {
    await control.selectOption({ label: name });
  } else {
    await control.click();
    await page.getByRole("option", { name, exact: true }).click();
  }
}

function validatePicture(value: unknown) {
  const picture = record(value);
  const data = picture.data;
  return (
    typeof data === "string" &&
    data.startsWith("iVBOR") &&
    number(picture.width) &&
    number(picture.height) &&
    picture.width > 0 &&
    picture.height > 0
  );
}

function validateRectangles(value: unknown) {
  const rectangles = array(value);
  return (
    rectangles.length >= 2 &&
    rectangles.every((value) => {
      const rectangle = record(value);
      return (
        number(rectangle.x) &&
        number(rectangle.y) &&
        number(rectangle.width) &&
        number(rectangle.height) &&
        rectangle.x >= 0 &&
        rectangle.y >= 0 &&
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        rectangle.x + rectangle.width <= 1 &&
        rectangle.y + rectangle.height <= 1
      );
    })
  );
}

test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("Research #79 real Chrome synthetic capture", () => {
  test.skip(
    !enabled || !destination || !projectName,
    "Set VERA_EXTENSION_REAL_CHROME=1, VERA_EXTENSION_DESTINATION_URL, and VERA_EXTENSION_PROJECT_NAME to run the disposable-profile check.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  let fixture: SyntheticFixture;

  test.beforeAll(async () => {
    fixture = await createSyntheticExtensionFixture();
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  test("captures an authenticated wrapped quote without a server refetch", async () => {
    if (!projectName)
      throw new Error("A disposable fixture project is required");
    const destinationUrl = new URL(destination!);
    if (!/^(127\.0\.0\.1|localhost)$/.test(destinationUrl.hostname)) {
      throw new Error(
        "The real Chrome fixture only permits a loopback destination origin",
      );
    }
    const stagedExtensionPath = await stageExtensionForChrome();
    const { context, profile, cleanupProfile } =
      await launchDisposableChrome(stagedExtensionPath);
    try {
      const id = await extensionId(context);
      if (process.env.VERA_EXTENSION_PAIR === "1") {
        await pairThroughOptions(context, id, destinationUrl.origin);
      }
      if (process.env.VERA_EXTENSION_CREATE_PROJECT === "1") {
        if (!projectName)
          throw new Error("A disposable fixture project is required");
        await ensureProject(context, destinationUrl.origin, projectName);
      }
      const article = await context.newPage();
      await article.goto(`${fixture.origin}/login`, {
        waitUntil: "domcontentloaded",
      });
      await article.goto(fixture.articleUrl, { waitUntil: "domcontentloaded" });
      const originalScrollY = await article.evaluate(() => window.scrollY);
      const expectedSelection = await article
        .locator('[data-fixture="quote"]')
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rectangles = Array.from(range.getClientRects());
          return {
            text: range.toString(),
            rectangleCount: rectangles.length,
          };
        });
      expect(expectedSelection.text === FIXTURE_QUOTE).toBe(true);
      expect(expectedSelection.rectangleCount >= 2).toBe(true);

      const postRequests: Array<{ url: string; body: RecordValue }> = [];
      article.on("request", (request) => {
        if (
          request.method() !== "POST" ||
          !request.url().includes("extension-captures")
        ) {
          return;
        }
        postRequests.push({
          url: request.url(),
          body: record(request.postDataJSON()),
        });
      });

      await article.locator('[data-fixture="quote"]').selectText();
      const cancelled = await triggerPopupCapture(article, context, id);
      await expect(
        cancelled.getByText(FIXTURE_QUOTE, { exact: true }),
      ).toBeVisible();
      await cancelled.getByRole("button", { name: /cancel/i }).click();
      await cancelled
        .waitForEvent("close", { timeout: 5_000 })
        .catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      expect(postRequests.length).toBe(0);

      await article.locator('[data-fixture="quote"]').selectText();
      const confirmation = await triggerPopupCapture(article, context, id);
      const confirmationUrl = new URL(confirmation.url());
      expect(confirmationUrl.origin).toBe(`chrome-extension://${id}`);
      expect(confirmationUrl.pathname).toBe("/confirm.html");
      expect(confirmationUrl.hash.length > 1).toBe(true);
      await expect(
        confirmation.getByText(FIXTURE_QUOTE, { exact: true }),
      ).toBeVisible();

      await chooseProject(confirmation, projectName);
      await confirmation
        .getByLabel("Speaker name", { exact: false })
        .fill("Avery Example");
      await confirmation
        .getByLabel("Speaker title", { exact: false })
        .fill("Field editor");
      await confirmation
        .getByLabel("Topics", { exact: false })
        .fill("Synthetic research");
      await confirmation
        .getByLabel(/note|intended use/i)
        .fill("Disposable fixture quote");

      const requestPromise = confirmation.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().includes("/extension/v1/projects/"),
      );
      await confirmation
        .getByRole("button", { name: "Save quote", exact: true })
        .click();
      const request = await requestPromise;
      const requestBody = record(request.postDataJSON());
      const response = await request.response();
      expect(response?.ok()).toBe(true);

      const quote = record(requestBody.quote);
      const surroundingWords = record(quote.surroundingWords);
      const metadata = record(requestBody.metadata);
      const top = record(requestBody.top);
      const passage = record(requestBody.passage);
      const highlight = record(quote.highlight);
      expect(requestBody.kind).toBe("quote");
      expect(quote.text === FIXTURE_QUOTE).toBe(true);
      expect(quote.speaker).toBe("Avery Example");
      expect(quote.speakerTitle).toBe("Field editor");
      expect(
        typeof surroundingWords.before === "string" &&
          surroundingWords.before.includes(FIXTURE_BEFORE),
      ).toBe(true);
      expect(
        typeof surroundingWords.after === "string" &&
          surroundingWords.after.includes(FIXTURE_AFTER),
      ).toBe(true);
      expect(metadata.title).toBe("Synthetic Field Notes");
      expect(metadata.authors).toEqual(["Avery Example"]);
      expect(metadata.publication).toBe("Synthetic Review");
      expect(validatePicture(top)).toBe(true);
      expect(validatePicture(passage)).toBe(true);
      expect(validateRectangles(highlight.rectangles)).toBe(true);

      const articleRequests = fixture.requests.filter(
        (path) => path === "/article",
      );
      expect(articleRequests.length).toBe(1);
      const endingScrollY = await article.evaluate(() => window.scrollY);
      expect(Math.abs(endingScrollY - originalScrollY)).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
      if (cleanupProfile) await rm(profile, { recursive: true, force: true });
      await rm(stagedExtensionPath, { recursive: true, force: true });
    }
  });
});
