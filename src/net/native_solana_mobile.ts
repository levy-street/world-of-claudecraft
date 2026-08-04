import type {
  SolanaMobileCapabilities,
  SolanaMobileDevice,
  SolanaMobileDistribution,
  WalletCapabilityBridge,
} from './wallet_capability';

interface NativeSolanaMobilePlugin {
  getCapabilities(): Promise<Partial<SolanaMobileCapabilities>>;
  current(): Promise<{ address?: unknown }>;
  connect(): Promise<{ address?: unknown }>;
  disconnect(): Promise<void>;
  signMessage(options: { message: string }): Promise<{ signature?: unknown }>;
  signAndSendTransaction(options: { transaction: string }): Promise<{ signature?: unknown }>;
}

function nativePlugin(): NativeSolanaMobilePlugin | null {
  const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor;
  const plugin = capacitor?.Plugins?.NativeSolanaMobile;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Partial<NativeSolanaMobilePlugin>;
  return typeof candidate.getCapabilities === 'function' &&
    typeof candidate.current === 'function' &&
    typeof candidate.connect === 'function' &&
    typeof candidate.disconnect === 'function' &&
    typeof candidate.signMessage === 'function' &&
    typeof candidate.signAndSendTransaction === 'function'
    ? (candidate as NativeSolanaMobilePlugin)
    : null;
}

function distribution(value: unknown): SolanaMobileDistribution {
  return value === 'solana-dapp-store' || value === 'google-play' ? value : 'unknown';
}

function device(value: unknown): SolanaMobileDevice {
  return value === 'seeker' || value === 'other' ? value : 'unknown';
}

export function normalizeSolanaMobileCapabilities(
  value: Partial<SolanaMobileCapabilities> | null,
): SolanaMobileCapabilities {
  return {
    distribution: distribution(value?.distribution),
    device: device(value?.device),
    mwaAvailable: value?.mwaAvailable === true,
  };
}

export const nativeSolanaMobileBridge: WalletCapabilityBridge = {
  async solanaMobileCapabilities() {
    const plugin = nativePlugin();
    if (!plugin) {
      return normalizeSolanaMobileCapabilities(null);
    }
    return normalizeSolanaMobileCapabilities(await plugin.getCapabilities());
  },
};

function requirePlugin(): NativeSolanaMobilePlugin {
  const plugin = nativePlugin();
  if (!plugin) throw new Error('native Solana Mobile bridge unavailable');
  return plugin;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value;
}

export async function connectNativeSolanaWallet(): Promise<string> {
  const result = await requirePlugin().connect();
  return requiredString(result.address, 'native wallet returned no address');
}

export async function currentNativeSolanaWallet(): Promise<string | null> {
  const result = await requirePlugin().current();
  return typeof result.address === 'string' && result.address.trim() ? result.address : null;
}

export async function disconnectNativeSolanaWallet(): Promise<void> {
  await requirePlugin().disconnect();
}

export async function signNativeSolanaMessage(message: string): Promise<string> {
  const result = await requirePlugin().signMessage({ message });
  return requiredString(result.signature, 'native wallet returned no signature');
}

export async function signAndSendNativeSolanaTransaction(transaction: string): Promise<string> {
  const result = await requirePlugin().signAndSendTransaction({ transaction });
  return requiredString(result.signature, 'native wallet returned no transaction signature');
}

export interface NativeSolanaWalletState {
  address: string | null;
  isConnected: boolean;
}

export interface NativeSolanaWalletClient {
  current(): Promise<NativeSolanaWalletState>;
  connect(): Promise<NativeSolanaWalletState>;
  disconnect(): Promise<void>;
  signMessageBase58(message: string): Promise<string>;
  signAndSendTransactionBase64(transaction: string): Promise<string>;
  onChange(listener: (state: NativeSolanaWalletState) => void): () => void;
}

export function createNativeSolanaWalletClient(): NativeSolanaWalletClient {
  const listeners = new Set<(state: NativeSolanaWalletState) => void>();
  let address: string | null = null;
  const state = (): NativeSolanaWalletState => ({
    address,
    isConnected: address !== null,
  });
  const emit = (): void => {
    const value = state();
    for (const listener of listeners) listener(value);
  };
  return {
    async current() {
      address = await currentNativeSolanaWallet();
      return state();
    },
    async connect() {
      address = await connectNativeSolanaWallet();
      emit();
      return state();
    },
    async disconnect() {
      await disconnectNativeSolanaWallet();
      address = null;
      emit();
    },
    signMessageBase58: signNativeSolanaMessage,
    signAndSendTransactionBase64: signAndSendNativeSolanaTransaction,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
