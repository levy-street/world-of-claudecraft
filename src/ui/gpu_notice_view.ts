// Pure view-core for the software-rendering notice (DOM-free, Node-tested in
// tests/gpu_notice_view.test.ts). The thin DOM consumer is
// src/ui/gpu_notice_toast.ts; the software verdict comes from the shared
// adapter-name detector plus the failIfMajorPerformanceCaveat probe
// (src/render/software_renderer.ts), assembled by
// src/game/software_render_notice.ts.
//
// The notice is cosmetic-only and gameplay-neutral: it hides nothing and delays
// nothing a player acts on; it only EXPLAINS why a WARP/SwiftShader session
// runs at a slideshow frame rate and says what to do about it. It shows at most
// once per install: a dismissal persists (the consumer stores it) and a
// non-software session never shows it at all.

export interface GpuNoticeState {
  shown: boolean;
  dismissed: boolean;
}

/** Resolve the initial state: show only on software rendering, and never re-nag. */
export function resolveGpuNotice(input: {
  softwareRendering: boolean;
  dismissedBefore: boolean;
}): GpuNoticeState {
  return {
    shown: input.softwareRendering && !input.dismissedBefore,
    dismissed: input.dismissedBefore,
  };
}

/** The player closed the notice: hide it now and remember the dismissal. */
export function dismissGpuNotice(_state: GpuNoticeState): GpuNoticeState {
  return { shown: false, dismissed: true };
}

/**
 * Body-copy key selection: inside the desktop (Electron) shell there is no
 * "browser setting" to enable, so the browser-centric advice would be actively
 * wrong; point at GPU drivers and the Windows per-app graphics setting instead.
 */
export function gpuNoticeBodyKey(
  desktopShell: boolean,
): 'gpuNotice.bodyDesktop' | 'gpuNotice.bodyWeb' {
  return desktopShell ? 'gpuNotice.bodyDesktop' : 'gpuNotice.bodyWeb';
}
