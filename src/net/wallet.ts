// Non-custodial Solana wallet connection through Wallet Standard. The
// account↔wallet *link* is performed by the server after the wallet signs a
// challenge (see src/net/online.ts + server/wallet.ts).
//
// Lives in src/net/ and is never imported by src/sim/: the deterministic core
// stays free of network/wallet dependencies.

import { isSolanaChain } from '@solana/wallet-standard-chains';
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
} from '@solana/wallet-standard-features';
import { getWallets, type Wallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsChangeProperties,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import bs58 from 'bs58';
import { apiUrl } from '../client_origin';
import type {
  MobileWalletClient,
  MobileWalletLauncher,
  MobileWalletState,
} from './mobile_wallet_deeplink';
import type { WalletConnectClient, WalletConnectState } from './wallet_connect';
import {
  currentStandaloneWalletWebApp,
  currentWalletPlatform,
  type MobileDeeplinkWalletProvider,
  type MobileWalletProvider,
  walletConnectionOptionsForPlatform,
} from './wallet_platform';

export interface WalletState {
  address: string | null;
  isConnected: boolean;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: WalletIcon;
  connected: boolean;
}

export type WalletPickerResult = string | { action: 'disconnect' } | null;
export type WalletPickerMode = 'desktop' | 'mobile' | 'standalone';

type CompatibleWallet = Wallet & StandardConnectFeature & SolanaSignMessageFeature;
type WalletPicker = (
  wallets: readonly WalletOption[],
  selectedId: string | null,
  mode: WalletPickerMode,
) => Promise<WalletPickerResult>;
type ConnectApi = StandardConnectFeature[typeof StandardConnect];
type DisconnectApi = StandardDisconnectFeature[typeof StandardDisconnect];
type EventsApi = StandardEventsFeature[typeof StandardEvents];
type SignMessageApi = SolanaSignMessageFeature[typeof SolanaSignMessage];
type SignAndSendTransactionApi =
  SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction];

class WalletSelectionCancelled extends Error {
  constructor() {
    super('wallet selection cancelled');
    this.name = 'WalletSelectionCancelled';
  }
}

const SELECTED_WALLET_KEY = 'woc.wallet.standard.selectedWallet';
export const WALLET_CONNECT_ID = 'woc.walletconnect';
export const WALLET_CONNECT_NAME = 'Wallet app or QR code';
export const WALLET_CONNECT_ICON =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="14" fill="%233b82f6"/%3E%3Cpath d="M18 27c8-8 20-8 28 0l3 3-5 5-3-3c-5-5-13-5-18 0l-3 3-5-5 3-3Zm5 10 5-5 4 4 4-4 5 5-9 9-9-9Z" fill="white"/%3E%3C/svg%3E' as WalletIcon;
const MOBILE_WALLET_IDS: Record<MobileWalletProvider, string> = {
  phantom: 'woc.mobile.phantom',
  solflare: 'woc.mobile.solflare',
};
const MOBILE_WALLET_NAMES: Record<MobileWalletProvider, string> = {
  phantom: 'Phantom',
  solflare: 'Solflare',
};
const MOBILE_WALLET_ICONS: Record<MobileWalletProvider, WalletIcon> = {
  phantom:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="14" fill="%23551bf9"/%3E%3Cpath d="M15 35c0-12 7-21 18-21 10 0 17 8 17 18 0 11-6 18-13 18-4 0-6-2-7-5-2 3-4 5-8 5-5 0-7-4-7-9v-6Zm12-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="white"/%3E%3C/svg%3E' as WalletIcon,
  solflare:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="8" y1="8" x2="56" y2="56"%3E%3Cstop stop-color="%23ffef58"/%3E%3Cstop offset=".5" stop-color="%23ff7a00"/%3E%3Cstop offset="1" stop-color="%23a51dff"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="64" height="64" rx="14" fill="%23120e18"/%3E%3Cpath d="M15 38h34L32 51 15 38Zm0-12h34L32 13 15 26Z" fill="url(%23g)"/%3E%3C/svg%3E' as WalletIcon,
};

const listeners = new Set<(state: WalletState) => void>();
const modalListeners = new Set<(open: boolean) => void>();
let walletPicker: WalletPicker | null = null;
let registry: Wallets | null = null;
let initialized = false;
let selectedWallet: CompatibleWallet | null = null;
let selectedAccount: WalletAccount | null = null;
let selectedWalletEventsOff: (() => void) | null = null;
let registryOff: (() => void) | null = null;
let registryUnregisterOff: (() => void) | null = null;
let pickerOpen = false;
let walletConnectProjectId: string | null = null;
let walletConnectClient: WalletConnectClient | null = null;
let walletConnectLoading: Promise<WalletConnectClient> | null = null;
let walletConnectAddress: string | null = null;
let walletConnectSelected = false;
let walletConnectOptionId = WALLET_CONNECT_ID;
let walletConnectOff: (() => void) | null = null;
let mobileWalletLauncher: MobileWalletLauncher | null = null;
let mobileWalletClient: MobileWalletClient | null = null;
let mobileWalletLoading: Promise<MobileWalletClient> | null = null;
let mobileWalletProvider: MobileDeeplinkWalletProvider | null = null;
let mobileWalletAddress: string | null = null;
let mobileWalletSelected = false;
let mobileWalletOff: (() => void) | null = null;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function walletConnectionsDisabledHere(): boolean {
  return currentWalletPlatform() !== 'desktop-web' && currentStandaloneWalletWebApp();
}

function readStoredWalletName(): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(SELECTED_WALLET_KEY);
  } catch {
    return null;
  }
}

function writeStoredWalletName(name: string | null): void {
  if (!canUseStorage()) return;
  try {
    if (name) window.localStorage.setItem(SELECTED_WALLET_KEY, name);
    else window.localStorage.removeItem(SELECTED_WALLET_KEY);
  } catch {
    // Storage can be disabled in private browsing. Wallet state still works for
    // the current page; it just will not silently reconnect after reload.
  }
}

function walletId(wallet: Wallet): string {
  return wallet.name;
}

function hasConnectFeature(wallet: Wallet): wallet is Wallet & StandardConnectFeature {
  return StandardConnect in wallet.features;
}

function hasDisconnectFeature(wallet: Wallet): wallet is Wallet & StandardDisconnectFeature {
  return StandardDisconnect in wallet.features;
}

function hasEventsFeature(wallet: Wallet): wallet is Wallet & StandardEventsFeature {
  return StandardEvents in wallet.features;
}

function hasSignMessageFeature(wallet: Wallet): wallet is Wallet & SolanaSignMessageFeature {
  return SolanaSignMessage in wallet.features;
}

function hasSignAndSendFeature(
  wallet: Wallet,
): wallet is Wallet & SolanaSignAndSendTransactionFeature {
  return SolanaSignAndSendTransaction in wallet.features;
}

function connectFeature(wallet: CompatibleWallet): ConnectApi {
  return wallet.features[StandardConnect] as ConnectApi;
}

function disconnectFeature(wallet: Wallet): DisconnectApi | null {
  return hasDisconnectFeature(wallet)
    ? (wallet.features[StandardDisconnect] as DisconnectApi)
    : null;
}

function eventsFeature(wallet: Wallet): EventsApi | null {
  return hasEventsFeature(wallet) ? (wallet.features[StandardEvents] as EventsApi) : null;
}

function signMessageFeature(wallet: CompatibleWallet): SignMessageApi {
  return wallet.features[SolanaSignMessage] as SignMessageApi;
}

function signAndSendFeature(wallet: CompatibleWallet): SignAndSendTransactionApi {
  if (!hasSignAndSendFeature(wallet)) throw new Error('wallet cannot sign and send transactions');
  return wallet.features[SolanaSignAndSendTransaction] as SignAndSendTransactionApi;
}

function accountSupportsSolanaSignMessage(account: WalletAccount): boolean {
  return account.chains.some(isSolanaChain) && account.features.includes(SolanaSignMessage);
}

function walletSupportsSolana(wallet: Wallet): boolean {
  return (
    wallet.chains.some(isSolanaChain) ||
    wallet.accounts.some((account) => account.chains.some(isSolanaChain))
  );
}

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return hasConnectFeature(wallet) && hasSignMessageFeature(wallet) && walletSupportsSolana(wallet);
}

function compatibleWallets(): CompatibleWallet[] {
  initWallet();
  return registry?.get().filter(isCompatibleWallet) ?? [];
}

function chooseAccount(
  wallet: CompatibleWallet,
  accounts: readonly WalletAccount[] = wallet.accounts,
): WalletAccount | null {
  return accounts.find(accountSupportsSolanaSignMessage) ?? null;
}

function currentState(): WalletState {
  const address = mobileWalletSelected
    ? mobileWalletAddress
    : walletConnectSelected
      ? walletConnectAddress
      : (selectedAccount?.address ?? null);
  return { address, isConnected: address !== null };
}

export function configureWalletConnect(projectId: string | null): void {
  walletConnectProjectId = projectId?.trim() || null;
}

export function setMobileWalletLauncher(launcher: MobileWalletLauncher | null): () => void {
  mobileWalletLauncher = launcher;
  return () => {
    if (mobileWalletLauncher === launcher) mobileWalletLauncher = null;
  };
}

function mobileProviderForId(id: string): MobileWalletProvider | null {
  if (id === MOBILE_WALLET_IDS.phantom) return 'phantom';
  if (id === MOBILE_WALLET_IDS.solflare) return 'solflare';
  return null;
}

async function loadMobileWalletClient(
  provider: MobileDeeplinkWalletProvider,
): Promise<MobileWalletClient> {
  if (mobileWalletClient && mobileWalletProvider === provider) return mobileWalletClient;
  mobileWalletOff?.();
  mobileWalletOff = null;
  mobileWalletClient = null;
  mobileWalletProvider = provider;
  mobileWalletLoading ??= import('./mobile_wallet_deeplink')
    .then((mod) => mod.createMobileWalletClient(provider, mobileWalletLauncher ?? undefined))
    .then((client) => {
      mobileWalletClient = client;
      mobileWalletOff = client.onChange((state: MobileWalletState) => {
        if (!mobileWalletSelected || mobileWalletProvider !== provider) return;
        const previous = mobileWalletAddress;
        mobileWalletAddress = state.address;
        if (previous !== mobileWalletAddress) emitWalletState();
      });
      return client;
    })
    .finally(() => {
      mobileWalletLoading = null;
    });
  return mobileWalletLoading;
}

async function selectMobileWallet(
  provider: MobileDeeplinkWalletProvider,
  connect: boolean,
): Promise<WalletState> {
  const client = await loadMobileWalletClient(provider);
  let state: MobileWalletState;
  try {
    state = connect ? await client.connect() : client.current();
  } catch (error) {
    if (error instanceof Error && error.name === 'WalletConnectionCancelled') {
      throw new WalletSelectionCancelled();
    }
    throw error;
  }
  const previous = currentState().address;
  detachSelectedWalletEvents();
  selectedWallet = null;
  selectedAccount = null;
  walletConnectSelected = false;
  walletConnectAddress = null;
  walletConnectOptionId = WALLET_CONNECT_ID;
  mobileWalletSelected = true;
  mobileWalletProvider = provider;
  mobileWalletAddress = state.address;
  writeStoredWalletName(MOBILE_WALLET_IDS[provider]);
  if (previous !== mobileWalletAddress) emitWalletState();
  return currentState();
}

async function loadWalletConnectClient(): Promise<WalletConnectClient> {
  if (walletConnectClient) return walletConnectClient;
  const projectId = walletConnectProjectId;
  if (!projectId) throw new Error('external wallet connection is not configured');
  walletConnectLoading ??= import('./wallet_connect')
    .then((mod) => mod.createWalletConnectClient(projectId))
    .then((client) => {
      walletConnectClient = client;
      walletConnectOff?.();
      walletConnectOff = client.onChange((state) => {
        if (!walletConnectSelected) return;
        const previous = walletConnectAddress;
        walletConnectAddress = state.address;
        if (previous !== walletConnectAddress) emitWalletState();
      });
      return client;
    })
    .finally(() => {
      walletConnectLoading = null;
    });
  return walletConnectLoading;
}

async function selectWalletConnect(connect: boolean): Promise<WalletState> {
  const client = await loadWalletConnectClient();
  let state: WalletConnectState;
  try {
    state = connect ? await client.connect() : client.current();
  } catch (error) {
    if (error instanceof Error && error.name === 'WalletConnectionCancelled') {
      throw new WalletSelectionCancelled();
    }
    throw error;
  }
  const previous = currentState().address;
  detachSelectedWalletEvents();
  selectedWallet = null;
  selectedAccount = null;
  mobileWalletSelected = false;
  mobileWalletAddress = null;
  walletConnectSelected = true;
  walletConnectOptionId = WALLET_CONNECT_ID;
  walletConnectAddress = state.address;
  writeStoredWalletName(WALLET_CONNECT_ID);
  if (previous !== walletConnectAddress) emitWalletState();
  return currentState();
}

function emitWalletState(): void {
  const state = currentState();
  for (const cb of listeners) cb(state);
}

function setPickerOpen(open: boolean): void {
  if (pickerOpen === open) return;
  pickerOpen = open;
  for (const cb of modalListeners) cb(open);
}

function setSelected(
  wallet: CompatibleWallet | null,
  account: WalletAccount | null,
  persist: boolean,
): void {
  const previousAddress = currentState().address;
  mobileWalletSelected = false;
  mobileWalletAddress = null;
  walletConnectSelected = false;
  walletConnectAddress = null;
  walletConnectOptionId = WALLET_CONNECT_ID;
  selectedWallet = wallet;
  selectedAccount = account;
  if (persist) writeStoredWalletName(wallet?.name ?? null);
  const nextAddress = selectedAccount?.address ?? null;
  if (previousAddress !== nextAddress) emitWalletState();
}

function detachSelectedWalletEvents(): void {
  if (!selectedWalletEventsOff) return;
  selectedWalletEventsOff();
  selectedWalletEventsOff = null;
}

function attachSelectedWalletEvents(wallet: CompatibleWallet): void {
  detachSelectedWalletEvents();
  const events = eventsFeature(wallet);
  if (!events) return;
  selectedWalletEventsOff = events.on('change', (props: StandardEventsChangeProperties) => {
    if (wallet !== selectedWallet) return;
    if (props.accounts) {
      setSelected(wallet, chooseAccount(wallet, props.accounts), true);
      return;
    }
    setSelected(wallet, chooseAccount(wallet), true);
  });
}

function walletOption(wallet: CompatibleWallet): WalletOption {
  return {
    id: walletId(wallet),
    name: wallet.name,
    icon: wallet.icon,
    connected: selectedWallet === wallet && selectedAccount !== null,
  };
}

function findWallet(id: string): CompatibleWallet | null {
  return compatibleWallets().find((wallet) => walletId(wallet) === id) ?? null;
}

function selectAuthorizedWallet(): boolean {
  const storedName = readStoredWalletName();
  const wallets = compatibleWallets();
  const storedWallet = storedName
    ? (wallets.find((wallet) => wallet.name === storedName) ?? null)
    : null;
  const walletWithAccount =
    storedWallet ?? wallets.find((wallet) => chooseAccount(wallet) !== null) ?? null;
  if (!walletWithAccount) return false;
  const account = chooseAccount(walletWithAccount);
  attachSelectedWalletEvents(walletWithAccount);
  setSelected(walletWithAccount, account, account !== null);
  return account !== null;
}

function trySilentReconnect(): void {
  const storedName = readStoredWalletName();
  if (!storedName) {
    selectAuthorizedWallet();
    return;
  }
  const wallet = compatibleWallets().find((candidate) => candidate.name === storedName) ?? null;
  if (!wallet) return;
  attachSelectedWalletEvents(wallet);
  const existing = chooseAccount(wallet);
  if (existing) {
    setSelected(wallet, existing, true);
    return;
  }
  selectedWallet = wallet;
  connectFeature(wallet)
    .connect({ silent: true })
    .then((result) => {
      if (selectedWallet !== wallet) return;
      setSelected(wallet, chooseAccount(wallet, result.accounts), true);
    })
    .catch(() => {
      if (selectedWallet === wallet) setSelected(wallet, null, false);
    });
}

function attachRegistryEvents(): void {
  if (!registry || registryOff || registryUnregisterOff) return;
  registryOff = registry.on('register', (...wallets) => {
    if (walletConnectSelected || mobileWalletSelected) return;
    const currentId = selectedWallet ? walletId(selectedWallet) : null;
    if (
      currentId &&
      wallets.some((wallet) => wallet.name === currentId && isCompatibleWallet(wallet))
    ) {
      trySilentReconnect();
    } else if (!selectedAccount) {
      selectAuthorizedWallet();
    }
  });
  registryUnregisterOff = registry.on('unregister', (...wallets) => {
    if (!selectedWallet || !wallets.includes(selectedWallet)) return;
    detachSelectedWalletEvents();
    setSelected(null, null, false);
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function setWalletPicker(picker: WalletPicker | null): () => void {
  walletPicker = picker;
  return () => {
    if (walletPicker === picker) walletPicker = null;
  };
}

export function initWallet(): Wallets {
  if (initialized && registry) return registry;
  initialized = true;
  registry = getWallets();
  // Mobile Home Screen apps cannot reliably receive the universal-link return from a
  // wallet app. Keep this context fail-closed, including for an injected provider or a
  // session persisted by the browser before the site was installed.
  if (walletConnectionsDisabledHere()) return registry;
  attachRegistryEvents();
  const storedWallet = readStoredWalletName();
  const storedMobileProvider = storedWallet ? mobileProviderForId(storedWallet) : null;
  if (storedMobileProvider) {
    void selectMobileWallet(storedMobileProvider, false).catch(() => {
      mobileWalletSelected = false;
      mobileWalletAddress = null;
    });
  } else if (storedWallet === WALLET_CONNECT_ID && walletConnectProjectId) {
    void selectWalletConnect(false).catch(() => {
      walletConnectSelected = false;
      walletConnectAddress = null;
    });
  } else {
    trySilentReconnect();
  }
  return registry;
}

export function availableWallets(): readonly WalletOption[] {
  if (walletConnectionsDisabledHere()) return [];
  const options = compatibleWallets().map(walletOption);
  const policy = walletConnectionOptionsForPlatform(
    currentWalletPlatform(),
    options.map((option) => option.name),
    currentStandaloneWalletWebApp(),
  );
  for (const provider of policy.mobileProviders) {
    options.push({
      id: MOBILE_WALLET_IDS[provider],
      name: MOBILE_WALLET_NAMES[provider],
      icon: MOBILE_WALLET_ICONS[provider],
      connected:
        mobileWalletSelected && mobileWalletProvider === provider && mobileWalletAddress !== null,
    });
  }
  if ((policy.reown || walletConnectSelected) && walletConnectProjectId) {
    options.push({
      id: WALLET_CONNECT_ID,
      name: WALLET_CONNECT_NAME,
      icon: WALLET_CONNECT_ICON,
      connected: walletConnectSelected && walletConnectAddress !== null,
    });
  }
  return options;
}

/** Subscribe to connection changes. Fires on connect/disconnect/account switch. */
export function onWalletChange(cb: (state: WalletState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-read a relay-backed wallet after returning from an external mobile app. */
export async function resumeWalletConnection(): Promise<WalletState> {
  const storedWallet = readStoredWalletName();
  if (
    walletConnectionsDisabledHere() ||
    !walletConnectProjectId ||
    storedWallet !== WALLET_CONNECT_ID
  ) {
    return currentState();
  }
  const client = await loadWalletConnectClient();
  client.refresh();
  return selectWalletConnect(false);
}

/** Subscribe to the app-owned wallet picker open/close state. */
export function onWalletModalChange(cb: (open: boolean) => void): () => void {
  modalListeners.add(cb);
  cb(pickerOpen);
  return () => modalListeners.delete(cb);
}

export function isWalletModalOpen(): boolean {
  return pickerOpen;
}

export function isWalletSelectionCancelled(err: unknown): boolean {
  return err instanceof WalletSelectionCancelled;
}

export function currentWallet(): WalletState {
  if (!initialized) initWallet();
  return currentState();
}

export async function connectWallet(walletIdToConnect: string): Promise<WalletState> {
  if (walletConnectionsDisabledHere()) {
    throw new Error('wallet connections are unavailable in the installed mobile web app');
  }
  const mobileProvider = mobileProviderForId(walletIdToConnect);
  if (mobileProvider) return selectMobileWallet(mobileProvider, true);
  if (walletIdToConnect === WALLET_CONNECT_ID) return selectWalletConnect(true);
  const wallet = findWallet(walletIdToConnect);
  if (!wallet) throw new Error('wallet is not available');
  attachSelectedWalletEvents(wallet);
  const result = await connectFeature(wallet).connect();
  const account = chooseAccount(wallet, result.accounts);
  if (!account) throw new Error('wallet did not authorize a Solana account with message signing');
  setSelected(wallet, account, true);
  return currentState();
}

/** Open the Wallet Standard picker, then connect the selected wallet. */
export async function openWalletModal(): Promise<void> {
  initWallet();
  const options = availableWallets();
  let result: WalletPickerResult = null;
  const soleDisconnectedWalletConnect =
    options.length === 1 && options[0]?.id === WALLET_CONNECT_ID && !options[0].connected;
  if (soleDisconnectedWalletConnect) {
    result = WALLET_CONNECT_ID;
  } else if (walletPicker) {
    setPickerOpen(true);
    try {
      result = await walletPicker(
        options,
        mobileWalletSelected && mobileWalletProvider
          ? MOBILE_WALLET_IDS[mobileWalletProvider]
          : walletConnectSelected
            ? walletConnectOptionId
            : selectedWallet
              ? walletId(selectedWallet)
              : null,
        currentWalletPlatform() === 'desktop-web'
          ? 'desktop'
          : currentStandaloneWalletWebApp()
            ? 'standalone'
            : 'mobile',
      );
    } finally {
      setPickerOpen(false);
    }
  } else if (options.length === 1) {
    result = options[0].id;
  }
  if (!result) throw new WalletSelectionCancelled();
  if (typeof result !== 'string') {
    await disconnectWallet();
    return;
  }
  await connectWallet(result);
}

export async function disconnectWallet(): Promise<void> {
  if (mobileWalletSelected) {
    const client = mobileWalletClient;
    const previous = mobileWalletAddress;
    mobileWalletSelected = false;
    mobileWalletAddress = null;
    writeStoredWalletName(null);
    if (previous !== null) emitWalletState();
    if (client) await client.disconnect();
    return;
  }
  if (walletConnectSelected) {
    const client = walletConnectClient;
    const previous = walletConnectAddress;
    walletConnectSelected = false;
    walletConnectAddress = null;
    walletConnectOptionId = WALLET_CONNECT_ID;
    writeStoredWalletName(null);
    if (previous !== null) emitWalletState();
    if (client) await client.disconnect();
    return;
  }
  const wallet = selectedWallet;
  detachSelectedWalletEvents();
  setSelected(null, null, true);
  const disconnect = wallet ? disconnectFeature(wallet) : null;
  if (disconnect) await disconnect.disconnect();
}

/**
 * Ask the connected wallet to sign `message` and return the signature
 * base58-encoded (the encoding the server's verifier expects).
 */
export async function signMessageBase58(message: string): Promise<string> {
  if (mobileWalletSelected && mobileWalletProvider) {
    const client = await loadMobileWalletClient(mobileWalletProvider);
    return client.signMessageBase58(message);
  }
  if (walletConnectSelected) {
    const client = await loadWalletConnectClient();
    return client.signMessageBase58(message);
  }
  const wallet = selectedWallet;
  const account = selectedAccount;
  if (!wallet || !account) throw new Error('connect a wallet first');
  const messageBytes = new TextEncoder().encode(message);
  const results = await signMessageFeature(wallet).signMessage({ account, message: messageBytes });
  const result = results[0];
  if (!result || !(result.signature instanceof Uint8Array))
    throw new Error('wallet returned an invalid signature');
  if (!bytesEqual(result.signedMessage, messageBytes))
    throw new Error('wallet modified the message before signing');
  return bs58.encode(result.signature);
}

function base64ToBytes(encoded: string): Uint8Array {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ask the connected wallet to sign and send a service-built Solana transaction. */
export async function signAndSendTransactionBase64(transactionBase64: string): Promise<string> {
  if (mobileWalletSelected && mobileWalletProvider) {
    const client = await loadMobileWalletClient(mobileWalletProvider);
    return client.signAndSendTransactionBase64(transactionBase64);
  }
  if (walletConnectSelected) {
    const client = await loadWalletConnectClient();
    return client.signAndSendTransactionBase64(transactionBase64);
  }
  const wallet = selectedWallet;
  const account = selectedAccount;
  if (!wallet || !account) throw new Error('connect a wallet first');
  const chain = account.chains.find(isSolanaChain) ?? wallet.chains.find(isSolanaChain);
  if (!chain) throw new Error('wallet did not authorize a Solana chain');
  if (!hasSignAndSendFeature(wallet) || !account.features.includes(SolanaSignAndSendTransaction)) {
    throw new Error('wallet cannot sign and send transactions');
  }
  const results = await signAndSendFeature(wallet).signAndSendTransaction({
    account,
    chain,
    transaction: base64ToBytes(transactionBase64),
    options: { preflightCommitment: 'confirmed' },
  });
  const result = results[0];
  if (!result || !(result.signature instanceof Uint8Array)) {
    throw new Error('wallet returned an invalid transaction signature');
  }
  return bs58.encode(result.signature);
}

// ── $WOC balance ────────────────────────────────────────────────────────────
// Read through the server proxy (GET /api/woc/balance). The Solana RPC endpoint
// and any API key embedded in it live ONLY on the server (see
// server/woc_balance.ts), so nothing secret is inlined into this bundle. The
// Browser requests stay same-origin; packaged clients use their configured API
// origin. In both cases the trusted game server holds the RPC credential.
// `fresh` adds &fresh=1 to bypass the server's per-wallet cache, used when the
// player opens a surface that shows the balance so an on-chain token change is
// reflected (still subject to the route's IP rate-limit).
export async function fetchWocBalance(owner: string, fresh = false): Promise<number | null> {
  try {
    const q = `owner=${encodeURIComponent(owner)}${fresh ? '&fresh=1' : ''}`;
    const res = await fetch(apiUrl(`/api/woc/balance?${q}`));
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: number | null };
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (err) {
    console.error('[wallet] $WOC balance read failed', err);
    return null;
  }
}
