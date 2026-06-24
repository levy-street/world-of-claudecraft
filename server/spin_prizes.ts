// The daily spinner prize table and the pure selection / accounting math over
// it. A prize is chosen by mapping the fairness outcome unit ([0,1) from
// fairness.ts) onto cumulative weights. Everything here is pure so the
// distribution, expected value, payout cap, and holder-tier odds scaling are all
// unit-testable, and the same table can be published for the provable-odds page.
import { LAMPORTS_PER_SOL } from './engagement_config';

export interface PrizeTier {
  /** Stable machine key (analytics / receipts / i18n hook). */
  key: string;
  /** Payout in lamports; 0 is a valid "no win" tier. */
  lamports: bigint;
  /** Relative selection weight; must be > 0. */
  weight: number;
}

const SOL = (n: number): bigint => BigInt(Math.round(n * Number(LAMPORTS_PER_SOL)));

/**
 * Default SOL-dust ladder. Weights sum to 1000 for readable percentages: 60%
 * nothing, then a long tail down to a 0.1% jackpot. Tune via the prize-table
 * config before any mainnet launch; the expected value per spin times DAU must
 * stay under SPIN_DAILY_BUDGET_LAMPORTS.
 */
export const DEFAULT_PRIZE_TABLE: readonly PrizeTier[] = [
  { key: 'none', lamports: 0n, weight: 600 },
  { key: 'dust_s', lamports: SOL(0.0005), weight: 250 },
  { key: 'dust_m', lamports: SOL(0.001), weight: 100 },
  { key: 'dust_l', lamports: SOL(0.005), weight: 40 },
  { key: 'shard', lamports: SOL(0.02), weight: 9 },
  { key: 'jackpot', lamports: SOL(0.1), weight: 1 },
] as const;

export interface TableValidation {
  ok: boolean;
  reason?: string;
}

/** Total selection weight of a table. */
export function totalWeight(table: readonly PrizeTier[]): number {
  let t = 0;
  for (const tier of table) t += tier.weight;
  return t;
}

/**
 * Validate a prize table against a hard payout cap. A table is sound when it is
 * non-empty, every weight is a positive finite number, every payout is a
 * non-negative integer-lamport bigint, and no payout exceeds the cap (so a
 * mis-edited table can never request more than the on-chain program allows).
 */
export function validatePrizeTable(table: readonly PrizeTier[], capLamports: bigint): TableValidation {
  if (table.length === 0) return { ok: false, reason: 'empty_table' };
  const seen = new Set<string>();
  for (const tier of table) {
    if (seen.has(tier.key)) return { ok: false, reason: `duplicate_key:${tier.key}` };
    seen.add(tier.key);
    if (!Number.isFinite(tier.weight) || tier.weight <= 0) return { ok: false, reason: `bad_weight:${tier.key}` };
    if (tier.lamports < 0n) return { ok: false, reason: `negative_payout:${tier.key}` };
    if (tier.lamports > capLamports) return { ok: false, reason: `over_cap:${tier.key}` };
  }
  return { ok: true };
}

/**
 * Select a prize for an outcome unit in [0, 1) by cumulative weight. The unit is
 * clamped into range defensively only against a caller passing exactly 1 or a
 * tiny negative rounding artifact; fairness.unitFromDigest already returns
 * [0, 1). Throws on an empty table -- that is a configuration bug, not a runtime
 * condition to swallow.
 */
export function selectPrize(table: readonly PrizeTier[], unit: number): PrizeTier {
  if (table.length === 0) throw new Error('selectPrize: empty prize table');
  const total = totalWeight(table);
  const u = unit <= 0 ? 0 : unit >= 1 ? 0.9999999999999999 : unit;
  let threshold = u * total;
  for (const tier of table) {
    threshold -= tier.weight;
    if (threshold < 0) return tier;
  }
  // Reachable only through floating-point summation drift at the very top of the
  // range; the last tier owns that slice.
  return table[table.length - 1];
}

/** Expected payout per spin in lamports (rounded to the nearest lamport). */
export function expectedValueLamports(table: readonly PrizeTier[]): bigint {
  const total = totalWeight(table);
  if (total <= 0) return 0n;
  let acc = 0;
  for (const tier of table) acc += tier.weight * Number(tier.lamports);
  return BigInt(Math.round(acc / total));
}

/** Largest single payout in the table (lamports). */
export function maxPayoutLamports(table: readonly PrizeTier[]): bigint {
  let m = 0n;
  for (const tier of table) if (tier.lamports > m) m = tier.lamports;
  return m;
}

/** Probability in [0, 1] that a spin pays anything at all. */
export function winProbability(table: readonly PrizeTier[]): number {
  const total = totalWeight(table);
  if (total <= 0) return 0;
  let win = 0;
  for (const tier of table) if (tier.lamports > 0n) win += tier.weight;
  return win / total;
}

/**
 * Shift selection mass toward winning tiers for higher holder tiers. Each
 * prize-bearing tier's weight is scaled by (1 + perTier * tier); the zero tier is
 * left untouched, so a higher tier strictly raises the win probability without
 * changing the relative odds among prizes. tier 0 returns the table unchanged.
 */
export function scaleTableForTier(
  table: readonly PrizeTier[],
  tier: number,
  perTier = 0.05,
): PrizeTier[] {
  const t = Number.isFinite(tier) && tier > 0 ? tier : 0;
  const factor = 1 + perTier * t;
  return table.map((p) => (p.lamports > 0n ? { ...p, weight: p.weight * factor } : { ...p }));
}
