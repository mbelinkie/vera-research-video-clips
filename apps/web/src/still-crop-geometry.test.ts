import { describe, expect, it } from "vitest";

import {
  containedImageRect,
  drawnCrop,
  minimumPointerCrop,
  movedCrop,
  normalizedPoint,
  resizedCrop,
  type Crop,
  type Corner,
} from "./still-crop-geometry.ts";

describe("contained still image coordinates", () => {
  it("uses the offset raster inside a wide letterboxed image element", () => {
    const content = containedImageRect(
      { left: 120, top: 80, width: 600, height: 400 },
      { width: 1200, height: 400 },
    );
    expect(content).toEqual({ left: 120, top: 180, width: 600, height: 200 });
    expect(normalizedPoint({ x: 270, y: 230 }, content!)).toEqual({
      x: 0.25,
      y: 0.25,
    });
    expect(normalizedPoint({ x: 720, y: 380 }, content!)).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("accounts for horizontal letterboxing and responsive image changes", () => {
    const natural = { width: 400, height: 800 };
    expect(
      containedImageRect(
        { left: 20, top: 30, width: 300, height: 400 },
        natural,
      ),
    ).toEqual({ left: 70, top: 30, width: 200, height: 400 });

    const resized = containedImageRect(
      { left: 20, top: 30, width: 200, height: 200 },
      natural,
    )!;
    expect(resized).toEqual({ left: 70, top: 30, width: 100, height: 200 });
    expect(normalizedPoint({ x: 120, y: 130 }, resized)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("clamps outside image borders and rejects missing, invalid bounds", () => {
    const raster = { left: 50, top: 70, width: 200, height: 100 };
    expect(normalizedPoint({ x: -100, y: 500 }, raster)).toEqual({
      x: 0,
      y: 1,
    });
    expect(normalizedPoint({ x: Infinity, y: 100 }, raster)).toBeUndefined();
    expect(
      normalizedPoint({ x: 60, y: 90 }, { ...raster, top: NaN }),
    ).toBeUndefined();
    expect(
      containedImageRect(raster, { width: 0, height: 800 }),
    ).toBeUndefined();
    expect(
      containedImageRect({ ...raster, width: 0 }, { width: 10, height: 10 }),
    ).toBeUndefined();
    expect(
      containedImageRect(
        { ...raster, left: Infinity },
        { width: 10, height: 10 },
      ),
    ).toBeUndefined();
  });
});

describe("bounded still crop gestures", () => {
  const min = { x: 0.01, y: 0.02 };
  const start: Crop = { x: 0.2, y: 0.3, width: 0.4, height: 0.5 };

  it("uses both one source pixel and three displayed pixels as minimums", () => {
    expect(
      minimumPointerCrop(
        { width: 800, height: 400 },
        { left: 25, top: 60, width: 400, height: 200 },
      ),
    ).toEqual({ x: 0.0075, y: 0.015 });
    expect(
      minimumPointerCrop(
        { width: 2, height: 4 },
        { left: 0, top: 0, width: 400, height: 200 },
      ),
    ).toEqual({ x: 0.5, y: 0.25 });
    expect(
      minimumPointerCrop(
        { width: 1000, height: 1000 },
        { left: 0, top: 0, width: 1, height: 2 },
      ),
    ).toEqual({ x: 1, y: 1 });
    expect(
      minimumPointerCrop(
        { width: 800, height: 0 },
        { left: 0, top: 0, width: 400, height: 200 },
      ),
    ).toBeUndefined();
  });

  it("draws in either direction, clips to boundaries and ignores tiny drags", () => {
    expect(drawnCrop({ x: 0.75, y: 0.8 }, { x: 0.25, y: 0.3 }, min)).toEqual({
      x: 0.25,
      y: 0.3,
      width: 0.5,
      height: 0.5,
    });
    expect(drawnCrop({ x: -5, y: -3 }, { x: 2, y: 3 }, min)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(
      drawnCrop({ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.5 }, min),
    ).toBeUndefined();
    expect(
      drawnCrop({ x: 0.1, y: 0.1 }, { x: 0.105, y: 0.4 }, min),
    ).toBeUndefined();
    expect(
      drawnCrop({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.11 }, min),
    ).toBeUndefined();
    expect(drawnCrop({ x: 0.9, y: 0.9 }, { x: 5, y: 5 }, min)).toEqual({
      x: 0.9,
      y: 0.9,
      width: 0.09999999999999998,
      height: 0.09999999999999998,
    });
  });

  it("clamps movement without changing the original dimensions", () => {
    expect(movedCrop(start, { x: 2, y: -3 })).toEqual({
      ...start,
      x: 0.6,
      y: 0,
    });
    expect(movedCrop(start, { x: -2, y: 3 })).toEqual({
      ...start,
      x: 0,
      y: 0.5,
    });
    expect(movedCrop(start, { x: 0, y: 0 })).toEqual(start);
  });

  it.each([
    ["nw", { x: 0.1, y: 0.15 }, { x: 0.1, y: 0.15, width: 0.5, height: 0.65 }],
    ["ne", { x: 0.9, y: 0.15 }, { x: 0.2, y: 0.15, width: 0.7, height: 0.65 }],
    ["sw", { x: 0.1, y: 0.95 }, { x: 0.1, y: 0.3, width: 0.5, height: 0.65 }],
    ["se", { x: 0.9, y: 0.95 }, { x: 0.2, y: 0.3, width: 0.7, height: 0.65 }],
  ] as const)("keeps the opposite %s corner fixed", (corner, point, result) => {
    const actual = resizedCrop(start, corner as Corner, point, min)!;
    expect(actual.x).toBeCloseTo(result.x);
    expect(actual.y).toBeCloseTo(result.y);
    expect(actual.width).toBeCloseTo(result.width);
    expect(actual.height).toBeCloseTo(result.height);
  });

  it("stops handles at edges and never inverts below the minimum", () => {
    const northWest = resizedCrop(start, "nw", { x: -3, y: -2 }, min)!;
    expect(northWest.x).toBe(0);
    expect(northWest.y).toBe(0);
    expect(northWest.width).toBeCloseTo(0.6);
    expect(northWest.height).toBeCloseTo(0.8);
    const southEast = resizedCrop(start, "se", { x: 2, y: 2 }, min)!;
    expect(southEast.x).toBe(0.2);
    expect(southEast.y).toBe(0.3);
    expect(southEast.width).toBeCloseTo(0.8);
    expect(southEast.height).toBeCloseTo(0.7);
    const nw = resizedCrop(start, "nw", { x: 1, y: 1 }, min)!;
    expect(nw.x + nw.width).toBeCloseTo(0.6);
    expect(nw.y + nw.height).toBeCloseTo(0.8);
    expect(nw.width).toBeCloseTo(min.x);
    expect(nw.height).toBeCloseTo(min.y);
    const se = resizedCrop(start, "se", { x: -1, y: -1 }, min)!;
    expect(se.width).toBeCloseTo(min.x);
    expect(se.height).toBeCloseTo(min.y);
  });

  it("preserves precise typed crops smaller than the pointer minimum", () => {
    const precise: Crop = { x: 0.8, y: 0.8, width: 0.002, height: 0.003 };
    expect(resizedCrop(precise, "se", { x: 0, y: 0 }, min)).toEqual(precise);
  });

  it("rejects invalid geometry rather than emitting nonfinite/out-of-range crops", () => {
    expect(movedCrop({ ...start, x: -0.1 }, { x: 0, y: 0 })).toBeUndefined();
    expect(movedCrop(start, { x: NaN, y: 0 })).toBeUndefined();
    expect(movedCrop({ ...start, width: 0 }, { x: 0, y: 0 })).toBeUndefined();
    expect(
      resizedCrop(start, "sw", { x: Infinity, y: 0 }, min),
    ).toBeUndefined();
    expect(
      resizedCrop(start, "se", { x: 0.5, y: 0.5 }, { x: 0, y: 0.1 }),
    ).toBeUndefined();
    expect(
      drawnCrop({ x: 0.1, y: NaN }, { x: 0.5, y: 0.5 }, min),
    ).toBeUndefined();
    expect(
      drawnCrop({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 2, y: 0.1 }),
    ).toBeUndefined();
  });
});
