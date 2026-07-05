// REAL-Postgres integration test for server/lp_guardian_db.ts: the one-query
// leaderboard prestige join (characters -> wallet_links -> lp_positions
// mirror) and the tier math over it. Mirrors the flow_ledger_db harness.
//
// CI-safe: skips entirely unless PG_TEST_URL points at a disposable Postgres.
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test npx vitest run tests/lp_guardian_db.integration.test.ts
// Run one shared-DB integration file at a time (--no-file-parallelism), like
// the other integration suites.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GUARDIAN_SEASONING_SECONDS } from '../src/sim/guardian_tier';

const PG_TEST_URL = process.env.PG_TEST_URL;
if (PG_TEST_URL) process.env.DATABASE_URL = PG_TEST_URL;
else process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';

const { pool, ensureSchema } = await import('../server/db');
const { guardianTiersForNames } = await import('../server/lp_guardian_db');
const { PgLpStakingDb } = await import('../server/lp_staking_db');

const POOL = 'PoolPubkey1111111111111111111111111111111111';
const NOW = 1_750_000_000;
const seasoned = NOW - GUARDIAN_SEASONING_SECONDS - 10;

describe.skipIf(!PG_TEST_URL)('guardianTiersForNames (real Postgres)', () => {
  beforeAll(async () => {
    await ensureSchema();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE lp_positions');
    await pool.query('TRUNCATE characters, wallet_links, accounts RESTART IDENTITY CASCADE');
  });

  async function seedPlayer(name: string, wallet: string | null): Promise<void> {
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [name.toLowerCase()],
    );
    const accountId = acc.rows[0].id;
    await pool.query(
      `INSERT INTO characters (account_id, name, class) VALUES ($1, $2, 'warrior')`,
      [accountId, name],
    );
    if (wallet) {
      await pool.query(`INSERT INTO wallet_links (account_id, pubkey) VALUES ($1, $2)`, [
        accountId,
        wallet,
      ]);
    }
  }

  it('maps character names to guardian tiers through the wallet link and the mirror', async () => {
    await seedPlayer('Abyssal', 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await seedPlayer('Fresh', 'WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    await seedPlayer('NoWallet', null);
    const db = new PgLpStakingDb();
    await db.upsertPositions([
      // seasoned, 366d remaining lock: abyssguard (tier 5)
      {
        pool: POOL,
        owner: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        amountBase: 500n,
        lockedUntil: NOW + 366 * 86_400,
        stakedAt: seasoned,
      },
      // staked yesterday: seasoning gate hides the flair
      {
        pool: POOL,
        owner: 'WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amountBase: 500n,
        lockedUntil: 0,
        stakedAt: NOW - 86_400,
      },
    ]);
    const tiers = await guardianTiersForNames(
      ['Abyssal', 'Fresh', 'NoWallet', 'Ghost'],
      POOL,
      1n,
      NOW,
    );
    expect(tiers.get('Abyssal')).toBe(5);
    expect(tiers.has('Fresh')).toBe(false);
    expect(tiers.has('NoWallet')).toBe(false);
    expect(tiers.has('Ghost')).toBe(false);
  });

  it('scopes to the pool and applies the dust floor', async () => {
    await seedPlayer('Duster', 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
    const db = new PgLpStakingDb();
    await db.upsertPositions([
      {
        pool: POOL,
        owner: 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        amountBase: 5n,
        lockedUntil: 0,
        stakedAt: seasoned,
      },
    ]);
    expect((await guardianTiersForNames(['Duster'], POOL, 10n, NOW)).has('Duster')).toBe(false); // below floor
    expect((await guardianTiersForNames(['Duster'], 'OtherPool', 1n, NOW)).has('Duster')).toBe(
      false,
    ); // wrong pool
    expect((await guardianTiersForNames(['Duster'], POOL, 1n, NOW)).get('Duster')).toBe(1); // wader
  });

  it('an empty name list is a no-op (no query)', async () => {
    expect((await guardianTiersForNames([], POOL, 1n, NOW)).size).toBe(0);
  });
});
