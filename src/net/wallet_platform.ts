export type WalletWebPlatform = 'desktop-web' | 'ios-web' | 'android-web';
/** Deep-link wallets the game opens on mobile web (not Wallet Standard). */
export type MobileDeeplinkWalletProvider = 'wocwallet' | 'phantom' | 'solflare';
export type MobileWalletProvider = MobileDeeplinkWalletProvider;

export interface WalletStandaloneIdentity {
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
}

export interface WalletBrowserIdentity {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export function detectWalletPlatform(identity: WalletBrowserIdentity): WalletWebPlatform {
  if (/android/i.test(identity.userAgent)) return 'android-web';
  const iphoneOrIpad = /iPhone|iPad|iPod/i.test(identity.userAgent);
  const ipadDesktopMode = identity.platform === 'MacIntel' && identity.maxTouchPoints > 1;
  return iphoneOrIpad || ipadDesktopMode ? 'ios-web' : 'desktop-web';
}

export function currentWalletPlatform(): WalletWebPlatform {
  if (typeof navigator === 'undefined') return 'desktop-web';
  return detectWalletPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

export function isStandaloneWalletWebApp(identity: WalletStandaloneIdentity): boolean {
  return identity.displayModeStandalone || identity.navigatorStandalone;
}

export function currentStandaloneWalletWebApp(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return isStandaloneWalletWebApp({
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
}

/**
 * Match injected Wallet Standard names to a deep-link provider id.
 * "WOC Wallet" must match `wocwallet` (alphanumerics only), not a naive
 * substring of the id.
 */
export function hasInjectedWallet(
  names: readonly string[],
  provider: MobileWalletProvider,
): boolean {
  const needle = provider.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return names.some((name) => {
    const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalized.includes(needle);
  });
}

export function walletConnectionOptionsForPlatform(
  platform: WalletWebPlatform,
  injectedWalletNames: readonly string[],
  standalone = false,
): { mobileProviders: MobileWalletProvider[]; reown: boolean } {
  if (platform === 'desktop-web') return { mobileProviders: [], reown: true };
  // WOC Wallet first: first-party option for World of ClaudeCraft mobile.
  const supportedProviders: readonly MobileWalletProvider[] = standalone
    ? []
    : ['wocwallet', 'phantom', 'solflare'];
  const mobileProviders = supportedProviders.filter(
    (provider) => !hasInjectedWallet(injectedWalletNames, provider),
  );
  return { mobileProviders, reown: false };
}
