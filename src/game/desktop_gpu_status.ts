// Consumes the desktop shell's GPU verdict: the main process knows things the
// page cannot see (whether Chromium fell back to a software rasterizer, and
// whether a machine with a dedicated GPU is running the session on the
// power-saving one), and pushes them over the bridge as a DesktopGpuStatus.
// This module feature-checks the optional bridge member (older installed shells
// have no onGpuStatus), latches the last verdict for whoever asks later, and
// forwards it to the GPU notice.
//
// Lives in src/game so main.ts stays a firewall (composition only) and so the
// notice keeps a single DOM consumer. The verdict can arrive long BEFORE the
// notice inits (the shell integration boots with the page, the notice waits for
// the renderer), which is why both a latch and a forward exist: the notice
// folds the latch in at init, and the forward revives an already-inited notice.

import type { DesktopBridge, DesktopGpuStatus } from '../runtime';
import { updateGpuNoticeShellVerdict } from '../ui/gpu_notice_toast';
import type { GpuNoticeVerdict } from '../ui/gpu_notice_view';

// The last verdict the shell pushed this session, or null when the shell never
// pushed one (web build, older shell, or the verdict is still pending).
let latched: DesktopGpuStatus | null = null;

/**
 * Validate a bridge payload before it reaches the notice. The shell is a
 * separate, independently updated binary, so a payload missing the booleans (an
 * older or partial shell) is dropped rather than coerced into a false verdict.
 */
export function normalizeDesktopGpuStatus(raw: unknown): DesktopGpuStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<DesktopGpuStatus>;
  if (
    typeof candidate.softwareRendering !== 'boolean' ||
    typeof candidate.discreteInactive !== 'boolean'
  )
    return null;
  return {
    softwareRendering: candidate.softwareRendering,
    discreteInactive: candidate.discreteInactive,
    // Re-apply the shell's 64-char cap: the shell is an independently updated
    // binary, so the bound must hold on this side of the boundary too.
    adapter: typeof candidate.adapter === 'string' ? candidate.adapter.slice(0, 64) : '',
  };
}

/**
 * Merge the shell verdict with the page's own boot-time probes: either source
 * claiming software rendering is enough (the shell sees the GPU process
 * verdict, the page sees the live context), while the inactive-discrete-GPU
 * component only ever comes from the shell and the hybrid component only ever
 * comes from the page (hybrid_gpu_detect.ts classifies the adapter name and is
 * structurally false inside the shell, which forces the discrete adapter).
 */
export function mergeShellGpuVerdict(input: {
  localSoftwareRendering: boolean;
  localHybridGpuLikely: boolean;
  shell: DesktopGpuStatus | null;
}): GpuNoticeVerdict {
  return {
    softwareRendering: input.localSoftwareRendering || input.shell?.softwareRendering === true,
    discreteInactive: input.shell?.discreteInactive === true,
    hybridGpuLikely: input.localHybridGpuLikely,
  };
}

/**
 * Subscribe to the shell's GPU verdict. Returns the unsubscribe hook, or a
 * no-op on a bridge without onGpuStatus (older shell, or a plain browser), so
 * neither the web build nor an outdated install changes behavior at all.
 */
export function initDesktopGpuStatus(bridge: DesktopBridge): () => void {
  latched = null;
  const subscribe = bridge.onGpuStatus;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, (raw: DesktopGpuStatus) => {
    const status = normalizeDesktopGpuStatus(raw);
    if (!status) return;
    latched = status;
    updateGpuNoticeShellVerdict(status);
  });
}

/** The last shell verdict, for a consumer that inits after it arrived. */
export function latchedDesktopGpuStatus(): DesktopGpuStatus | null {
  return latched;
}
