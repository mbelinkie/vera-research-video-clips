import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
const ownerId = "019fbb95-cd76-7920-93fa-e23ba755ee36";
const parentId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
const childId = "019fbb95-cd76-7920-93fa-e23ba755ee45";
const sourceId = "019fbb95-cd76-7920-93fa-e23ba755ee43";
const now = "2026-11-20T12:00:00.000Z";

type Crop = { x: number; y: number; width: number; height: number };

function item(id: string, title: string) {
  return {
    id,
    kind: "still",
    projectId,
    sourceId,
    createdBy: ownerId,
    notes: "",
    topics: ["Research", "Synthetic"],
    content: {
      title,
      credit: "Fixture photographer",
      licence: "CC BY 4.0",
      usageNote: "Generated test image",
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function savedImage() {
  // A tall, already-kept image produces substantial horizontal letterboxing
  // under object-fit: contain. No external image URLs or real account data.
  const pixels = Buffer.alloc(100 * 300 * 4);
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 100; x++) {
      const index = (y * 100 + x) * 4;
      pixels[index] = x < 50 ? 235 : 25;
      pixels[index + 1] = y < 150 ? 90 : 200;
      pixels[index + 2] = 40;
      pixels[index + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width: 100, height: 300, channels: 4 } })
    .png()
    .toBuffer();
}

async function connectSavedStill(
  page: Page,
  options: { failFirstSave?: boolean } = {},
) {
  const bytes = await savedImage();
  const writes: Array<{
    idempotencyKey: string;
    crop: Crop;
    [key: string]: unknown;
  }> = [];
  await page.route("**/cloud-api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/cloud-api", "");
    if (path === "/api/projects")
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Fixture project",
            description: "",
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    if (path === `/api/projects/${projectId}/items`)
      return route.fulfill({ json: [item(parentId, "Synthetic saved still")] });
    if (path === `/api/projects/${projectId}/sources`)
      return route.fulfill({ json: [] });
    if (path === `/api/projects/${projectId}/sources/${sourceId}`)
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "missing", message: "Not present", retryable: false },
        },
      });
    if (
      path === `/api/projects/${projectId}/stills/${parentId}/crop` &&
      request.method() === "POST"
    ) {
      writes.push(request.postDataJSON());
      if (options.failFirstSave && writes.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "retry",
              message: "Temporary storage failure",
              retryable: true,
            },
          },
        });
      return route.fulfill({
        status: 201,
        json: item(childId, "Synthetic saved still crop"),
      });
    }
    if (
      path.startsWith(`/api/projects/${projectId}/stills/`) &&
      path.endsWith("/assets/display")
    ) {
      return route.fulfill({ body: bytes, contentType: "image/png" });
    }
    if (
      path.startsWith(`/api/projects/${projectId}/stills/`) &&
      path.endsWith("/assets/thumbnail")
    )
      return route.fulfill({ body: bytes, contentType: "image/png" });
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "not_found",
          message: "Fixture route unavailable",
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
  await page.getByRole("button", { name: "Open stills" }).click();
  await page
    .getByRole("button", { name: /Synthetic saved still/ })
    .first()
    .click();
  return writes;
}

function coordinates(page: Page) {
  const editor = page.locator(".stills-import-panel");
  return {
    left: editor.getByRole("spinbutton", { name: "Left (x)" }),
    top: editor.getByRole("spinbutton", { name: "Top (y)" }),
    width: editor.getByRole("spinbutton", { name: "Width" }),
    height: editor.getByRole("spinbutton", { name: "Height" }),
  };
}

async function expectCrop(page: Page, expected: Crop, tolerance = 0.015) {
  const wanted = [expected.x, expected.y, expected.width, expected.height];
  await expect
    .poll(async () => {
      const { numeric, css } = await page
        .locator(".stills-crop-editor")
        .evaluate((editor) => {
          const numeric = Array.from(
            editor.querySelectorAll<HTMLInputElement>(
              ".stills-crop-coordinates input",
            ),
          ).map((input) => Number(input.value));
          const box = editor.querySelector<HTMLElement>(".stills-crop-box");
          const css = box
            ? [
                box.style.left,
                box.style.top,
                box.style.width,
                box.style.height,
              ].map((value) => parseFloat(value) / 100)
            : [];
          return { numeric, css };
        });
      return (
        numeric.length === 4 &&
        css.length === 4 &&
        numeric.every((value, i) => Math.abs(value - wanted[i]!) < tolerance) &&
        css.every((value, i) => Math.abs(value - numeric[i]!) < 0.00001)
      );
    })
    .toBe(true);
}

async function drag(
  page: Page,
  a: [number, number],
  b: [number, number],
  surface: { x: number; y: number; width: number; height: number },
) {
  await page.mouse.move(
    surface.x + a[0] * surface.width,
    surface.y + a[1] * surface.height,
  );
  await page.mouse.down();
  await page.mouse.move(
    surface.x + b[0] * surface.width,
    surface.y + b[1] * surface.height,
    { steps: 6 },
  );
  await page.mouse.up();
}

test("draw, move and corner-resize a contained saved still; keyboard and failed-save retry use one crop", async ({
  page,
}) => {
  test.setTimeout(90_000); // Real browser image decode and gestures on slower CI hosts.
  const writes = await connectSavedStill(page, { failFirstSave: true });
  await page.getByRole("button", { name: "Crop this still" }).click();
  const surface = page.locator(".stills-crop-surface");
  await expect(surface).toBeVisible();
  await surface.scrollIntoViewIfNeeded();
  const image = page.locator(".stills-crop-preview img");
  const imageBox = (await image.boundingBox())!;
  const bounds = (await surface.boundingBox())!;
  expect(bounds.width).toBeLessThan(imageBox.width / 2);
  expect(bounds.x - imageBox.x).toBeGreaterThan(60);
  expect(
    Math.abs(bounds.x + bounds.width / 2 - (imageBox.x + imageBox.width / 2)),
  ).toBeLessThan(2);
  await expectCrop(page, { x: 0, y: 0, width: 1, height: 1 });

  await drag(page, [0.1, 0.2], [0.6, 0.65], bounds);
  await expectCrop(page, { x: 0.1, y: 0.2, width: 0.5, height: 0.45 });
  await drag(page, [0.3, 0.4], [0.4, 0.45], bounds);
  await expectCrop(page, { x: 0.2, y: 0.25, width: 0.5, height: 0.45 });
  await drag(page, [0.7, 0.7], [0.8, 0.78], bounds);
  await expectCrop(page, { x: 0.2, y: 0.25, width: 0.6, height: 0.53 });

  // Browser number-input arrow editing and the rectangle share React state.
  const width = coordinates(page).width;
  await width.focus();
  await width.press("ArrowDown");
  await expectCrop(page, { x: 0.2, y: 0.25, width: 0.59, height: 0.53 });
  expect(
    await page
      .locator(".stills-import-panel")
      .evaluate((form) => (form as HTMLFormElement).checkValidity()),
  ).toBe(true);
  await page.getByRole("button", { name: "Save cropped still" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary storage failure" }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    title: "Synthetic saved still crop",
    topics: ["Research", "Synthetic"],
    credit: "Fixture photographer",
    licence: "CC BY 4.0",
    usageNote: "Generated test image",
  });
  expect(writes[0]).not.toHaveProperty("pageUrl");
  await expectCrop(page, { x: 0.2, y: 0.25, width: 0.59, height: 0.53 });
  await page.getByRole("button", { name: "Save cropped still" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Still saved" }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[1]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  for (const key of ["x", "y", "width", "height"] as const)
    expect(writes[1]!.crop[key]).toBeCloseTo(
      { x: 0.2, y: 0.25, width: 0.59, height: 0.53 }[key],
      2,
    );
  await expect(
    page.getByRole("button", { name: /Synthetic saved still crop/ }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: /Synthetic saved still/ }).first(),
  ).toBeVisible();
});

test("tiny drag, cancel and unavailable kept image cannot submit a crop", async ({
  page,
}) => {
  const writes = await connectSavedStill(page);
  await page.getByRole("button", { name: "Crop this still" }).click();
  const surface = page.locator(".stills-crop-surface");
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  await drag(page, [0.3, 0.4], [0.301, 0.401], bounds);
  await expectCrop(page, { x: 0, y: 0, width: 1, height: 1 });
  await drag(page, [0.2, 0.25], [0.6, 0.8], bounds);
  await expectCrop(page, { x: 0.2, y: 0.25, width: 0.4, height: 0.55 });
  await page.getByRole("button", { name: "Cancel crop" }).click();
  await expect(
    page.getByRole("heading", { name: "Save a new still" }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Crop this still" }).click();
  await expectCrop(page, { x: 0, y: 0, width: 1, height: 1 });

  // A failed authenticated display load never falls back to an external image.
  const bad = page.locator(".stills-crop-preview");
  await page.route(
    `**/cloud-api/api/projects/${projectId}/stills/${parentId}/assets/display`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "gone", message: "Gone", retryable: false } },
      }),
  );
  await page.getByRole("button", { name: "Close stills" }).click();
  await page.getByRole("button", { name: "Open stills" }).click();
  await page
    .getByRole("button", { name: /Synthetic saved still/ })
    .first()
    .click();
  await expect(page.getByText("Saved preview unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crop this still" }),
  ).toBeDisabled();
  await expect(bad.locator(".stills-crop-surface")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
