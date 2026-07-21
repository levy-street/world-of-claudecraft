import { describe, expect, it } from 'vitest';
import { dismissBrowserNotice, resolveBrowserNotice } from '../src/ui/browser_notice_view';

describe('resolveBrowserNotice', () => {
  it('shows only for an unsupported browser that has not dismissed it', () => {
    expect(resolveBrowserNotice({ unsupported: true, dismissedBefore: false })).toEqual({
      shown: true,
      dismissed: false,
    });
  });

  it('never shows on a supported browser', () => {
    expect(resolveBrowserNotice({ unsupported: false, dismissedBefore: false }).shown).toBe(false);
  });

  it('never re-nags after a persisted dismissal, even on unsupported browser', () => {
    expect(resolveBrowserNotice({ unsupported: true, dismissedBefore: true })).toEqual({
      shown: false,
      dismissed: true,
    });
  });
});

describe('dismissBrowserNotice', () => {
  it('hides the notice and remembers the dismissal', () => {
    const state = resolveBrowserNotice({ unsupported: true, dismissedBefore: false });
    expect(dismissBrowserNotice(state)).toEqual({ shown: false, dismissed: true });
  });
});
