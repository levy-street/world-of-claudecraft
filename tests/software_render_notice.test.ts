import { beforeEach, describe, expect, it, vi } from 'vitest';

// The assembler combines two independently-tested signals; these tests pin the
// combiner itself: either signal firing shows the notice, the adapter-name
// verdict short-circuits the probe (no throwaway context when the answer is
// already yes), and a null probe (Node, or context creation threw) never shows.
vi.mock('../src/render/gfx', () => ({ gfxSoftwareRendering: vi.fn() }));
vi.mock('../src/render/software_renderer', () => ({ probeMajorPerformanceCaveat: vi.fn() }));
vi.mock('../src/ui/gpu_notice_toast', () => ({ initGpuNotice: vi.fn() }));

import { initSoftwareRenderNotice } from '../src/game/software_render_notice';
import { gfxSoftwareRendering } from '../src/render/gfx';
import { probeMajorPerformanceCaveat } from '../src/render/software_renderer';
import { initGpuNotice } from '../src/ui/gpu_notice_toast';

const gfxVerdict = vi.mocked(gfxSoftwareRendering);
const probe = vi.mocked(probeMajorPerformanceCaveat);
const notice = vi.mocked(initGpuNotice);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initSoftwareRenderNotice', () => {
  it('shows on the adapter-name verdict alone and skips the probe (short-circuit)', () => {
    gfxVerdict.mockReturnValue(true);
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({ softwareRendering: true, desktopShell: true });
    expect(probe).not.toHaveBeenCalled();
  });

  it('shows when only the caveat probe fires (renderer-string drift backstop)', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(true);
    initSoftwareRenderNotice(false);
    expect(notice).toHaveBeenCalledWith({ softwareRendering: true, desktopShell: false });
  });

  it('stays quiet on a hardware session', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    initSoftwareRenderNotice(false);
    expect(notice).toHaveBeenCalledWith({ softwareRendering: false, desktopShell: false });
  });

  it('treats a null probe (no canvas, or getContext threw) as not-software', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(null);
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({ softwareRendering: false, desktopShell: true });
  });
});
