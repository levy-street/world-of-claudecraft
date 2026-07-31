import { describe, expect, it } from 'vitest';
import {
  detectWalletPlatform,
  hasInjectedWallet,
  isStandaloneWalletWebApp,
  walletConnectionOptionsForPlatform,
} from '../src/net/wallet_platform';

describe('wallet platform options', () => {
  it('detects iPhone, iPadOS, Android, and desktop browsers', () => {
    expect(
      detectWalletPlatform({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toBe('ios-web');
    expect(
      detectWalletPlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('ios-web');
    expect(
      detectWalletPlatform({
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe('android-web');
    expect(
      detectWalletPlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe('desktop-web');
  });

  it('offers wallet-app handoffs on mobile and Reown QR on desktop', () => {
    expect(walletConnectionOptionsForPlatform('ios-web', [])).toEqual({
      mobileProviders: ['wocwallet', 'phantom', 'solflare'],
      reown: false,
    });
    expect(walletConnectionOptionsForPlatform('android-web', [])).toEqual({
      mobileProviders: ['wocwallet', 'phantom', 'solflare'],
      reown: false,
    });
    expect(walletConnectionOptionsForPlatform('desktop-web', [])).toEqual({
      mobileProviders: [],
      reown: true,
    });
    expect(walletConnectionOptionsForPlatform('ios-web', [], true)).toEqual({
      mobileProviders: [],
      reown: false,
    });
  });

  it('does not duplicate a wallet already injected into a mobile wallet browser', () => {
    expect(walletConnectionOptionsForPlatform('ios-web', ['Phantom'])).toEqual({
      mobileProviders: ['wocwallet', 'solflare'],
      reown: false,
    });
    expect(walletConnectionOptionsForPlatform('android-web', ['Solflare Wallet'])).toEqual({
      mobileProviders: ['wocwallet', 'phantom'],
      reown: false,
    });
    expect(walletConnectionOptionsForPlatform('ios-web', ['WOC Wallet'])).toEqual({
      mobileProviders: ['phantom', 'solflare'],
      reown: false,
    });
    expect(walletConnectionOptionsForPlatform('ios-web', ['Backpack'])).toEqual({
      mobileProviders: ['wocwallet', 'phantom', 'solflare'],
      reown: false,
    });
  });

  it('matches injected WOC Wallet names to the wocwallet provider id', () => {
    expect(hasInjectedWallet(['WOC Wallet'], 'wocwallet')).toBe(true);
    expect(hasInjectedWallet(['wocwallet'], 'wocwallet')).toBe(true);
    expect(hasInjectedWallet(['Phantom'], 'wocwallet')).toBe(false);
  });

  it('recognizes both standards-based and legacy iOS standalone mode', () => {
    expect(
      isStandaloneWalletWebApp({ displayModeStandalone: true, navigatorStandalone: false }),
    ).toBe(true);
    expect(
      isStandaloneWalletWebApp({ displayModeStandalone: false, navigatorStandalone: true }),
    ).toBe(true);
    expect(
      isStandaloneWalletWebApp({ displayModeStandalone: false, navigatorStandalone: false }),
    ).toBe(false);
  });
});
