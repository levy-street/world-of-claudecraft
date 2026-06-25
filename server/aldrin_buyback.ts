// Buyback-and-burn keeper for the SOL/USDC half of an Aldrin Club payment. The
// payment tx already routed 50% to the treasury and 50% to the buyback vault
// (server/aldrin_config.ts ALDRIN_BUYBACK_VAULT). This keeper periodically takes
// the vault balance, swaps it to $WOC on a DEX aggregator (Jupiter), and burns
// the proceeds, turning subscription revenue into $WOC deflation.
//
// All chain IO is behind the BuybackExecutor seam so the orchestration is
// unit-testable with a fake (the same shape as the in-flight burn_keeper's
// injected executor). The keeper wallet that signs swaps + burns is the single
// custodial seam and holds only in-flight buyback funds; its secret comes from
// ALDRIN_BUYBACK_KEEPER_SECRET (KMS in prod, never git).
//
// DRAFT NOTE: production should run ONE buyback keeper for the whole protocol
// (marketplace fees, subscriptions, every sink), not one per feature. When the
// shared core buyback.ts lands on main, route the Aldrin buyback split into that
// vault + keeper and delete this module; it exists here only to make the draft's
// SOL/USDC -> $WOC -> burn path concrete and reviewable.
import {
  ALDRIN_BUYBACK_MIN_BATCH_USD_CENTS,
  ALDRIN_BUYBACK_SLIPPAGE_BPS,
} from './aldrin_config';

/** A single swap+burn cycle's outcome, for the audit log + admin dashboard. */
export interface BuybackResult {
  swappedInUsdCents: number;
  wocBought: bigint;
  wocBurned: bigint;
  swapSignature: string;
  burnSignature: string;
}

/** The chain IO the keeper needs; a fake implements this in tests. */
export interface BuybackExecutor {
  /** Current buyback-vault balance, valued in USD cents (USDC at 1:1, SOL via FX). */
  vaultValueUsdCents(): Promise<number>;
  /** Swap the entire vault balance to $WOC at <= slippageBps; resolve to bought base units + sig. */
  swapVaultToWoc(slippageBps: number): Promise<{ wocBought: bigint; signature: string }>;
  /** Burn `amount` base units of $WOC from the keeper's ATA; resolve to the burn sig. */
  burnWoc(amount: bigint): Promise<string>;
  /** Persist the cycle for audit (UNIQUE on swap signature => idempotent). */
  record(result: BuybackResult): Promise<void>;
}

/**
 * Pure trigger: run a batch only once the pooled value clears the dust floor.
 * Kept separate so the threshold policy is testable without any IO.
 */
export function shouldRunBuyback(pooledUsdCents: number, minUsdCents = ALDRIN_BUYBACK_MIN_BATCH_USD_CENTS): boolean {
  return Number.isFinite(pooledUsdCents) && pooledUsdCents >= minUsdCents;
}

/**
 * Run one buyback cycle if the vault has cleared the floor. Returns the result,
 * or null when there was nothing to do. Errors propagate so the caller's interval
 * loop can log + back off.
 *
 * CRASH SAFETY (follow-up, before this keeper is enabled): the swap -> burn ->
 * record sequence has a window where a crash after the swap but before the burn
 * leaves bought $WOC unburned with no audit row. A production keeper must persist
 * the swap signature before/with the burn and add a "swapped but not burned"
 * recovery pass. The executor seam is shaped to allow that; this orchestration is
 * the happy path for review.
 */
export async function runBuybackCycle(exec: BuybackExecutor): Promise<BuybackResult | null> {
  const pooled = await exec.vaultValueUsdCents();
  if (!shouldRunBuyback(pooled)) return null;

  const { wocBought, signature } = await exec.swapVaultToWoc(ALDRIN_BUYBACK_SLIPPAGE_BPS);
  if (wocBought <= 0n) return null;

  const burnSignature = await exec.burnWoc(wocBought);
  const result: BuybackResult = {
    swappedInUsdCents: pooled,
    wocBought,
    wocBurned: wocBought,
    swapSignature: signature,
    burnSignature,
  };
  await exec.record(result);
  return result;
}
