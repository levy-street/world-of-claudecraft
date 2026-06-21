// Buyback keeper. Periodically drains an accrual vault (the marketplace's USDC
// cut), swaps the USDC for $WOC on Jupiter, then SETTLES it one of two ways:
//   - 'burn'   : SPL-burns the bought $WOC (deflationary sink).
//   - 'top_up' : transfers the bought $WOC into a reward pool and credits the
//                flow ledger as a verified `marketplace_buyback` inflow, so it
//                becomes spendable headroom for #480 emissions — genuine
//                on-market BUY pressure that precedes any payout.
//
// Lifted from the skins marketplace buy-and-burn keeper and generalized at the
// terminal step; the durable swap→settle state machine, TWAP chunking, and
// recover-by-recorded-signature crash safety are preserved exactly. The keeper is
// the ONLY holder of the vault signing key, and it is never injected into the
// quote/verify path, so a compromise of those paths cannot move funds. ALL
// orchestration runs over an injected PayoutExecutor/PayoutStore and is unit-
// tested with fakes; buildProductionDeps() is the thin real-I/O wiring.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { isSolanaAddress } from './wallet_link';
import { DEFAULT_PAYOUT_POLICY, planTwapChunks, shouldRunBatch, type PayoutPolicy } from './payout_policy';
import { parseSplitPayment, fetchFinalizedTransaction, signatureStatus, solanaRpc, SOLANA_RPC_URL, SPL_TOKEN_PROGRAM } from './solana_rpc';
import {
  createBuybackBatch, markBatchSwapped, markBatchSettling, markBatchSettled, markBatchFailed,
  openBuybackBatches, lastSettleAt, type PayoutBatchRow, type PayoutMode,
} from './payout_db';
import { FlowLedger } from './flow_ledger';
import { PgFlowLedgerDb } from './flow_ledger_db';

const VAULT = (process.env.BUYBACK_VAULT ?? process.env.MARKETPLACE_BURN_VAULT ?? '').trim();
const VAULT_SECRET = (process.env.BUYBACK_VAULT_SECRET ?? process.env.MARKETPLACE_BURN_VAULT_SECRET ?? '').trim();
const USDC_MINT = (process.env.USDC_MINT ?? process.env.VITE_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();
const WOC_MINT = (process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth').trim();
const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag/v6').trim();
// 'top_up' funds the #480 reward pool from marketplace revenue; 'burn' (default)
// keeps the deflationary sink. top_up also needs REWARD_POOL_VAULT + BUYBACK_SEASON_ID.
const KEEPER_MODE: PayoutMode = process.env.PAYOUT_KEEPER_MODE === 'top_up' ? 'top_up' : 'burn';
const REWARD_POOL_VAULT = (process.env.REWARD_POOL_VAULT ?? '').trim();
const BUYBACK_SEASON_ID = Number.parseInt(process.env.BUYBACK_SEASON_ID ?? '', 10);
const SPL_ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN_PROGRAM = new PublicKey(SPL_TOKEN_PROGRAM);

// A 'swapping'/'settling' batch this old whose signature still won't confirm is
// treated as never-landed (well past any blockhash validity window), so the
// keeper can't wedge forever on a lost transaction.
const STALE_MS = 10 * 60 * 1000;

function envPolicy(): PayoutPolicy {
  const u = (key: string, fallback: bigint): bigint => {
    const v = process.env[key];
    return v && Number.isFinite(Number(v)) ? BigInt(Math.round(Number(v) * 1_000_000)) : fallback;
  };
  const ms = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const bps = process.env.BUYBACK_MAX_SLIPPAGE_BPS;
  return {
    thresholdUsdc: u('BUYBACK_BATCH_THRESHOLD_USDC', DEFAULT_PAYOUT_POLICY.thresholdUsdc),
    minBatchUsdc: u('BUYBACK_MIN_BATCH_USDC', DEFAULT_PAYOUT_POLICY.minBatchUsdc),
    cadenceMs: ms('BUYBACK_CADENCE_MS', DEFAULT_PAYOUT_POLICY.cadenceMs),
    twapSplitAboveUsdc: u('BUYBACK_TWAP_SPLIT_ABOVE_USDC', DEFAULT_PAYOUT_POLICY.twapSplitAboveUsdc),
    twapChunkUsdc: u('BUYBACK_TWAP_CHUNK_USDC', DEFAULT_PAYOUT_POLICY.twapChunkUsdc),
    maxSlippageBps: bps && Number.isFinite(Number(bps)) ? BigInt(Math.round(Number(bps))) : DEFAULT_PAYOUT_POLICY.maxSlippageBps,
  };
}

// The keeper runs only when fully configured: a valid vault address + its signing
// secret. top_up additionally needs a valid reward-pool destination and a season
// id to credit. Absent these, the marketplace still accrues USDC; nothing swaps.
export function keeperConfigured(mode: PayoutMode = KEEPER_MODE): boolean {
  if (!isSolanaAddress(VAULT) || VAULT_SECRET.length === 0) return false;
  if (mode === 'top_up') return isSolanaAddress(REWARD_POOL_VAULT) && Number.isInteger(BUYBACK_SEASON_ID);
  return true;
}

type ConfirmResult = 'confirmed' | 'failed' | 'unknown';

// Signing + on-chain I/O the keeper drives. Split out so the orchestration is
// testable with a fake and the only key-holding code is the production wiring.
export interface PayoutExecutor {
  vaultUsdcBalance(): Promise<bigint>;
  quote(inUsdc: bigint): Promise<{ outWoc: bigint; raw: unknown } | null>;
  signSwap(quoteRaw: unknown): Promise<{ signature: string; send(): Promise<void> }>;
  confirm(signature: string): Promise<ConfirmResult>;
  wocReceived(swapSignature: string): Promise<bigint>;
  // The terminal settlement: a burn OR a transfer into the reward pool, decided by
  // the production wiring's mode. The orchestration is identical either way.
  signSettle(amountWoc: bigint): Promise<{ signature: string; send(): Promise<void> }>;
}

export interface PayoutStore {
  createBatch(b: { batchId: string; usdcIn: bigint; buyTxSig: string }): Promise<boolean>;
  markSwapped(batchId: string, wocBought: bigint): Promise<void>;
  markSettling(batchId: string, settleTxSig: string): Promise<void>;
  markSettled(batchId: string, wocSettled: bigint): Promise<void>;
  markFailed(batchId: string, reason: string): Promise<void>;
  openBatches(): Promise<PayoutBatchRow[]>;
  lastSettleAt(): Promise<number | null>;
}

export interface KeeperOpts {
  now: () => number;
  newBatchId: () => string;
  staleMs: number;
  // Fires after a batch is durably marked settled (burn or top-up). The top_up
  // wiring uses it to credit the flow ledger; idempotent on the settle signature.
  onSettled?: (info: { batchId: string; wocSettled: bigint; settleTxSig: string }) => Promise<void>;
}

export class PayoutKeeper {
  constructor(
    private readonly exec: PayoutExecutor,
    private readonly store: PayoutStore,
    private readonly policy: PayoutPolicy,
    private readonly opts: KeeperOpts,
  ) {}

  /**
   * One keeper tick. If any batch is still in-flight, finish recovering it before
   * starting new work (so we never run two batches against the same vault pool).
   * Otherwise, if policy says go, drain the vault — TWAP-chunked, each chunk a full
   * swap→settle micro-batch processed in sequence.
   */
  async runCycle(): Promise<void> {
    const open = await this.store.openBatches();
    if (open.length > 0) { await this.recover(open); return; }

    const available = await this.exec.vaultUsdcBalance();
    const last = await this.store.lastSettleAt();
    if (!shouldRunBatch({ availableUsdc: available, lastBurnAt: last, now: this.opts.now(), policy: this.policy })) return;

    for (const chunk of planTwapChunks(available, this.policy)) {
      const completed = await this.swapAndSettle(chunk);
      if (!completed) break; // a no-route / unconfirmed / failed chunk: leave the rest for the next cycle
    }
  }

  private async swapAndSettle(usdcIn: bigint): Promise<boolean> {
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
  // no balance snapshot needed), then settle exactly that.
  private async completeSwapped(batchId: string, swapSig: string): Promise<boolean> {
    const woc = await this.exec.wocReceived(swapSig);
    if (woc <= 0n) { await this.store.markFailed(batchId, 'swap confirmed but no $WOC received'); return false; }
    await this.store.markSwapped(batchId, woc);
    return this.settle(batchId, woc);
  }

  private async settle(batchId: string, woc: bigint): Promise<boolean> {
    const tx = await this.exec.signSettle(woc);
    await this.store.markSettling(batchId, tx.signature); // record the settle sig before broadcast
    await tx.send();
    const conf = await this.exec.confirm(tx.signature);
    if (conf === 'confirmed') { await this.finishSettled(batchId, woc, tx.signature); return true; }
    return false; // unknown/failed — recovery re-checks (and, if stale, re-issues) the settle
  }

  // Mark settled durably, then fire the post-settle hook (top_up credits the flow
  // ledger). The hook is idempotent on the settle signature, so a recovery that
  // re-confirms the same settle never double-credits.
  private async finishSettled(batchId: string, woc: bigint, settleTxSig: string): Promise<void> {
    await this.store.markSettled(batchId, woc);
    await this.opts.onSettled?.({ batchId, wocSettled: woc, settleTxSig });
  }

  /** Resolve in-flight batches by their recorded signature — never by re-reading
   *  the vault balance (which could double-swap a lost-confirmation swap). */
  async recover(open?: PayoutBatchRow[]): Promise<void> {
    const batches = open ?? await this.store.openBatches();
    for (const b of batches) {
      if (b.status === 'swapping' && b.buyTxSig) {
        const conf = await this.exec.confirm(b.buyTxSig);
        if (conf === 'confirmed') await this.completeSwapped(b.batchId, b.buyTxSig);
        else if (conf === 'failed') await this.store.markFailed(b.batchId, 'swap reverted (slippage / route)');
        // Stale + still 'unknown': do NOT blindly fail — the swap may have landed but
        // be momentarily unreadable. Route through completeSwapped, which measures the
        // $WOC actually received: >0 settles it (recovered, never stranded); 0 fails the
        // batch and leaves the USDC in the vault for the next cycle.
        else if (this.isStale(b)) await this.completeSwapped(b.batchId, b.buyTxSig);
      } else if (b.status === 'swapped') {
        await this.settle(b.batchId, b.wocBought);
      } else if (b.status === 'settling' && b.settleTxSig) {
        const conf = await this.exec.confirm(b.settleTxSig);
        if (conf === 'confirmed') await this.finishSettled(b.batchId, b.wocBought, b.settleTxSig);
        else if (conf === 'failed' || this.isStale(b)) await this.settle(b.batchId, b.wocBought); // re-issue the settle
      }
    }
  }

  // Staleness is measured from the broadcast of the phase's OWN transaction: the
  // swap (created_at) for a 'swapping' batch, the settle (settle_broadcast_at) for a
  // 'settling' one. Timing 'settling' from created_at would make a batch whose swap
  // confirmed slowly look instantly stale and trigger a premature re-settle.
  private isStale(b: PayoutBatchRow): boolean {
    const since = b.status === 'settling' && b.settleBroadcastAt ? b.settleBroadcastAt : b.createdAt;
    return this.opts.now() - new Date(since).getTime() > this.opts.staleMs;
  }
}

// --------------------------------------------------------------------------
// Pure SPL instruction encoders (exported for the encoding test) + production
// wiring (real Jupiter REST + @solana/web3.js signing + raw RPC). The wiring is
// the ONLY code that touches the vault key.
// --------------------------------------------------------------------------

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

// SPL Token `TransferChecked` (tag 12): u8 tag + u64 amount(LE) + u8 decimals.
// Used by the top_up settlement to move the bought $WOC into the reward pool.
export function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
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

export function buildProductionDeps(mode: PayoutMode): { exec: PayoutExecutor; store: PayoutStore } {
  const vault = Keypair.fromSecretKey(bs58.decode(VAULT_SECRET));
  if (vault.publicKey.toBase58() !== VAULT) {
    throw new Error('BUYBACK_VAULT_SECRET does not match BUYBACK_VAULT');
  }
  // One RPC for the whole keeper: reads go through solana_rpc.ts (SOLANA_RPC_URL)
  // and the broadcast/blockhash Connection uses the SAME URL, so a confirm can
  // never look at a different cluster than where the swap was sent.
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  const policy = envPolicy();
  const wocMint = new PublicKey(WOC_MINT);
  const vaultWocAta = associatedTokenAccount(vault.publicKey, wocMint);
  const poolWocAta = mode === 'top_up' ? associatedTokenAccount(new PublicKey(REWARD_POOL_VAULT), wocMint) : null;

  const signTerminal = async (amountWoc: bigint): Promise<{ signature: string; send(): Promise<void> }> => {
    const decimals = await wocDecimals();
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const ix = mode === 'top_up'
      ? transferCheckedIx(vaultWocAta, wocMint, poolWocAta!, vault.publicKey, amountWoc, decimals)
      : burnCheckedIx(vaultWocAta, wocMint, vault.publicKey, amountWoc, decimals);
    const tx = new Transaction({ feePayer: vault.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(vault);
    const signature = bs58.encode(tx.signature!);
    return { signature, send: async () => { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 }); } };
  };

  const exec: PayoutExecutor = {
    vaultUsdcBalance: () => vaultTokenBalance(VAULT, USDC_MINT),

    async quote(inUsdc) {
      // slippageBps is the binding slippage cap: Jupiter bakes it into the quote's
      // otherAmountThreshold, which signSwap passes straight to /swap, so the
      // on-chain swap instruction REVERTS if it would receive less. The cap is
      // enforced by the chain, not by us trusting the quoted out-amount.
      const url = `${JUPITER_API}/quote?inputMint=${USDC_MINT}&outputMint=${WOC_MINT}&amount=${inUsdc.toString()}&slippageBps=${policy.maxSlippageBps.toString()}&swapMode=ExactIn`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
      if (!data.outAmount || !(data.routePlan?.length)) return null; // no route
      return { outWoc: BigInt(data.outAmount), raw: data };
    },

    async signSwap(quoteRaw) {
      const res = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteResponse: quoteRaw, userPublicKey: VAULT, wrapAndUnwrapSol: false, dynamicComputeUnitLimit: true }),
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

    signSettle: signTerminal,
  };

  const store: PayoutStore = {
    createBatch: (b) => createBuybackBatch({
      batchId: b.batchId, mode, source: 'marketplace', usdcIn: b.usdcIn, buyTxSig: b.buyTxSig,
      seasonId: mode === 'top_up' ? BUYBACK_SEASON_ID : null,
      dest: mode === 'top_up' ? REWARD_POOL_VAULT : null,
    }),
    markSwapped: markBatchSwapped,
    markSettling: markBatchSettling,
    markSettled: markBatchSettled,
    markFailed: markBatchFailed,
    openBatches: openBuybackBatches,
    lastSettleAt,
  };

  return { exec, store };
}

// Construct the production keeper, or null if not configured. In 'top_up' mode it
// wires the post-settle hook to credit the flow ledger for BUYBACK_SEASON_ID — the
// only legitimate way the #480 pool grows beyond rake recirculation, and genuine
// on-market buy pressure that is recorded as a verified inflow before any payout.
export function buildPayoutKeeper(): PayoutKeeper | null {
  if (!keeperConfigured(KEEPER_MODE)) return null;
  const { exec, store } = buildProductionDeps(KEEPER_MODE);
  let onSettled: KeeperOpts['onSettled'];
  if (KEEPER_MODE === 'top_up') {
    const ledger = new FlowLedger(new PgFlowLedgerDb());
    onSettled = async ({ wocSettled, settleTxSig }) => {
      await ledger.ensureSeason(BUYBACK_SEASON_ID);
      await ledger.creditInflow({ seasonId: BUYBACK_SEASON_ID, source: 'marketplace_buyback', amountBase: wocSettled, txSig: settleTxSig });
    };
  }
  return new PayoutKeeper(exec, store, envPolicy(), {
    now: () => Date.now(),
    newBatchId: () => randomBytes(16).toString('hex'),
    staleMs: STALE_MS,
    onSettled,
  });
}
