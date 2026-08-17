// Boots the one-time GPU notice once the renderer exists, covering the
// page-detectable triggers (issue #2119 scopes a/b/c):
// - software rendering: combines the adapter-name verdict resolved during
//   initGfxTier with the drift-proof failIfMajorPerformanceCaveat probe
//   (either firing means the session is on a software rasterizer).
// - hybrid-GPU-likely: the session is on an integrated GPU on a machine that
//   likely also has a discrete one, resolved from the same adapter-name
//   string via hybrid_gpu_detect.ts. Detected at BOOT (not gated on a bad
//   frame window like perf_nudge.ts's mid-session sibling nudge), so the
//   player sees it before they ever notice stutter. Browser-only: the desktop
//   shell forces the discrete adapter, so the detector excludes it.
// Folds in whatever the desktop shell has already said about the machine's
// GPUs (src/game/desktop_gpu_status.ts) and hands the merged verdict to the
// UI toast. Lives in src/game so main.ts stays a firewall (composition only)
// and neither ui nor render has to import the other.

import { activeGpuRendererName, gfxSoftwareRendering } from '../render/gfx';
import { probeMajorPerformanceCaveat } from '../render/software_renderer';
import { gpuNoticeDisplayed, initGpuNotice } from '../ui/gpu_notice_toast';
import { detectDesktopPlatform } from './desktop_download';
import { latchedDesktopGpuStatus, mergeShellGpuVerdict } from './desktop_gpu_status';
import { hybridGpuLikely } from './hybrid_gpu_detect';

/** Call AFTER the Renderer is constructed (initGfxTier has resolved by then). */
export function initSoftwareRenderNotice(desktopShell: boolean): void {
  const localSoftwareRendering = gfxSoftwareRendering() || probeMajorPerformanceCaveat() === true;
  const localHybridGpuLikely = hybridGpuLikely({
    gpuRenderer: activeGpuRendererName(),
    desktopShell,
  });
  const desktopPlatform = detectDesktopPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
  );
  const verdict = mergeShellGpuVerdict({
    localSoftwareRendering,
    localHybridGpuLikely,
    shell: latchedDesktopGpuStatus(),
  });
  initGpuNotice({ ...verdict, desktopShell, desktopPlatform });
}

// The two exposures below read the notice's per-session display latch rather
// than a boot-time snapshot, because a shell verdict can arrive AFTER the
// notice inits and because perf_nudge samples them late (inside its 30 s
// interval check, not at its own init). They stay true after the player
// dismisses the notice: the suppression rule is "the player was already told
// this", which a dismissal does not undo.

/**
 * True when the notice showed the SOFTWARE-rendering copy this session, or the
 * browser-only hybrid-GPU copy: the hybrid body names the same hardware
 * acceleration remedy, so it too suppresses the perf nudge's redundant
 * hardware-acceleration arm (the widened meaning is upstream's, PR #3153).
 */
export function softwareNoticeShown(): boolean {
  const displayed = gpuNoticeDisplayed();
  return displayed.softwareRendering || displayed.hybridGpuLikely;
}

/**
 * True when the notice showed a verdict that included the inactive dedicated
 * GPU this session, so the perf nudge suppresses its integrated-GPU arm: the
 * two toasts would otherwise contradict each other (the nudge's copy tells web
 * players the desktop app picks the gaming GPU automatically, which is exactly
 * what this verdict says did not happen).
 */
export function discreteNoticeShown(): boolean {
  return gpuNoticeDisplayed().discreteInactive;
}
