// Integration test for the Postgres EngagementDb against a REAL database. Gated
// on ENGAGEMENT_TEST_DATABASE_URL so it is skipped wherever no DB is provided;
// when set, it exercises the actual SQL, the unique constraints, the bigint
// round-trip, and the full EngagementService end to end on real Postgres.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { engagementSchema, PgEngagementDb } from '../server/engagement_db';
import { EngagementService } from '../server/engagement_service';
import { parseEngagementConfig } from '../server/engagement_config';
import { deriveOutcomeUnit } from '../server/fairness';
import { DEFAULT_PRIZE_TABLE, selectPrize, scaleTableForTier } from '../server/spin_prizes';

const DB_URL = process.env.ENGAGEMENT_TEST_DATABASE_URL;
const REALM = 'testrealm';
const suite = DB_URL ? describe : describe.skip;

// Wait for the database to accept connections (it may still be starting). Uses
// setTimeout-based backoff, not a shell sleep; necessary to race a just-launched
// container.
async function waitForDb(p: Pool): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      await p.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('postgres did not become ready in time');
}

suite('PgEngagementDb (real Postgres)', () => {
  let pool: Pool;
  let db: PgEngagementDb;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await waitForDb(pool);
    // Fresh, idempotent setup: a minimal accounts table (the FK target) + the
    // engagement schema, then a handful of accounts to reference.
    await pool.query(`
      DROP TABLE IF EXISTS pack_openings, pack_pity, daily_activity, spins, spin_daily_commits CASCADE;
      DROP TABLE IF EXISTS accounts CASCADE;
      CREATE TABLE accounts (id SERIAL PRIMARY KEY);
    `);
    await pool.query(engagementSchema(REALM));
    await pool.query('INSERT INTO accounts (id) VALUES (1),(2),(3),(4),(5),(6),(7)');
    db = new PgEngagementDb(pool, REALM);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it('daily commit: put is write-once, get reads back, reveal flips the flag', async () => {
    await db.putDailyCommit({ utcDay: 100, commitHash: 'aa', seedHex: 'beef', revealed: false });
    await db.putDailyCommit({ utcDay: 100, commitHash: 'bb', seedHex: 'cafe', revealed: false }); // ignored
    const got = await db.getDailyCommit(100);
    expect(got).toEqual({ utcDay: 100, commitHash: 'aa', seedHex: 'beef', revealed: false });
    await db.revealDailySeed(100);
    expect((await db.getDailyCommit(100))!.revealed).toBe(true);
    expect(await db.getDailyCommit(999)).toBeNull();
  });

  it('spins: insert, read by day, and the unique index blocks a second same-day spin', async () => {
    const lamports = 123_456_789n;
    const spin = await db.insertSpin({ accountId: 1, utcDay: 100, dayNonce: 1, clientSeed: 'cs', prizeKey: 'dust_m', lamports });
    expect(spin.id).toBeGreaterThan(0);
    expect(spin.status).toBe('pending');
    expect(spin.lamports).toBe(lamports); // exact bigint round-trip through BIGINT

    const byDay = await db.getSpinForDay(1, 100);
    expect(byDay).toEqual(spin);

    await expect(
      db.insertSpin({ accountId: 1, utcDay: 100, dayNonce: 1, clientSeed: 'x', prizeKey: 'none', lamports: 0n }),
    ).rejects.toThrow('unique_violation: spins_account_day');

    // A different day for the same account is allowed.
    await expect(
      db.insertSpin({ accountId: 1, utcDay: 101, dayNonce: 1, clientSeed: 'y', prizeKey: 'none', lamports: 0n }),
    ).resolves.toBeTruthy();
  });

  it('spins: settle and fail transitions persist', async () => {
    const spin = await db.insertSpin({ accountId: 2, utcDay: 100, dayNonce: 1, clientSeed: 'cs', prizeKey: 'dust_s', lamports: 500_000n });
    await db.markSpinSettled(spin.id, 'sig-xyz');
    const settled = await db.getSpin(spin.id);
    expect(settled!.status).toBe('settled');
    expect(settled!.settleSig).toBe('sig-xyz');

    const other = await db.insertSpin({ accountId: 3, utcDay: 100, dayNonce: 1, clientSeed: 'cs', prizeKey: 'none', lamports: 0n });
    await db.markSpinFailed(other.id);
    expect((await db.getSpin(other.id))!.status).toBe('failed');
  });

  it('streak: upsert round-trips including a null lastDay', async () => {
    expect(await db.getStreak(4)).toEqual({ lastDay: null, streak: 0 });
    await db.setStreak(4, { lastDay: 100, streak: 3 });
    expect(await db.getStreak(4)).toEqual({ lastDay: 100, streak: 3 });
    await db.setStreak(4, { lastDay: 101, streak: 4 });
    expect(await db.getStreak(4)).toEqual({ lastDay: 101, streak: 4 });
  });

  it('pity: upsert round-trips per (account, pack)', async () => {
    expect(await db.getPity(5, 'common_cache')).toBe(0);
    await db.setPity(5, 'common_cache', 2);
    await db.setPity(5, 'rare_cache', 9);
    expect(await db.getPity(5, 'common_cache')).toBe(2);
    expect(await db.getPity(5, 'rare_cache')).toBe(9);
  });

  it('pack openings: records contents and the UNIQUE tx_sig is a replay guard', async () => {
    const id = await db.recordPackOpening({ accountId: 5, packId: 'common_cache', txSig: 'burn-1', contents: [{ ref: 'worn_sword' }] });
    expect(id).toBeGreaterThan(0);
    expect(await db.hasPaymentSig('burn-1')).toBe(true);
    expect(await db.hasPaymentSig('never')).toBe(false);
    await expect(
      db.recordPackOpening({ accountId: 5, packId: 'common_cache', txSig: 'burn-1', contents: [] }),
    ).rejects.toThrow('unique_violation: pack_openings.tx_sig');
  });

  it('EngagementService end-to-end on real Postgres: claim, settle, reveal, open', async () => {
    const seed = Buffer.alloc(32, 5);
    const cfg = parseEngagementConfig({});
    const svc = new EngagementService(db, cfg, { makeSeed: () => seed });

    const claim = await svc.claimSpin({ accountId: 6, clientSeed: 'e2e', holderTier: 0, utcDay: 500 });
    const unit = deriveOutcomeUnit(seed, 6, 1, 'e2e');
    const expected = selectPrize(scaleTableForTier(DEFAULT_PRIZE_TABLE, 0), unit);
    expect(claim.spin.prizeKey).toBe(expected.key);

    await expect(svc.claimSpin({ accountId: 6, clientSeed: 'again', holderTier: 0, utcDay: 500 })).rejects.toThrow('already_spun');

    const settled = await svc.settleSpin(claim.spin.id, 'settle-sig-1');
    expect(settled.status).toBe('settled');
    expect((await svc.settleSpin(claim.spin.id, 'settle-sig-1')).status).toBe('settled'); // idempotent

    const revealed = await svc.revealDay(500);
    expect(deriveOutcomeUnit(Buffer.from(revealed, 'hex'), 6, 1, 'e2e')).toBe(unit);

    const open1 = await svc.openPack({ accountId: 7, packId: 'common_cache', txSig: 'svc-burn-1', policy: 'cosmetic', units: [0, 0, 0] });
    expect(open1.result.rewards).toHaveLength(2);
    expect(await db.getPity(7, 'common_cache')).toBe(1);
    await expect(
      svc.openPack({ accountId: 7, packId: 'common_cache', txSig: 'svc-burn-1', policy: 'cosmetic', units: [0, 0, 0] }),
    ).rejects.toThrow('replayed_payment');
  });
});
