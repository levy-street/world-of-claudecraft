// Opt-in real-Postgres coverage for the limited-relic serial ledger. The default
// suite exercises the service against an in-memory fake (tests/server/
// limited_supply.test.ts); THIS file runs the actual PgLimitedSupplyDb SQL against
// a live PostgreSQL 16, so the transaction, the cap guard, the reclaim/allocate
// branches, and the concurrent-lease safety are verified against the real engine
// (not a model of it). Set TEST_DATABASE_URL to run it; it skips otherwise.

import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITED_SUPPLY_SCHEMA, PgLimitedSupplyDb } from '../server/limited_supply_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'limited_supply_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

describeDb('limited-relic serial ledger (real Postgres)', () => {
  // Every pool connection runs in the isolated test schema so the unqualified DDL
  // table names resolve there and the suite never touches production tables.
  const pool = new Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA}`, max: 6 });
  const db = new PgLimitedSupplyDb(pool);

  const resetSchema = async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(LIMITED_SUPPLY_SCHEMA);
  };

  beforeEach(resetSchema);
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await pool.end();
  });

  const rowState = async (itemId: string, serial: number): Promise<string | undefined> => {
    const r = await pool.query('SELECT state FROM limited_serials WHERE item_id=$1 AND serial=$2', [
      itemId,
      serial,
    ]);
    return r.rows[0]?.state as string | undefined;
  };

  it('seedSupply is idempotent and never lowers a shipped cap', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 25 }]);
    await db.seedSupply([{ itemId: 'relic', supply: 3 }]); // a re-seed with a smaller number
    const r = await pool.query(
      'SELECT supply, next_serial FROM limited_item_supply WHERE item_id=$1',
      ['relic'],
    );
    expect(r.rows[0].supply).toBe(25); // frozen at the first value
    expect(r.rows[0].next_serial).toBe(1);
  });

  it('leases 1..supply then returns null (the cap guard is enforced by the real UPDATE)', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 4 }]);
    const got: (number | null)[] = [];
    for (let i = 0; i < 6; i++) got.push(await db.leaseSerial('relic', 'r1'));
    expect(got).toEqual([1, 2, 3, 4, null, null]);
    // The rows really exist, all leased, none past the cap.
    const rows = await pool.query('SELECT serial, state FROM limited_serials ORDER BY serial');
    expect(rows.rows.map((x) => x.serial)).toEqual([1, 2, 3, 4]);
    expect(rows.rows.every((x) => x.state === 'leased')).toBe(true);
  });

  it('reclaims the lowest released serial before allocating a fresh one (dense reuse)', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 5 }]);
    for (let i = 0; i < 3; i++) await db.leaseSerial('relic', 'r1'); // 1,2,3
    await db.releaseSerials('relic', [2], 'r1'); // free serial 2
    // The next lease reuses 2 (lowest released), not a fresh 4.
    expect(await db.leaseSerial('relic', 'r1')).toBe(2);
    expect(await db.leaseSerial('relic', 'r1')).toBe(4); // then fresh
  });

  it('markMinted confirms a leased serial once, and is a no-op on a non-leased row', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 3 }]);
    await db.leaseSerial('relic', 'r1'); // serial 1
    await db.markMinted('relic', 1, { characterId: 42, characterName: 'Ada' });
    expect(await rowState('relic', 1)).toBe('minted');
    const row = await pool.query(
      'SELECT character_id, character_name, minted_at FROM limited_serials WHERE serial=1',
    );
    expect(row.rows[0].character_id).toBe(42);
    expect(row.rows[0].character_name).toBe('Ada');
    expect(row.rows[0].minted_at).not.toBeNull();
    // A retry (or a mint against an already-minted serial) changes nothing.
    await db.markMinted('relic', 1, { characterId: 99, characterName: 'Mallory' });
    const after = await pool.query('SELECT character_id FROM limited_serials WHERE serial=1');
    expect(after.rows[0].character_id).toBe(42); // not overwritten
  });

  it('releaseSerials only frees this realm’s still-leased serials', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 3 }]);
    await db.leaseSerial('relic', 'r1'); // 1 (r1)
    await db.leaseSerial('relic', 'r2'); // 2 (r2)
    await db.markMinted('relic', 1, { characterId: 1, characterName: 'A' });
    // r2 tries to release serials 1 (minted, not its realm) and 2 (its own leased).
    await db.releaseSerials('relic', [1, 2], 'r2');
    expect(await rowState('relic', 1)).toBe('minted'); // untouched (wrong realm + minted)
    expect(await rowState('relic', 2)).toBe('released'); // its own leased freed
  });

  it('readMints reports supply/minted/leased and the confirmed mint roll', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 5 }]);
    await db.leaseSerial('relic', 'r1'); // 1
    await db.leaseSerial('relic', 'r1'); // 2
    await db.markMinted('relic', 1, { characterId: 7, characterName: 'Bru' });
    const snap = await db.readMints();
    const row = snap.supplies.find((s) => s.itemId === 'relic');
    expect(row).toEqual({ itemId: 'relic', supply: 5, minted: 1, leased: 1 });
    expect(snap.mints).toHaveLength(1);
    expect(snap.mints[0]).toMatchObject({
      itemId: 'relic',
      serial: 1,
      characterName: 'Bru',
      realm: 'r1',
    });
    expect(typeof snap.mints[0].mintedAt).toBe('string');
  });

  it('never issues a duplicate serial under concurrent cross-realm leasing', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 50 }]);
    // 8 "realms" hammer leaseSerial for the same item at once. The real row lock +
    // the (item_id, serial) primary key must guarantee every issued serial is
    // distinct and none exceeds the cap. This is the safety the in-memory fake
    // (single-threaded) cannot prove.
    const realms = Array.from({ length: 8 }, (_v, i) => `realm-${i}`);
    const results = await Promise.all(
      realms.flatMap((realm) => Array.from({ length: 10 }, () => db.leaseSerial('relic', realm))),
    );
    const serials = results.filter((s): s is number => s !== null);
    expect(new Set(serials).size).toBe(serials.length); // all distinct: no double-issue
    expect(Math.max(...serials)).toBeLessThanOrEqual(50); // never past the cap
    // 80 lease attempts against a supply of 50 => exactly 50 issued, 30 null.
    expect(serials.length).toBe(50);
    expect(results.filter((s) => s === null)).toHaveLength(30);
    // And the ledger holds exactly the 50 distinct serials 1..50.
    const rows = await pool.query('SELECT serial FROM limited_serials ORDER BY serial');
    expect(rows.rows.map((x) => x.serial)).toEqual(Array.from({ length: 50 }, (_v, i) => i + 1));
  });

  it('the primary key physically rejects a duplicate (item_id, serial)', async () => {
    await db.seedSupply([{ itemId: 'relic', supply: 3 }]);
    await db.leaseSerial('relic', 'r1'); // serial 1
    await expect(
      pool.query(
        `INSERT INTO limited_serials (item_id, serial, state, realm) VALUES ('relic', 1, 'leased', 'r2')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
