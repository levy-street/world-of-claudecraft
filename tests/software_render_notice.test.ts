import { beforeEach, describe, expect, it, vi } from 'vitest';

// The assembler combines four independently-tested signals; these tests pin
// the combiner itself: either local software signal firing shows the notice,
// the adapter-name verdict short-circuits the probe (no throwaway context when
// the answer is already yes), a null probe (Node, or context creation threw)
// never shows, the boot-time hybrid verdict and detected platform pass
// through, and the desktop shell's latched verdict is folded in on top.
vi.mock('../src/render/gfx', () => ({
  gfxSoftwareRendering: vi.fn(),
  activeGpuRendererName: vi.fn(),
}));
vi.mock('../src/render/software_renderer', () => ({ probeMajorPerformanceCaveat: vi.fn() }));
vi.mock('../src/ui/gpu_notice_toast', () => ({
  initGpuNotice: vi.fn(),
  updateGpuNoticeShellVerdict: vi.fn(),
  gpuNoticeDisplayed: vi.fn(() => ({
    softwareRendering: false,
    discreteInactive: false,
    hybridGpuLikely: false,
  })),
}));
vi.mock('../src/game/hybrid_gpu_detect', () => ({ hybridGpuLikely: vi.fn() }));
vi.mock('../src/game/desktop_download', () => ({ detectDesktopPlatform: vi.fn() }));

import { detectDesktopPlatform } from '../src/game/desktop_download';
import { initDesktopGpuStatus } from '../src/game/desktop_gpu_status';
import { hybridGpuLikely } from '../src/game/hybrid_gpu_detect';
import {
  discreteNoticeShown,
  initSoftwareRenderNotice,
  softwareNoticeShown,
} from '../src/game/software_render_notice';
import { activeGpuRendererName, gfxSoftwareRendering } from '../src/render/gfx';
import { probeMajorPerformanceCaveat } from '../src/render/software_renderer';
import type { DesktopBridge, DesktopGpuStatus } from '../src/runtime';
import { gpuNoticeDisplayed, initGpuNotice } from '../src/ui/gpu_notice_toast';

const gfxVerdict = vi.mocked(gfxSoftwareRendering);
const gpuName = vi.mocked(activeGpuRendererName);
const probe = vi.mocked(probeMajorPerformanceCaveat);
const notice = vi.mocked(initGpuNotice);
const displayed = vi.mocked(gpuNoticeDisplayed);
const hybrid = vi.mocked(hybridGpuLikely);
const platform = vi.mocked(detectDesktopPlatform);

const NOTHING_DISPLAYED = {
  softwareRendering: false,
  discreteInactive: false,
  hybridGpuLikely: false,
};

// Drives the real latch the assembler reads, the way the shell would.
function pushShellVerdict(status: DesktopGpuStatus | null): void {
  const shell: { push: ((status: DesktopGpuStatus) => void) | null } = { push: null };
  const bridge = {
    onGpuStatus: (callback: (status: DesktopGpuStatus) => void) => {
      shell.push = callback;
      return () => {};
    },
  } as unknown as DesktopBridge;
  initDesktopGpuStatus(bridge);
  if (status && shell.push) shell.push(status);
}

beforeEach(() => {
  vi.clearAllMocks();
  displayed.mockReturnValue({ ...NOTHING_DISPLAYED });
  gpuName.mockReturnValue('Intel(R) UHD Graphics 620');
  hybrid.mockReturnValue(false);
  platform.mockReturnValue('other');
  // Every case starts with no shell verdict latched.
  pushShellVerdict(null);
});

describe('initSoftwareRenderNotice', () => {
  it('shows on the adapter-name verdict alone and skips the probe (short-circuit)', () => {
    gfxVerdict.mockReturnValue(true);
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: true,
      discreteInactive: false,
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
      discreteInactive: false,
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
      discreteInactive: false,
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
      discreteInactive: false,
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
      discreteInactive: false,
      hybridGpuLikely: true,
      desktopShell: false,
      desktopPlatform: 'win',
    });
  });

  it('folds in a shell verdict that arrived before the renderer existed', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    pushShellVerdict({ softwareRendering: false, discreteInactive: true, adapter: 'Intel UHD' });
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: false,
      discreteInactive: true,
      hybridGpuLikely: false,
      desktopShell: true,
      desktopPlatform: 'other',
    });
  });

  it('accepts a software verdict from the shell even when both local signals say no', () => {
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    pushShellVerdict({ softwareRendering: true, discreteInactive: false, adapter: 'SwiftShader' });
    initSoftwareRenderNotice(true);
    expect(notice).toHaveBeenCalledWith({
      softwareRendering: true,
      discreteInactive: false,
      hybridGpuLikely: false,
      desktopShell: true,
      desktopPlatform: 'other',
    });
  });
});

describe('perf-nudge suppression exposures', () => {
  it('reports the software notice for a software verdict but not a discrete one (ruling R16)', () => {
    // The nudge's hardware-acceleration arm suppresses only when the boot
    // notice DISPLAYED a verdict carrying that remedy; a discrete-only notice
    // must NOT suppress it, or a software session would silently lose its
    // explanation.
    displayed.mockReturnValue({ ...NOTHING_DISPLAYED, softwareRendering: true });
    expect(softwareNoticeShown()).toBe(true);
    expect(discreteNoticeShown()).toBe(false);

    displayed.mockReturnValue({ ...NOTHING_DISPLAYED, discreteInactive: true });
    expect(softwareNoticeShown()).toBe(false);
    expect(discreteNoticeShown()).toBe(true);
  });

  it('counts a displayed hybrid notice toward the software exposure (PR #3153 widening)', () => {
    // The hybrid body names the same hardware-acceleration remedy, so upstream
    // widened the suppression to cover it; the discrete exposure stays blind
    // to hybrid.
    displayed.mockReturnValue({ ...NOTHING_DISPLAYED, hybridGpuLikely: true });
    expect(softwareNoticeShown()).toBe(true);
    expect(discreteNoticeShown()).toBe(false);
  });

  it('reports nothing shown when the notice never displayed', () => {
    displayed.mockReturnValue({ ...NOTHING_DISPLAYED });
    expect(softwareNoticeShown()).toBe(false);
    expect(discreteNoticeShown()).toBe(false);
  });

  it('reads the live display latch, so a verdict arriving after init still counts', () => {
    // perf_nudge samples these inside its interval check, well after the boot
    // notice inits, so the exposures must not be a boot-time snapshot.
    gfxVerdict.mockReturnValue(false);
    probe.mockReturnValue(false);
    initSoftwareRenderNotice(true);
    expect(discreteNoticeShown()).toBe(false);
    displayed.mockReturnValue({ ...NOTHING_DISPLAYED, discreteInactive: true });
    expect(discreteNoticeShown()).toBe(true);
  });
});
