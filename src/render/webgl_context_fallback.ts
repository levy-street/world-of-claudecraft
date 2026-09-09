// The renderer's WebGL2 context, created HERE and handed to three, with a
// power-preference fallback: the first request asks for the discrete GPU
// (`high-performance`, the hint that keeps dual-GPU laptops off their
// integrated chip); when the browser answers that with no context at all
// (ANGLE Vulkan on NVIDIA + X11 does), the next request asks for the default.
//
// Why the context is created here and not by three: on a refused request
// three's constructor probes the canvas with a bare getContext(name) before
// it throws, and a canvas keeps the first context it ever created, so any
// later request on that canvas adopts the probe's context with the browser's
// default attributes (a multisampled default framebuffer among them) and the
// requested attributes are silently dropped. Creating the context ourselves
// means every attempt carries the renderer's own attributes, and three,
// given `context`, never probes. A refused request does not lock the canvas
// (measured 2026-08-28: three refused attempts on one canvas fired three
// webglcontextcreationerror events), so the next attempt is a real request.

import * as THREE from 'three';

export type WebGLPowerPreference = 'high-performance' | 'low-power' | 'default';

/** The preferences tried, in order. */
export const WEBGL_POWER_PREFERENCE_ORDER: readonly WebGLPowerPreference[] = [
  'high-performance',
  'default',
];

/** three r185's own context attributes (WebGLRenderer.js: `alpha` is
 *  always true at creation, the renderer's alpha parameter only picks the
 *  clear alpha), with the game's one choice: no default-framebuffer MSAA on
 *  any tier (high/ultra get AA from the composer's MSAA HalfFloat target,
 *  low runs without AA; see the renderer's construction site). */
export const RENDERER_CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: false,
});

export interface WebGL2CanvasLike {
  getContext(
    contextId: 'webgl2',
    attributes: WebGLContextAttributes,
  ): WebGL2RenderingContext | null;
}

export interface WebGL2ContextOutcome {
  context: WebGL2RenderingContext;
  /** The preference the context was finally created with. */
  powerPreference: WebGLPowerPreference;
  /** The refused preferences before it, in order. */
  refused: WebGLPowerPreference[];
}

/** three's own wording for a refused context, kept so every reader of the
 *  startup error (the safety screen, the logs) sees what it always saw. */
export const WEBGL_CONTEXT_REFUSED_MESSAGE =
  'THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.';

function warnOnFallback(refused: WebGLPowerPreference, next: WebGLPowerPreference): void {
  console.warn(`[gfx] no WebGL2 context for powerPreference ${refused}, retrying with ${next}`);
}

/** Request a WebGL2 context per preference until one answers; throws three's
 *  own refused-context error when every preference is refused. */
export function createWebGL2ContextWithFallback(
  canvas: WebGL2CanvasLike,
  order: readonly WebGLPowerPreference[] = WEBGL_POWER_PREFERENCE_ORDER,
  onFallback: (refused: WebGLPowerPreference, next: WebGLPowerPreference) => void = warnOnFallback,
): WebGL2ContextOutcome {
  const refused: WebGLPowerPreference[] = [];
  for (let i = 0; i < order.length; i++) {
    const powerPreference = order[i];
    const context = canvas.getContext('webgl2', {
      ...RENDERER_CONTEXT_ATTRIBUTES,
      powerPreference,
    });
    if (context) return { context, powerPreference, refused };
    refused.push(powerPreference);
    if (i + 1 < order.length) onFallback(powerPreference, order[i + 1]);
  }
  throw new Error(WEBGL_CONTEXT_REFUSED_MESSAGE);
}

export interface RendererWebGL {
  webgl: THREE.WebGLRenderer;
  /** null when the caller supplied its own context (its preference is its own). */
  powerPreference: WebGLPowerPreference | null;
}

/** The renderer's WebGLRenderer over a context created with the fallback,
 *  or over the caller's supplied context (one attempt, no fallback). */
export function createRendererWebGL(
  canvas: HTMLCanvasElement,
  suppliedContext?: WebGL2RenderingContext,
): RendererWebGL {
  const created = suppliedContext ? null : createWebGL2ContextWithFallback(canvas);
  const webgl = new THREE.WebGLRenderer({
    canvas,
    context: suppliedContext ?? created?.context,
    antialias: RENDERER_CONTEXT_ATTRIBUTES.antialias,
  });
  return { webgl, powerPreference: created?.powerPreference ?? null };
}
