import { describe, expect, it } from 'vitest';
import { dismissGpuNotice, gpuNoticeBodyKey, resolveGpuNotice } from '../src/ui/gpu_notice_view';

describe('resolveGpuNotice', () => {
  it('shows only for a software-rendering session that has not dismissed it', () => {
    expect(resolveGpuNotice({ softwareRendering: true, dismissedBefore: false })).toEqual({
      shown: true,
      dismissed: false,
    });
  });

  it('never shows on a hardware-accelerated session', () => {
    expect(resolveGpuNotice({ softwareRendering: false, dismissedBefore: false }).shown).toBe(
      false,
    );
  });

  it('never re-nags after a persisted dismissal, even on software rendering', () => {
    expect(resolveGpuNotice({ softwareRendering: true, dismissedBefore: true })).toEqual({
      shown: false,
      dismissed: true,
    });
  });
});

describe('dismissGpuNotice', () => {
  it('hides the notice and remembers the dismissal', () => {
    const state = resolveGpuNotice({ softwareRendering: true, dismissedBefore: false });
    expect(dismissGpuNotice(state)).toEqual({ shown: false, dismissed: true });
  });
});

describe('gpuNoticeBodyKey', () => {
  it('picks the desktop copy inside the Electron shell and the browser copy on the web', () => {
    // Inside the desktop shell "enable hardware acceleration in your browser" is
    // actively wrong advice (there is no such setting), so the split is load-bearing.
    expect(gpuNoticeBodyKey(true)).toBe('gpuNotice.bodyDesktop');
    expect(gpuNoticeBodyKey(false)).toBe('gpuNotice.bodyWeb');
  });
});
