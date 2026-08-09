import { describe, expect, it } from 'vitest';
import { dismissGpuNotice, gpuNoticeBodyKey, resolveGpuNotice } from '../src/ui/gpu_notice_view';

const NEITHER = {
  softwareRendering: false,
  hybridGpuLikely: false,
  softwareDismissedBefore: false,
  hybridDismissedBefore: false,
};

describe('resolveGpuNotice', () => {
  it('shows the software variant for a software-rendering session that has not dismissed it', () => {
    expect(resolveGpuNotice({ ...NEITHER, softwareRendering: true })).toEqual({
      shown: true,
      dismissed: false,
      variant: 'software',
    });
  });

  it('shows the hybrid variant for a likely-hybrid session that has not dismissed it', () => {
    expect(resolveGpuNotice({ ...NEITHER, hybridGpuLikely: true })).toEqual({
      shown: true,
      dismissed: false,
      variant: 'hybrid',
    });
  });

  it('never shows on a session matching neither trigger', () => {
    expect(resolveGpuNotice(NEITHER)).toEqual({ shown: false, dismissed: false, variant: null });
  });

  it('never re-nags the software variant after its own persisted dismissal', () => {
    expect(
      resolveGpuNotice({ ...NEITHER, softwareRendering: true, softwareDismissedBefore: true }),
    ).toEqual({ shown: false, dismissed: true, variant: 'software' });
  });

  it('never re-nags the hybrid variant after its own persisted dismissal', () => {
    expect(
      resolveGpuNotice({ ...NEITHER, hybridGpuLikely: true, hybridDismissedBefore: true }),
    ).toEqual({ shown: false, dismissed: true, variant: 'hybrid' });
  });

  it('a hybrid dismissal never suppresses a later software trigger, and vice versa', () => {
    expect(
      resolveGpuNotice({
        ...NEITHER,
        softwareRendering: true,
        hybridDismissedBefore: true,
      }).shown,
    ).toBe(true);
    expect(
      resolveGpuNotice({
        ...NEITHER,
        hybridGpuLikely: true,
        softwareDismissedBefore: true,
      }).shown,
    ).toBe(true);
  });

  it('software rendering wins priority when both triggers are somehow true', () => {
    expect(
      resolveGpuNotice({
        ...NEITHER,
        softwareRendering: true,
        hybridGpuLikely: true,
      }).variant,
    ).toBe('software');
  });
});

describe('dismissGpuNotice', () => {
  it('hides the notice and remembers the dismissal, keeping the variant', () => {
    const state = resolveGpuNotice({ ...NEITHER, softwareRendering: true });
    expect(dismissGpuNotice(state)).toEqual({
      shown: false,
      dismissed: true,
      variant: 'software',
    });
  });
});

describe('gpuNoticeBodyKey', () => {
  it('picks the desktop copy inside the Electron shell and the browser copy on the web', () => {
    // Inside the desktop shell "enable hardware acceleration in your browser" is
    // actively wrong advice (there is no such setting), so the split is load-bearing.
    expect(
      gpuNoticeBodyKey({ variant: 'software', desktopShell: true, desktopPlatform: 'other' }),
    ).toBe('gpuNotice.bodyDesktop');
    expect(
      gpuNoticeBodyKey({ variant: 'software', desktopShell: false, desktopPlatform: 'other' }),
    ).toBe('gpuNotice.bodyWeb');
  });

  it('picks per-OS copy for the hybrid variant, generic for anything else', () => {
    expect(
      gpuNoticeBodyKey({ variant: 'hybrid', desktopShell: false, desktopPlatform: 'win' }),
    ).toBe('gpuNotice.hybridBodyWindows');
    expect(
      gpuNoticeBodyKey({ variant: 'hybrid', desktopShell: false, desktopPlatform: 'linux' }),
    ).toBe('gpuNotice.hybridBodyLinux');
    expect(
      gpuNoticeBodyKey({ variant: 'hybrid', desktopShell: false, desktopPlatform: 'mac' }),
    ).toBe('gpuNotice.hybridBodyOther');
    expect(
      gpuNoticeBodyKey({ variant: 'hybrid', desktopShell: false, desktopPlatform: 'other' }),
    ).toBe('gpuNotice.hybridBodyOther');
  });
});
