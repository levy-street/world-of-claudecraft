import { describe, expect, it } from 'vitest';
import {
  requestedRenderBackend,
  selectRenderBackend,
} from '../src/render/backend/backend_select_core';

describe('render backend selection', () => {
  it('uses WebGL2 unless WebGPU is explicitly requested', () => {
    expect(requestedRenderBackend('')).toBe('webgl2');
    expect(requestedRenderBackend('?renderer=webgl2')).toBe('webgl2');
    expect(requestedRenderBackend('?renderer=webgpu')).toBe('webgpu');
    expect(requestedRenderBackend('?other=1&renderer=WEBGPU')).toBe('webgpu');
    expect(requestedRenderBackend('?renderer=unknown')).toBe('webgl2');
    expect(requestedRenderBackend('?renderer=%')).toBe('webgl2');
  });

  it('selects the experimental backend only when every gate is satisfied', () => {
    expect(
      selectRenderBackend('webgpu', {
        secureContext: true,
        navigatorGpu: true,
        forwardProfileCompatible: true,
        forceWebGl2: false,
      }),
    ).toEqual({
      kind: 'webgpu',
      requested: 'webgpu',
      fallback: false,
      reason: 'Explicit experimental WebGPU request is supported',
    });
  });

  it.each([
    ['kill switch', { forceWebGl2: true }, 'runtime kill switch'],
    ['insecure context', { secureContext: false }, 'secure context'],
    ['missing API', { navigatorGpu: false }, 'unavailable'],
    ['incompatible scene', { forwardProfileCompatible: false }, 'compatibility profile'],
  ])('falls back atomically for %s', (_label, override, reason) => {
    const selection = selectRenderBackend('webgpu', {
      secureContext: true,
      navigatorGpu: true,
      forwardProfileCompatible: true,
      forceWebGl2: false,
      ...override,
    });
    expect(selection.kind).toBe('webgl2');
    expect(selection.fallback).toBe(true);
    expect(selection.reason).toContain(reason);
  });

  it('never treats the production WebGL2 selection as a fallback', () => {
    expect(
      selectRenderBackend('webgl2', {
        secureContext: false,
        navigatorGpu: false,
        forwardProfileCompatible: false,
        forceWebGl2: true,
      }),
    ).toMatchObject({ kind: 'webgl2', fallback: false });
  });
});
