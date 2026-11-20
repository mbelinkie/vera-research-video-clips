import { MAX_SCREENSHOT_BYTES } from "./capture-utils.mjs";
import { pngDimensions } from "./highlight-geometry.mjs";

const MAX_PIXELS = 25_000_000;

function pngBytes(capture) {
  return Uint8Array.from(atob(capture.data), (character) =>
    character.charCodeAt(0),
  );
}

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

// A shifted/animated page is less useful than a valid single screenshot.
// Compare a substantial overlapping region near the seam rather than relying
// solely on the requested scroll offset (which can lie on dynamic pages).
function stableOverlap(first, second, rect, shift, scale) {
  const left = Math.ceil((rect.left + (rect.right - rect.left) * 0.12) * scale);
  const right = Math.floor(
    (rect.right - (rect.right - rect.left) * 0.12) * scale,
  );
  const top = Math.ceil(rect.top * scale);
  const bottom = Math.floor(rect.bottom * scale);
  const overlap = bottom - top - shift;
  if (right - left < 12 || overlap < 24) return false;
  const probeBottom = bottom - Math.max(4, Math.round(4 * scale));
  const probeTop = Math.max(
    top + shift + 4,
    probeBottom - Math.min(120, overlap - 8),
  );
  if (probeBottom <= probeTop) return false;
  const width = right - left;
  const height = probeBottom - probeTop;
  const original = first.getImageData(left, probeTop, width, height).data;
  const moved = second.getImageData(left, probeTop - shift, width, height).data;
  const stride = Math.max(2, Math.floor(width / 72));
  let changed = 0;
  let compared = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += stride) {
      const index = 4 * (y * width + x);
      compared += 1;
      if (
        Math.abs(original[index] - moved[index]) > 28 ||
        Math.abs(original[index + 1] - moved[index + 1]) > 28 ||
        Math.abs(original[index + 2] - moved[index + 2]) > 28
      ) {
        changed += 1;
      }
    }
  }
  return compared > 0 && changed / compared < 0.12;
}

/**
 * Stitch one bounded scrolled viewport onto the original screenshot. Chrome's
 * documented tabs.captureVisibleTab() under activeTab captures the *visible*
 * viewport only; scrolling in the content script then capturing again avoids
 * debugger access and additional host permissions. The 30% overlap excludes
 * common sticky headers and allows a pixel stability check before joining.
 * https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab
 * https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
 */
export async function stitchTallTop(first, second, step, viewport) {
  if (
    !first ||
    !second ||
    first.width !== second.width ||
    first.height !== second.height ||
    !viewport ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !step ||
    !Number.isFinite(step.delta) ||
    !step.rect ||
    step.viewport?.width !== viewport.width ||
    step.viewport?.height !== viewport.height
  ) {
    return undefined;
  }
  const { rect, delta } = step;
  const { left, top, right, bottom } = rect;
  const dimensions = [left, top, right, bottom];
  if (
    !dimensions.every(Number.isFinite) ||
    left < 0 ||
    top < 0 ||
    right > viewport.width ||
    bottom > viewport.height ||
    right - left < 80 ||
    bottom - top < 100 ||
    delta < 40 ||
    delta > (bottom - top) * 0.71
  ) {
    return undefined;
  }
  const scale = first.width / viewport.width;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const shift = Math.round(delta * scale);
  const x = Math.round(left * scale);
  const rightPx = Math.round(right * scale);
  const bottomPx = Math.min(first.height, Math.round(bottom * scale));
  const sourceY = bottomPx - shift;
  const outputHeight = first.height + shift;
  if (
    shift < 1 ||
    sourceY < Math.ceil(top * scale) ||
    rightPx > first.width ||
    outputHeight > 16_384 ||
    first.width * outputHeight > MAX_PIXELS
  ) {
    return undefined;
  }

  let firstBitmap;
  let secondBitmap;
  try {
    firstBitmap = await createImageBitmap(
      new Blob([pngBytes(first)], { type: "image/png" }),
    );
    secondBitmap = await createImageBitmap(
      new Blob([pngBytes(second)], { type: "image/png" }),
    );
    if (
      firstBitmap.width !== first.width ||
      firstBitmap.height !== first.height ||
      secondBitmap.width !== second.width ||
      secondBitmap.height !== second.height
    ) {
      return undefined;
    }
    const output = new OffscreenCanvas(first.width, outputHeight);
    const background = new OffscreenCanvas(second.width, second.height);
    const outputContext = output.getContext("2d", { willReadFrequently: true });
    const secondContext = background.getContext("2d", {
      willReadFrequently: true,
    });
    if (!outputContext || !secondContext) return undefined;
    outputContext.drawImage(firstBitmap, 0, 0);
    secondContext.drawImage(secondBitmap, 0, 0);
    if (!stableOverlap(outputContext, secondContext, rect, shift, scale)) {
      return undefined;
    }
    // Insert the continuation before the original bottom border and footer.
    const belowPanel = first.height - bottomPx;
    if (belowPanel > 0) {
      outputContext.drawImage(
        firstBitmap,
        0,
        bottomPx,
        first.width,
        belowPanel,
        0,
        bottomPx + shift,
        first.width,
        belowPanel,
      );
    }
    outputContext.fillStyle = "#fff";
    outputContext.fillRect(0, bottomPx, first.width, shift);
    outputContext.drawImage(
      secondBitmap,
      x,
      sourceY,
      rightPx - x,
      shift,
      x,
      bottomPx,
      rightPx - x,
      shift,
    );
    const blob = await output.convertToBlob({ type: "image/png" });
    if (!blob || blob.size < 24 || blob.size > MAX_SCREENSHOT_BYTES) {
      return undefined;
    }
    const data = encodeBase64(new Uint8Array(await blob.arrayBuffer()));
    const size = pngDimensions(data);
    if (size.width !== first.width || size.height !== outputHeight) {
      return undefined;
    }
    return { data, ...size };
  } finally {
    firstBitmap?.close?.();
    secondBitmap?.close?.();
  }
}
