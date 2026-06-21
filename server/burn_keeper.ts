// Buy-and-burn keeper (PRD §4.6 / Phase 2). Periodically drains the marketplace
// burn vault: swaps the accrued USDC for $WOC on Jupiter, then SPL-burns it,
// recording every batch in the public burn ledger. The keeper is the ONLY holder
// of the burn-vault signing key — it is never injected into the quote/verify
// path (server/marketplace.ts), so a compromise of those paths can't move funds.
//
// Design split: ALL orchestration (cadence, TWAP chunking, the durable
// swap→burn state machine, crash recovery) lives in BurnKeeper over an injected
// BurnExecutor/BurnStore — fully unit-tested with fakes. buildProductionDeps()
// is the thin, real I/O wiring (Jupiter REST + @solana/web3.js signing + raw RPC
// reads). Jupiter is mainnet-only, so the live path runs only on a funded mainnet
// deployment; the orchestration is exercised headlessly via the injected fakes.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { isSolanaAddress } from './wallet_link';
import { DEFAULT_BURN_POLICY, planTwapChunks, shouldRunBatch, type BurnPolicy } from './burn_policy';
import { parseSplitPayment, fetchFinalizedTransaction, signatureStatus, solanaRpc, SOLANA_RPC_URL, SPL_TOKEN_PROGRAM } from './solana_rpc';
import {
  createBurnBatch, markBatchSwapped, markBatchBurning, markBatchBurned, markBatchFailed,
  openBurnBatches, lastBurnAt, type BurnBatchRow,
} from './db';

const BURN_VAULT = (process.env.MARKETPLACE_BURN_VAULT ?? '').trim();
const BURN_VAULT_SECRET = (process.env.MARKETPLACE_BURN_VAULT_SECRET ?? '').trim();
const USDC_MINT = (process.env.USDC_MINT ?? process.env.VITE_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();
const WOC_MINT = (process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth').trim();
const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag/v6').trim();
const SPL_ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN_PROGRAM = new PublicKey(SPL_TOKEN_PROGRAM);

// A 'swapping'/'burning' batch this old whose signature still won't confirm is
// treated as never-landed (well past any blockhash validity window), so the
// keeper can't wedge forever on a lost transaction.
const STALE_MS = 10 * 60 * 1000;

function envPolicy(): BurnPolicy {
  const u = (key: string, fallback: bigint): bigint => {
    const v = process.env[key];
    return v && Number.isFinite(Number(v)) ? BigInt(Math.round(Number(v) * 1_000_000)) : fallback;
  };
  const ms = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const bps = process.env.BURN_MAX_SLIPPAGE_BPS;
  return {
    thresholdUsdc: u('BURN_BATCH_THRESHOLD_USDC', DEFAULT_BURN_POLICY.thresholdUsdc),
    minBatchUsdc: u('BURN_MIN_BATCH_USDC', DEFAULT_BURN_POLICY.minBatchUsdc),
    cadenceMs: ms('BURN_CADENCE_MS', DEFAULT_BURN_POLICY.cadenceMs),
    twapSplitAboveUsdc: u('BURN_TWAP_SPLIT_ABOVE_USDC', DEFAULT_BURN_POLICY.twapSplitAboveUsdc),
    twapChunkUsdc: u('BURN_TWAP_CHUNK_USDC', DEFAULT_BURN_POLICY.twapChunkUsdc),
    maxSlippageBps: bps && Number.isFinite(Number(bps)) ? BigInt(Math.round(Number(bps))) : DEFAULT_BURN_POLICY.maxSlippageBps,
  };
}

// The keeper runs only when fully configured: a valid burn vault address + its
// signing secret. Absent these, the server still accepts purchases (the 30%
// accrues), but no swap/burn happens.
export function keeperConfigured(): boolean {
  return isSolanaAddress(BURN_VAULT) && BURN_VAULT_SECRET.length > 0;
}

type ConfirmResult = 'confirmed' | 'failed' | 'unknown';

// Signing + on-chain I/O the keeper drives. Split out so the orchestration is
// testable with a fake and the only key-holding code is the production wiring.
export interface BurnExecutor {
  vaultUsdcBalance(): Promise<bigint>;
  quote(inUsdc: bigint): Promise<{ raw: unknown } | null>;
  signSwap(quoteRaw: unknown): Promise<{ signature: string; send(): Promise<void> }>;
  confirm(signature: string): Promise<ConfirmResult>;
  wocReceived(swapSignature: string): Promise<bigint>;
  signBurn(amountWoc: bigint): Promise<{ signature: string; send(): Promise<void> }>;
}

export interface BurnStore {
  createBatch(b: { batchId: string; usdcIn: bigint; buyTxSig: string }): Promise<boolean>;
  markSwapped(batchId: string, wocBought: bigint): Promise<void>;
  markBurning(batchId: string, burnTxSig: string): Promise<void>;
  markBurned(batchId: string, wocBurned: bigint): Promise<void>;
  markFailed(batchId: string, reason: string): Promise<void>;
  openBatches(): Promise<BurnBatchRow[]>;
  lastBurnAt(): Promise<number | null>;
}

export interface KeeperOpts {
  now: () => number;
  newBatchId: () => string;
  staleMs: number;
}

export class BurnKeeper {
  constructor(
    private readonly exec: BurnExecutor,
    private readonly store: BurnStore,
    private readonly policy: BurnPolicy,
    private readonly opts: KeeperOpts,
  ) {}

  /**
   * One keeper tick. If any batch is still in-flight, finish recovering it before
   * starting new work (so we never run two batches against the same vault pool).
   * Otherwise, if policy says go, drain the vault — TWAP-chunked, each chunk a
   * full swap→burn micro-batch processed in sequence.
   */
  async runCycle(): Promise<void> {
    const open = await this.store.openBatches();
    if (open.length > 0) { await this.recover(open); return; }

    const available = await this.exec.vaultUsdcBalance();
    const last = await this.store.lastBurnAt();
    if (!shouldRunBatch({ availableUsdc: available, lastBurnAt: last, now: this.opts.now(), policy: this.policy })) return;

    for (const chunk of planTwapChunks(available, this.policy)) {
      const completed = await this.swapAndBurn(chunk);
      if (!completed) break; // a no-route / unconfirmed / failed chunk: leave the rest for the next cycle
    }
  }

  private async swapAndBurn(usdcIn: bigint): Promise<boolean> {
    const quote = await this.exec.quote(usdcIn);
    if (!quote) return false; // no route / thin liquidity — leave the USDC, retry next cycle
    const swap = await this.exec.signSwap(quote.raw);
    const batchId = this.opts.newBatchId();
    // Durable intent BEFORE broadcast: a crash after this recovers by buy_tx_sig.
    const fresh = await this.store.createBatch({ batchId, usdcIn, buyTxSig: swap.signature });
    if (!fresh) return false; // this signed swap is already tracked — recovery owns it
    await swap.send();
    const conf = await this.exec.confirm(swap.signature);
    if (conf === 'failed') { await this.store.markFailed(batchId, 'swap reverted (slippage / route)'); return false; }
    if (conf !== 'confirmed') return false; // unknown — left 'swapping' for the next cycle's recovery
    return this.completeSwapped(batchId, swap.signature);
  }

  // Swap confirmed → measure the $WOC actually received from the tx (restart-safe;
  // no balance snapshot needed), then burn exactly that.
  private async completeSwapped(batchId: string, swapSig: string): Promise<boolean> {
    const woc = await this.exec.wocReceived(swapSig);
    if (woc <= 0n) { await this.store.markFailed(batchId, 'swap confirmed but no $WOC received'); return false; }
    await this.store.markSwapped(batchId, woc);
    return this.burn(batchId, woc);
  }

  private async burn(batchId: string, woc: bigint): Promise<boolean> {
    const burnTx = await this.exec.signBurn(woc);
    await this.store.markBurning(batchId, burnTx.signature); // record the burn sig before broadcast
    await burnTx.send();
    const conf = await this.exec.confirm(burnTx.signature);
    if (conf === 'confirmed') { await this.store.markBurned(batchId, woc); return true; }
    return false; // unknown/failed — recovery re-checks (and, if stale, re-issues) the burn
  }

  /** Resolve in-flight batches by their recorded signature — never by re-reading
   *  the vault balance (which could double-swap a lost-confirmation swap). */
  async recover(open?: BurnBatchRow[]): Promise<void> {
    const batches = open ?? await this.store.openBatches();
    for (const b of batches) {
      if (b.status === 'swapping' && b.buyTxSig) {
        const conf = await this.exec.confirm(b.buyTxSig);
        if (conf === 'confirmed') await this.completeSwapped(b.batchId, b.buyTxSig);
        else if (conf === 'failed') await this.store.markFailed(b.batchId, 'swap reverted (slippage / route)');
        // Stale + still 'unknown': do NOT blindly fail — the swap may have landed but
        // be momentarily unreadable. Route through completeSwapped, which measures the
        // $WOC actually received: >0 burns it (recovered, never stranded); 0 fails the
        // batch and leaves the USDC in the vault for the next cycle.
        else if (this.isStale(b)) await this.completeSwapped(b.batchId, b.buyTxSig);
      } else if (b.status === 'swapped') {
        await this.burn(b.batchId, b.wocBought);
      } else if (b.status === 'burning' && b.burnTxSig) {
        const conf = await this.exec.confirm(b.burnTxSig);
        if (conf === 'confirmed') await this.store.markBurned(b.batchId, b.wocBought);
        else if (conf === 'failed' || this.isStale(b)) await this.burn(b.batchId, b.wocBought); // re-issue the burn
      }
    }
  }

  // Staleness is measured from the broadcast of the phase's OWN transaction: the
  // swap (created_at) for a 'swapping' batch, the burn (burn_broadcast_at) for a
  // 'burning' one. Timing 'burning' from created_at would make a batch whose swap
  // confirmed slowly look instantly stale and trigger a premature re-burn.
  private isStale(b: BurnBatchRow): boolean {
    const since = b.status === 'burning' && b.burnBroadcastAt ? b.burnBroadcastAt : b.createdAt;
    return this.opts.now() - new Date(since).getTime() > this.opts.staleMs;
  }
}

// --------------------------------------------------------------------------
// Production wiring (real Jupiter REST + @solana/web3.js signing + raw RPC).
// The ONLY code that touches the burn-vault key.
// --------------------------------------------------------------------------

// Exported for the encoding test (tests/burn_keeper_encoding.test.ts) — pure, no I/O.
export function associatedTokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], SPL_ATA_PROGRAM)[0];
}

// SPL Token `BurnChecked` (tag 15): u8 tag + u64 amount(LE) + u8 decimals.
export function burnCheckedIx(ata: PublicKey, mint: PublicKey, authority: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(15, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
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

export function buildProductionDeps(): { exec: BurnExecutor; store: BurnStore } {
  const vault = Keypair.fromSecretKey(bs58.decode(BURN_VAULT_SECRET));
  if (vault.publicKey.toBase58() !== BURN_VAULT) {
    throw new Error('MARKETPLACE_BURN_VAULT_SECRET does not match MARKETPLACE_BURN_VAULT');
  }
  // One RPC for the whole keeper: reads go through solana_rpc.ts (SOLANA_RPC_URL)
  // and the broadcast/blockhash Connection uses the SAME URL, so a confirm can
  // never look at a different cluster than where the swap was sent.
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  const policy = envPolicy();

  const exec: BurnExecutor = {
    vaultUsdcBalance: () => vaultTokenBalance(BURN_VAULT, USDC_MINT),

    async quote(inUsdc) {
      // slippageBps is the binding slippage cap: Jupiter bakes it into the quote's
      // otherAmountThreshold, which signSwap passes straight to /swap, so the
      // on-chain swap instruction REVERTS if it would receive less. The cap is
      // enforced by the chain, not by us trusting the quoted out-amount.
      const url = `${JUPITER_API}/quote?inputMint=${USDC_MINT}&outputMint=${WOC_MINT}&amount=${inUsdc.toString()}&slippageBps=${policy.maxSlippageBps.toString()}&swapMode=ExactIn`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
      if (!data.outAmount || !(data.routePlan?.length)) return null; // no route / no quoted output
      return { raw: data }; // the full quote (incl. outAmount + slippage threshold) rides into /swap

    },

    async signSwap(quoteRaw) {
      // Hand the FULL quote back to /swap so its otherAmountThreshold (the
      // slippageBps cap above) rides into the on-chain instruction unchanged.
      const res = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteResponse: quoteRaw, userPublicKey: BURN_VAULT, wrapAndUnwrapSol: false, dynamicComputeUnitLimit: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`jupiter swap build failed (${res.status})`);
      const { swapTransaction } = (await res.json()) as { swapTransaction: string };
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      tx.sign([vault]);
      const signature = bs58.encode(tx.signatures[0]);
      return { signature, send: async () => { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }); } };
    },

    // getSignatureStatuses(searchTransactionHistory) — recognizes a finalized tx
    // even when it is old / getTransaction lags, so a landed swap or burn is never
    // mistaken for "never landed" and written off (which would strand funds).
    confirm: signatureStatus,

    async wocReceived(swapSignature) {
      const tx = await fetchFinalizedTransaction(swapSignature);
      if (!tx) return 0n;
      // parseSplitPayment is mint-generic — the delta map is for the passed mint.
      const delta = parseSplitPayment(tx, WOC_MINT).tokenDeltas.get(BURN_VAULT) ?? 0n;
      return delta > 0n ? delta : 0n;
    },

    async signBurn(amountWoc) {
      const mint = new PublicKey(WOC_MINT);
      const ata = associatedTokenAccount(vault.publicKey, mint);
      const decimals = await wocDecimals();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: vault.publicKey, blockhash, lastValidBlockHeight })
        .add(burnCheckedIx(ata, mint, vault.publicKey, amountWoc, decimals));
      tx.sign(vault);
      const signature = bs58.encode(tx.signature!);
      return { signature, send: async () => { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }); } };
    },
  };

  const store: BurnStore = {
    createBatch: (b) => createBurnBatch({ batchId: b.batchId, source: 'marketplace', usdcIn: b.usdcIn, buyTxSig: b.buyTxSig }),
    markSwapped: markBatchSwapped,
    markBurning: markBatchBurning,
    markBurned: markBatchBurned,
    markFailed: markBatchFailed,
    openBatches: openBurnBatches,
    lastBurnAt,
  };

  return { exec, store };
}

// Construct the production keeper, or null if not configured.
export function buildBurnKeeper(): BurnKeeper | null {
  if (!keeperConfigured()) return null;
  const { exec, store } = buildProductionDeps();
  return new BurnKeeper(exec, store, envPolicy(), {
    now: () => Date.now(),
    newBatchId: () => randomBytes(16).toString('hex'),
    staleMs: STALE_MS,
  });
}
