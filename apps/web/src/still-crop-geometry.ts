/** Normalized coordinates of a crop on the oriented, retained image. */
export type Crop = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const positiveSize = (size: Size) =>
  Number.isFinite(size.width) &&
  Number.isFinite(size.height) &&
  size.width > 0 &&
  size.height > 0;

const finitePoint = (point: Point) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const validCrop = (crop: Crop) =>
  finitePoint(crop) &&
  positiveSize(crop) &&
  crop.x >= 0 &&
  crop.y >= 0 &&
  crop.x + crop.width <= 1 &&
  crop.y + crop.height <= 1;

const validMinimum = (min: Point) =>
  finitePoint(min) && min.x > 0 && min.y > 0 && min.x <= 1 && min.y <= 1;

/** The actual pixels of an object-fit:contain image inside its DOM bounds. */
export function containedImageRect(box: Rect, natural: Size): Rect | undefined {
  if (
    !positiveSize(box) ||
    !positiveSize(natural) ||
    !Number.isFinite(box.left) ||
    !Number.isFinite(box.top)
  )
    return undefined;

  const scale = Math.min(
    box.width / natural.width,
    box.height / natural.height,
  );
  const width = natural.width * scale;
  const height = natural.height * scale;
  if (!positiveSize({ width, height })) return undefined;

  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** Clamp client coordinates to the visible raster, not the letterboxed element. */
export function normalizedPoint(
  client: Point,
  content: Rect,
): Point | undefined {
  if (
    !finitePoint(client) ||
    !positiveSize(content) ||
    !Number.isFinite(content.left) ||
    !Number.isFinite(content.top)
  )
    return undefined;

  return {
    x: clamp((client.x - content.left) / content.width, 0, 1),
    y: clamp((client.y - content.top) / content.height, 0, 1),
  };
}

/** New pointer selections must cover a source pixel and three display pixels. */
export function minimumPointerCrop(
  natural: Size,
  content: Rect,
): Point | undefined {
  if (!positiveSize(natural) || !positiveSize(content)) return undefined;
  return {
    x: Math.min(1, Math.max(1 / natural.width, 3 / content.width)),
    y: Math.min(1, Math.max(1 / natural.height, 3 / content.height)),
  };
}

/** Reject incomplete drags instead of replacing the previously saved crop. */
export function drawnCrop(a: Point, b: Point, min: Point): Crop | undefined {
  if (!finitePoint(a) || !finitePoint(b) || !validMinimum(min))
    return undefined;

  const left = clamp(Math.min(a.x, b.x), 0, 1);
  const top = clamp(Math.min(a.y, b.y), 0, 1);
  const right = clamp(Math.max(a.x, b.x), 0, 1);
  const bottom = clamp(Math.max(a.y, b.y), 0, 1);
  if (right - left < min.x || bottom - top < min.y) return undefined;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Move relative to the gesture-start crop so repeated moves do not drift. */
export function movedCrop(start: Crop, delta: Point): Crop | undefined {
  if (!validCrop(start) || !finitePoint(delta)) return undefined;
  return {
    ...start,
    x: clamp(start.x + delta.x, 0, 1 - start.width),
    y: clamp(start.y + delta.y, 0, 1 - start.height),
  };
}

/** Resize around the opposite corner, stopping at image edges and minimums. */
export function resizedCrop(
  start: Crop,
  corner: Corner,
  point: Point,
  min: Point,
): Crop | undefined {
  if (
    !validCrop(start) ||
    !finitePoint(point) ||
    !validMinimum(min) ||
    !(["nw", "ne", "sw", "se"] as const).includes(corner)
  )
    return undefined;

  // Preserve a precise, smaller numeric crop rather than enlarging it just
  // because a pointer gesture began. Newly drawn selections use the full min.
  const minWidth = Math.min(start.width, min.x);
  const minHeight = Math.min(start.height, min.y);
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const x = corner.endsWith("w")
    ? clamp(point.x, 0, right - minWidth)
    : start.x;
  const y = corner.startsWith("n")
    ? clamp(point.y, 0, bottom - minHeight)
    : start.y;
  const newRight = corner.endsWith("e")
    ? clamp(point.x, start.x + minWidth, 1)
    : right;
  const newBottom = corner.startsWith("s")
    ? clamp(point.y, start.y + minHeight, 1)
    : bottom;

  return {
    x,
    y,
    // Leave untouched numeric dimensions exact (including sub-pixel values).
    width: x === start.x && newRight === right ? start.width : newRight - x,
    height:
      y === start.y && newBottom === bottom ? start.height : newBottom - y,
  };
}
