// Referral bonus persistence (#475): the per-character earnings checkpoint the
// reconciler bonuses against, and the referrer's accrued commission. SQL only
// (server/CLAUDE.md). The "who referred whom" relationship lives in the existing
// `referrals` table (db.ts); this adds the reward bookkeeping on top of it.
//
// Counters (xpGained, lootCopper) fit well inside 2^53 for any realistic play, so
// they are read as JS numbers; the columns are BIGINT for headroom.

import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export const REFERRAL_REWARDS_SCHEMA = `
-- The last earned-counter values we credited a referral bonus against, per
-- referred CHARACTER (counters are per character). Only NEW earnings past this
-- checkpoint are bonused, so a bonus is never paid twice. Cascades with the character.
CREATE TABLE IF NOT EXISTS referral_progress (
  character_id BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  last_xp_gained BIGINT NOT NULL DEFAULT 0,
  last_loot_copper BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A referrer's accrued commission from their referred players' earnings: pending
-- (not yet granted to a live character) plus lifetime totals (for display). The
-- pending pool is granted to the referrer's character on their next play, then reset.
CREATE TABLE IF NOT EXISTS referral_rewards (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  pending_xp BIGINT NOT NULL DEFAULT 0,
  pending_copper BIGINT NOT NULL DEFAULT 0,
  lifetime_xp BIGINT NOT NULL DEFAULT 0,
  lifetime_copper BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// The account that referred this account, with when (for the 30-day window), or null.
export async function referrerForReferee(
  db: Queryable,
  refereeAccountId: number,
): Promise<{ referrerAccountId: number; referredAt: Date } | null> {
  const res = await db.query(
    'SELECT referrer_account_id, created_at FROM referrals WHERE referee_account_id = $1',
    [refereeAccountId],
  );
  return res.rows[0]
    ? { referrerAccountId: Number(res.rows[0].referrer_account_id), referredAt: res.rows[0].created_at as Date }
    : null;
}

// The character's earnings checkpoint, or null when none recorded yet (treat as 0/0).
export async function getReferralProgress(
  db: Queryable,
  characterId: number,
): Promise<{ xpGained: number; lootCopper: number } | null> {
  const res = await db.query(
    'SELECT last_xp_gained, last_loot_copper FROM referral_progress WHERE character_id = $1',
    [characterId],
  );
  return res.rows[0]
    ? { xpGained: Number(res.rows[0].last_xp_gained), lootCopper: Number(res.rows[0].last_loot_copper) }
    : null;
}

export async function setReferralProgress(
  db: Queryable,
  characterId: number,
  xpGained: number,
  lootCopper: number,
): Promise<void> {
  await db.query(
    `INSERT INTO referral_progress (character_id, last_xp_gained, last_loot_copper) VALUES ($1, $2, $3)
     ON CONFLICT (character_id) DO UPDATE
       SET last_xp_gained = EXCLUDED.last_xp_gained, last_loot_copper = EXCLUDED.last_loot_copper, updated_at = now()`,
    [characterId, Math.floor(xpGained), Math.floor(lootCopper)],
  );
}

// Accrue commission to a referrer's pending + lifetime pools.
export async function accrueReferralReward(
  db: Queryable,
  referrerAccountId: number,
  xp: number,
  copper: number,
): Promise<void> {
  const x = Math.max(0, Math.floor(xp));
  const c = Math.max(0, Math.floor(copper));
  if (x === 0 && c === 0) return;
  await db.query(
    `INSERT INTO referral_rewards (account_id, pending_xp, pending_copper, lifetime_xp, lifetime_copper)
     VALUES ($1, $2, $3, $2, $3)
     ON CONFLICT (account_id) DO UPDATE SET
       pending_xp = referral_rewards.pending_xp + EXCLUDED.pending_xp,
       pending_copper = referral_rewards.pending_copper + EXCLUDED.pending_copper,
       lifetime_xp = referral_rewards.lifetime_xp + EXCLUDED.pending_xp,
       lifetime_copper = referral_rewards.lifetime_copper + EXCLUDED.pending_copper,
       updated_at = now()`,
    [referrerAccountId, x, c],
  );
}

// Atomically take the referrer's pending pool (zeroing it) so it can be granted
// to a live character exactly once. Returns {0,0} when nothing is pending.
export async function claimReferralRewards(db: Queryable, accountId: number): Promise<{ xp: number; copper: number }> {
  const res = await db.query(
    `WITH old AS (
       SELECT account_id, pending_xp, pending_copper FROM referral_rewards
        WHERE account_id = $1 AND (pending_xp > 0 OR pending_copper > 0) FOR UPDATE
     )
     UPDATE referral_rewards r SET pending_xp = 0, pending_copper = 0, updated_at = now()
       FROM old WHERE r.account_id = old.account_id
     RETURNING old.pending_xp AS xp, old.pending_copper AS copper`,
    [accountId],
  );
  return res.rows[0] ? { xp: Number(res.rows[0].xp), copper: Number(res.rows[0].copper) } : { xp: 0, copper: 0 };
}

export interface ReferralRewardSummary {
  pendingXp: number;
  pendingCopper: number;
  lifetimeXp: number;
  lifetimeCopper: number;
  referredCount: number; // how many accounts this account has referred
}

export async function referralRewardSummary(db: Queryable, accountId: number): Promise<ReferralRewardSummary> {
  const res = await db.query(
    `SELECT
       COALESCE((SELECT pending_xp FROM referral_rewards WHERE account_id = $1), 0) AS pending_xp,
       COALESCE((SELECT pending_copper FROM referral_rewards WHERE account_id = $1), 0) AS pending_copper,
       COALESCE((SELECT lifetime_xp FROM referral_rewards WHERE account_id = $1), 0) AS lifetime_xp,
       COALESCE((SELECT lifetime_copper FROM referral_rewards WHERE account_id = $1), 0) AS lifetime_copper,
       (SELECT count(*)::int FROM referrals WHERE referrer_account_id = $1) AS referred_count`,
    [accountId],
  );
  const r = res.rows[0];
  return {
    pendingXp: Number(r.pending_xp),
    pendingCopper: Number(r.pending_copper),
    lifetimeXp: Number(r.lifetime_xp),
    lifetimeCopper: Number(r.lifetime_copper),
    referredCount: Number(r.referred_count),
  };
}
