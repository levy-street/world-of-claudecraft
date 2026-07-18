import type { WalletOption, WalletPickerResult } from './wallet';

export interface DesktopWalletManagerView {
  options: WalletOption[];
  selectedId: string | null;
}

export type DesktopWalletManagerAction = 'authorize' | 'disconnect' | 'cancel';

export async function disconnectDesktopWalletSession(
  disconnectProvider: () => Promise<void>,
  markDisconnected: () => void,
): Promise<void> {
  try {
    await disconnectProvider();
  } finally {
    markDisconnected();
  }
}

export function desktopWalletManagerView(
  options: readonly WalletOption[],
  browserSessionActive: boolean,
): DesktopWalletManagerView {
  const browserOptionId = options[0]?.id ?? null;
  const mapped = options.map((option, index) => ({
    ...option,
    connected: option.connected || (browserSessionActive && index === 0),
  }));
  const connected = mapped.find((option) => option.connected)?.id ?? null;
  return {
    options: mapped,
    selectedId: connected ?? (browserSessionActive ? browserOptionId : null),
  };
}

export function desktopWalletManagerAction(result: WalletPickerResult): DesktopWalletManagerAction {
  if (result === null) return 'cancel';
  return typeof result === 'string' ? 'authorize' : 'disconnect';
}
