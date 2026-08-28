// The game's own WebGL renderer string, reported to the desktop shell. The
// shell judges its Linux Vulkan trial on it: app.getGPUInfo gives the shell
// no renderer string on Linux, while the page's context knows exactly which
// ANGLE backend it landed on ("ANGLE (NVIDIA, Vulkan 1.4 ...)"). The read is
// the cached boot probe (src/render/gfx.ts activeGpuRendererName), so this
// costs no extra context; fire and forget, and total: an older shell without
// the method, a missing string, or a throwing channel report nothing.

import { activeGpuParallelCompile, activeGpuRendererName } from '../render/gfx';
import type { DesktopBridge } from '../runtime';

/** The renderer string plus whether the context lists KHR_parallel_shader_compile:
 *  the shell's Vulkan trial ladder reads the flag to tell a parallel-compile launch
 *  whose feature took from one whose feature did not. */
export function reportDesktopGpuRenderer(
  bridge: DesktopBridge | null | undefined,
  readRenderer: () => string | undefined = activeGpuRendererName,
  readParallelCompile: () => boolean | undefined = activeGpuParallelCompile,
): boolean {
  const report = bridge?.reportGpuRenderer;
  if (typeof report !== 'function') return false;
  let renderer: string | undefined;
  let parallelCompile: boolean | undefined;
  try {
    renderer = readRenderer();
    parallelCompile = readParallelCompile();
  } catch {
    return false;
  }
  if (typeof renderer !== 'string' || renderer.length === 0) return false;
  try {
    report.call(bridge, renderer, parallelCompile);
    return true;
  } catch {
    return false;
  }
}
