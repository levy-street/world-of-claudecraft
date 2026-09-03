// The drawing-buffer readout the Options window prints under Render Quality:
// what the frame is rendered at versus what the display is. The renderer is
// the source (Renderer.perfStats().drawingBuffer, the allocated backing store
// bounded by the tier's DPR cap and pixel budget), main.ts registers it once
// at boot, and the options painter reads it when it builds the Graphics panel,
// the same singleton-read shape the panel's music toggle uses. Kept off
// OptionsHooks so the hud coordinator does not grow for one readout.

export interface DrawingBufferReadout {
  /** The allocated drawing buffer, in device pixels. */
  readonly width: number;
  readonly height: number;
  /** The display area the canvas covers at the live DPR, in device pixels. */
  readonly nativeWidth: number;
  readonly nativeHeight: number;
}

export interface DrawingBufferReadoutStats {
  /** CSS viewport size (Renderer.perfStats width/height). */
  readonly width: number;
  readonly height: number;
  readonly drawingBuffer: { readonly width: number; readonly height: number };
}

/** The readout from the renderer's perf stats plus the live device pixel ratio,
 *  which the caller injects (this module never reaches the browser itself). */
export function drawingBufferReadout(
  stats: DrawingBufferReadoutStats,
  pixelRatio: number,
): DrawingBufferReadout {
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return {
    width: Math.max(1, Math.round(stats.drawingBuffer.width)),
    height: Math.max(1, Math.round(stats.drawingBuffer.height)),
    nativeWidth: Math.max(1, Math.round(stats.width * dpr)),
    nativeHeight: Math.max(1, Math.round(stats.height * dpr)),
  };
}

type ReadoutSource = () => DrawingBufferReadout | null;

let source: ReadoutSource | null = null;

/** Register (or clear, with null) the live readout source. */
export function setDrawingBufferReadoutSource(next: ReadoutSource | null): void {
  source = next;
}

/** The current readout, or null before a renderer exists (the row then hides). */
export function readDrawingBuffer(): DrawingBufferReadout | null {
  return source ? source() : null;
}
