export type WalletWebPlatform = 'desktop-web' | 'ios-web' | 'android-web';
export type MobileDeeplinkWalletProvider = 'phantom' | 'solflare';
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

function hasInjectedWallet(names: readonly string[], provider: MobileWalletProvider): boolean {
  return names.some((name) => name.toLowerCase().includes(provider));
}

export function walletConnectionOptionsForPlatform(
  platform: WalletWebPlatform,
  injectedWalletNames: readonly string[],
  standalone = false,
): { mobileProviders: MobileWalletProvider[]; reown: boolean } {
  if (platform === 'desktop-web') return { mobileProviders: [], reown: true };
  const supportedProviders: readonly MobileWalletProvider[] = standalone
    ? []
    : ['phantom', 'solflare'];
  const mobileProviders = supportedProviders.filter(
    (provider) => !hasInjectedWallet(injectedWalletNames, provider),
  );
  return { mobileProviders, reown: false };
}
