// Boots the one-time software-rendering notice once the renderer exists:
// combines the adapter-name verdict resolved during initGfxTier with the
// drift-proof failIfMajorPerformanceCaveat probe (either firing means the
// session is on a software rasterizer), and hands the result to the UI toast.
// Lives in src/game so main.ts stays a firewall (composition only) and neither
// ui nor render has to import the other.

import { gfxSoftwareRendering } from '../render/gfx';
import { probeMajorPerformanceCaveat } from '../render/software_renderer';
import { initGpuNotice } from '../ui/gpu_notice_toast';

/** Call AFTER the Renderer is constructed (initGfxTier has resolved by then). */
export function initSoftwareRenderNotice(desktopShell: boolean): void {
  const softwareRendering = gfxSoftwareRendering() || probeMajorPerformanceCaveat() === true;
  initGpuNotice({ softwareRendering, desktopShell });
}
