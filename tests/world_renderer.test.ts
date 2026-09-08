import { beforeEach, expect, it, vi } from 'vitest';
import { transparentGameplaySort } from '../src/render/transparent_draw_order';
import { createWorldRenderer } from '../src/render/world_renderer';

const state = vi.hoisted(() => ({ renderer: {} as Record<string, unknown>, construct: vi.fn() }));
vi.mock('three', () => ({
  WebGLRenderer: class {
    constructor(options: unknown) {
      state.construct(options);
      Object.assign(this, state.renderer);
    }
  },
}));

beforeEach(() => {
  state.construct.mockClear();
  state.renderer = {
    capabilities: { isWebGL2: true },
    getContext: vi.fn(),
    setTransparentSort: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
});

it('keeps the supplied context and installs readable transparency without framebuffer MSAA', () => {
  const canvas = {} as HTMLCanvasElement,
    context = {} as WebGL2RenderingContext;
  vi.mocked(state.renderer.getContext as () => unknown).mockReturnValue(context);
  expect(createWorldRenderer(canvas, context).getContext()).toBe(context);
  expect(state.construct).toHaveBeenCalledWith({
    canvas,
    context,
    antialias: false,
    powerPreference: 'high-performance',
  });
  expect(state.renderer.setTransparentSort).toHaveBeenCalledWith(transparentGameplaySort);
  expect(state.renderer.dispose).not.toHaveBeenCalled();
  expect(state.renderer.forceContextLoss).not.toHaveBeenCalled();
});

it('cleans up a fresh failed context before the owning renderer receives it', () => {
  state.renderer.capabilities = { isWebGL2: false };
  expect(() => createWorldRenderer({} as HTMLCanvasElement)).toThrow('Renderer requires WebGL2');
  expect(state.renderer.dispose).toHaveBeenCalledOnce();
  expect(state.renderer.forceContextLoss).toHaveBeenCalledOnce();
});

it('preserves a caller-owned context and the original error even if cleanup throws', () => {
  const context = {} as WebGL2RenderingContext;
  state.renderer.dispose = vi.fn(() => {
    throw new Error('cleanup failed');
  });
  expect(() => createWorldRenderer({} as HTMLCanvasElement, context)).toThrow(
    'Three replaced the supplied WebGL2 context',
  );
  expect(state.renderer.dispose).toHaveBeenCalledOnce();
  expect(state.renderer.forceContextLoss).not.toHaveBeenCalled();
});

it('releases a fresh wrapper if transparency setup fails', () => {
  state.renderer.setTransparentSort = vi.fn(() => {
    throw new Error('sort install failed');
  });
  expect(() => createWorldRenderer({} as HTMLCanvasElement)).toThrow('sort install failed');
  expect(state.renderer.dispose).toHaveBeenCalledOnce();
  expect(state.renderer.forceContextLoss).toHaveBeenCalledOnce();
});
