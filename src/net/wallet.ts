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
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export interface WalletState {
  address: string | null;
  isConnected: boolean;
}

// The Solana provider AppKit hands back exposes raw message signing.
interface SolanaSignProvider {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

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
