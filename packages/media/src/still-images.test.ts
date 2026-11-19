import sharp from "sharp";
import { expect, it } from "vitest";
import { InvalidStillImage, prepareStill } from "./still-images.ts";

it("keeps original bytes, normalizes EXIF orientation and bounds the thumbnail", async () => {
  const jpeg = await sharp({
    create: { width: 480, height: 240, channels: 3, background: "orange" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const result = await prepareStill(jpeg);
  expect(result.original).toMatchObject({
    bytes: jpeg,
    width: 480,
    height: 240,
  });
  expect(result.display).toMatchObject({ width: 240, height: 480 });
  expect(result.thumbnail).toMatchObject({ width: 160, height: 320 });
  expect(
    (await sharp(result.display.bytes).metadata()).orientation,
  ).toBeUndefined();
});

it("crops the oriented pixels and preserves transparency", async () => {
  const rgba = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 255, 0, 0, 255, 0, 255, 0, 128,
  ]);
  const png = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } })
    .png()
    .toBuffer();
  const { original } = await prepareStill(png, {
    x: 0.5,
    y: 0,
    width: 0.5,
    height: 1,
  });
  const out = await sharp(original.bytes).raw().toBuffer();
  expect(out).toEqual(Buffer.from([0, 255, 0, 128, 0, 255, 0, 128]));
  await expect(
    prepareStill(png, { x: 0.5, y: 0, width: 0.6, height: 1 }),
  ).rejects.toThrow("Crop must fit");
});

it("rejects unsupported and corrupt inputs, and images above the decoded pixel limit", async () => {
  await expect(prepareStill(Buffer.from("<svg/>"))).rejects.toThrow(
    InvalidStillImage,
  );
  await expect(prepareStill(Buffer.from([255, 216, 255]))).rejects.toThrow(
    InvalidStillImage,
  );

  const bigPng = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(prepareStill(bigPng)).rejects.toThrow(InvalidStillImage);
});
