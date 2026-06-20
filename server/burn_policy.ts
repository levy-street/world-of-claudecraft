// Pure policy for the buy-and-burn keeper: when to run a batch, how big it may
// be, and how to chunk a large pool (TWAP). No I/O — fully unit-tested. All USDC
// amounts are base units (6 decimals) as bigint; $WOC amounts are base units too.

export interface BurnPolicy {
  thresholdUsdc: bigint;       // run as soon as the pool reaches this
  minBatchUsdc: bigint;        // fee-aware floor — never swap below this, even past cadence
  cadenceMs: number;           // run on this interval once the pool clears the floor
  twapSplitAboveUsdc: bigint;  // pools above this are split into chunks (price-impact control)
  twapChunkUsdc: bigint;       // max USDC per child swap
  maxSlippageBps: bigint;      // hard slippage ceiling handed to the DEX (swap reverts past it)
}

const usdc = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

// Defaults from the PRD (§3.7). Each is env-overridable in burn_keeper.ts.
export const DEFAULT_BURN_POLICY: BurnPolicy = {
  thresholdUsdc: usdc(250),
  minBatchUsdc: usdc(25),
  cadenceMs: 6 * 3600 * 1000,
  twapSplitAboveUsdc: usdc(1000),
  twapChunkUsdc: usdc(250),
  maxSlippageBps: 100n, // 1.00%
};

/**
 * Should a buy-and-burn run now? Triggered by reaching the threshold OR by the
 * cadence elapsing — but NEVER below the fee-aware floor: a small pool waits
 * indefinitely (even past cadence) until it clears `minBatchUsdc`, so a batch can
 * never spend more in fees than it swaps.
 */
export function shouldRunBatch(p: { availableUsdc: bigint; lastBurnAt: number | null; now: number; policy: BurnPolicy }): boolean {
  if (p.availableUsdc < p.policy.minBatchUsdc) return false;
  if (p.availableUsdc >= p.policy.thresholdUsdc) return true;
  const sinceLast = p.lastBurnAt === null ? Infinity : p.now - p.lastBurnAt;
  return sinceLast >= p.policy.cadenceMs;
}

/**
 * Split a pool into TWAP chunks: a pool above `twapSplitAboveUsdc` becomes chunks
 * of at most `twapChunkUsdc` (the last carries the remainder); smaller pools are
 * one chunk. Conserves the total exactly (Σ chunks === amount).
 */
export function planTwapChunks(amount: bigint, policy: BurnPolicy): bigint[] {
  if (amount <= 0n) return [];
  if (amount <= policy.twapSplitAboveUsdc) return [amount];
  const chunk = policy.twapChunkUsdc > 0n ? policy.twapChunkUsdc : amount;
  const chunks: bigint[] = [];
  for (let remaining = amount; remaining > 0n; ) {
    const take = remaining > chunk ? chunk : remaining;
    chunks.push(take);
    remaining -= take;
  }
  return chunks;
}
