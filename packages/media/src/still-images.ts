import sharp, { type Metadata } from "sharp";

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StillImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};
export type PreparedStill = {
  original: StillImage;
  display: StillImage;
  thumbnail: StillImage;
};

export class InvalidStillImage extends Error {}

export const MAX_STILL_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const decodeOptions = {
  failOn: "warning",
  limitInputPixels: MAX_PIXELS,
} as const;

function sniff(bytes: Buffer): StillImage["mimeType"] {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new InvalidStillImage("Choose a JPEG, PNG or WebP image.");
}

function isAnimatedPng(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") break;
    offset += size + 12;
  }
  return false;
}

function cropPixels(crop: NormalizedCrop, width: number, height: number) {
  const { x, y, width: w, height: h } = crop;
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > 1 ||
    y + h > 1
  )
    throw new InvalidStillImage("Crop must fit within the image.");
  const left = Math.floor(x * width);
  const top = Math.floor(y * height);
  const right = Math.min(width, Math.ceil((x + w) * width));
  const bottom = Math.min(height, Math.ceil((y + h) * height));
  if (right <= left || bottom <= top)
    throw new InvalidStillImage("Crop must contain at least one pixel.");
  return { left, top, width: right - left, height: bottom - top };
}

function validateMetadata(
  metadata: Metadata,
  mimeType: StillImage["mimeType"],
  bytes: Buffer,
) {
  if (
    mimeType !== "image/" + metadata.format ||
    !metadata.width ||
    !metadata.height
  )
    throw new InvalidStillImage("The image format could not be verified.");
  if (metadata.width * metadata.height > MAX_PIXELS)
    throw new InvalidStillImage("This image exceeds the 25 megapixel limit.");
  if (
    (metadata.pages ?? 1) > 1 ||
    (mimeType === "image/png" && isAnimatedPng(bytes))
  )
    throw new InvalidStillImage("Choose a single-frame image.");
  return { width: metadata.width, height: metadata.height };
}

export async function prepareStill(
  bytes: Buffer,
  crop?: NormalizedCrop,
): Promise<PreparedStill> {
  if (bytes.byteLength > MAX_STILL_BYTES)
    throw new InvalidStillImage("This image exceeds the 20 MiB limit.");
  const mimeType = sniff(bytes);
  try {
    const input = sharp(bytes, decodeOptions);
    const size = validateMetadata(await input.metadata(), mimeType, bytes);
    const oriented = await input
      .autoOrient()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = oriented.info;
    const raster = sharp(oriented.data, {
      raw: { width, height, channels },
      limitInputPixels: MAX_PIXELS,
    });
    if (crop) raster.extract(cropPixels(crop, width, height));
    const full = await raster
      .webp({ lossless: true })
      .toBuffer({ resolveWithObject: true });
    if (full.data.length > MAX_STILL_BYTES)
      throw new InvalidStillImage(
        "The processed image exceeds the 20 MiB limit.",
      );
    const display: StillImage = {
      bytes: full.data,
      mimeType: "image/webp",
      width: full.info.width,
      height: full.info.height,
    };
    const thumb = await sharp(display.bytes, decodeOptions)
      .resize({
        width: 320,
        height: 320,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      original: crop ? display : { bytes, mimeType, ...size },
      display,
      thumbnail: {
        bytes: thumb.data,
        mimeType: "image/webp",
        width: thumb.info.width,
        height: thumb.info.height,
      },
    };
  } catch (error) {
    if (error instanceof InvalidStillImage) throw error;
    throw new InvalidStillImage(
      "The image could not be decoded within the supported image limits.",
    );
  }
}
