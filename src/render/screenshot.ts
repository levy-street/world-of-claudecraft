// Pure, DOM-free screenshot geometry so the scaling math is unit-testable without
// a WebGL context. The thin canvas consumer is Renderer.captureScreenshot.

export interface Dims {
  w: number;
  h: number;
}

// Fit (w,h) within a square of `maxEdge` on the longest side, never upscaling.
// Returns integer dimensions >= 1. Non-finite/zero inputs collapse to 1x1 so a
// caller never produces a degenerate canvas.
export function downscaleDims(w: number, h: number, maxEdge: number): Dims {
  const sw = Number.isFinite(w) && w > 0 ? w : 1;
  const sh = Number.isFinite(h) && h > 0 ? h : 1;
  const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : 1;
  const longest = Math.max(sw, sh);
  const scale = longest > edge ? edge / longest : 1;
  return {
    w: Math.max(1, Math.round(sw * scale)),
    h: Math.max(1, Math.round(sh * scale)),
  };
}
