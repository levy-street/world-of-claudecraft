// Frame-time sparkline: a testable pure-geometry core + a thin canvas painter.
//
// Lifted out of perf_overlay.ts so the sample->coordinate mapping (auto-scaled
// vertical range, target baseline, point layout) is unit-testable without a
// canvas. perf_overlay.ts keeps only the DPR-aware backing-store sizing and hands
// the 2D context here.

import { DEFAULT_PERF_FG_RGB, rgbaFromHex } from './perf_overlay_model';

export interface FrameGraphPoint {
  x: number;
  y: number;
}

export interface FrameGraphGeometry {
  /** The vertical scale ceiling (ms) the line is normalized against. */
  maxMs: number;
  /** The y of the target (e.g. 60fps) baseline. */
  baselineY: number;
  /** One point per sample, oldest->newest, in CSS pixels. */
  points: FrameGraphPoint[];
}

/** Wild stalls are clamped so normal variance stays legible. */
export const MAX_VISIBLE_MS = 100;

export interface FrameGraphCanvasMetrics {
  /** HiDPI backing-store dimensions (device pixels) for `canvas.width/height`. */
  pxW: number;
  pxH: number;
  /** Device-pixel-ratio actually used (clamped to 2 to bound memory). */
  dpr: number;
}

/** Device-pixel backing-store size for a measured CSS width/height. The canvas's
 *  *display* width is deliberately left to CSS (`width:100%`) so it follows its
 *  panel rather than pinning it: writing an absolute px display width once caused
 *  the sparkline to prop the shrink-wrapped overlay open, leaving the graph stuck
 *  at the expanded width when metrics were removed. Pure: no canvas, no DOM. */
export function frameGraphCanvasMetrics(cssW: number, cssH: number, devicePixelRatio: number): FrameGraphCanvasMetrics {
  const dpr = Math.min(2, devicePixelRatio > 0 ? devicePixelRatio : 1);
  return {
    pxW: Math.max(1, Math.round(cssW * dpr)),
    pxH: Math.max(1, Math.round(cssH * dpr)),
    dpr,
  };
}

/** Map frame-time samples (ms, oldest->newest) to sparkline coordinates. The
 *  vertical range auto-scales from 2x target up to the worst sample, capped at
 *  MAX_VISIBLE_MS. Pure: no canvas, no DOM. */
export function frameGraphGeometry(
  samples: readonly number[], targetMs: number, cssW: number, cssH: number,
): FrameGraphGeometry {
  const n = samples.length;
  let maxMs = targetMs * 2;
  for (const ms of samples) if (ms > maxMs) maxMs = ms;
  maxMs = Math.min(maxMs, MAX_VISIBLE_MS);
  const safeMax = maxMs > 0 ? maxMs : 1;
  const yOf = (ms: number): number => cssH - 1 - (Math.min(ms, safeMax) / safeMax) * (cssH - 2);
  const xOf = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * cssW);
  const points: FrameGraphPoint[] = [];
  for (let i = 0; i < n; i++) points.push({ x: xOf(i), y: yOf(samples[i]) });
  return { maxMs, baselineY: yOf(targetMs), points };
}

export interface PaintFrameGraphOpts {
  samples: readonly number[];
  targetMs: number;
  cssW: number;
  cssH: number;
  /** Accent color (hex #rrggbb); the baseline/fill/line use alpha variants. */
  color: string;
}

/** Draw the sparkline into an already-sized 2D context (CSS-pixel transform set
 *  by the caller). No-op for fewer than two points. */
export function paintFrameTimeGraph(ctx: CanvasRenderingContext2D, o: PaintFrameGraphOpts): void {
  const { cssW, cssH, color } = o;
  ctx.clearRect(0, 0, cssW, cssH);
  const { points, baselineY } = frameGraphGeometry(o.samples, o.targetMs, cssW, cssH);
  if (points.length < 2) return;

  // Target (e.g. 60fps) baseline.
  ctx.strokeStyle = withAlpha(color, 0.28);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, baselineY);
  ctx.lineTo(cssW, baselineY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under the frame-time line.
  ctx.beginPath();
  ctx.moveTo(0, cssH);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(cssW, cssH);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.14);
  ctx.fill();

  // The frame-time line itself.
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = withAlpha(color, 0.85);
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

/** Accent color + alpha, falling back to the default gold when the hex is bad. */
function withAlpha(hex: string, alpha: number): string {
  return rgbaFromHex(hex, alpha, DEFAULT_PERF_FG_RGB);
}
