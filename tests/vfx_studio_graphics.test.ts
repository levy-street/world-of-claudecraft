import { describe, expect, it, vi } from 'vitest';
import { createStudioGraphicsContext } from '../src/vfx_studio/graphics';

const boundary = vi.hoisted(() => ({
  dispose: vi.fn(),
  bootstrap: vi.fn(),
  context: {},
  order: [] as string[],
}));
vi.mock('three', () => ({
  WebGLRenderer: class {
    capabilities = { isWebGL2: true };
    getContext = () => boundary.context;
    dispose = () => {
      boundary.order.push('dispose');
      boundary.dispose();
    };
    constructor() {
      boundary.order.push('context');
    }
  },
}));
vi.mock('../src/render/gfx', () => ({
  initGfxTier: () => {
    boundary.order.push('bootstrap');
    boundary.bootstrap();
  },
  captureGfxCapabilities: () => ({ softwareRendering: false }),
}));

describe('studio graphics bootstrap', () => {
  it('initializes shared shaders and returns the same context after releasing its probe wrapper', () => {
    const prepared = createStudioGraphicsContext({} as HTMLCanvasElement);
    expect(prepared.context).toBe(boundary.context);
    expect(boundary.order).toEqual(['context', 'bootstrap', 'dispose']);
    expect(boundary.dispose).toHaveBeenCalledTimes(1);
  });
});
