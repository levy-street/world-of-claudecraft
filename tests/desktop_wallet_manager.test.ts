import { describe, expect, it } from 'vitest';
import {
  desktopWalletManagerAction,
  desktopWalletManagerView,
  disconnectDesktopWalletSession,
} from '../src/net/desktop_wallet_manager';
import type { WalletOption } from '../src/net/wallet';

const option = (connected = false): WalletOption => ({
  id: 'walletconnect',
  name: 'Wallet app or QR code',
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  connected,
});

describe('desktop wallet manager', () => {
  it('shows the browser wallet as connected after a successful handoff', () => {
    expect(desktopWalletManagerView([option()], true)).toEqual({
      options: [option(true)],
      selectedId: 'walletconnect',
    });
  });

  it('preserves a live provider connection and leaves a fresh manager disconnected', () => {
    expect(desktopWalletManagerView([option(true)], false).selectedId).toBe('walletconnect');
    expect(desktopWalletManagerView([option()], false)).toEqual({
      options: [option()],
      selectedId: null,
    });
  });

  it('maps picker choices to authorization, disconnect, or cancellation', () => {
    expect(desktopWalletManagerAction('walletconnect')).toBe('authorize');
    expect(desktopWalletManagerAction({ action: 'disconnect' })).toBe('disconnect');
    expect(desktopWalletManagerAction(null)).toBe('cancel');
  });

  it('clears the browser session even when provider disconnect rejects', async () => {
    const events: string[] = [];

    await expect(
      disconnectDesktopWalletSession(
        async () => {
          events.push('provider');
          throw new Error('provider failed');
        },
        () => events.push('disconnected'),
      ),
    ).rejects.toThrow('provider failed');

    expect(events).toEqual(['provider', 'disconnected']);
  });
});
