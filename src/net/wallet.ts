import './wallet-polyfill';
// Non-custodial Solana wallet connection through Wallet Standard. The
// account↔wallet *link* is performed by the server after the wallet signs a
// challenge (see src/net/online.ts + server/wallet.ts).
//
// Lives in src/net/ and is never imported by src/sim/: the deterministic core
// stays free of network/wallet dependencies.
import { getWallets, type Wallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsChangeProperties,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import { isSolanaChain } from '@solana/wallet-standard-chains';
import {
  SolanaSignMessage, type SolanaSignMessageFeature,
  SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature,
} from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

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

type CompatibleWallet = Wallet & StandardConnectFeature & SolanaSignMessageFeature;
type WalletPicker = (wallets: readonly WalletOption[], selectedId: string | null) => Promise<string | null>;
type ConnectApi = StandardConnectFeature[typeof StandardConnect];
type DisconnectApi = StandardDisconnectFeature[typeof StandardDisconnect];
type EventsApi = StandardEventsFeature[typeof StandardEvents];
type SignMessageApi = SolanaSignMessageFeature[typeof SolanaSignMessage];

class WalletSelectionCancelled extends Error {
  constructor() {
    super('wallet selection cancelled');
    this.name = 'WalletSelectionCancelled';
  }
}

const SELECTED_WALLET_KEY = 'woc.wallet.standard.selectedWallet';

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

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
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

function connectFeature(wallet: CompatibleWallet): ConnectApi {
  return wallet.features[StandardConnect] as ConnectApi;
}

function disconnectFeature(wallet: Wallet): DisconnectApi | null {
  return hasDisconnectFeature(wallet) ? wallet.features[StandardDisconnect] as DisconnectApi : null;
}

function eventsFeature(wallet: Wallet): EventsApi | null {
  return hasEventsFeature(wallet) ? wallet.features[StandardEvents] as EventsApi : null;
}

function signMessageFeature(wallet: CompatibleWallet): SignMessageApi {
  return wallet.features[SolanaSignMessage] as SignMessageApi;
}

function accountSupportsSolanaSignMessage(account: WalletAccount): boolean {
  return account.chains.some(isSolanaChain) && account.features.includes(SolanaSignMessage);
}

function walletSupportsSolana(wallet: Wallet): boolean {
  return wallet.chains.some(isSolanaChain) || wallet.accounts.some((account) => account.chains.some(isSolanaChain));
}

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return hasConnectFeature(wallet) && hasSignMessageFeature(wallet) && walletSupportsSolana(wallet);
}

function compatibleWallets(): CompatibleWallet[] {
  initWallet();
  return registry?.get().filter(isCompatibleWallet) ?? [];
}

function chooseAccount(wallet: CompatibleWallet, accounts: readonly WalletAccount[] = wallet.accounts): WalletAccount | null {
  return accounts.find(accountSupportsSolanaSignMessage) ?? null;
}

function currentState(): WalletState {
  const address = selectedAccount?.address ?? null;
  return { address, isConnected: address !== null };
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

function setSelected(wallet: CompatibleWallet | null, account: WalletAccount | null, persist: boolean): void {
  const previousAddress = selectedAccount?.address ?? null;
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
  const storedWallet = storedName ? wallets.find((wallet) => wallet.name === storedName) ?? null : null;
  const walletWithAccount = storedWallet ?? wallets.find((wallet) => chooseAccount(wallet) !== null) ?? null;
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
  connectFeature(wallet).connect({ silent: true })
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
    const currentId = selectedWallet ? walletId(selectedWallet) : null;
    if (currentId && wallets.some((wallet) => wallet.name === currentId && isCompatibleWallet(wallet))) {
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
  attachRegistryEvents();
  trySilentReconnect();
  return registry;
}

export function availableWallets(): readonly WalletOption[] {
  return compatibleWallets().map(walletOption);
}

/** Subscribe to connection changes. Fires on connect/disconnect/account switch. */
export function onWalletChange(cb: (state: WalletState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
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
  let id: string | null = null;
  if (walletPicker) {
    setPickerOpen(true);
    try {
      id = await walletPicker(options, selectedWallet ? walletId(selectedWallet) : null);
    } finally {
      setPickerOpen(false);
    }
  } else if (options.length === 1) {
    id = options[0].id;
  }
  if (!id) throw new WalletSelectionCancelled();
  await connectWallet(id);
}

export async function disconnectWallet(): Promise<void> {
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
  const wallet = selectedWallet;
  const account = selectedAccount;
  if (!wallet || !account) throw new Error('connect a wallet first');
  const messageBytes = new TextEncoder().encode(message);
  const results = await signMessageFeature(wallet).signMessage({ account, message: messageBytes });
  const result = results[0];
  if (!result || !(result.signature instanceof Uint8Array)) throw new Error('wallet returned an invalid signature');
  if (!bytesEqual(result.signedMessage, messageBytes)) throw new Error('wallet modified the message before signing');
  return bs58.encode(result.signature);
}

// ── $WOC balance ────────────────────────────────────────────────────────────
// Read through the server proxy (GET /api/woc/balance). The Solana RPC endpoint
// and any API key embedded in it live ONLY on the server (see
// server/woc_balance.ts), so nothing secret is inlined into this bundle. The
// request is same-origin: the server that served this page holds the key.
// `fresh` adds &fresh=1 to bypass the server's per-wallet cache, used when the
// player opens a surface that shows the balance so an on-chain token change is
// reflected (still subject to the route's IP rate-limit).
export async function fetchWocBalance(owner: string, fresh = false): Promise<number | null> {
  try {
    const q = `owner=${encodeURIComponent(owner)}${fresh ? '&fresh=1' : ''}`;
    const res = await fetch(`/api/woc/balance?${q}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: number | null };
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (err) {
    console.error('[wallet] $WOC balance read failed', err);
    return null;
  }
}

// ── Marketplace split payment ────────────────────────────────────────────────
// Build + sign + send the single atomic USDC transaction a creator-skin purchase
// requires: 70% to the creator + 30% to the burn vault + a memo (the quote id).
// Instructions are built on @solana/web3.js; the connected wallet signs and sends
// via the Wallet Standard SolanaSignAndSendTransaction feature. The server
// verifies the resulting on-chain balance deltas, so what matters is that the
// transfers actually land. The USDC mint + recipient owners + exact amounts come
// from the server-issued quote.
//
// RPC and chain MUST be the same cluster — a blockhash fetched from one cluster
// is invalid when the tx is broadcast on another ("blockhash not found"). Both
// default to devnet (Phase 1); prod sets both env vars to its launch cluster.
// VITE_SOLANA_RPC_URL (the mainnet $WOC-balance RPC) is deliberately NOT a
// fallback here, so a misconfigured build can't silently mix clusters.
const MARKET_RPC = String(import.meta.env.VITE_MARKETPLACE_RPC_URL ?? 'https://api.devnet.solana.com').trim();
const MARKET_CHAIN = String(import.meta.env.VITE_MARKETPLACE_CHAIN ?? 'solana:devnet').trim();
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const USDC_DECIMALS = 6;

let paymentConnection: Connection | null = null;
function getPaymentConnection(): Connection {
  if (!paymentConnection) paymentConnection = new Connection(MARKET_RPC, 'confirmed');
  return paymentConnection;
}

// The deterministic Associated Token Account for (owner, mint) under the legacy
// SPL Token program. The buyer tx never creates these (creator + burn vault must
// already hold a USDC ATA; an onboarding precondition), matching the server
// verifier's exactly-two-transfers expectation.
function associatedTokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

// SPL Token `TransferChecked` (tag 12): u8 tag + u64 amount(LE) + u8 decimals.
function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function memoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, 'utf8') });
}

// The split-payment legs from a server quote; amounts are USDC base-unit strings.
export interface SplitPaymentQuote {
  mint: string;
  memo: string;
  creator: { owner: string; amount: string };
  burn: { owner: string; amount: string };
}

/**
 * Build the buyer's atomic 70/30 USDC split-payment transaction from a server
 * quote: two SPL `TransferChecked` legs (creator + burn vault) funded from the
 * buyer's ATA, plus a memo binding the quote id. PURE + deterministic (no wallet,
 * no network) — exactly the shape server `validateSplitPayment` checks — so it is
 * unit-tested in isolation (tests/split_payment_tx.test.ts). The buyer is the sole
 * signing authority and funds both legs; recipient ATAs are NOT created here (an
 * onboarding precondition, mirrored by the verifier's exactly-two-transfers rule).
 */
export function buildSplitPaymentTransaction(q: SplitPaymentQuote, buyer: string, blockhash: string, lastValidBlockHeight: number): Transaction {
  const mint = new PublicKey(q.mint);
  const buyerPk = new PublicKey(buyer);
  const buyerAta = associatedTokenAccount(buyerPk, mint);
  return new Transaction({ feePayer: buyerPk, blockhash, lastValidBlockHeight }).add(
    transferCheckedIx(buyerAta, mint, associatedTokenAccount(new PublicKey(q.creator.owner), mint), buyerPk, BigInt(q.creator.amount), USDC_DECIMALS),
    transferCheckedIx(buyerAta, mint, associatedTokenAccount(new PublicKey(q.burn.owner), mint), buyerPk, BigInt(q.burn.amount), USDC_DECIMALS),
    memoInstruction(q.memo),
  );
}

/**
 * Build + sign + send the buyer's atomic 70/30 USDC split payment via the
 * connected wallet, then wait for the transaction to FINALIZE (the commitment
 * the server verifies against) before returning the signature to hand to
 * /api/marketplace/buy.
 */
export async function signAndSendSplitPayment(q: SplitPaymentQuote): Promise<string> {
  const wallet = selectedWallet;
  const account = selectedAccount;
  if (!wallet || !account) throw new Error('connect a wallet first');
  if (!(SolanaSignAndSendTransaction in wallet.features)) throw new Error('the connected wallet cannot send transactions');
  const sendFeature = (wallet.features as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
  const chain = account.chains.find((c) => c === MARKET_CHAIN) ?? account.chains.find(isSolanaChain);
  if (!chain) throw new Error('the connected wallet has no Solana chain for the marketplace');

  const conn = getPaymentConnection();
  // Default ('confirmed') commitment — a 'finalized' blockhash is ~32 slots old
  // and would halve the tx's validity window before the wallet even signs. The
  // confirmation below still waits for 'finalized' (what the server verifies).
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = buildSplitPaymentTransaction(q, account.address, blockhash, lastValidBlockHeight);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const results = await sendFeature.signAndSendTransaction({ account, chain, transaction: new Uint8Array(wire) });
  const result = results[0];
  if (!result || !(result.signature instanceof Uint8Array)) throw new Error('the wallet returned no transaction signature');
  const signature = bs58.encode(result.signature);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized');
  return signature;
}
