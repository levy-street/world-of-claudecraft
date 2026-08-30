// The GPU backend class behind a WebGL context, read off the renderer
// string: what decides whether a shader link issued elsewhere (the warm
// worker) can run off the thread that presents frames. On ANGLE's OpenGL
// backends the link's resolution runs on the one GPU-process thread the
// frame waits for; D3D11, Vulkan and Metal compile on their own thread
// pools. Measured 2026-08-28 (tmp/REPORT_worker-step3_2026-08-28.md): every
// OpenGL cell blocked, D3D11 passed, Vulkan had nothing left to warm.
// Safari masks the renderer string (no WEBGL_debug_renderer_info), so its
// Metal backend reads as unknown here and auto stays off on it: the 'metal'
// arm is reachable only where the string is unmasked.

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

/** Backends where the warm worker is worth its cost: it must compile off the
 *  presenting thread AND have something to warm. Vulkan compiles off-thread
 *  but a cold link there costs 8 to 25 ms (ANGLE only emits SPIR-V, the
 *  pipeline is built at link and the first draw is free: 0 ms on an RTX
 *  3060, an RTX 3090 and an Intel iGPU, 2026-08-30) while the worker's own
 *  context pays 70 to 160 ms per link until warm, and in game its links ran
 *  42 to 89 ms against 14 on the main context: it costs more than it saves. */
export const WORKER_WORTH_BACKENDS: readonly GpuBackendClass[] = ['d3d11', 'metal'];

export function workerWorthWarming(backend: GpuBackendClass): boolean {
  return WORKER_WORTH_BACKENDS.includes(backend);
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
