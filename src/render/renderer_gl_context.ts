// The world canvas's WebGL2 context, created here rather than by three.
//
// three ALWAYS asks for `alpha: true` in the attributes it passes to
// canvas.getContext (three.module.js, WebGLRenderer's context block): its own
// `alpha` parameter only decides the default clear alpha, never what the context
// is created with. So the world canvas has always been a TRANSLUCENT surface,
// even though every pixel this renderer writes has alpha 1 (the composer's grade
// pass emits vec4(c, 1.0), the direct path clears opaque) and it sits over an
// opaque page (html, body { background: #000 } in src/styles/base.css) at
// z-index 0 with the loading curtain, the launcher shell and every HUD overlay
// as DOM siblings ABOVE it. Nothing has ever looked through the canvas.
//
// A translucent canvas is not free: Chrome's compositor keeps such a layer on
// the blended path instead of promoting it to an opaque copy or a hardware
// overlay, which on Windows is a per-frame full-screen composite cost the page
// gets nothing for. Creating the context ourselves with `alpha: false` is the
// whole fix; every other attribute mirrors three's own defaults for the
// parameters the renderer passes, so a supplied context and a three-created one
// differ in exactly one bit.
//
// Fail-soft by construction: if the browser refuses the attributes, or hands
// back a context that still reports alpha, this returns null and the caller
// falls through to three's own creation. `?canvasalpha=on` (render_dev_flags.ts)
// does the same deliberately, so a Windows A/B can compare the two paths on one
// build without a rebuild.

import { worldCanvasAlphaRequested } from './render_dev_flags';

/** The world context's attributes. Every value except `alpha` is what three
 *  would have requested for the parameters `renderer.ts` passes it. */
export const RENDERER_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
};

/**
 * Create the opaque world context on `canvas`, or return null to let three
 * create its own (the `?canvasalpha=on` A/B arm, a refused attribute set, or a
 * host with no WebGL2 at all).
 */
export function createRendererGlContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  if (worldCanvasAlphaRequested()) return null;
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext('webgl2', RENDERER_CONTEXT_ATTRIBUTES);
  } catch {
    return null;
  }
  if (!context) return null;
  // A driver may ignore the request. An honest fallback beats a silent
  // mismatch between what this module claims and what the compositor sees.
  return context.getContextAttributes()?.alpha === false ? context : null;
}
