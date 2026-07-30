// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { installWalletResumeHandlers } from '../src/net/wallet_resume';

describe('wallet resume handlers', () => {
  it('refreshes wallet state on visible, focus, and page restore events', () => {
    const refresh = vi.fn();
    const remove = installWalletResumeHandlers(refresh);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));

    expect(refresh).toHaveBeenCalledTimes(3);
    remove();
  });

  it('does not refresh while the page is hidden and removes every listener', () => {
    const refresh = vi.fn();
    const remove = installWalletResumeHandlers(refresh);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();

    remove();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
