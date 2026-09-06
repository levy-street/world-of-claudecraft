// @vitest-environment jsdom
//
// The world canvas's WebGL2 context attributes. three requests `alpha: true`
// unconditionally, so an opaque world surface only exists if the renderer
// supplies its own context: these pins are what keeps that true, plus the
// `?canvasalpha=on` A/B arm that restores three's own attributes.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readSource = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

function withSearch(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

async function loadModule() {
  vi.resetModules();
  return await import('../src/render/renderer_gl_context');
}

function stubCanvas(
  attributes: WebGLContextAttributes | null,
  onGetContext?: () => never,
): HTMLCanvasElement {
  const context = attributes
    ? ({ getContextAttributes: () => attributes } as unknown as WebGL2RenderingContext)
    : null;
  return {
    getContext: onGetContext ?? ((): WebGL2RenderingContext | null => context),
  } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  withSearch('');
  vi.resetModules();
});

describe('world WebGL2 context attributes', () => {
  it('asks for an OPAQUE surface and otherwise mirrors what three would request', async () => {
    withSearch('');
    const { RENDERER_CONTEXT_ATTRIBUTES } = await loadModule();
    // The one bit that differs from three's own request.
    expect(RENDERER_CONTEXT_ATTRIBUTES.alpha).toBe(false);
    // Everything else is three's default for the parameters renderer.ts passes
    // (antialias:false, powerPreference:'high-performance', the rest defaulted),
    // so a supplied context and a three-created one differ in exactly one bit.
    expect(RENDERER_CONTEXT_ATTRIBUTES).toEqual({
      alpha: false,
      depth: true,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
  });

  it('returns the context when the browser honours the opaque request', async () => {
    withSearch('');
    const { createRendererGlContext, RENDERER_CONTEXT_ATTRIBUTES } = await loadModule();
    const getContext = vi.fn(
      () => ({ getContextAttributes: () => ({ alpha: false }) }) as WebGL2RenderingContext,
    );
    const canvas = { getContext } as unknown as HTMLCanvasElement;
    expect(createRendererGlContext(canvas)).not.toBeNull();
    expect(getContext).toHaveBeenCalledWith('webgl2', RENDERER_CONTEXT_ATTRIBUTES);
  });

  it('falls back to three when the driver ignores the request or refuses it', async () => {
    withSearch('');
    const { createRendererGlContext } = await loadModule();
    // Honoured nothing: still translucent, so claiming opacity would be a lie.
    expect(createRendererGlContext(stubCanvas({ alpha: true }))).toBeNull();
    // No WebGL2 at all.
    expect(createRendererGlContext(stubCanvas(null))).toBeNull();
    // A host that throws on getContext.
    expect(
      createRendererGlContext(
        stubCanvas(null, () => {
          throw new Error('no context');
        }),
      ),
    ).toBeNull();
  });

  it('?canvasalpha=on restores the legacy translucent arm without touching the canvas', async () => {
    withSearch('?canvasalpha=on');
    const { createRendererGlContext } = await loadModule();
    const getContext = vi.fn();
    const canvas = { getContext } as unknown as HTMLCanvasElement;
    expect(createRendererGlContext(canvas)).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
  });

  it('any other flag value keeps the opaque default', async () => {
    withSearch('?canvasalpha=off&prep=legacy');
    const { createRendererGlContext } = await loadModule();
    expect(createRendererGlContext(stubCanvas({ alpha: false }))).not.toBeNull();
  });
});

describe('the renderer actually supplies it', () => {
  it('renderer.ts hands its own context to three, keeping the recycled one first', () => {
    const source = readSource('../src/render/renderer.ts');
    expect(source).toContain(
      'context: options.context ?? createRendererGlContext(canvas) ?? undefined,',
    );
  });

  it('nothing in the world draw path depends on a transparent clear', () => {
    // setClearColor with alpha 0 exists only for offscreen RENDER TARGETS, which
    // carry their own alpha whatever the canvas does, and each restores the
    // previous clear. A new one on the default framebuffer would break opacity.
    const source = readSource('../src/render/renderer.ts');
    expect(source).not.toContain('setClearAlpha');
    expect(source).not.toContain('setClearColor');
  });
});
