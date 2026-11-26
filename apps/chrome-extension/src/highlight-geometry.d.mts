export interface VisibleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface HighlightGeometry {
  pixels: Array<{ x: number; y: number; width: number; height: number }>;
  normalized: Array<{ x: number; y: number; width: number; height: number }>;
}

export function highlightFromVisibleRects(
  rectangles: VisibleRect[],
  viewport: Size,
  raster: Size,
): HighlightGeometry;

export function pngDimensions(data: string, mimeType?: string): Size;
