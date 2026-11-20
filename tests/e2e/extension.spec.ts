import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
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
        // Pregrant the synthetic Research server only. Source access still
        // requires invoking the toolbar action in the target tab.
        host_permissions: ["http://127.0.0.1/*"],
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
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--enable-unsafe-extension-debugging",
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

// Chrome for Testing runs the toolbar action against the actual source tab.
// The helper extension view clicks the button in Chrome's native action popup.
async function triggerPopupCapture(
  article: Page,
  context: BrowserContext,
  id: string,
  kind: "quote" | "page" | "youtube" = "quote",
) {
  const helper = await context.newPage();
  const browserCdp = await context.browser()!.newBrowserCDPSession();
  try {
    await helper.goto(`chrome-extension://${id}/popup.html`);
    await article.bringToFront();
    const { targetInfos } = await browserCdp.send("Target.getTargets", {
      filter: [{ type: "tab" }],
    });
    const targetInfo = targetInfos.find(
      (target) => target.url === article.url(),
    );
    if (!targetInfo)
      throw new Error("The synthetic article tab is unavailable.");
    await browserCdp.send("Extensions.triggerAction", {
      id,
      targetId: targetInfo.targetId,
    });
    await helper.waitForFunction((captureKind) => {
      const extension = (
        window as unknown as {
          chrome: {
            extension: { getViews(options: { type: string }): Window[] };
          };
        }
      ).chrome.extension;
      const popup = extension.getViews({ type: "popup" })[0];
      if (popup?.document.readyState !== "complete") return false;
      const button = popup.document.querySelector<HTMLButtonElement>(
        `button[data-kind="${captureKind}"]`,
      );
      if (!button) return false;
      button.click();
      return true;
    }, kind);
    try {
      return await waitForConfirmation(context, id);
    } catch {
      const state = await helper.evaluate(async () => {
        const api = (
          window as unknown as {
            chrome: {
              runtime: {
                sendMessage(
                  input: object,
                ): Promise<{ status?: { message?: string } }>;
              };
            };
          }
        ).chrome;
        return (await api.runtime.sendMessage({ type: "vera.capture.status" }))
          .status?.message;
      });
      throw new Error(
        `Chrome did not open ${kind} confirmation. ${state ?? "No capture status."}`,
      );
    }
  } finally {
    await browserCdp.detach();
    await helper.close().catch(() => undefined);
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

  test("captures an authenticated quote, page and YouTube playhead", async () => {
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
      await expect(article).toHaveURL(fixture.articleUrl);
      const reader = article.locator("main");
      await article
        .locator('[data-fixture="quote"]')
        .evaluate((element) =>
          element.scrollIntoView({ block: "center", behavior: "instant" }),
        );
      const originalScrollY = await reader.evaluate(
        (element) => element.scrollTop,
      );
      expect(originalScrollY).toBeGreaterThan(0);
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

      let capturePosts = 0;
      context.on("request", (request) => {
        if (
          request.method() !== "POST" ||
          !request.url().endsWith("/captures")
        ) {
          return;
        }
        capturePosts++;
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
      expect(capturePosts).toBe(0);

      await article.locator('[data-fixture="quote"]').selectText();
      const confirmation = await triggerPopupCapture(article, context, id);
      const confirmationUrl = new URL(confirmation.url());
      expect(confirmationUrl.protocol).toBe("chrome-extension:");
      expect(confirmationUrl.hostname).toBe(id);
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
      expect(response?.status()).toBe(201);

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

      const receipt = await response!.json();
      const projectId = new URL(request.url()).pathname.split("/")[4];
      const readBase =
        destinationUrl.origin +
        "/cloud-api/api/projects/" +
        projectId +
        "/extension-captures/" +
        receipt.captureId;
      const stored = await context.request.get(readBase);
      expect(stored.status()).toBe(200);
      const manifest = await stored.json();
      expect(manifest.assets).toHaveLength(2);
      for (const asset of manifest.assets) {
        const read = await context.request.get(
          readBase +
            "/assets/" +
            asset.role +
            "?revisionId=" +
            asset.revisionId,
        );
        expect(read.status()).toBe(200);
        const data = await read.body();
        expect(
          createHash("sha256").update(data).digest("hex") === asset.sha256,
        ).toBe(true);
        const submitted = asset.role === "top" ? top : passage;
        expect(data.equals(Buffer.from(String(submitted.data), "base64"))).toBe(
          true,
        );
        const { data: rgb, info } = await sharp(data)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let headlinePixels = 0;
        let selectionPixels = 0;
        for (let i = 0; i < rgb.length; i += info.channels) {
          if (rgb[i] === 0 && rgb[i + 1] === 140 && rgb[i + 2] === 240)
            headlinePixels++;
          if (rgb[i] === 0 && rgb[i + 1] === 255 && rgb[i + 2] === 0)
            selectionPixels++;
        }
        expect
          .soft(selectionPixels, asset.role + " picture has clean text")
          .toBe(0);
        if (asset.role === "top") {
          expect
            .soft(headlinePixels, "top picture includes the headline")
            .toBeGreaterThan(0);
        } else {
          expect(headlinePixels, "passage picture is a distinct view").toBe(0);
          // The synthetic article uses magenta ink only for the selected words.
          // Each stored line rectangle must actually contain that ink.
          for (const box of asset.pixelRectangles) {
            let ink = 0;
            for (let y = box.y; y < box.y + box.height; y++) {
              for (let x = box.x; x < box.x + box.width; x++) {
                const i = (y * info.width + x) * info.channels;
                if (rgb[i]! > 160 && rgb[i + 1]! < 80 && rgb[i + 2]! > 150)
                  ink++;
              }
            }
            expect(ink).toBeGreaterThan(0);
          }
          expect(asset.pixelRectangles.length).toBe(
            expectedSelection.rectangleCount,
          );
        }
      }

      const articleRequests = fixture.requests.filter(
        (path) => path === "/article",
      );
      expect(articleRequests.length).toBe(1);
      const endingScrollY = await reader.evaluate(
        (element) => element.scrollTop,
      );
      expect(Math.abs(endingScrollY - originalScrollY)).toBeLessThanOrEqual(1);
      await expect.poll(() => confirmation.isClosed()).toBe(true);
      expect(
        await article.evaluate(() => window.getSelection()?.toString()),
      ).toBe(FIXTURE_QUOTE);
      await article.evaluate(() => window.getSelection()?.removeAllRanges());
      const pageConfirmation = await triggerPopupCapture(
        article,
        context,
        id,
        "page",
      );
      await chooseProject(pageConfirmation, projectName);
      const savedPage = pageConfirmation.waitForResponse(
        (result) =>
          result.request().method() === "POST" &&
          result.url().endsWith("/captures"),
      );
      await pageConfirmation
        .getByRole("button", { name: "Save page", exact: true })
        .click();
      const pageResponse = await savedPage;
      expect(pageResponse.status()).toBe(201);
      const pageReceipt = await pageResponse.json();
      expect(pageReceipt.sourceId).toBe(receipt.sourceId);
      expect(pageReceipt.itemId).toBeUndefined();
      expect(
        pageReceipt.assets.map((asset: { role: string }) => asset.role).sort(),
      ).toEqual(["passage", "top"]);
      await pageConfirmation.getByRole("button", { name: "Close" }).click();

      const watchUrl = "https://www.youtube.com/watch?v=VeraTest079";
      // Five seconds of silent 8 kHz mono PCM give Chrome a real, seekable clock.
      const wave = Buffer.alloc(44 + 5 * 8_000 * 2);
      wave.write("RIFF", 0);
      wave.writeUInt32LE(wave.length - 8, 4);
      wave.write("WAVEfmt ", 8);
      wave.writeUInt32LE(16, 16);
      wave.writeUInt16LE(1, 20);
      wave.writeUInt16LE(1, 22);
      wave.writeUInt32LE(8_000, 24);
      wave.writeUInt32LE(16_000, 28);
      wave.writeUInt16LE(2, 32);
      wave.writeUInt16LE(16, 34);
      wave.write("data", 36);
      wave.writeUInt32LE(wave.length - 44, 40);
      await context.route(watchUrl, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><title>Synthetic YouTube player</title>
            <div class="html5-video-player">
              <video width="320" height="180" src="data:audio/wav;base64,${wave.toString("base64")}"></video>
              <div class="ytp-ad-player-overlay" hidden></div>
            </div>`,
        }),
      );
      const watch = await context.newPage();
      await watch.goto(watchUrl);
      const player = watch.locator("video");
      await expect
        .poll(() =>
          player.evaluate((video: HTMLVideoElement) => video.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await player.evaluate((video: HTMLVideoElement) => {
        video.currentTime = 3.125;
      });
      await expect
        .poll(() =>
          player.evaluate(
            (video: HTMLVideoElement) =>
              !video.seeking && video.readyState >= 2,
          ),
        )
        .toBe(true);
      const videoConfirmation = await triggerPopupCapture(
        watch,
        context,
        id,
        "youtube",
      );
      const time = videoConfirmation.getByRole("checkbox", {
        name: "Include 0:03",
      });
      await expect(time).toBeEnabled();
      await expect(time).not.toBeChecked();
      await videoConfirmation.getByRole("button", { name: "Cancel" }).click();
      await expect.poll(() => videoConfirmation.isClosed()).toBe(true);

      await watch.locator(".html5-video-player").evaluate((element) => {
        element.classList.add("ad-showing");
      });
      const adConfirmation = await triggerPopupCapture(
        watch,
        context,
        id,
        "youtube",
      );
      await expect(
        adConfirmation.getByRole("checkbox", { name: /time unavailable/i }),
      ).toBeDisabled();
    } finally {
      await context.close();
      if (cleanupProfile) await rm(profile, { recursive: true, force: true });
      await rm(stagedExtensionPath, { recursive: true, force: true });
    }
  });
});
