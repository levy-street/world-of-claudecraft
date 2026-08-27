// The GPU backend class behind a WebGL context, read off the renderer
// string: what decides whether a shader link issued elsewhere (the warm
// worker) can run off the thread that presents frames. On ANGLE's OpenGL
// backends the link's resolution runs on the one GPU-process thread the
// frame waits for; D3D11, Vulkan and Metal compile on their own thread
// pools. Measured 2026-08-28 (tmp/REPORT_worker-step3_2026-08-28.md): every
// OpenGL cell blocked, D3D11 passed, Vulkan had nothing left to warm.

import { isSoftwareRendererName } from './software_renderer';

export type GpuBackendClass = 'd3d11' | 'vulkan' | 'metal' | 'opengl' | 'software' | 'unknown';

/** Backends whose shader compile runs off the presenting thread. */
export const OFF_THREAD_COMPILE_BACKENDS: readonly GpuBackendClass[] = ['d3d11', 'vulkan', 'metal'];

export function classifyGpuBackend(renderer: string): GpuBackendClass {
  const text = renderer.toLowerCase();
  // The shared software detector first: WARP ("Microsoft Basic Render Driver")
  // speaks Direct3D11 and SwiftShader speaks Vulkan.
  if (isSoftwareRendererName(renderer) || text.includes('llvmpipe') || text.includes('softpipe')) {
    return 'software';
  }
  if (text.includes('direct3d11') || text.includes('d3d11')) return 'd3d11';
  if (text.includes('vulkan')) return 'vulkan';
  if (text.includes('metal')) return 'metal';
  if (text.includes('opengl')) return 'opengl';
  return 'unknown';
}

export function compilesOffThread(backend: GpuBackendClass): boolean {
  return OFF_THREAD_COMPILE_BACKENDS.includes(backend);
}

export interface GpuBackendReadout {
  renderer: string;
  backend: GpuBackendClass;
}

interface DebugRendererInfoLike {
  UNMASKED_RENDERER_WEBGL: number;
}

interface RendererStringSource {
  getExtension(name: string): unknown;
  getParameter?(name: number): unknown;
}

const GL_RENDERER = 0x1f01;

/** The unmasked renderer string when the browser exposes it, else the
 *  masked one; never throws (an unknown backend keeps the worker off). */
export function readGpuBackend(context: RendererStringSource): GpuBackendReadout {
  let renderer = '';
  try {
    const info = context.getExtension('WEBGL_debug_renderer_info') as DebugRendererInfoLike | null;
    const raw =
      info && typeof context.getParameter === 'function'
        ? context.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : typeof context.getParameter === 'function'
          ? context.getParameter(GL_RENDERER)
          : '';
    renderer = typeof raw === 'string' ? raw : '';
  } catch {
    renderer = '';
  }
  return { renderer, backend: classifyGpuBackend(renderer) };
}
