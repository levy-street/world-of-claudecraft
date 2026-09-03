// Thin browser consumer of drawing_buffer_budget_core.ts: reads the live DPR
// and the active GFX policy so the renderer's resolution wiring has ONE base
// ratio (applyResolution, the dynamic-resolution region rect and the boot
// setPixelRatio all take it from here). The math and its pins live in the core.
import {
  type DrawingBufferBound,
  type DrawingBufferRatio,
  drawingBufferRatio,
} from './drawing_buffer_budget_core';
import { GFX } from './gfx';
import { pixelBudgetDisabled } from './render_dev_flags';

export interface CssViewport {
  readonly width: number;
  readonly height: number;
}

/** The base pixel ratio for a CSS viewport: the live DPR under the tier's cap and
 *  its drawing-buffer pixel budget, before the Render Quality slider. */
export function resolveDrawingBufferRatio(viewport: CssViewport): DrawingBufferRatio {
  return drawingBufferRatio({
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    devicePixelRatio: window.devicePixelRatio,
    pixelRatioCap: GFX.pixelRatioCap,
    maxDrawingBufferPixels: pixelBudgetDisabled()
      ? Number.POSITIVE_INFINITY
      : GFX.maxDrawingBufferPixels,
  });
}

/** What the drawing buffer actually is, and what settled it: the ?perf overlay
 *  and the Options readout print this, the perf reporter records it. */
export interface DrawingBufferPerfStats {
  /** The allocated buffer (the canvas backing store), in device pixels. */
  readonly width: number;
  readonly height: number;
  /** The tier's pixel budget in force; 0 under ?pixelbudget=off (a finite
   *  sentinel: this block rides the fleet perf report as JSON). */
  readonly maxPixels: number;
  readonly bound: DrawingBufferBound;
  /** True when the budget, not the DPR or the cap, settled the allocation. */
  readonly budgetBound: boolean;
}

export function drawingBufferPerfStats(
  canvas: { readonly width: number; readonly height: number },
  viewport: CssViewport,
): DrawingBufferPerfStats {
  const resolved = resolveDrawingBufferRatio(viewport);
  return {
    width: canvas.width,
    height: canvas.height,
    maxPixels: pixelBudgetDisabled() ? 0 : GFX.maxDrawingBufferPixels,
    bound: resolved.bound,
    budgetBound: resolved.budgetBound,
  };
}
