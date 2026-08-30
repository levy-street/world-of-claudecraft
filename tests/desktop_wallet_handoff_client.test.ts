import { describe, expect, it, vi } from 'vitest';
import {
  desktopWalletHandoffAvailable,
  parseDesktopWalletHandoffStatus,
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

  it('carries the step-up action verbatim and resolves its result kind', async () => {
    const api = {
      createDesktopWalletHandoff: vi.fn().mockResolvedValue({
        code: 'E'.repeat(43),
        expiresInMs: 10_000,
      }),
      desktopWalletHandoffResult: vi.fn().mockResolvedValue({
        status: 'complete',
        result: { kind: 'stepup', address: 'wallet', signature: 'msg-signature' },
      }),
    };
    const bridge = {
      openWalletBrowser: vi.fn().mockResolvedValue(true),
      takeWalletHandoffCode: vi.fn().mockResolvedValue(null),
      onWalletHandoffCode: vi.fn().mockReturnValue(() => {}),
    };
    const action = { kind: 'stepup' as const, nonce: 'ab'.repeat(16), expectedAddress: 'wallet' };
    await expect(performDesktopWalletHandoff(action, api, bridge)).resolves.toEqual({
      kind: 'stepup',
      address: 'wallet',
      signature: 'msg-signature',
    });
    // The action reaches the create call untouched: only the NONCE travels,
    // never any message text the renderer could have supplied.
    expect(api.createDesktopWalletHandoff).toHaveBeenCalledWith(action);
  });

  it('validates result payloads: known kinds pass, anything else reads as missing', () => {
    expect(
      parseDesktopWalletHandoffStatus({
        status: 'complete',
        result: { kind: 'stepup', address: 'wallet', signature: 'sig' },
      }),
    ).toEqual({
      status: 'complete',
      result: { kind: 'stepup', address: 'wallet', signature: 'sig' },
    });
    expect(parseDesktopWalletHandoffStatus({ status: 'pending' })).toEqual({ status: 'pending' });
    // The two pre-existing kinds, moved out of online.ts by this change:
    // breaking either arm silently turns a completed link or payment into
    // "expired", so both happy paths are pinned here.
    expect(
      parseDesktopWalletHandoffStatus({
        status: 'complete',
        result: { kind: 'link', address: 'wallet', nonce: 'n1', signature: 'sig' },
      }),
    ).toEqual({
      status: 'complete',
      result: { kind: 'link', address: 'wallet', nonce: 'n1', signature: 'sig' },
    });
    expect(
      parseDesktopWalletHandoffStatus({
        status: 'complete',
        result: { kind: 'transaction', address: 'wallet', signature: 'sig' },
      }),
    ).toEqual({
      status: 'complete',
      result: { kind: 'transaction', address: 'wallet', signature: 'sig' },
    });
    // Fail-closed arms: an unknown kind, a missing field, and junk all read
    // as 'missing' (the poller surfaces that as an expired authorization).
    expect(
      parseDesktopWalletHandoffStatus({
        status: 'complete',
        result: { kind: 'mystery', address: 'wallet', signature: 'sig' },
      }),
    ).toEqual({ status: 'missing' });
    expect(
      parseDesktopWalletHandoffStatus({
        status: 'complete',
        result: { kind: 'link', address: 'wallet', signature: 'sig' },
      }),
    ).toEqual({ status: 'missing' });
    expect(parseDesktopWalletHandoffStatus({})).toEqual({ status: 'missing' });
  });
});

describe('desktopWalletHandoffAvailable', () => {
  it('requires BOTH the desktop shell and the openWalletBrowser bridge method', () => {
    const openWalletBrowser = async () => true;
    expect(desktopWalletHandoffAvailable(true, { openWalletBrowser })).toBe(true);
    // An older shell without the method: the Exchange signers must fall back
    // to the in-renderer wallet, never throw unavailable.
    expect(desktopWalletHandoffAvailable(true, {})).toBe(false);
    expect(desktopWalletHandoffAvailable(true, null)).toBe(false);
    expect(desktopWalletHandoffAvailable(false, { openWalletBrowser })).toBe(false);
  });
});
