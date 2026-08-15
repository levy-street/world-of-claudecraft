// Pure view-core for the GPU notice family (DOM-free, Node-tested in
// tests/gpu_notice_view.test.ts). The thin DOM consumer is
// src/ui/gpu_notice_toast.ts. Two independent triggers feed one notice slot:
// - 'software': the session runs on a software rasterizer (WARP/SwiftShader/
//   llvmpipe). Verdict assembled by src/game/software_render_notice.ts from
//   the shared adapter-name detector plus the failIfMajorPerformanceCaveat probe.
// - 'hybrid': the session runs on an integrated GPU on a machine that likely
//   also has a discrete one (issue #2119). Verdict from
//   src/game/hybrid_gpu_detect.ts.
//
// Both notices are cosmetic-only and gameplay-neutral: they hide nothing and
// delay nothing a player acts on, they only EXPLAIN a slow/underpowered
// session and say what to do about it. Each shows at most once per install
// (a dismissal persists per variant, so dismissing one never suppresses the
// other) and a session matching neither trigger never shows anything.
// Software rendering takes priority when (rare) both triggers are somehow
// true, since it is the more severe condition and the two are otherwise
// mutually exclusive (a software rasterizer is never classified as an
// integrated GPU family).

export type GpuNoticeVariant = 'software' | 'hybrid';

export interface GpuNoticeState {
  shown: boolean;
  dismissed: boolean;
  variant: GpuNoticeVariant | null;
}

/** Resolve the initial state: show only on a live trigger, and never re-nag per variant. */
export function resolveGpuNotice(input: {
  softwareRendering: boolean;
  hybridGpuLikely: boolean;
  softwareDismissedBefore: boolean;
  hybridDismissedBefore: boolean;
}): GpuNoticeState {
  if (input.softwareRendering) {
    return {
      shown: !input.softwareDismissedBefore,
      dismissed: input.softwareDismissedBefore,
      variant: 'software',
    };
  }
  if (input.hybridGpuLikely) {
    return {
      shown: !input.hybridDismissedBefore,
      dismissed: input.hybridDismissedBefore,
      variant: 'hybrid',
    };
  }
  return { shown: false, dismissed: false, variant: null };
}

/** The player closed the notice: hide it now and remember the dismissal. */
export function dismissGpuNotice(state: GpuNoticeState): GpuNoticeState {
  return { shown: false, dismissed: true, variant: state.variant };
}

/**
 * Best-effort desktop-OS family for per-OS hybrid guidance. Mirrors
 * src/game/desktop_download.ts's DesktopPlatform union structurally (this
 * module cannot import from src/game/, see src/CLAUDE.md dependency
 * direction); the caller (src/game/software_render_notice.ts) computes it
 * with that module's detectDesktopPlatform and passes the value in.
 */
export type DesktopPlatform = 'mac' | 'win' | 'linux' | 'other';

export type GpuNoticeBodyKey =
  | 'gpuNotice.bodyDesktop'
  | 'gpuNotice.bodyWeb'
  | 'gpuNotice.hybridBodyWindows'
  | 'gpuNotice.hybridBodyLinux'
  | 'gpuNotice.hybridBodyOther';

/**
 * Body-copy key selection.
 * - software: inside the desktop (Electron) shell there is no "browser
 *   setting" to enable, so the browser-centric advice would be actively
 *   wrong; point at GPU drivers and the Windows per-app graphics setting
 *   instead.
 * - hybrid: never fires inside the desktop shell (hybridGpuLikely already
 *   excludes it), so the split is purely by OS, since the fix is a different
 *   OS-level or browser-level control on Windows vs Linux; anything else
 *   (mac, unknown) gets generic guidance that still names the desktop app.
 */
export function gpuNoticeBodyKey(input: {
  variant: GpuNoticeVariant;
  desktopShell: boolean;
  desktopPlatform: DesktopPlatform;
}): GpuNoticeBodyKey {
  if (input.variant === 'software') {
    return input.desktopShell ? 'gpuNotice.bodyDesktop' : 'gpuNotice.bodyWeb';
  }
  if (input.desktopPlatform === 'win') return 'gpuNotice.hybridBodyWindows';
  if (input.desktopPlatform === 'linux') return 'gpuNotice.hybridBodyLinux';
  return 'gpuNotice.hybridBodyOther';
}
