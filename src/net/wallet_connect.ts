// Reown AppKit transport for external Solana wallet apps. The dedicated
// Solana adapter is loaded only after this option is selected so normal game
// boot does not download AppKit or Solana Web3. The server challenge remains
// authoritative for account linking; this module only supplies a temporary
// signing connection.

import type { Provider } from '@reown/appkit-adapter-solana';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export interface WalletConnectState {
  address: string | null;
  chain: string | null;
}

export interface WalletConnectClient {
  current(): WalletConnectState;
  refresh(): WalletConnectState;
  connect(): Promise<WalletConnectState>;
  disconnect(): Promise<void>;
  signMessageBase58(message: string): Promise<string>;
  signAndSendTransactionBase64(transactionBase64: string): Promise<string>;
  onChange(listener: (state: WalletConnectState) => void): () => void;
}

interface AppKitAccountSource {
  isConnected?: boolean;
  allAccounts?: Array<{ namespace?: string; address?: string }>;
}

export const FEATURED_WALLET_IDS = [
  // Phantom, Solflare, Backpack.
  'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393',
  '1ca0bdd4747578705b1939af023d120677c64fe6ca76add81fda36e350605e79',
  '2bd8c14e035c2d48f184aaa168559e86b0e3433228d3c4075900a221785019b0',
] as const;

export type WalletConnectModalView = 'Connect' | 'ConnectingWalletConnectBasic';

export interface WalletConnectRuntimeOptions {
  registerWalletStandard: false;
  modalView: WalletConnectModalView;
  allWallets: 'SHOW' | 'HIDE';
  enableWalletGuide: boolean;
}

export function walletConnectRuntimeOptions(protocol: string): WalletConnectRuntimeOptions {
  const packagedDesktop = protocol === 'app:';
  return {
    // AppKit is used directly below. Registering its Wallet Standard shim as well
    // feeds a second, non-functional "WalletConnect" choice back into our own picker.
    registerWalletStandard: false,
    // Electron cannot see extensions installed in the user's normal browser profile.
    // Open its supported cross-device QR pairing route directly instead of offering
    // extension-only wallet entries that will always report "Not Detected".
    modalView: packagedDesktop ? 'ConnectingWalletConnectBasic' : 'Connect',
    allWallets: packagedDesktop ? 'HIDE' : 'SHOW',
    enableWalletGuide: !packagedDesktop,
  };
}

export function parseAppKitAccountState(
  account: AppKitAccountSource | null | undefined,
  chain: string | null | undefined,
): WalletConnectState {
  if (!account?.isConnected) return { address: null, chain: null };
  const address = account.allAccounts?.find(
    (candidate) => candidate.namespace === 'solana' && !!candidate.address,
  )?.address;
  if (!address || !chain?.startsWith('solana:')) return { address: null, chain: null };
  return { address, chain };
}

function base64ToBytes(encoded: string): Uint8Array {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function deserializeSolanaTransaction(
  transactionBase64: string,
): Transaction | VersionedTransaction {
  const bytes = base64ToBytes(transactionBase64);
  const versioned = VersionedTransaction.deserialize(bytes);
  return versioned.version === 'legacy' ? Transaction.from(bytes) : versioned;
}

function metadataUrl(): string {
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return window.location.origin;
  }
  return 'https://worldofclaudecraft.com';
}

function connectionCancelled(): Error {
  const error = new Error('wallet connection cancelled');
  error.name = 'WalletConnectionCancelled';
  return error;
}

export async function createWalletConnectClient(projectId: string): Promise<WalletConnectClient> {
  const [{ createAppKit }, { SolanaAdapter }, { solana }] = await Promise.all([
    import('@reown/appkit'),
    import('@reown/appkit-adapter-solana'),
    import('@reown/appkit/networks'),
  ]);
  const runtime = walletConnectRuntimeOptions(
    typeof window === 'undefined' ? '' : window.location.protocol,
  );
  const adapter = new SolanaAdapter({ registerWalletStandard: runtime.registerWalletStandard });
  const appKit = createAppKit({
    adapters: [adapter],
    projectId,
    networks: [solana],
    defaultNetwork: solana,
    metadata: {
      name: 'World of ClaudeCraft',
      description: 'Connect a Solana wallet to World of ClaudeCraft',
      url: metadataUrl(),
      icons: ['https://worldofclaudecraft.com/icons/icon-512.png'],
    },
    featuredWalletIds: [...FEATURED_WALLET_IDS],
    allWallets: runtime.allWallets,
    enableNetworkSwitch: false,
    enableWalletGuide: runtime.enableWalletGuide,
    enableMobileFullScreen: true,
    experimental_preferUniversalLinks: true,
    themeMode: 'dark',
    termsConditionsUrl: 'https://worldofclaudecraft.com/terms',
    privacyPolicyUrl: 'https://worldofclaudecraft.com/privacy',
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    },
  });

  const listeners = new Set<(state: WalletConnectState) => void>();
  const readState = (): WalletConnectState =>
    parseAppKitAccountState(
      appKit.getAccount('solana'),
      appKit.getCaipNetwork('solana')?.caipNetworkId,
    );
  let state = readState();
  const emit = (): void => {
    const next = readState();
    if (next.address === state.address && next.chain === state.chain) return;
    state = next;
    for (const listener of listeners) listener(state);
  };
  appKit.subscribeAccount(emit, 'solana');
  appKit.subscribeNetwork(emit);

  function requireProvider(): Provider {
    if (!state.address) throw new Error('connect a wallet first');
    const provider = appKit.getProvider<Provider>('solana');
    if (!provider) throw new Error('connected Solana wallet provider is unavailable');
    return provider;
  }

  return {
    current: () => state,
    refresh: () => {
      emit();
      return state;
    },
    async connect() {
      const existing = readState();
      if (existing.address && existing.chain) {
        state = existing;
        return state;
      }

      let abortConnection = (_error: unknown): void => {};
      let markModalOpened = (): void => {};
      let refreshConnection = (): void => {};
      const connected = new Promise<WalletConnectState>((resolve, reject) => {
        let modalOpened = false;
        let settled = false;
        const timeout = globalThis.setTimeout(() => {
          cancel(new Error('wallet connection timed out'));
        }, 120_000);
        const cleanup = (): void => {
          globalThis.clearTimeout(timeout);
          accountOff();
          stateOff();
        };
        const finish = (result: WalletConnectState): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };
        const cancel = (error: unknown = connectionCancelled()): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        abortConnection = cancel;
        markModalOpened = () => {
          modalOpened = true;
        };
        refreshConnection = () => {
          emit();
          if (state.address && state.chain) finish(state);
        };
        const accountOff = appKit.subscribeAccount(() => {
          refreshConnection();
        }, 'solana');
        const stateOff = appKit.subscribeState((next) => {
          if (next.open) modalOpened = true;
          else if (modalOpened && !state.address) cancel();
        });
      });

      try {
        await appKit.open({ view: runtime.modalView, namespace: 'solana' });
        if (appKit.isOpen()) markModalOpened();
        refreshConnection();
      } catch (error) {
        abortConnection(error);
      }
      try {
        return await connected;
      } catch (error) {
        // Release any incomplete pairing proposal so a retry starts cleanly.
        await appKit.disconnect('solana').catch(() => {});
        throw error;
      }
    },
    async disconnect() {
      await appKit.disconnect('solana');
      state = { address: null, chain: null };
      for (const listener of listeners) listener(state);
    },
    async signMessageBase58(message) {
      const signature = await requireProvider().signMessage(new TextEncoder().encode(message));
      if (!(signature instanceof Uint8Array) || signature.byteLength === 0) {
        throw new Error('wallet message signing returned an invalid signature');
      }
      return bs58.encode(signature);
    },
    async signAndSendTransactionBase64(transactionBase64) {
      const signature = await requireProvider().signAndSendTransaction(
        deserializeSolanaTransaction(transactionBase64),
        { preflightCommitment: 'confirmed' },
      );
      if (typeof signature !== 'string' || signature.length === 0) {
        throw new Error('wallet transaction signing returned an invalid signature');
      }
      return signature;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
