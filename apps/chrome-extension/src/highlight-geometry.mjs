/**
 * Convert CSS viewport rectangles into lossless PNG pixel rectangles and the
 * normalized coordinates used by the Research quote contract.
 *
 * The caller must establish that the rectangles and PNG came from the same
 * active tab, navigation, viewport, and stable after-scroll paint.
 */
export function highlightFromVisibleRects(rectangles, viewport, raster) {
  const validSize = (size) =>
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0;
  if (
    !validSize(viewport) ||
    !validSize(raster) ||
    !Number.isInteger(raster.width) ||
    !Number.isInteger(raster.height) ||
    !Array.isArray(rectangles) ||
    rectangles.length < 1 ||
    rectangles.length > 200
  ) {
    throw new Error("Invalid highlight dimensions");
  }
  const pixel = rectangles.map((rect) => {
    const { left, top, width, height } = rect ?? {};
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      left < 0 ||
      top < 0 ||
      left + width > viewport.width ||
      top + height > viewport.height
    ) {
      throw new Error(
        "The passage is not fully visible in the captured viewport",
      );
    }
    const x1 = Math.floor((left * raster.width) / viewport.width);
    const y1 = Math.floor((top * raster.height) / viewport.height);
    const x2 = Math.ceil(((left + width) * raster.width) / viewport.width);
    const y2 = Math.ceil(((top + height) * raster.height) / viewport.height);
    if (
      x1 < 0 ||
      y1 < 0 ||
      x2 > raster.width ||
      y2 > raster.height ||
      x1 >= x2 ||
      y1 >= y2
    ) {
      throw new Error("Invalid screenshot rectangle");
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  });
  return {
    pixels: pixel,
    normalized: pixel.map((rect) => ({
      x: rect.x / raster.width,
      y: rect.y / raster.height,
      width: rect.width / raster.width,
      height: rect.height / raster.height,
    })),
  };
}

function decodeBase64(data) {
  if (typeof atob === "function") {
    const binary = atob(data);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  throw new Error("PNG decoding is unavailable");
}

export function pngDimensions(data, mimeType = "image/png") {
  if (mimeType.toLowerCase() !== "image/png" || typeof data !== "string") {
    throw new Error("Expected a PNG capture");
  }
  const bytes = decodeBase64(data);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("Invalid PNG capture");
  }
  const readUint32 = (offset) =>
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0;
  const ihdrLength = readUint32(8);
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (ihdrLength !== 13 || chunkType !== "IHDR")
    throw new Error("Invalid PNG header");
  const width = readUint32(16);
  const height = readUint32(20);
  if (
    !width ||
    !height ||
    width > 16_384 ||
    height > 16_384 ||
    width * height > 25_000_000
  )
    throw new Error("PNG dimensions exceed capture limits");
  return { width, height };
}
