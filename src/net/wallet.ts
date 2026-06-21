// Non-custodial Solana wallet connection via Reown AppKit (formerly
// WalletConnect). This module owns the AppKit instance and the browser-side
// connection; the account↔wallet *link* is performed by the server after the
// wallet signs a challenge (see src/net/online.ts + server/wallet.ts).
//
// Lives in src/net/ and is never imported by src/sim/ — the deterministic core
// stays free of network/wallet dependencies.
import './wallet-polyfill';
import { createAppKit } from '@reown/appkit';
import { solana, solanaDevnet } from '@reown/appkit/networks';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

export interface WalletState {
  address: string | null;
  isConnected: boolean;
}

// The Solana provider AppKit hands back. Message signing is always present;
// transaction signing/sending varies by wallet, so both are optional and we
// feature-detect (prefer signTransaction so WE submit to the $WOC mainnet RPC,
// independent of whichever network the wallet UI happens to be set to).
interface SolanaSignProvider {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction?(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction?(tx: Transaction): Promise<{ signature: string }>;
}

// SPL Memo program (v2). The burn tx carries the quoteId as a memo so the server
// can bind the on-chain payment to the account + action it quoted.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const PROJECT_ID = String(import.meta.env.VITE_REOWN_PROJECT_ID ?? '').trim();

type AppKitInstance = ReturnType<typeof createAppKit>;
let appkit: AppKitInstance | null = null;
const listeners = new Set<(state: WalletState) => void>();

export function initWallet(): AppKitInstance {
  if (appkit) return appkit;
  if (!PROJECT_ID) {
    console.warn('[wallet] VITE_REOWN_PROJECT_ID is not set — add it to .env.local to enable wallet connect.');
  }
  appkit = createAppKit({
    adapters: [new SolanaAdapter()],
    networks: [solana, solanaDevnet],
    projectId: PROJECT_ID || 'MISSING_VITE_REOWN_PROJECT_ID',
    metadata: {
      name: 'World of ClaudeCraft',
      description: 'Link your Solana wallet to your World of ClaudeCraft account.',
      url: window.location.origin,
      icons: [`${window.location.origin}/worldofclaudecraft-logo.png`],
    },
    features: { analytics: false, email: false, socials: false },
  });
  appkit.subscribeAccount((acct) => {
    const address = acct.address ?? null;
    for (const cb of listeners) cb({ address, isConnected: address !== null });
  }, 'solana');
  return appkit;
}

/** Subscribe to connection changes. Fires on connect/disconnect/account switch. */
export function onWalletChange(cb: (state: WalletState) => void): void {
  listeners.add(cb);
}

export function currentWallet(): WalletState {
  if (!appkit) return { address: null, isConnected: false };
  const address = appkit.getAddress('solana') ?? null;
  return { address, isConnected: address !== null };
}

/** Open the Reown modal (connect, or the account view when already connected). */
export async function openWalletModal(): Promise<void> {
  await initWallet().open();
}

export async function disconnectWallet(): Promise<void> {
  if (appkit) await appkit.disconnect('solana');
}

/**
 * Ask the connected wallet to sign `message` and return the signature
 * base58-encoded (the encoding the server's verifier expects).
 */
export async function signMessageBase58(message: string): Promise<string> {
  const provider = initWallet().getProvider<SolanaSignProvider>('solana');
  if (!provider) throw new Error('connect a wallet first');
  const signature = await provider.signMessage(new TextEncoder().encode(message));
  return bs58.encode(signature);
}

// ── $WOC balance ────────────────────────────────────────────────────────────
// The $WOC SPL mint and the RPC endpoint used to read balances. $WOC lives on
// mainnet, so balances are read there regardless of which network the wallet is
// on. Both overridable via env; the mint defaults to the published contract.
const WOC_MINT = String(import.meta.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth').trim();
const SOLANA_RPC = String(import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) connection = new Connection(SOLANA_RPC, 'confirmed');
  return connection;
}

/**
 * Read the connected wallet's $WOC balance (uiAmount, summed across token
 * accounts for the mint). Returns 0 when the wallet holds none, or null if the
 * RPC read fails (network/rate-limit) so the UI can simply omit the balance.
 */
export async function fetchWocBalance(owner: string): Promise<number | null> {
  try {
    const res = await getConnection().getParsedTokenAccountsByOwner(
      new PublicKey(owner),
      { mint: new PublicKey(WOC_MINT) },
    );
    let total = 0;
    for (const { account } of res.value) {
      const amount = account.data.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amount === 'number') total += amount;
    }
    return total;
  } catch (err) {
    console.error('[wallet] $WOC balance read failed', err);
    return null;
  }
}

// ── $WOC payments (burn) ─────────────────────────────────────────────────────
// What the server's /api/identity/quote hands back. Amounts are base-unit
// decimal strings (they can exceed Number.MAX_SAFE_INTEGER), parsed to BigInt
// here. `memo` MUST be included verbatim in the tx so the server can match it.
export interface WocBurnQuote {
  mint: string;
  decimals: number;
  amountBase: string;
  burnBase: string;
  treasuryBase: string;
  treasury: string | null;
  memo: string;
}

/**
 * Build, sign, and submit the $WOC payment for an identity quote: burn the
 * burn-portion, transfer the treasury-portion (if any), and attach the quote's
 * memo — one transaction. Returns the confirmed signature, which the caller
 * hands to /api/identity/confirm. The wallet only signs; we submit to the $WOC
 * mainnet RPC so the burn lands there regardless of the wallet's selected
 * network.
 */
export async function payWocBurn(quote: WocBurnQuote): Promise<string> {
  const provider = initWallet().getProvider<SolanaSignProvider>('solana');
  const address = currentWallet().address;
  if (!provider || !address) throw new Error('connect a wallet first');

  const owner = new PublicKey(address);
  const mint = new PublicKey(quote.mint);
  const ownerAta = getAssociatedTokenAddressSync(mint, owner);
  const burnBase = BigInt(quote.burnBase);
  const treasuryBase = BigInt(quote.treasuryBase);

  const ixs: TransactionInstruction[] = [];
  if (burnBase > 0n) {
    ixs.push(createBurnCheckedInstruction(ownerAta, mint, owner, burnBase, quote.decimals));
  }
  if (treasuryBase > 0n && quote.treasury) {
    const treasury = new PublicKey(quote.treasury);
    const treasuryAta = getAssociatedTokenAddressSync(mint, treasury);
    // Create the treasury's $WOC token account if it doesn't exist yet (no-op
    // when it already does); the payer funds the rent.
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner, treasuryAta, treasury, mint));
    ixs.push(createTransferCheckedInstruction(ownerAta, mint, treasuryAta, owner, treasuryBase, quote.decimals));
  }
  // Memo last: binds this payment to the server-issued quote.
  ixs.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(quote.memo, 'utf8') }));

  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
  tx.add(...ixs);

  // Prefer signTransaction → our own submit (forces the $WOC mainnet RPC). Fall
  // back to the wallet's signAndSendTransaction if that's all it exposes.
  let signature: string;
  if (provider.signTransaction) {
    const signed = await provider.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize());
  } else if (provider.signAndSendTransaction) {
    ({ signature } = await provider.signAndSendTransaction(tx));
  } else {
    throw new Error('this wallet cannot sign transactions');
  }
  // Wait for confirmation so the follow-up /confirm doesn't immediately 409 on
  // an unfinalized tx (the server still independently re-verifies finality).
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

/**
 * Sign and submit a server-built, already-partial-signed transaction (base64) —
 * used for the atomic burn + SNS subdomain mint, where the execution wallet has
 * pre-signed the createSubdomain/transferSubdomain instructions and the player
 * adds the remaining signature (fee payer + burn authority). Returns the
 * confirmed signature for /api/subdomain/confirm.
 */
export async function signAndSubmitServerTx(txBase64: string): Promise<string> {
  const provider = initWallet().getProvider<SolanaSignProvider>('solana');
  if (!provider?.signTransaction) throw new Error('this wallet cannot sign transactions');
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  const connection = getConnection();
  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  const blockhash = tx.recentBlockhash!;
  const lastValidBlockHeight = tx.lastValidBlockHeight ?? (await connection.getBlockHeight()) + 150;
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}
