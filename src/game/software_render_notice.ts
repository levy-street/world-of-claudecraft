// Boots the one-time software-rendering notice once the renderer exists:
// combines the adapter-name verdict resolved during initGfxTier with the
// drift-proof failIfMajorPerformanceCaveat probe (either firing means the
// session is on a software rasterizer), and hands the result to the UI toast.
// Lives in src/game so main.ts stays a firewall (composition only) and neither
// ui nor render has to import the other.

import { gfxSoftwareRendering } from '../render/gfx';
import { probeMajorPerformanceCaveat } from '../render/software_renderer';
import { initGpuNotice } from '../ui/gpu_notice_toast';

// Whether the boot-time notice was actually DISPLAYED this session, recorded
// so the perf-nudge assembler (perf_nudge.ts) can suppress its redundant
// software arm (packet 0 ruling R16). False until initSoftwareRenderNotice
// runs, and false when the notice stayed hidden (hardware session, or a
// previously persisted dismissal).
let noticeShown = false;

/** Call AFTER the Renderer is constructed (initGfxTier has resolved by then). */
export function initSoftwareRenderNotice(desktopShell: boolean): void {
  const softwareRendering = gfxSoftwareRendering() || probeMajorPerformanceCaveat() === true;
  noticeShown = initGpuNotice({ softwareRendering, desktopShell }) === true;
}

/** True when the boot-time software-rendering notice showed this session. */
export function softwareNoticeShown(): boolean {
  return noticeShown;
}
