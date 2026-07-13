export interface RendererViewportSnapshot {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface RendererViewportResize {
  sizeChanged: boolean;
  resolutionChanged: boolean;
}

export function resolveViewportResize(
  current: RendererViewportSnapshot,
  next: RendererViewportSnapshot,
): RendererViewportResize {
  const sizeChanged = current.width !== next.width || current.height !== next.height;
  const pixelRatioChanged = Math.abs(current.pixelRatio - next.pixelRatio) >= 0.001;
  return { sizeChanged, resolutionChanged: sizeChanged || pixelRatioChanged };
}
