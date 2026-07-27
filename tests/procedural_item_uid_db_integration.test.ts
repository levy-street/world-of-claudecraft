import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PROCEDURAL_ITEM_UID_SCHEMA,
  reserveProceduralItemUidBlock,
} from '../server/procedural_item_uid_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA_NAME = 'procedural_item_uid_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

describeDb('procedural item UID leasing (real Postgres)', () => {
  let pool: Pool;

  async function scopedQuery(text: string, values?: unknown[]) {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA_NAME}`);
      return await client.query(text, values);
    } finally {
      client.release();
    }
  }

  function scopedPool(): Pick<Pool, 'query'> {
    return { query: scopedQuery } as unknown as Pick<Pool, 'query'>;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 16 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA_NAME}`);
    await scopedQuery(PROCEDURAL_ITEM_UID_SCHEMA);
    await scopedQuery(PROCEDURAL_ITEM_UID_SCHEMA);
  });

  beforeEach(async () => {
    await scopedQuery('TRUNCATE procedural_item_uid_sequences');
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
    await pool.end();
  });

  it('reserves 64 concurrent same-realm ranges without overlap', async () => {
    const blockSize = 37;
    const leases = await Promise.all(
      Array.from({ length: 64 }, () =>
        reserveProceduralItemUidBlock(scopedPool(), 'Concurrency Realm', blockSize),
      ),
    );
    const ranges = leases
      .map((lease) => [BigInt(lease.startSerial), BigInt(lease.endExclusive)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));

    expect(new Set(ranges.map(([start]) => start.toString())).size).toBe(64);
    for (let i = 0; i < ranges.length; i++) {
      const expectedStart = 1n + BigInt(i * blockSize);
      expect(ranges[i]).toEqual([expectedStart, expectedStart + BigInt(blockSize)]);
    }
    const counter = await scopedQuery(
      'SELECT next_serial::text AS next_serial FROM procedural_item_uid_sequences WHERE realm = $1',
      ['Concurrency Realm'],
    );
    expect(counter.rows).toEqual([{ next_serial: String(1 + 64 * blockSize) }]);
  });

  it('scopes counters independently by realm and never reissues a discarded lease', async () => {
    const firstA = await reserveProceduralItemUidBlock(scopedPool(), 'Realm A', 10);
    const firstB = await reserveProceduralItemUidBlock(scopedPool(), 'Realm B', 10);
    const secondA = await reserveProceduralItemUidBlock(scopedPool(), 'Realm A', 10);

    expect(firstA.startSerial).toBe('1');
    expect(firstB.startSerial).toBe('1');
    expect(secondA.startSerial).toBe('11');
    expect(firstA.realmNamespace).not.toBe(firstB.realmNamespace);
  });

  it('fails atomically on BIGINT overflow and leaves the counter unchanged', async () => {
    const nearMax = '9223372036854775802';
    await scopedQuery(
      'INSERT INTO procedural_item_uid_sequences (realm, next_serial) VALUES ($1, $2::bigint)',
      ['Overflow Realm', nearMax],
    );

    await expect(
      reserveProceduralItemUidBlock(scopedPool(), 'Overflow Realm', 10),
    ).rejects.toBeDefined();
    const counter = await scopedQuery(
      'SELECT next_serial::text AS next_serial FROM procedural_item_uid_sequences WHERE realm = $1',
      ['Overflow Realm'],
    );
    expect(counter.rows).toEqual([{ next_serial: nearMax }]);
  });
});
