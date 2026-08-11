// Refer-a-friend SQL boundary (docs/prd/refer-a-friend.md). All referral-program
// SQL lives here; the DDL lives in referrals_schema.ts (db.ts-import-free so
// ensureSchema can apply it without a cycle), the rules in referral_program.ts,
// and the redemption shell in referral_redemption.ts.
import { pool } from './db';
import {
  generateReferralCode,
  isValidReferralCodeShape,
  REFERRAL_CODE_LENGTH,
} from './referral_program';

export type ReferralStatus = 'pending' | 'active' | 'completed' | 'voided';

export interface ReferralRow {
  refereeAccountId: number;
  referrerAccountId: number;
  slug: string;
  codeUsed: string | null;
  status: ReferralStatus;
  createdAt: Date;
}

const MAX_CODE_MINT_ATTEMPTS = 25;

// The stable code for an account, minting one on first use. Mint-time UNIQUE
// collisions retry with a fresh draw; the caller's rng is injected so tests pin
// exact codes. Math.random is fine at the CALL SITE server-side (this is not sim
// code); tests pass a deterministic rng.
export async function getOrMintReferralCode(
  ownerAccountId: number,
  rng: () => number,
): Promise<string> {
  const existing = await pool.query('SELECT code FROM referral_codes WHERE owner_account_id = $1', [
    ownerAccountId,
  ]);
  if (existing.rows[0]?.code) return existing.rows[0].code;
  for (let attempt = 0; attempt < MAX_CODE_MINT_ATTEMPTS; attempt++) {
    const code = generateReferralCode(rng);
    const res = await pool.query(
      `INSERT INTO referral_codes (owner_account_id, code)
       VALUES ($1, $2)
       ON CONFLICT (owner_account_id) DO NOTHING
       RETURNING code`,
      [ownerAccountId, code],
    );
    if (res.rows[0]?.code) return res.rows[0].code;
    // owner-conflict: another request minted concurrently; read theirs back.
    const raced = await pool.query('SELECT code FROM referral_codes WHERE owner_account_id = $1', [
      ownerAccountId,
    ]);
    if (raced.rows[0]?.code) return raced.rows[0].code;
    // else the INSERT lost on the code UNIQUE index: loop and draw again.
  }
  throw new Error('referral code mint exhausted retries');
}

/** The owning account for an ACTIVE referral code, else null. */
export async function accountForReferralCode(code: string): Promise<number | null> {
  if (code.length !== REFERRAL_CODE_LENGTH || !isValidReferralCodeShape(code)) return null;
  const res = await pool.query(
    'SELECT owner_account_id FROM referral_codes WHERE code = $1 AND active',
    [code],
  );
  return res.rows[0]?.owner_account_id ?? null;
}

/**
 * The one-round-trip fact bag behind the eligibility gate and the caps
 * (referral_program.ts ReferrerFacts). seasonDays parameterizes the rolling
 * completed-this-season window.
 */
export async function referrerProgramFacts(
  accountId: number,
  seasonDays: number,
): Promise<{
  accountAgeDays: number;
  maxCharacterLevel: number;
  activeReferrals: number;
  completedThisSeason: number;
  completedTotal: number;
}> {
  const res = await pool.query(
    `SELECT
       floor(EXTRACT(EPOCH FROM (now() - a.created_at)) / 86400)::int AS account_age_days,
       COALESCE((SELECT max(c.level) FROM characters c WHERE c.account_id = $1), 0)
         AS max_character_level,
       (SELECT count(*)::int FROM referrals r
          WHERE r.referrer_account_id = $1 AND r.status IN ('pending', 'active'))
         AS active_referrals,
       (SELECT count(*)::int FROM referrals r
          WHERE r.referrer_account_id = $1 AND r.status = 'completed'
            AND r.created_at > now() - ($2 || ' days')::interval)
         AS completed_this_season,
       (SELECT count(*)::int FROM referrals r
          WHERE r.referrer_account_id = $1 AND r.status = 'completed')
         AS completed_total
     FROM accounts a
     WHERE a.id = $1`,
    [accountId, String(seasonDays)],
  );
  const row = res.rows[0];
  return {
    accountAgeDays: row?.account_age_days ?? 0,
    maxCharacterLevel: row?.max_character_level ?? 0,
    activeReferrals: row?.active_referrals ?? 0,
    completedThisSeason: row?.completed_this_season ?? 0,
    completedTotal: row?.completed_total ?? 0,
  };
}

/**
 * Insert the redemption row, computing the initial status IN the statement so a
 * correlated redemption lands voided atomically:
 *   - another referral of the SAME referrer already carries this exact
 *     (device_fingerprint, ip_hash) pair (both non-null): the pair counts once.
 *   - the referee redeemed from an IP the referrer's account has used
 *     (created_ip / last_login_ip): referrer and referee correlate.
 * Idempotent like the legacy recordReferral: the PK on referee_account_id keeps
 * only the first redemption. The raw referee IP ($7) is used ONLY for the
 * correlation compare against the accounts columns; the row stores hashes.
 */
export async function insertReferralRedemption(input: {
  refereeAccountId: number;
  referrerAccountId: number;
  redeemedToken: string;
  codeUsed: string | null;
  deviceFingerprint: string | null;
  ipHash: string | null;
  rawRefereeIp: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO referrals
       (referee_account_id, referrer_account_id, slug, code_used, status,
        device_fingerprint, ip_hash)
     SELECT $1, $2, $3, $4,
       CASE
         WHEN ($5::text IS NOT NULL AND $6::text IS NOT NULL AND EXISTS(
                SELECT 1 FROM referrals r2
                WHERE r2.referrer_account_id = $2
                  AND r2.device_fingerprint = $5 AND r2.ip_hash = $6))
           OR ($7::text IS NOT NULL AND EXISTS(
                SELECT 1 FROM accounts a
                WHERE a.id = $2
                  AND (a.created_ip = $7 OR a.last_login_ip = $7)))
         THEN 'voided'
         ELSE 'pending'
       END,
       $5, $6
     ON CONFLICT (referee_account_id) DO NOTHING`,
    [
      input.refereeAccountId,
      input.referrerAccountId,
      input.redeemedToken,
      input.codeUsed,
      input.deviceFingerprint,
      input.ipHash,
      input.rawRefereeIp,
    ],
  );
}

/**
 * Promote this account's referral statuses from the durable characters.level
 * column: pending -> active once the referee owns any character, and pending or
 * active -> completed at bondEndLevel. Touches rows where the account is either
 * side (referee level-up, or a referrer reconciling at login). Never touches
 * voided rows. Returns the referrals newly completed BY THIS CALL so the caller
 * can fire ladder rewards exactly once per transition.
 */
export async function refreshReferralStatuses(
  accountId: number,
  completeAtLevel: number,
): Promise<{ refereeAccountId: number; referrerAccountId: number }[]> {
  const res = await pool.query(
    `UPDATE referrals r SET status =
       CASE
         WHEN EXISTS(SELECT 1 FROM characters c
                     WHERE c.account_id = r.referee_account_id AND c.level >= $2)
           THEN 'completed'
         WHEN EXISTS(SELECT 1 FROM characters c
                     WHERE c.account_id = r.referee_account_id)
           THEN 'active'
         ELSE r.status
       END
     WHERE r.status IN ('pending', 'active')
       AND (r.referee_account_id = $1 OR r.referrer_account_id = $1)
       AND r.status IS DISTINCT FROM
         CASE
           WHEN EXISTS(SELECT 1 FROM characters c
                       WHERE c.account_id = r.referee_account_id AND c.level >= $2)
             THEN 'completed'
           WHEN EXISTS(SELECT 1 FROM characters c
                       WHERE c.account_id = r.referee_account_id)
             THEN 'active'
           ELSE r.status
         END
     RETURNING r.referee_account_id, r.referrer_account_id,
       (r.status = 'completed') AS completed`,
    [accountId, completeAtLevel],
  );
  return res.rows
    .filter((row) => row.completed === true)
    .map((row) => ({
      refereeAccountId: row.referee_account_id,
      referrerAccountId: row.referrer_account_id,
    }));
}

/**
 * Event-driven completion: the server SAW the referee's live level-up cross the
 * completion level, so promote unconditionally (the durable characters.level
 * column lags the event by up to one autosave, which is why this cannot ride
 * refreshReferralStatuses). Never touches voided rows. Returns the newly
 * completed referrals so ladder rewards fire exactly once per transition.
 */
export async function completeReferralsForReferee(
  refereeAccountId: number,
): Promise<{ refereeAccountId: number; referrerAccountId: number }[]> {
  const res = await pool.query(
    `UPDATE referrals SET status = 'completed'
     WHERE referee_account_id = $1 AND status IN ('pending', 'active')
     RETURNING referee_account_id, referrer_account_id`,
    [refereeAccountId],
  );
  return res.rows.map((row) => ({
    refereeAccountId: row.referee_account_id,
    referrerAccountId: row.referrer_account_id,
  }));
}

/**
 * The live bond edges touching this account: referrals still pending or active
 * (a completed or voided referral has no bond). Read at join/leave/level-up by
 * the bond service (server/referral_bond.ts) to recompute session stamps.
 */
export async function activeBondEdgesForAccount(
  accountId: number,
): Promise<{ refereeAccountId: number; referrerAccountId: number }[]> {
  const res = await pool.query(
    `SELECT referee_account_id, referrer_account_id FROM referrals
     WHERE status IN ('pending', 'active')
       AND (referee_account_id = $1 OR referrer_account_id = $1)`,
    [accountId],
  );
  return res.rows.map((row) => ({
    refereeAccountId: row.referee_account_id,
    referrerAccountId: row.referrer_account_id,
  }));
}

/** The referral row where this account is the referee, if any. */
export async function referralForReferee(refereeAccountId: number): Promise<ReferralRow | null> {
  const res = await pool.query(
    `SELECT referee_account_id, referrer_account_id, slug, code_used, status, created_at
     FROM referrals WHERE referee_account_id = $1`,
    [refereeAccountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    refereeAccountId: row.referee_account_id,
    referrerAccountId: row.referrer_account_id,
    slug: row.slug,
    codeUsed: row.code_used ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Every referral where this account is the referrer (admin + reconcile read). */
export async function referralsForReferrer(referrerAccountId: number): Promise<ReferralRow[]> {
  const res = await pool.query(
    `SELECT referee_account_id, referrer_account_id, slug, code_used, status, created_at
     FROM referrals WHERE referrer_account_id = $1
     ORDER BY created_at ASC`,
    [referrerAccountId],
  );
  return res.rows.map((row) => ({
    refereeAccountId: row.referee_account_id,
    referrerAccountId: row.referrer_account_id,
    slug: row.slug,
    codeUsed: row.code_used ?? null,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** Admin void/reinstate. Reinstate recomputes pending; the next status refresh promotes it. */
export async function setReferralStatus(
  refereeAccountId: number,
  status: ReferralStatus,
): Promise<boolean> {
  const res = await pool.query('UPDATE referrals SET status = $2 WHERE referee_account_id = $1', [
    refereeAccountId,
    status,
  ]);
  return (res.rowCount ?? 0) > 0;
}

// ── Milestones (docs/prd/refer-a-friend.md, phase 3) ───────────────────────
// referral_milestones rows record which milestone fired for which SUBJECT
// account and whether its reward went out. Two key families share the table:
// referee milestones ('referred_level_10', 'referred_level_20') keyed by the
// REFEREE account, and referrer tier grants ('referrer_tier_1'...) keyed by
// the REFERRER account, so every grant is claim-once (the discord reward_ledger
// dedupe shape: durable claim first, best-effort apply after).

/** Record a milestone; true when THIS call inserted it (first firing). */
export async function recordReferralMilestone(
  subjectAccountId: number,
  milestoneKey: string,
): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO referral_milestones (referee_account_id, milestone_key)
     VALUES ($1, $2)
     ON CONFLICT (referee_account_id, milestone_key) DO NOTHING
     RETURNING milestone_key`,
    [subjectAccountId, milestoneKey],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Claim a milestone's reward exactly once; true when THIS call claimed it. */
export async function claimReferralMilestoneReward(
  subjectAccountId: number,
  milestoneKey: string,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE referral_milestones SET reward_granted = TRUE
     WHERE referee_account_id = $1 AND milestone_key = $2 AND reward_granted = FALSE`,
    [subjectAccountId, milestoneKey],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Referee milestones whose reward has not gone out yet for referrals this
 * account referred (voided referrals excluded): the referrer-join reconcile
 * read behind offline-ding delivery.
 */
export async function ungrantedMilestonesForReferrer(
  referrerAccountId: number,
): Promise<{ refereeAccountId: number; milestoneKey: string }[]> {
  const res = await pool.query(
    `SELECT m.referee_account_id, m.milestone_key
     FROM referral_milestones m
     JOIN referrals r ON r.referee_account_id = m.referee_account_id
     WHERE r.referrer_account_id = $1 AND r.status <> 'voided'
       AND m.reward_granted = FALSE
     ORDER BY m.reached_at ASC`,
    [referrerAccountId],
  );
  return res.rows.map((row) => ({
    refereeAccountId: row.referee_account_id,
    milestoneKey: row.milestone_key,
  }));
}

/** Milestone rows for one subject account (admin inspect read). */
export async function referralMilestonesForAccount(
  subjectAccountId: number,
): Promise<{ milestoneKey: string; reachedAt: Date; rewardGranted: boolean }[]> {
  const res = await pool.query(
    `SELECT milestone_key, reached_at, reward_granted FROM referral_milestones
     WHERE referee_account_id = $1 ORDER BY reached_at ASC`,
    [subjectAccountId],
  );
  return res.rows.map((row) => ({
    milestoneKey: row.milestone_key,
    reachedAt: row.reached_at,
    rewardGranted: row.reward_granted,
  }));
}

/** Program-wide aggregates for the admin metrics read (one round trip). */
export async function referralProgramStats(): Promise<{
  totalRedemptions: number;
  pending: number;
  active: number;
  completed: number;
  voided: number;
  rewardsGrantedByKey: Record<string, number>;
}> {
  const res = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM referrals) AS total,
       (SELECT count(*)::int FROM referrals WHERE status = 'pending') AS pending,
       (SELECT count(*)::int FROM referrals WHERE status = 'active') AS active,
       (SELECT count(*)::int FROM referrals WHERE status = 'completed') AS completed,
       (SELECT count(*)::int FROM referrals WHERE status = 'voided') AS voided`,
  );
  const byKey = await pool.query(
    `SELECT milestone_key, count(*)::int AS n FROM referral_milestones
     WHERE reward_granted GROUP BY milestone_key`,
  );
  const rewardsGrantedByKey: Record<string, number> = {};
  for (const row of byKey.rows) rewardsGrantedByKey[row.milestone_key] = row.n;
  const row = res.rows[0];
  return {
    totalRedemptions: row?.total ?? 0,
    pending: row?.pending ?? 0,
    active: row?.active ?? 0,
    completed: row?.completed ?? 0,
    voided: row?.voided ?? 0,
    rewardsGrantedByKey,
  };
}

/** The stored referral code row for an account, if any (admin inspect read). */
export async function referralCodeForAccount(
  ownerAccountId: number,
): Promise<{ code: string; active: boolean } | null> {
  const res = await pool.query(
    'SELECT code, active FROM referral_codes WHERE owner_account_id = $1',
    [ownerAccountId],
  );
  const row = res.rows[0];
  return row ? { code: row.code, active: row.active } : null;
}
