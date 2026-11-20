export interface CapturePng {
  data: string;
  width: number;
  height: number;
}

export interface CaptureStep {
  delta: number;
  rect: { left: number; top: number; right: number; bottom: number };
  viewport: { width: number; height: number };
}

export function stitchTallTop(
  first: CapturePng,
  second: CapturePng,
  step: CaptureStep,
  viewport: { width: number; height: number },
): Promise<CapturePng | undefined>;
