// Thin browser consumer of drawing_buffer_budget_core.ts: reads the live DPR
// and the active GFX policy so the renderer's resolution wiring has ONE base
// ratio (applyResolution, the dynamic-resolution region rect and the boot
// setPixelRatio all take it from here). The math and its pins live in the core.
import { type DrawingBufferRatio, drawingBufferRatio } from './drawing_buffer_budget_core';
import { GFX } from './gfx';

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
    maxDrawingBufferPixels: GFX.maxDrawingBufferPixels,
  });
}
