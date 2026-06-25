// Realm-buyback keeper (#475). The 30% buyback leg of every realm PURCHASE lands
// in the realm buyback vault (in SOL or USDC, whatever the buyer paid). This keeper
// drains that vault on a cadence, swaps the proceeds to $WOC on Jupiter, and BURNS
// the $WOC (deflationary) — the on-chain half of "30% buys $WOC off the DEX and
// burns it". It reuses the proven PayoutKeeper state machine (durable swap->settle,
// TWAP chunking, recover-by-signature crash safety) verbatim; only the I/O wiring
// is realm-specific, and it is the ONLY code that holds the realm vault key.
//
// Multi-tenant safety: the marketplace keeper (payout_keeper.ts) and this keeper
// share the buyback_batches table but own DIFFERENT vaults, so each is scoped to
// its own `source` (this one uses realm_usdc / realm_sol, one keeper per currency
// so a SOL batch and a USDC batch never recover each other). Disabled unless a
// dedicated REALM_BUYBACK_VAULT + its signing secret are configured; the buyer's
// split still accrues to the vault either way, so nothing is lost when it is off.

import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { isSolanaAddress } from './wallet_link';
import { DEFAULT_PAYOUT_POLICY, planTwapChunks, shouldRunBatch, type PayoutPolicy } from './payout_policy';
import { solanaRpc, SOLANA_RPC_URL, parseSplitPayment, fetchFinalizedTransaction, signatureStatus } from './solana_rpc';
import {
  createBuybackBatch, markBatchSwapped, markBatchSettling, markBatchSettled, markBatchFailed,
  openBuybackBatchesBySource, lastSettleAtBySource,
} from './payout_db';
import {
  PayoutKeeper, associatedTokenAccount, burnCheckedIx,
  type PayoutExecutor, type PayoutStore, type KeeperOpts,
} from './payout_keeper';
import { CURRENCIES, type BuyCurrency } from './realm_price';
import { WOC_MINT } from './woc_config';

// keep planTwapChunks/shouldRunBatch referenced via the policy the keeper uses; the
// PayoutKeeper class calls them internally — imported here only for clarity of deps.
void planTwapChunks;
void shouldRunBatch;

const VAULT = (process.env.REALM_BUYBACK_VAULT ?? '').trim();
const VAULT_SECRET = (process.env.REALM_BUYBACK_VAULT_SECRET ?? '').trim();
const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag/v6').trim();
const STALE_MS = 10 * 60 * 1000;

// Native SOL kept in the vault for fees + rent so it stays operational across
// cycles; only the surplus above this is swept into a buyback.
const SOL_RESERVE_LAMPORTS = lamportsEnv('REALM_BUYBACK_SOL_RESERVE', 0.03);

function lamportsEnv(key: string, defaultSol: number): bigint {
  const v = Number(process.env[key]);
  const sol = Number.isFinite(v) && v >= 0 ? v : defaultSol;
  return BigInt(Math.round(sol * 1e9));
}

// Which paid currencies this vault buys back. Defaults to both; an operator can
// restrict it (e.g. only sweep USDC) via REALM_BUYBACK_CURRENCIES=USDC.
function enabledCurrencies(): BuyCurrency[] {
  const raw = (process.env.REALM_BUYBACK_CURRENCIES ?? 'USDC,SOL')
    .split(',')
    .map((s) => s.trim().toUpperCase());
  return (['USDC', 'SOL'] as BuyCurrency[]).filter((c) => raw.includes(c));
}

export function realmBuybackConfigured(): boolean {
  return isSolanaAddress(VAULT) && VAULT_SECRET.length > 0 && enabledCurrencies().length > 0;
}

// Per-currency batch policy (thresholds are in the INPUT token's base units). USDC
// reuses the marketplace defaults (6dp); SOL gets lamport-scaled defaults (9dp).
function policyFor(currency: BuyCurrency): PayoutPolicy {
  if (currency === 'SOL') {
    return {
      thresholdUsdc: lamportsEnv('REALM_BUYBACK_SOL_THRESHOLD', 0.05),
      minBatchUsdc: lamportsEnv('REALM_BUYBACK_SOL_MIN_BATCH', 0.02),
      cadenceMs: DEFAULT_PAYOUT_POLICY.cadenceMs,
      twapSplitAboveUsdc: lamportsEnv('REALM_BUYBACK_SOL_TWAP_SPLIT_ABOVE', 5),
      twapChunkUsdc: lamportsEnv('REALM_BUYBACK_SOL_TWAP_CHUNK', 1),
      maxSlippageBps: DEFAULT_PAYOUT_POLICY.maxSlippageBps,
    };
  }
  return DEFAULT_PAYOUT_POLICY;
}

let cachedWocDecimals: number | null = null;
async function wocDecimals(): Promise<number> {
  if (cachedWocDecimals !== null) return cachedWocDecimals;
  const res = await solanaRpc<{ value?: { decimals?: number } }>('getTokenSupply', [WOC_MINT]);
  const d = res?.value?.decimals;
  if (typeof d !== 'number') throw new Error('could not read $WOC mint decimals');
  cachedWocDecimals = d;
  return d;
}

async function vaultTokenBalance(owner: string, mint: string): Promise<bigint> {
  const res = await solanaRpc<{ value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }>(
    'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }],
  );
  let total = 0n;
  for (const a of res?.value ?? []) {
    const amt = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amt === 'string') total += BigInt(amt);
  }
  return total;
}

async function vaultNativeBalance(owner: string): Promise<bigint> {
  const res = await solanaRpc<{ value?: number }>('getBalance', [owner, { commitment: 'confirmed' }]);
  const bal = typeof res?.value === 'number' ? BigInt(Math.trunc(res.value)) : 0n;
  return bal > SOL_RESERVE_LAMPORTS ? bal - SOL_RESERVE_LAMPORTS : 0n;
}

function buildExecutor(vault: Keypair, conn: Connection, currency: BuyCurrency, policy: PayoutPolicy): PayoutExecutor {
  const cfg = CURRENCIES[currency];
  const inputMint = cfg.mint; // USDC mint, or wSOL for native SOL (wrapAndUnwrapSol handles the wrap)
  const wocMint = new PublicKey(WOC_MINT);
  const vaultWocAta = associatedTokenAccount(vault.publicKey, wocMint);

  return {
    vaultUsdcBalance: () => (cfg.native ? vaultNativeBalance(VAULT) : vaultTokenBalance(VAULT, inputMint)),

    async quote(inAmount) {
      const url =
        `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${WOC_MINT}` +
        `&amount=${inAmount.toString()}&slippageBps=${policy.maxSlippageBps.toString()}&swapMode=ExactIn`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
      if (!data.outAmount || !data.routePlan?.length) return null; // no route / thin liquidity
      return { outWoc: BigInt(data.outAmount), raw: data };
    },

    async signSwap(quoteRaw) {
      const res = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteRaw,
          userPublicKey: VAULT,
          wrapAndUnwrapSol: cfg.native,
          dynamicComputeUnitLimit: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`jupiter swap build failed (${res.status})`);
      const { swapTransaction } = (await res.json()) as { swapTransaction: string };
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      tx.sign([vault]);
      const signature = bs58.encode(tx.signatures[0]);
      return { signature, send: async () => { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }); } };
    },

    confirm: signatureStatus,

    async wocReceived(swapSignature) {
      const tx = await fetchFinalizedTransaction(swapSignature);
      if (!tx) return 0n;
      const delta = parseSplitPayment(tx, WOC_MINT).tokenDeltas.get(VAULT) ?? 0n;
      return delta > 0n ? delta : 0n;
    },

    async signSettle(amountWoc) {
      const decimals = await wocDecimals();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const ix = burnCheckedIx(vaultWocAta, wocMint, vault.publicKey, amountWoc, decimals);
      const tx = new Transaction({ feePayer: vault.publicKey, blockhash, lastValidBlockHeight }).add(ix);
      tx.sign(vault);
      const signature = bs58.encode(tx.signature!);
      return { signature, send: async () => { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }); } };
    },
  };
}

function buildStore(source: string): PayoutStore {
  return {
    createBatch: (b) =>
      createBuybackBatch({ batchId: b.batchId, mode: 'burn', source, usdcIn: b.usdcIn, buyTxSig: b.buyTxSig, seasonId: null, dest: null }),
    markSwapped: markBatchSwapped,
    markSettling: markBatchSettling,
    markSettled: markBatchSettled,
    markFailed: markBatchFailed,
    openBatches: () => openBuybackBatchesBySource(source),
    lastSettleAt: () => lastSettleAtBySource(source),
  };
}

export interface RealmBuybackKeeper {
  label: BuyCurrency;
  keeper: PayoutKeeper;
}

// One keeper per enabled currency, or [] when unconfigured. main.ts runs them
// sequentially under withRealmBuybackKeeperLock so sibling realm processes sharing
// the vault never double-swap.
export function buildRealmBuybackKeepers(): RealmBuybackKeeper[] {
  if (!realmBuybackConfigured()) return [];
  const vault = Keypair.fromSecretKey(bs58.decode(VAULT_SECRET));
  if (vault.publicKey.toBase58() !== VAULT) {
    throw new Error('REALM_BUYBACK_VAULT_SECRET does not match REALM_BUYBACK_VAULT');
  }
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  const opts: KeeperOpts = {
    now: () => Date.now(),
    newBatchId: () => randomBytes(16).toString('hex'),
    staleMs: STALE_MS,
  };
  return enabledCurrencies().map((currency) => {
    const policy = policyFor(currency);
    const source = `realm_${currency.toLowerCase()}`;
    return {
      label: currency,
      keeper: new PayoutKeeper(buildExecutor(vault, conn, currency, policy), buildStore(source), policy, opts),
    };
  });
}
