// The bug-report screenshot of the live scene, the thin canvas consumer of
// screenshot.ts's geometry, lifted out of renderer.ts: the renderer hands in
// its one-frame draw and the draw-stat discard, this owns the readback.
//
// The main WebGLRenderer is created WITHOUT preserveDrawingBuffer (that costs
// memory on the hot path), so the colour buffer is valid only until control
// returns to the browser and it composites. One fresh frame is therefore
// rendered and read back synchronously in the SAME call, before yielding,
// then downscaled onto a 2D canvas. JPEG compression is deliberately
// asynchronous: toDataURL took ~18ms at 1280x720 and blocked the bug-report
// menu. Returns null on any failure (lost context, tainted canvas) so the
// caller can degrade gracefully.

import { canvasDataUrlAsync } from './canvas_data_url';
import { downscaleDims } from './screenshot';

export interface ScreenshotCaptureHost {
  /** The renderer's canvas, read right after `draw()`. */
  domElement: HTMLCanvasElement;
  /** Render one fresh frame synchronously. */
  draw(): void;
  /** Keep the out-of-band draw out of the next frame's draw stats; runs on
   *  the throw path too. */
  discardDraw(): void;
}

export async function captureRendererScreenshot(
  host: ScreenshotCaptureHost,
  maxEdge: number,
  quality: number,
): Promise<string | null> {
  try {
    host.draw();
    const gl = host.domElement;
    const dims = downscaleDims(gl.width, gl.height, maxEdge);
    const out = document.createElement('canvas');
    out.width = dims.w;
    out.height = dims.h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(gl, 0, 0, dims.w, dims.h);
    return await canvasDataUrlAsync(out, 'image/jpeg', quality);
  } catch {
    return null;
  } finally {
    host.discardDraw();
  }
}
