// The Three-facing half of the GPU timer: probes EXT_disjoint_timer_query_webgl2
// on the live context and owns the composer marker passes that split the frame
// into named GPU sections. All state-machine logic lives in gpu_timer_core.ts
// (pure, Node-tested); this file only touches the context and the Pass seam.
//
// Section semantics: markers are inserted BEFORE each real pass, and each
// split closes the previous section, so a section covers everything from its
// marker to the next one (the last runs to endFrame). The scene section
// therefore includes three's internal shadow-map pass, which has no seam of
// its own; the census's frozen-shadow diff remains the tool for shadow share.
//
// Never inserted AFTER the final real pass: EffectComposer routes the last
// enabled pass to the canvas (isLastEnabledPass), and a trailing marker would
// steal that slot and blank the frame.

import type * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import {
  createGpuSectionTimer,
  type GpuSectionTimer,
  type GpuTimerExt,
  type GpuTimerGl,
} from './gpu_timer_core';
import { renderLayerDisabled } from './render_dev_flags';

export type { GpuSectionTimer, GpuTimerStats } from './gpu_timer_core';

export type GpuTimerUnsupportedReason = 'disabled' | 'webgl1' | 'no-extension';

export interface GpuTimerProbe {
  timer: GpuSectionTimer | null;
  supported: boolean;
  reason: GpuTimerUnsupportedReason | null;
}

/**
 * Probe the renderer's context for the timer extension. `?gputimer=off` is the
 * dev kill switch (render_dev_flags), symmetric with the other layer flags.
 * Firefox and Safari do not ship the extension; Chrome exposes it on real GPUs
 * and on ANGLE/D3D11, which is exactly the cohort Windows diagnosis needs.
 */
export function probeGpuTimer(webgl: THREE.WebGLRenderer): GpuTimerProbe {
  if (renderLayerDisabled('gputimer')) return { timer: null, supported: false, reason: 'disabled' };
  if (!webgl.capabilities.isWebGL2) return { timer: null, supported: false, reason: 'webgl1' };
  let ext: GpuTimerExt | null = null;
  try {
    ext = webgl.getContext().getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerExt | null;
  } catch {
    ext = null;
  }
  if (!ext) return { timer: null, supported: false, reason: 'no-extension' };
  const gl = webgl.getContext() as unknown as GpuTimerGl;
  return { timer: createGpuSectionTimer(gl, ext), supported: true, reason: null };
}

/**
 * A zero-draw composer pass that closes the running GPU section and opens the
 * named one. needsSwap stays false so the composer's read/write buffers flow
 * through untouched; render() issues no GL work beyond the query boundary.
 */
export class GpuSectionMarkerPass extends Pass {
  constructor(
    private readonly split: (label: string) => void,
    private readonly label: string,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(): void {
    this.split(this.label);
  }
}
