export type SolanaMobileDistribution = 'solana-dapp-store' | 'google-play' | 'unknown';
export type SolanaMobileDevice = 'seeker' | 'other' | 'unknown';

export interface SolanaMobileCapabilities {
  distribution: SolanaMobileDistribution;
  device: SolanaMobileDevice;
  mwaAvailable: boolean;
}

export interface WalletCapabilityBridge {
  walletConnectionSupported?(): Promise<boolean>;
  solanaMobileCapabilities?(): Promise<SolanaMobileCapabilities>;
}

/** Resolve the host capability before downloading or rendering wallet code. */
export async function resolveWalletCapability(input: {
  disabled: boolean;
  nativeApp: boolean;
  desktopApp: boolean;
  bridge: WalletCapabilityBridge | null;
}): Promise<boolean> {
  if (input.disabled) return false;
  if (input.nativeApp) {
    try {
      const capabilities = await input.bridge?.solanaMobileCapabilities?.();
      return (
        capabilities?.distribution === 'solana-dapp-store' &&
        capabilities.device === 'seeker' &&
        capabilities.mwaAvailable === true
      );
    } catch {
      return false;
    }
  }
  if (!input.desktopApp) return true;
  try {
    return (await input.bridge?.walletConnectionSupported?.()) === true;
  } catch {
    return false;
  }
}
