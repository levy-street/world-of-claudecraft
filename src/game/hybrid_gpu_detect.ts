// Boot-time "likely hybrid-GPU laptop stuck on the integrated adapter"
// detector (issue #2119, scope b). perf_doctor.ts already trusts one
// adapter-name classification for this exact question (ruling R15:
// classifyGpuRenderer === 'midIntegrated' or the older isWeakIntegratedGpu
// list), but only nudges the player AFTER a bad live frame window. This
// module answers the same question at BOOT, from the adapter-name string
// alone, so software_render_notice.ts can show a notice before the player
// ever notices stutter. It deliberately reuses the exact same classification
// (never a second regex set) so the boot notice and the mid-session nudge can
// never disagree about what counts as "integrated."
//
// Deliberately excludes:
// - the desktop (Electron) shell, which already forces the discrete adapter
//   at the process level (electron/gpu_preference.cjs); the page has nothing
//   left to detect or fix there.
// - the generic 'weak' GPU class (old mobile SoCs, Adreno/Mali/PowerVR), where
//   "switch to the gaming GPU" is nonsense advice; only classifyGpuRenderer's
//   'midIntegrated' bucket (Iris Xe/Plus, integrated Radeon/Vega, desktop UHD
//   7xx) plus isWeakIntegratedGpu's older-Intel list (Iris Plus 6xx, UHD 6xx,
//   HD 5xx/6xx) count.
//
// The adapter string can never PROVE a discrete GPU also exists, only that
// this session is not on one: false positives are worse than missed
// detections (issue acceptance criteria), so keep the caller's copy
// conditional ("if this computer also has a gaming GPU"), matching the
// existing perfNudge.integratedGpu copy this mirrors.

import { classifyGpuRenderer, isWeakIntegratedGpu } from '../render/gfx';

/**
 * True when `name` classifies as an integrated GPU family known to often ship
 * alongside a discrete GPU in a hybrid laptop (Intel Iris Xe/Plus/UHD/HD
 * Graphics, integrated AMD Radeon/Vega APUs). Mirrors perf_doctor.ts's private
 * isIntegratedGpuName so the two detectors never drift.
 */
export function isIntegratedGpuRendererName(name: string | undefined): boolean {
  if (!name) return false;
  return classifyGpuRenderer(name) === 'midIntegrated' || isWeakIntegratedGpu(name);
}

export interface HybridGpuDetectInput {
  /** UNMASKED_RENDERER_WEBGL adapter-name string, or undefined if unavailable. */
  gpuRenderer: string | undefined;
  /** True inside the Electron shell, which already forces the discrete adapter. */
  desktopShell: boolean;
}

/**
 * True when this session is likely running on an integrated GPU on a machine
 * that likely also has a discrete one, and the page itself has no lever left
 * to fix it (the desktop shell already does; see HybridGpuDetectInput.desktopShell).
 */
export function hybridGpuLikely(input: HybridGpuDetectInput): boolean {
  if (input.desktopShell) return false;
  return isIntegratedGpuRendererName(input.gpuRenderer);
}
