// The backend class behind a WebGL context (src/render/gpu_backend_class_core.ts):
// the string each measured machine reported, and the class it must land in.

import { describe, expect, it } from 'vitest';
import {
  classifyGpuBackend,
  compilesOffThread,
  readGpuBackend,
  WORKER_WORTH_BACKENDS,
  workerWorthWarming,
} from '../src/render/gpu_backend_class_core';

describe('classifyGpuBackend', () => {
  it('classes the renderer strings of the measured machines', () => {
    expect(
      classifyGpuBackend(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('d3d11');
    expect(
      classifyGpuBackend(
        'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)',
      ),
    ).toBe('opengl');
    expect(classifyGpuBackend('ANGLE (Intel, Mesa Intel(R) Graphics (ARL), OpenGL ES 3.2)')).toBe(
      'opengl',
    );
    expect(classifyGpuBackend('Mali-G715')).toBe('unknown');
    expect(
      classifyGpuBackend(
        'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (0x00002204)), NVIDIA)',
      ),
    ).toBe('vulkan');
    expect(
      classifyGpuBackend(
        'ANGLE (Intel, Vulkan 1.4.318 (Intel(R) Graphics (ARL) (0x00007D67)), Intel open-source Mesa driver)',
      ),
    ).toBe('vulkan');
    expect(
      classifyGpuBackend('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'),
    ).toBe('metal');
  });

  it('classes WARP as software even though it speaks Direct3D11', () => {
    // Chromium's Windows software fallback: a D3D11 string with no GPU behind
    // it; the worker must stay off there (src/render/software_renderer.ts).
    expect(
      classifyGpuBackend(
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('software');
  });

  it('classes a software rasterizer as software even when it speaks Vulkan', () => {
    expect(
      classifyGpuBackend(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe('software');
    expect(classifyGpuBackend('llvmpipe (LLVM 17.0.6, 256 bits)')).toBe('software');
  });

  it('lets the worker on only where the compile runs off the presenting thread', () => {
    expect(compilesOffThread('d3d11')).toBe(true);
    expect(compilesOffThread('vulkan')).toBe(true);
    expect(compilesOffThread('metal')).toBe(true);
    expect(compilesOffThread('opengl')).toBe(false);
    expect(compilesOffThread('software')).toBe(false);
    expect(compilesOffThread('unknown')).toBe(false);
  });

  it('pins where the worker is worth its cost: off-thread compile AND something to warm', () => {
    // Vulkan compiles off-thread and is still out: a cold link there is as
    // cheap as a hit and the worker's own links cost more (2026-08-30).
    expect(WORKER_WORTH_BACKENDS).toEqual(['d3d11']);
    expect(workerWorthWarming('d3d11')).toBe(true);
    // Metal: unmeasured in game, and its one reading (11 ms cold) is Vulkan's.
    expect(workerWorthWarming('metal')).toBe(false);
    expect(workerWorthWarming('vulkan')).toBe(false);
    expect(workerWorthWarming('opengl')).toBe(false);
    expect(workerWorthWarming('software')).toBe(false);
    expect(workerWorthWarming('unknown')).toBe(false);
    for (const backend of WORKER_WORTH_BACKENDS) expect(compilesOffThread(backend)).toBe(true);
  });
});

describe('readGpuBackend', () => {
  it('prefers the unmasked renderer string', () => {
    const context = {
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (name: number) =>
        name === 0x9246 ? 'ANGLE (NVIDIA, ... Direct3D11 ..., D3D11)' : 'WebKit WebGL',
    };
    expect(readGpuBackend(context)).toEqual({
      renderer: 'ANGLE (NVIDIA, ... Direct3D11 ..., D3D11)',
      backend: 'd3d11',
    });
  });

  it('falls back to the masked renderer, then to unknown, and never throws', () => {
    const masked = {
      getExtension: () => null,
      getParameter: (name: number) => (name === 0x1f01 ? 'ANGLE (Intel, Vulkan 1.4 ...)' : ''),
    };
    expect(readGpuBackend(masked).backend).toBe('vulkan');
    expect(readGpuBackend({ getExtension: () => null }).backend).toBe('unknown');
    expect(
      readGpuBackend({
        getExtension: () => {
          throw new Error('context lost');
        },
      }),
    ).toEqual({ renderer: '', backend: 'unknown' });
  });
});
