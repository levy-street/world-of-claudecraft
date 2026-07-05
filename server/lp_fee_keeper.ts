// The LP fee-share intake keeper: a second PayoutKeeper instance over the LP
// FEE VAULT (where DEX trading-fee revenue accrues in USDC). Same durable
// swap-then-settle machine, TWAP chunking, and recover-by-recorded-signature
// crash safety as the marketplace buyback keeper (payout_keeper.ts); only the
// terminal differs: the bought $WOC is settled by fund_distribution into the
// LP mining season's woc_escrow distribution vault (so the on-chain
// total_funded ceiling moves with it) and credited to the flow ledger as a
// verified lp_fee_revenue inflow, becoming spendable headroom for the LP
// epoch emissions. Batches are tagged source 'lp_fee' and both keepers read
// their batches source-scoped, so neither can ever recover the other's.

import { randomBytes } from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { FlowLedger } from './flow_ledger';
import { PgFlowLedgerDb } from './flow_ledger_db';
import {
  createBuybackBatch,
  lastSettleAt,
  markBatchFailed,
  markBatchSettled,
  markBatchSettling,
  markBatchSwapped,
  openBuybackBatches,
} from './payout_db';
import {
  buildSwapSide,
  envPolicy,
  type PayoutExecutor,
  PayoutKeeper,
  type PayoutStore,
} from './payout_keeper';
import { SOLANA_RPC_URL, solanaRpc } from './solana_rpc';
import { isSolanaAddress } from './wallet_link';
import { distributionPda, fundDistributionIx } from './woc_escrow_client';

const LP_FEE_VAULT = (process.env.WOC_LP_FEE_VAULT ?? '').trim();
const LP_FEE_VAULT_SECRET = (process.env.WOC_LP_FEE_VAULT_SECRET ?? '').trim();
const LP_SEASON_ID = Number.parseInt(process.env.WOC_LP_SEASON_ID ?? '', 10);
const ESCROW_PROGRAM_ID = (process.env.WOC_ESCROW_PROGRAM_ID ?? '').trim();
const WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

const STALE_MS = 10 * 60 * 1000; // mirrors the marketplace keeper

/** Whether the LP fee intake is fully configured (absent pieces = intake dark). */
export function lpFeeKeeperConfigured(): boolean {
  return (
    isSolanaAddress(LP_FEE_VAULT) &&
    LP_FEE_VAULT_SECRET.length > 0 &&
    isSolanaAddress(ESCROW_PROGRAM_ID) &&
    Number.isInteger(LP_SEASON_ID)
  );
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

/**
 * Construct the LP fee keeper, or null when not configured. NOTE: callers gate
 * this behind WOC_LP_FEE_SHARE_ENABLED (lp_fee_share_boot.ts); this module only
 * checks its own vault config so the boot module owns the flag semantics.
 */
export function buildLpFeeKeeper(): PayoutKeeper | null {
  if (!lpFeeKeeperConfigured()) return null;
  const vault = Keypair.fromSecretKey(bs58.decode(LP_FEE_VAULT_SECRET));
  if (vault.publicKey.toBase58() !== LP_FEE_VAULT) {
    throw new Error('WOC_LP_FEE_VAULT_SECRET does not match WOC_LP_FEE_VAULT');
  }
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  const policy = envPolicy();
  const programId = new PublicKey(ESCROW_PROGRAM_ID);
  const wocMint = new PublicKey(WOC_MINT);
  const dest = distributionPda(programId, BigInt(LP_SEASON_ID)).toBase58();

  const exec: PayoutExecutor = {
    ...buildSwapSide(vault, LP_FEE_VAULT, conn, policy),
    // Terminal: fund_distribution moves the bought $WOC into the LP season's
    // escrow vault AND advances its on-chain total_funded (the payout ceiling),
    // unlike a raw transfer into the vault ATA. wocDecimals is fetched for
    // parity with the marketplace terminal even though fund_distribution does
    // not need it; it validates the mint exists before we sign.
    async signSettle(amountWoc) {
      await wocDecimals();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const ix = fundDistributionIx({
        programId,
        mint: wocMint,
        seasonId: BigInt(LP_SEASON_ID),
        funder: vault.publicKey,
        amountBase: amountWoc,
      });
      const tx = new Transaction({
        feePayer: vault.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);
      tx.sign(vault);
      const signature = bs58.encode(tx.signature!);
      return {
        signature,
        send: async () => {
          await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
        },
      };
    },
  };

  const store: PayoutStore = {
    createBatch: (b) =>
      createBuybackBatch({
        batchId: b.batchId,
        mode: 'top_up',
        source: 'lp_fee',
        usdcIn: b.usdcIn,
        buyTxSig: b.buyTxSig,
        seasonId: LP_SEASON_ID,
        dest,
      }),
    markSwapped: markBatchSwapped,
    markSettling: markBatchSettling,
    markSettled: markBatchSettled,
    markFailed: markBatchFailed,
    openBatches: () => openBuybackBatches('lp_fee'),
    lastSettleAt: () => lastSettleAt('lp_fee'),
  };

  const ledger = new FlowLedger(new PgFlowLedgerDb());
  return new PayoutKeeper(exec, store, policy, {
    now: () => Date.now(),
    newBatchId: () => randomBytes(16).toString('hex'),
    staleMs: STALE_MS,
    // Idempotent on the settle signature (UNIQUE tx_sig): a recovery that
    // re-confirms the same settle can never double-credit the season.
    onSettled: async ({ wocSettled, settleTxSig }) => {
      await ledger.ensureSeason(LP_SEASON_ID, 'lp mining');
      await ledger.creditInflow({
        seasonId: LP_SEASON_ID,
        source: 'lp_fee_revenue',
        amountBase: wocSettled,
        txSig: settleTxSig,
      });
    },
  });
}
