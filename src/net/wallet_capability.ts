export interface WalletCapabilityBridge {
  walletConnectionSupported?(): Promise<boolean>;
}

/** Resolve the host capability before downloading or rendering wallet code. */
export async function resolveWalletCapability(input: {
  disabled: boolean;
  nativeApp: boolean;
  desktopApp: boolean;
  bridge: WalletCapabilityBridge | null;
}): Promise<boolean> {
  if (input.disabled || input.nativeApp) return false;
  if (!input.desktopApp) return true;
  try {
    return (await input.bridge?.walletConnectionSupported?.()) === true;
  } catch {
    return false;
  }
}
