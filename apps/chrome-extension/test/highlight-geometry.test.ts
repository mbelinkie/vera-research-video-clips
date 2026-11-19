import { describe, expect, it } from "vitest";
import {
  highlightFromVisibleRects,
  pngDimensions,
} from "../src/highlight-geometry.mjs";

describe("browser-supplied quote geometry", () => {
  const viewport = { width: 800, height: 600 };
  const raster = { width: 1600, height: 1200 };

  it("maps CSS rectangles to decoded PNG pixels without assuming devicePixelRatio", () => {
    const result = highlightFromVisibleRects(
      [{ left: 200, top: 300, width: 200, height: 60 }],
      viewport,
      raster,
    );
    expect(result.pixels).toEqual([
      { x: 400, y: 600, width: 400, height: 120 },
    ]);
    expect(result.normalized).toEqual([
      { x: 0.25, y: 0.5, width: 0.25, height: 0.1 },
    ]);
  });

  it("retains separate rectangles for wrapped lines and rounds out fractional pixels", () => {
    const result = highlightFromVisibleRects(
      [
        { left: 200.2, top: 300.1, width: 200.1, height: 20.2 },
        { left: 50.1, top: 320.2, width: 100.2, height: 20.2 },
      ],
      viewport,
      raster,
    );
    expect(result.pixels).toHaveLength(2);
    expect(result.pixels[0]).toEqual({
      x: 400,
      y: 600,
      width: 401,
      height: 41,
    });
  });

  it("fails closed on clipped, missing, NaN, negative, and excessive geometry", () => {
    for (const rectangles of [
      [],
      [{ left: 790, top: 20, width: 30, height: 10 }],
      [{ left: 3, top: 2, width: Number.NaN, height: 5 }],
      [{ left: -1, top: 10, width: 4, height: 4 }],
    ]) {
      expect(() =>
        highlightFromVisibleRects(rectangles, viewport, raster),
      ).toThrow();
    }
    expect(() =>
      highlightFromVisibleRects(
        Array.from({ length: 201 }, () => ({
          left: 1,
          top: 1,
          width: 2,
          height: 2,
        })),
        viewport,
        raster,
      ),
    ).toThrow();
  });

  it("uses the actual PNG IHDR dimensions", () => {
    const header = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2,
      0, 0, 0, 3,
    ]);
    const encoded = btoa(String.fromCharCode(...header));
    expect(pngDimensions(encoded)).toEqual({ width: 2, height: 3 });
    expect(() => pngDimensions("not-a-png")).toThrow();
  });
});
