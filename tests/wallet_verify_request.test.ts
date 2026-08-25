// @vitest-environment happy-dom
// The one shared entry into the wallet connect/verify flow: every HUD connect
// button (bags, daily rewards, the WOC Store, the Exchange banner) rides this
// helper, so the event name main.ts listens for cannot drift per caller.
import { describe, expect, it, vi } from 'vitest';
import { requestWalletVerify } from '../src/ui/wallet_verify_request';

describe('wallet_verify_request', () => {
  it('dispatches the woc:wallet-verify event main.ts listens for', () => {
    const seen = vi.fn();
    window.addEventListener('woc:wallet-verify', seen);
    try {
      requestWalletVerify();
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('woc:wallet-verify', seen);
    }
  });
});
