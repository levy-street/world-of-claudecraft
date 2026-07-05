// SQL for the Liquidity Guardian leaderboard prestige: map character names to
// their linked wallets' LP staking positions (the lp_positions DB mirror the
// epoch runner maintains, so this costs ZERO chain reads) and compute the
// cosmetic tier through the shared pure math. All raw SQL lives here per the
// server SQL-only-in-*_db.ts invariant.
import { guardianTierIndex } from '../src/sim/guardian_tier';
import { pool } from './db';

function bigintOf(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

/**
 * Guardian tiers for a batch of character names (one query): character ->
 * account -> linked wallet -> lp_positions mirror row -> tier. Names without a
 * wallet or without a seasoned position simply do not appear in the result.
 * `poolKey` scopes to the active staking pool; `minStakeBase` is the flair
 * dust floor; `nowSec` the tier evaluation time.
 */
export async function guardianTiersForNames(
  names: string[],
  poolKey: string,
  minStakeBase: bigint,
  nowSec: number,
): Promise<Map<string, number>> {
  const tiers = new Map<string, number>();
  if (names.length === 0) return tiers;
  const r = await pool.query(
    `SELECT c.name, p.amount_base::text AS amount, p.locked_until, p.staked_at
       FROM characters c
       JOIN wallet_links w ON w.account_id = c.account_id
       JOIN lp_positions p ON p.owner = w.pubkey AND p.pool = $2
      WHERE c.name = ANY($1) AND p.amount_base > 0`,
    [names, poolKey],
  );
  for (const row of r.rows) {
    const tier = guardianTierIndex(
      {
        amountBase: bigintOf(row.amount),
        lockedUntil: Number(row.locked_until),
        stakedAt: Number(row.staked_at),
      },
      nowSec,
      minStakeBase,
    );
    if (tier > 0) tiers.set(row.name as string, tier);
  }
  return tiers;
}
