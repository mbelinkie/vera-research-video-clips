import { deflateSync, inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stitchTallTop } from "../src/tall-top.mjs";

const WIDTH = 240;
const HEIGHT = 160;
const VIEWPORT = { width: WIDTH, height: HEIGHT };

type Raster = { width: number; height: number; pixels: Uint8Array };

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(input: Buffer) {
  let crc = 0xffffffff;
  for (const value of input) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, body: Buffer) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, body])));
  return Buffer.concat([length, type, body, checksum]);
}

function encodePng({ width, height, pixels }: Raster) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(
      rows,
      y * (width * 4 + 1) + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit RGBA, no interlace
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(bytes: Buffer): Raster {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Bad PNG");
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
    }
    if (kind === "IDAT") compressed.push(payload);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if (rows[y * (width * 4 + 1)] !== 0)
      throw new Error("Unexpected PNG filter");
    rows.copy(
      pixels,
      y * width * 4,
      y * (width * 4 + 1) + 1,
      (y + 1) * (width * 4 + 1),
    );
  }
  return { pixels, width, height };
}

// Node has no OffscreenCanvas. This small raster adapter tests the real stitch
// algorithm and its produced PNG; the next pipeline phase verifies Chrome's
// native OffscreenCanvas and captureVisibleTab together.
class RasterCanvas {
  pixels: Uint8Array;
  fillStyle = "";

  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  getContext() {
    return this;
  }

  drawImage(image: Raster, ...args: number[]) {
    const [sx, sy, sw, sh, dx, dy, dw, dh] = (
      args.length === 2
        ? [
            0,
            0,
            image.width,
            image.height,
            args[0],
            args[1],
            image.width,
            image.height,
          ]
        : args
    ) as [number, number, number, number, number, number, number, number];
    for (let y = 0; y < dh; y += 1) {
      for (let x = 0; x < dw; x += 1) {
        const srcX = sx + Math.floor((x * sw) / dw);
        const srcY = sy + Math.floor((y * sh) / dh);
        const dstX = dx + x;
        const dstY = dy + y;
        if (
          srcX < 0 ||
          srcX >= image.width ||
          srcY < 0 ||
          srcY >= image.height ||
          dstX < 0 ||
          dstX >= this.width ||
          dstY < 0 ||
          dstY >= this.height
        )
          continue;
        this.pixels.set(
          image.pixels.subarray(
            4 * (srcY * image.width + srcX),
            4 * (srcY * image.width + srcX) + 4,
          ),
          4 * (dstY * this.width + dstX),
        );
      }
    }
  }

  fillRect(left: number, top: number, width: number, height: number) {
    if (this.fillStyle !== "#fff") throw new Error("Unexpected fill");
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) {
        this.pixels.set([255, 255, 255, 255], 4 * (y * this.width + x));
      }
    }
  }

  getImageData(left: number, top: number, width: number, height: number) {
    if (
      left < 0 ||
      top < 0 ||
      left + width > this.width ||
      top + height > this.height
    ) {
      throw new Error("Out-of-bounds pixel read");
    }
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const start = 4 * ((top + y) * this.width + left + x);
        data.set(this.pixels.subarray(start, start + 4), 4 * (y * width + x));
      }
    }
    return { data };
  }

  async convertToBlob() {
    return new Blob([encodePng(this)], { type: "image/png" });
  }
}

function installCanvas() {
  vi.stubGlobal("OffscreenCanvas", RasterCanvas);
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    return {
      ...decodePng(Buffer.from(await blob.arrayBuffer())),
      close: vi.fn(),
    };
  });
}

function rowColor(index: number): [number, number, number, number] {
  return [index % 256, (index * 3) % 256, (index * 7) % 256, 255];
}

async function screenshot(scroll: number, shifted = false) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const color =
        shifted && y >= 20 && y <= 45 ? [255, 0, 0, 255] : rowColor(y + scroll);
      pixels.set(color, 4 * (y * WIDTH + x));
    }
  }
  const data = encodePng({ pixels, width: WIDTH, height: HEIGHT });
  return { data: data.toString("base64"), width: WIDTH, height: HEIGHT };
}

async function pixel(capture: { data: string }, x: number, y: number) {
  const { pixels, width } = decodePng(Buffer.from(capture.data, "base64"));
  return [...pixels.subarray(4 * (y * width + x), 4 * (y * width + x) + 4)];
}

afterEach(() => vi.unstubAllGlobals());

describe("bounded screenshot top stitching", () => {
  it("appends exactly the new document pixels in one tall PNG", async () => {
    installCanvas();
    const result = await stitchTallTop(
      await screenshot(0),
      await screenshot(98),
      {
        delta: 98,
        rect: { left: 0, top: 0, right: WIDTH, bottom: HEIGHT },
        viewport: VIEWPORT,
      },
      VIEWPORT,
    );
    expect(result).toMatchObject({ width: WIDTH, height: 258 });
    expect(await pixel(result!, 100, 159)).toEqual(rowColor(159));
    expect(await pixel(result!, 100, 160)).toEqual(rowColor(160));
    expect(await pixel(result!, 100, 257)).toEqual(rowColor(257));
  });

  it("inserts new rows at the panel edge and keeps the original pixels below", async () => {
    installCanvas();
    const result = await stitchTallTop(
      await screenshot(0),
      await screenshot(80),
      {
        delta: 80,
        rect: { left: 40, top: 10, right: 200, bottom: 150 },
        viewport: VIEWPORT,
      },
      VIEWPORT,
    );
    expect(result).toMatchObject({ width: WIDTH, height: 240 });
    expect(await pixel(result!, 100, 149)).toEqual(rowColor(149));
    expect(await pixel(result!, 100, 150)).toEqual(rowColor(150));
    expect(await pixel(result!, 100, 229)).toEqual(rowColor(229));
    expect(await pixel(result!, 20, 200)).toEqual([255, 255, 255, 255]);
    expect(await pixel(result!, 100, 230)).toEqual(rowColor(150));
    expect(await pixel(result!, 20, 239)).toEqual(rowColor(159));
  });

  it("uses a single view for a shifted seam or out-of-range scroll", async () => {
    installCanvas();
    const first = await screenshot(0);
    const rect = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
    expect(
      await stitchTallTop(
        first,
        await screenshot(98, true),
        {
          delta: 98,
          rect,
          viewport: VIEWPORT,
        },
        VIEWPORT,
      ),
    ).toBeUndefined();
    expect(
      await stitchTallTop(
        first,
        await screenshot(15),
        {
          delta: 15,
          rect,
          viewport: VIEWPORT,
        },
        VIEWPORT,
      ),
    ).toBeUndefined();
    expect(
      await stitchTallTop(
        first,
        await screenshot(130),
        {
          delta: 130,
          rect,
          viewport: VIEWPORT,
        },
        VIEWPORT,
      ),
    ).toBeUndefined();
  });
});
