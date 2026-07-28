import { describe, expect, it, vi } from 'vitest';
import { createRenderBackendWithFallback } from '../src/render/backend/backend_factory';
import type { RenderBackend } from '../src/render/backend/types';

function backend(kind: 'webgl2' | 'webgpu'): RenderBackend {
  return {
    kind,
    renderer: {} as RenderBackend['renderer'],
    experimental: kind === 'webgpu',
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('render backend factory', () => {
  it('does not import or construct WebGPU on the default path', async () => {
    const webgl2 = vi.fn(() => backend('webgl2'));
    const webgpu = vi.fn(() => backend('webgpu'));
    const result = await createRenderBackendWithFallback(
      {
        kind: 'webgl2',
        requested: 'webgl2',
        fallback: false,
        reason: 'default',
      },
      { webgl2, webgpu },
    );
    expect(result.backend.kind).toBe('webgl2');
    expect(webgl2).toHaveBeenCalledOnce();
    expect(webgpu).not.toHaveBeenCalled();
  });

  it('falls back atomically when experimental initialization fails', async () => {
    const result = await createRenderBackendWithFallback(
      {
        kind: 'webgpu',
        requested: 'webgpu',
        fallback: false,
        reason: 'explicit',
      },
      {
        webgl2: () => backend('webgl2'),
        webgpu: () => Promise.reject(new Error('adapter unavailable')),
      },
    );
    expect(result.backend.kind).toBe('webgl2');
    expect(result.initializationFallback).toBe(true);
    expect(result.selection).toMatchObject({
      requested: 'webgpu',
      fallback: true,
    });
    expect(result.selection.reason).toContain('adapter unavailable');
  });
});
