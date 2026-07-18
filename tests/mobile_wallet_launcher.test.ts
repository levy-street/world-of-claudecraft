// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusManager } from '../src/ui/focus_manager';

vi.mock('../src/ui/i18n', () => ({
  t: (key: string, params?: { wallet?: string }) => {
    if (key === 'wallet.openAppTitle') return `Continue in ${params?.wallet}`;
    if (key === 'wallet.openAppHelp') return `Open ${params?.wallet} to review this request.`;
    if (key === 'wallet.openAppButton') return `Open ${params?.wallet}`;
    if (key === 'wallet.preparingAppButton') return `Preparing ${params?.wallet}...`;
    if (key === 'wallet.walletAppUnavailable') return `${params?.wallet} is unavailable.`;
    if (key === 'wallet.manualReturnBrowserHelp') return 'Return to this browser tab.';
    if (key === 'wallet.manualReturnStandaloneHelp') return 'Return to the Home Screen app.';
    if (key === 'skinEvent.close') return 'Close';
    return key;
  },
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mobile wallet app launcher', () => {
  it('opens the wallet app only from the explicit user CTA', async () => {
    const release = vi.fn();
    const focusManager = {
      open: vi.fn(() => ({ focusFirst: vi.fn(), release })),
    } as unknown as FocusManager;
    const open = vi.fn(async () => {});
    const { showMobileWalletLauncher } = await import('../src/ui/mobile_wallet_launcher');

    const launched = showMobileWalletLauncher(
      {
        provider: 'solflare',
        walletName: 'Solflare',
        returnTarget: 'browser',
        open: Promise.resolve(open),
      },
      focusManager,
    );

    expect(document.querySelector('#mobile-wallet-launch-title')?.textContent).toBe(
      'Continue in Solflare',
    );
    expect(open).not.toHaveBeenCalled();

    const button = document.querySelector<HTMLButtonElement>('.wallet-app-launch-button');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe('Preparing Solflare...');
    await vi.waitFor(() => expect(button?.disabled).toBe(false));
    expect(button?.textContent).toBe('Open Solflare');
    button?.click();
    await launched;

    expect(open).toHaveBeenCalledOnce();
    await expect(launched).resolves.toBe('opened');
    expect(release).toHaveBeenCalledWith(true);
    expect(document.querySelector('.wallet-picker-backdrop')).toBeNull();
  });

  it('keeps the launcher visible while Reown prepares the selected wallet', async () => {
    const focusManager = {
      open: vi.fn(() => ({ focusFirst: vi.fn(), release: vi.fn() })),
    } as unknown as FocusManager;
    const { showMobileWalletLauncher } = await import('../src/ui/mobile_wallet_launcher');
    let resolveOpen = (_open: () => Promise<void>) => {};
    const openReady = new Promise<() => Promise<void>>((resolve) => {
      resolveOpen = resolve;
    });

    const launched = showMobileWalletLauncher(
      {
        provider: 'solflare',
        walletName: 'Solflare',
        returnTarget: 'standalone',
        open: openReady,
      },
      focusManager,
    );

    const button = document.querySelector<HTMLButtonElement>('.wallet-app-launch-button');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe('Preparing Solflare...');
    expect(document.querySelector('.wallet-picker-backdrop')).not.toBeNull();
    expect(document.querySelector('.wallet-connection-copy-button')).toBeNull();

    const open = vi.fn(async () => {});
    resolveOpen(open);
    await vi.waitFor(() => expect(button?.disabled).toBe(false));
    button?.click();
    await expect(launched).resolves.toBe('opened');
    expect(open).toHaveBeenCalledOnce();
  });

  it('uses browser-specific return guidance and exposes it to assistive technology', async () => {
    const focusManager = {
      open: vi.fn(() => ({ focusFirst: vi.fn(), release: vi.fn() })),
    } as unknown as FocusManager;
    const { showMobileWalletLauncher } = await import('../src/ui/mobile_wallet_launcher');

    void showMobileWalletLauncher(
      {
        provider: 'solflare',
        walletName: 'Solflare',
        returnTarget: 'browser',
        open: Promise.resolve(vi.fn(async () => {})),
      },
      focusManager,
    );

    expect(document.querySelector('#mobile-wallet-return-help')?.textContent).toBe(
      'Return to this browser tab.',
    );
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toContain(
      'mobile-wallet-return-help',
    );
  });
});
