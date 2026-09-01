// Real-Postgres coverage for the World Market sold-volume store: the DDL's
// additive idempotence (there are no migration files, so ensureSchema
// re-applies it at every boot under the advisory lock and a second boot over a
// populated table must be a no-op), the accumulating upsert, the windowed
// read-back, and the retention prune.
//
// These are the claims a fake-db test structurally cannot make. The unit suite
// (tests/server/market_sold_volume.test.ts) pins the SQL TEXT and the pure
// verdicts; this one proves the statements actually run, that the ON CONFLICT
// target matches a real constraint, that the BIGINT counters come back as
// numbers, and that the day arithmetic behaves at the window boundary.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_stepup_pg_integration.test.ts.
//
// The schema is applied DIRECTLY rather than through db.ensureSchema(): what is
// under test is this module's own DDL, and applying it in isolation is what
// makes "re-applying it is a no-op" a statement about this DDL rather than
// about the whole boot path.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MARKET_SOLD_VOLUME_RETENTION_DAYS,
  MARKET_SOLD_VOLUME_SCHEMA,
  marketSoldVolumeRetentionTable,
  pruneMarketSoldVolumeBatch,
  readMarketSoldVolumeSince,
  recordMarketSoldVolumeRow,
} from '../server/market_sold_volume_db';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_market_sold_volume_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('market_sold_volume against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);
    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 6 });
    await pool.query(MARKET_SOLD_VOLUME_SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  async function reset(): Promise<void> {
    await pool.query('DELETE FROM market_sold_volume');
  }

  it('re-applies cleanly over a populated table (the boot contract)', async () => {
    await reset();
    await recordMarketSoldVolumeRow(pool, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
    // Twice more, exactly as two extra boots would.
    await pool.query(MARKET_SOLD_VOLUME_SCHEMA);
    await pool.query(MARKET_SOLD_VOLUME_SCHEMA);
    const rows = await readMarketSoldVolumeSince(pool, 'eastbrook', 7);
    expect(rows, 'the re-applied DDL disturbed existing rows').toEqual([
      { itemId: 'wyrmfall_core', saleCount: 1, quantity: 3, copper: 900 },
    ]);
  });

  it('creates the primary key and the day index the prune needs', async () => {
    const res = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'market_sold_volume' ORDER BY indexname`,
    );
    const names = res.rows.map((row) => row.indexname);
    expect(names).toContain('market_sold_volume_day');
    expect(names).toContain('market_sold_volume_pkey');
  });

  it('accumulates repeat sales into one row per (realm, day, item)', async () => {
    await reset();
    for (const sale of [
      { itemId: 'wyrmfall_core', quantity: 3, copper: 900 },
      { itemId: 'wyrmfall_core', quantity: 2, copper: 600 },
      { itemId: 'vale_wheat_seed', quantity: 10, copper: 50 },
    ]) {
      await recordMarketSoldVolumeRow(pool, 'eastbrook', sale);
    }
    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM market_sold_volume`,
    );
    // Two ITEMS on one day, not three sales: this is a roll-up, and that is
    // the whole growth argument for the table.
    expect(count.rows[0].n).toBe('2');
    const rows = await readMarketSoldVolumeSince(pool, 'eastbrook', 7);
    expect([...rows].sort((a, b) => (a.itemId < b.itemId ? -1 : 1))).toEqual([
      { itemId: 'vale_wheat_seed', saleCount: 1, quantity: 10, copper: 50 },
      { itemId: 'wyrmfall_core', saleCount: 2, quantity: 5, copper: 1500 },
    ]);
  });

  it('returns BIGINT counters as numbers, not strings', async () => {
    await reset();
    await recordMarketSoldVolumeRow(pool, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
    const [row] = await readMarketSoldVolumeSince(pool, 'eastbrook', 7);
    // pg hands BIGINT back as a string; a readout forwarding it would
    // concatenate where the fold means to add.
    expect(typeof row.saleCount).toBe('number');
    expect(typeof row.quantity).toBe('number');
    expect(typeof row.copper).toBe('number');
  });

  it('scopes the read to one realm', async () => {
    await reset();
    await recordMarketSoldVolumeRow(pool, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
    await recordMarketSoldVolumeRow(pool, 'westfall', {
      itemId: 'wyrmfall_core',
      quantity: 99,
      copper: 99_000,
    });
    // One process reports its OWN realm, matching the listing half.
    expect(await readMarketSoldVolumeSince(pool, 'eastbrook', 7)).toEqual([
      { itemId: 'wyrmfall_core', saleCount: 1, quantity: 3, copper: 900 },
    ]);
  });

  it('reads the trailing window inclusive of today and excludes older days', async () => {
    await reset();
    await pool.query(
      `INSERT INTO market_sold_volume (realm, day, item_id, sale_count, quantity, copper)
       VALUES ('eastbrook', (now() AT TIME ZONE 'utc')::date, 'today_item', 1, 1, 10),
              ('eastbrook', (now() AT TIME ZONE 'utc')::date - 6, 'edge_item', 1, 1, 20),
              ('eastbrook', (now() AT TIME ZONE 'utc')::date - 7, 'stale_item', 1, 1, 30)`,
    );
    const ids = (await readMarketSoldVolumeSince(pool, 'eastbrook', 7))
      .map((row) => row.itemId)
      .sort();
    // A 7-day window is today plus the six before it: the day exactly 7 back
    // is outside, which is the boundary an off-by-one would move.
    expect(ids).toEqual(['edge_item', 'today_item']);
    expect(await readMarketSoldVolumeSince(pool, 'eastbrook', 1)).toEqual([
      { itemId: 'today_item', saleCount: 1, quantity: 1, copper: 10 },
    ]);
  });

  it('prunes only days past the window, in bounded batches, oldest first', async () => {
    await reset();
    await pool.query(
      `INSERT INTO market_sold_volume (realm, day, item_id, sale_count, quantity, copper)
       SELECT 'eastbrook', (now() AT TIME ZONE 'utc')::date - g, 'aged_' || g, 1, 1, 1
         FROM generate_series(0, 200) AS g`,
    );
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM market_sold_volume`,
    );
    expect(before.rows[0].n).toBe('201');
    // A batch smaller than the expired set: the sweep's bounded-batch contract.
    const first = await pruneMarketSoldVolumeBatch(pool, MARKET_SOLD_VOLUME_RETENTION_DAYS, 10);
    expect(first).toBe(10);
    // Oldest first is the forward-progress guarantee: the very oldest day must
    // be gone after one batch.
    const oldest = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM market_sold_volume
        WHERE day = (now() AT TIME ZONE 'utc')::date - 200`,
    );
    expect(oldest.rows[0].n).toBe('0');
    // Drain the rest through the registration the sweep actually uses.
    const table = marketSoldVolumeRetentionTable(pool);
    expect(table.name).toBe('market_sold_volume');
    for (let i = 0; i < 40; i++) {
      if ((await table.pruneBatch(1000)) === 0) break;
    }
    const kept = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM market_sold_volume`,
    );
    // Everything inside the window survives, and nothing outside it does.
    expect(Number(kept.rows[0].n)).toBe(MARKET_SOLD_VOLUME_RETENTION_DAYS + 1);
    const oldestKept = await pool.query<{ d: string }>(
      `SELECT min(day)::text AS d FROM market_sold_volume`,
    );
    const age = await pool.query<{ age: string }>(
      `SELECT ((now() AT TIME ZONE 'utc')::date - $1::date)::text AS age`,
      [oldestKept.rows[0].d],
    );
    expect(Number(age.rows[0].age)).toBe(MARKET_SOLD_VOLUME_RETENTION_DAYS);
  });

  it('keeps forever on a zero window', async () => {
    await reset();
    await pool.query(
      `INSERT INTO market_sold_volume (realm, day, item_id, sale_count, quantity, copper)
       VALUES ('eastbrook', (now() AT TIME ZONE 'utc')::date - 5000, 'ancient', 1, 1, 1)`,
    );
    expect(await pruneMarketSoldVolumeBatch(pool, 0, 1000)).toBe(0);
    const kept = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM market_sold_volume`,
    );
    expect(kept.rows[0].n).toBe('1');
  });

  // The constant relation RETENTION > WINDOW used to sit here as a third case.
  // It needs no Postgres, and inside this describeDb it was skipped in every
  // DB-less run, which is every local run without TEST_DATABASE_URL. It lives
  // in the unit suite now (tests/server/market_sold_volume.test.ts), beside the
  // other assertions about these constants.
});
