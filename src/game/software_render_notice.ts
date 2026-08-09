// Boots the one-time GPU notice once the renderer exists, covering two
// independent triggers (issue #2119 scopes a/b/c):
// - software rendering: combines the adapter-name verdict resolved during
//   initGfxTier with the drift-proof failIfMajorPerformanceCaveat probe
//   (either firing means the session is on a software rasterizer).
// - hybrid-GPU-likely: the session is on an integrated GPU on a machine that
//   likely also has a discrete one, resolved from the same adapter-name
//   string via hybrid_gpu_detect.ts. Detected at BOOT (not gated on a bad
//   frame window like perf_nudge.ts's mid-session sibling nudge), so the
//   player sees it before they ever notice stutter.
// Hands both verdicts to the UI toast, which resolves which (if either) wins.
// Lives in src/game so main.ts stays a firewall (composition only) and
// neither ui nor render has to import the other.

import { activeGpuRendererName, gfxSoftwareRendering } from '../render/gfx';
import { probeMajorPerformanceCaveat } from '../render/software_renderer';
import { initGpuNotice } from '../ui/gpu_notice_toast';
import { detectDesktopPlatform } from './desktop_download';
import { hybridGpuLikely } from './hybrid_gpu_detect';

// Whether the boot-time notice was actually DISPLAYED this session, recorded
// so the perf-nudge assembler (perf_nudge.ts) can suppress its redundant
// software arm (packet 0 ruling R16). False until initSoftwareRenderNotice
// runs, and false when the notice stayed hidden (hardware session, or a
// previously persisted dismissal).
let noticeShown = false;

/** Call AFTER the Renderer is constructed (initGfxTier has resolved by then). */
export function initSoftwareRenderNotice(desktopShell: boolean): void {
  const softwareRendering = gfxSoftwareRendering() || probeMajorPerformanceCaveat() === true;
  const hybrid = hybridGpuLikely({ gpuRenderer: activeGpuRendererName(), desktopShell });
  const desktopPlatform = detectDesktopPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
  );
  noticeShown =
    initGpuNotice({
      softwareRendering,
      hybridGpuLikely: hybrid,
      desktopShell,
      desktopPlatform,
    }) === true;
}

/** True when the boot-time GPU notice (software or hybrid) showed this session. */
export function softwareNoticeShown(): boolean {
  return noticeShown;
}
