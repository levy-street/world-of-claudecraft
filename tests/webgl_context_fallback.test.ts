// The renderer's WebGL2 context with the power-preference fallback
// (src/render/webgl_context_fallback.ts): every request carries the
// renderer's own attributes, a refused request is retried with the next
// preference on the SAME canvas, and the last refusal is three's own error.

import { describe, expect, it } from 'vitest';
import {
  createWebGL2ContextWithFallback,
  RENDERER_CONTEXT_ATTRIBUTES,
  WEBGL_CONTEXT_REFUSED_MESSAGE,
  WEBGL_POWER_PREFERENCE_ORDER,
  type WebGL2CanvasLike,
  type WebGLPowerPreference,
} from '../src/render/webgl_context_fallback';

/** A canvas that refuses the listed preferences and answers the rest with a
 *  context that remembers the attributes it was created with. */
function canvasRefusing(refused: WebGLPowerPreference[]) {
  const requests: WebGLContextAttributes[] = [];
  const canvas: WebGL2CanvasLike = {
    getContext: (contextId, attributes) => {
      expect(contextId).toBe('webgl2');
      requests.push({ ...attributes });
      if (refused.includes(attributes.powerPreference as WebGLPowerPreference)) return null;
      return {
        getContextAttributes: () => ({ ...attributes }),
      } as unknown as WebGL2RenderingContext;
    },
  };
  return { canvas, requests };
}

describe('createWebGL2ContextWithFallback', () => {
  it('asks for the discrete GPU first, with the renderer own attributes, and stops there', () => {
    const { canvas, requests } = canvasRefusing([]);
    const outcome = createWebGL2ContextWithFallback(canvas);
    expect(requests).toEqual([
      { ...RENDERER_CONTEXT_ATTRIBUTES, powerPreference: 'high-performance' },
    ]);
    expect(outcome.powerPreference).toBe('high-performance');
    expect(outcome.refused).toEqual([]);
    expect(outcome.context.getContextAttributes()?.antialias).toBe(false);
  });

  it('retries with the default preference, same attributes, when the discrete request is refused', () => {
    // ANGLE Vulkan on NVIDIA + X11 answers `high-performance` with no
    // context; the default request on the same canvas creates one that still
    // runs on the discrete GPU. The attributes must be the renderer's on the
    // retry too: no default-framebuffer MSAA on any tier.
    const { canvas, requests } = canvasRefusing(['high-performance']);
    const fallbacks: string[] = [];
    const outcome = createWebGL2ContextWithFallback(canvas, undefined, (refused, next) =>
      fallbacks.push(`${refused}->${next}`),
    );
    expect(requests.map((r) => r.powerPreference)).toEqual(['high-performance', 'default']);
    expect(requests.every((r) => r.antialias === false && r.alpha === true)).toBe(true);
    expect(outcome.powerPreference).toBe('default');
    expect(outcome.refused).toEqual(['high-performance']);
    expect(outcome.context.getContextAttributes()?.antialias).toBe(false);
    expect(fallbacks).toEqual(['high-performance->default']);
  });

  it('throws three own refused-context error when every preference is refused', () => {
    const { canvas, requests } = canvasRefusing(['high-performance', 'default']);
    expect(() => createWebGL2ContextWithFallback(canvas)).toThrow(WEBGL_CONTEXT_REFUSED_MESSAGE);
    expect(requests.map((r) => r.powerPreference)).toEqual(WEBGL_POWER_PREFERENCE_ORDER);
  });

  it('tries exactly the order it is given, and warns once per fallback only', () => {
    const { canvas, requests } = canvasRefusing(['high-performance']);
    const fallbacks: string[] = [];
    expect(() =>
      createWebGL2ContextWithFallback(canvas, ['high-performance'], (r, n) =>
        fallbacks.push(`${r}->${n}`),
      ),
    ).toThrow(WEBGL_CONTEXT_REFUSED_MESSAGE);
    expect(requests).toHaveLength(1);
    expect(fallbacks).toEqual([]);
  });

  it('pins three r185 attribute set: alpha on, no MSAA, no stencil, no caveat refusal', () => {
    expect(RENDERER_CONTEXT_ATTRIBUTES).toEqual({
      alpha: true,
      depth: true,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
  });
});
