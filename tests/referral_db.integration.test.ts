// Real-Postgres integration test for the referral reward bookkeeping (#475): the
// per-character earnings checkpoint, the referrer's pending/lifetime commission
// pools, and the UNIFIED referral capture (an affiliate code resolves the same as
// a card slug). Gated on PG_TEST_URL; run sequentially with the other realm DB
// integration tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG = process.env.PG_TEST_URL;
if (PG) process.env.DATABASE_URL ??= PG;
const run = PG ? describe : describe.skip;

run('referral_db against real Postgres', () => {
  let db: typeof import('../server/db');
  let refDb: typeof import('../server/referral_db');
  let aff: typeof import('../server/affiliate_db');
  let card: typeof import('../server/player_card');
  let referrer: number;
  let charId: number;

  async function newAccount(prefix: string): Promise<number> {
    return (await db.createAccount(`${prefix}_${Date.now()}_${Math.floor(performance.now())}`, 'h')).id;
  }
  async function newCharacter(accountId: number): Promise<number> {
    const r = await db.pool.query(
      `INSERT INTO characters (account_id, name, class) VALUES ($1, $2, 'warrior') RETURNING id`,
      [accountId, `refchar_${accountId}_${Date.now()}`],
    );
    return Number(r.rows[0].id);
  }

  beforeAll(async () => {
    db = await import('../server/db');
    refDb = await import('../server/referral_db');
    aff = await import('../server/affiliate_db');
    card = await import('../server/player_card');
    await db.pool.query('DROP TABLE IF EXISTS referral_progress, referral_rewards CASCADE');
    await db.ensureSchema();
    referrer = await newAccount('refrr');
    charId = await newCharacter(referrer);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('unifies referral capture: an affiliate code resolves to the referrer (first-touch, no self-referral)', async () => {
    const code = await aff.getOrCreateAffiliateCode(db.pool, referrer);
    const referee = await newAccount('refee');

    // self-referral is ignored
    await card.captureReferral(referrer, code);
    expect(await refDb.referrerForReferee(db.pool, referrer)).toBeNull();

    // a real referee, captured via the affiliate code (not a card slug)
    await card.captureReferral(referee, code);
    const rel = await refDb.referrerForReferee(db.pool, referee);
    expect(rel?.referrerAccountId).toBe(referrer);
    expect(rel?.referredAt).toBeInstanceOf(Date);

    // an unknown code is a no-op
    const orphan = await newAccount('orph');
    await card.captureReferral(orphan, 'definitely-not-a-real-code');
    expect(await refDb.referrerForReferee(db.pool, orphan)).toBeNull();
  });

  it('checkpoints a character\'s earned counters (upsert round-trip)', async () => {
    expect(await refDb.getReferralProgress(db.pool, charId)).toBeNull();
    await refDb.setReferralProgress(db.pool, charId, 1000, 500);
    expect(await refDb.getReferralProgress(db.pool, charId)).toEqual({ xpGained: 1000, lootCopper: 500 });
    await refDb.setReferralProgress(db.pool, charId, 1650, 800);
    expect(await refDb.getReferralProgress(db.pool, charId)).toEqual({ xpGained: 1650, lootCopper: 800 });
  });

  it('accrues, summarizes, and atomically claims a referrer\'s commission', async () => {
    const rr = await newAccount('rwd');
    await refDb.accrueReferralReward(db.pool, rr, 50, 25);
    await refDb.accrueReferralReward(db.pool, rr, 50, 25);
    await refDb.accrueReferralReward(db.pool, rr, 0, 0); // no-op

    let sum = await refDb.referralRewardSummary(db.pool, rr);
    expect(sum).toMatchObject({ pendingXp: 100, pendingCopper: 50, lifetimeXp: 100, lifetimeCopper: 50 });

    // claim takes the pending pool exactly once; lifetime persists
    expect(await refDb.claimReferralRewards(db.pool, rr)).toEqual({ xp: 100, copper: 50 });
    expect(await refDb.claimReferralRewards(db.pool, rr)).toEqual({ xp: 0, copper: 0 });
    sum = await refDb.referralRewardSummary(db.pool, rr);
    expect(sum).toMatchObject({ pendingXp: 0, pendingCopper: 0, lifetimeXp: 100, lifetimeCopper: 50 });
  });

  it('counts how many accounts a referrer has referred', async () => {
    const rr = await newAccount('cnt');
    const code = await aff.getOrCreateAffiliateCode(db.pool, rr);
    await card.captureReferral(await newAccount('a'), code);
    await card.captureReferral(await newAccount('b'), code);
    expect((await refDb.referralRewardSummary(db.pool, rr)).referredCount).toBe(2);
  });

  it('cascades the progress row when the character is deleted', async () => {
    const acc = await newAccount('cas');
    const c = await newCharacter(acc);
    await refDb.setReferralProgress(db.pool, c, 10, 10);
    await db.pool.query('DELETE FROM characters WHERE id = $1', [c]);
    expect(await refDb.getReferralProgress(db.pool, c)).toBeNull();
  });
});
