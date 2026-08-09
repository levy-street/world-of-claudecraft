import { beforeEach, describe, expect, it, vi } from 'vitest';

// The assembler combines the software-rendering signal (two independently
// tested probes) and the boot-time hybrid-GPU signal, then hands both
// verdicts to the UI toast, which decides what (if anything) to show. These
// tests pin the combiner itself.
vi.mock('../src/render/gfx', () => ({
  gfxSoftwareRendering: vi.fn(),
  activeGpuRendererName: vi.fn(),
}));
vi.mock('../src/render/software_renderer', () => ({ probeMajorPerformanceCaveat: vi.fn() }));
vi.mock('../src/ui/gpu_notice_toast', () => ({ initGpuNotice: vi.fn() }));
vi.mock('../src/game/hybrid_gpu_detect', () => ({ hybridGpuLikely: vi.fn() }));
vi.mock('../src/game/desktop_download', () => ({ detectDesktopPlatform: vi.fn() }));

import { detectDesktopPlatform } from '../src/game/desktop_download';
import { hybridGpuLikely } from '../src/game/hybrid_gpu_detect';
import { initSoftwareRenderNotice, softwareNoticeShown } from '../src/game/software_render_notice';
import { activeGpuRendererName, gfxSoftwareRendering } from '../src/render/gfx';
import { probeMajorPerformanceCaveat } from '../src/render/software_renderer';
import { initGpuNotice } from '../src/ui/gpu_notice_toast';

const gfxVerdict = vi.mocked(gfxSoftwareRendering);
const gpuName = vi.mocked(activeGpuRendererName);
const probe = vi.mocked(probeMajorPerformanceCaveat);
const notice = vi.mocked(initGpuNotice);
const hybrid = vi.mocked(hybridGpuLikely);
const platform = vi.mocked(detectDesktopPlatform);

beforeEach(() => {
  vi.clearAllMocks();
  gpuName.mockReturnValue('Intel(R) UHD Graphics 620');
  hybrid.mockReturnValue(false);
  platform.mockReturnValue('other');
});

describe('initSoftwareRenderNotice', () => {
  it('shows on the adapter-name verdict alone and skips the probe (short-circuit)', () => {
    gfxVerdict.mockReturnValue(true);
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: true,
      hybridGpuLikely: false,
      desktopShell: true,
      desktopPlatform: 'other',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('shows when only the caveat probe fires (renderer-string drift backstop)', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(true);
    initSoftwareRenderNotice(false);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: true,
      hybridGpuLikely: false,
      desktopShell: false,
      desktopPlatform: 'other',
    });
  });

  it('stays quiet on a hardware session', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    initSoftwareRenderNotice(false);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: false,
      hybridGpuLikely: false,
      desktopShell: false,
      desktopPlatform: 'other',
    });
  });

  it('treats a null probe (no canvas, or getContext threw) as not-software', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(null);
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: false,
      hybridGpuLikely: false,
      desktopShell: true,
      desktopPlatform: 'other',
    });
  });

  it('passes the hybrid-GPU verdict and the detected desktop platform through', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    hybrid.mockReturnValue(true);
    platform.mockReturnValue('win');
    initSoftwareRenderNotice(false);
    expect(hybrid).toHaveBeenCalledWith({
      gpuRenderer: 'Intel(R) UHD Graphics 620',
      desktopShell: false,
    });
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: false,
      hybridGpuLikely: true,
      desktopShell: false,
      desktopPlatform: 'win',
    });
  });

  it('records whether the toast actually showed, for the perf-nudge suppression', () => {
    // Ruling R16: the nudge's software arm suppresses only when the boot
    // notice DISPLAYED, which the toast alone decides (it also reads the
    // persisted dismissal), so the memo must follow its return value.
    gfxVerdict.mockReturnValue(true);
    notice.mockReturnValue(true);
    initSoftwareRenderNotice(false);
    expect(softwareNoticeShown()).toBe(true);

    notice.mockReturnValue(false);
    initSoftwareRenderNotice(false);
    expect(softwareNoticeShown()).toBe(false);
  });
});
