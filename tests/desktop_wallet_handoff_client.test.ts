import { describe, expect, it, vi } from 'vitest';
import {
  performDesktopWalletHandoff,
  waitForDesktopWalletResult,
  walletHandoffCodeFromHash,
} from '../src/net/desktop_wallet_handoff';

describe('desktop wallet handoff client', () => {
  it('reads the handoff secret only from the fragment', () => {
    const code = 'B'.repeat(43);
    expect(walletHandoffCodeFromHash(`#code=${code}`)).toBe(code);
    expect(walletHandoffCodeFromHash('')).toBeNull();
    expect(walletHandoffCodeFromHash('#code=short')).toBeNull();
  });

  it('polls until the browser completes and stops immediately on the deep-link signal', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({
        status: 'complete',
        result: { kind: 'transaction', address: 'wallet', signature: 'signature' },
      });
    let wake: (() => void) | null = null;
    const resultPromise = waitForDesktopWalletResult({
      code: 'C'.repeat(43),
      status,
      wait: () => new Promise<void>((resolve) => (wake = resolve)),
      timeoutMs: 10_000,
      now: (() => {
        let value = 0;
        return () => value++;
      })(),
    });
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    (wake as (() => void) | null)?.();
    await expect(resultPromise).resolves.toEqual({
      kind: 'transaction',
      address: 'wallet',
      signature: 'signature',
    });
  });

  it('opens the normal browser and consumes the authenticated result', async () => {
    let returned: ((code: string) => void) | null = null;
    const api = {
      createDesktopWalletHandoff: vi.fn().mockResolvedValue({
        code: 'D'.repeat(43),
        expiresInMs: 10_000,
      }),
      desktopWalletHandoffResult: vi.fn().mockResolvedValue({
        status: 'complete',
        result: {
          kind: 'link',
          address: 'wallet',
          nonce: 'nonce',
          signature: 'signature',
        },
      }),
    };
    const bridge = {
      openWalletBrowser: vi.fn().mockImplementation(async (code: string) => {
        returned?.(code);
        return true;
      }),
      takeWalletHandoffCode: vi.fn().mockResolvedValue(null),
      onWalletHandoffCode: vi.fn().mockImplementation((callback: (code: string) => void) => {
        returned = callback;
        return () => {
          returned = null;
        };
      }),
    };

    await expect(performDesktopWalletHandoff({ kind: 'link' }, api, bridge)).resolves.toEqual({
      kind: 'link',
      address: 'wallet',
      nonce: 'nonce',
      signature: 'signature',
    });
    expect(bridge.openWalletBrowser).toHaveBeenCalledWith('D'.repeat(43));
  });
});
