// Real projection SQL against a disposable database; shared application state
// is untouched. TEST_DATABASE_URL follows the repository's opt-in DB convention.
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.TEST_DATABASE_URL;
const database = `woc_mount_items_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const target = adminUrl ? new URL(adminUrl) : null;
if (target) {
  target.pathname = `/${database}`;
  process.env.DATABASE_URL = target.toString();
}
const describeDb = adminUrl ? describe : describe.skip;

describeDb('account mount item projection (real Postgres)', () => {
  let admin: Pool;
  let db: typeof import('../server/db');
  let mounts: typeof import('../server/account_mount_items_db');
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE "${database}"`);
    db = await import('../server/db');
    mounts = await import('../server/account_mount_items_db');
    await db.pool.query(`
      CREATE TABLE characters (id SERIAL PRIMARY KEY, account_id INT, realm TEXT, state JSONB);
      CREATE INDEX characters_account ON characters(account_id);
    `);
  }, 60_000);
  afterAll(async () => {
    await db?.pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it('includes bags and personal banks across realms, excludes other accounts and non-possession containers', async () => {
    const state = {
      inventory: [
        { itemId: 'reins_valorsteed', count: 1 },
        { itemId: 'reins_valorsteed', count: 2 },
        { itemId: 'reins_stalkglider_snail', count: 'invalid' },
        { itemId: 'reins_stormfeather_griffin', count: 0 },
      ],
      bank: { inventory: [{ itemId: 'reins_grag_bear', count: 1 }] },
      vendorBuyback: [{ itemId: 'reins_stalkglider_snail', count: 1 }],
      mail: [{ itemId: 'reins_stormfeather_griffin', count: 1 }],
      guildBank: { inventory: [{ itemId: 'reins_stormfeather_griffin', count: 1 }] },
    };
    await db.pool.query('INSERT INTO characters (account_id, realm, state) VALUES ($1, $2, $3)', [
      1,
      'east',
      state,
    ]);
    await db.pool.query('INSERT INTO characters (account_id, realm, state) VALUES ($1, $2, $3)', [
      1,
      'west',
      {
        bank: { inventory: [{ itemId: 'reins_stalkglider_snail', count: 1 }] },
        inventory: null,
      },
    ]);
    await db.pool.query('INSERT INTO characters (account_id, realm, state) VALUES ($1, $2, $3)', [
      2,
      'west',
      {
        inventory: [{ itemId: 'reins_stormfeather_griffin', count: 1 }],
        bank: { inventory: 'malformed' },
      },
    ]);
    const rows = await mounts.loadAccountMountItems(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].mountSkinIds.slice().sort()).toEqual(['grag_bear', 'valorsteed']);
    expect(rows[1].mountSkinIds).toEqual(['stalkglider_snail']);
    await db.pool.query("UPDATE characters SET state = '{}'::jsonb WHERE account_id = 1");
    expect((await mounts.loadAccountMountItems(1)).map((row) => row.mountSkinIds)).toEqual([
      [],
      [],
    ]);
  });

  it('uses the account index with a grown unrelated character population and returns bounded projections', async () => {
    const { MOUNT_ITEM_IDS } = await import('../server/account_mount_items_core');
    await db.pool.query('DELETE FROM characters WHERE account_id = 1');
    const slots = (length: number) =>
      Array.from({ length }, (_, index) => ({
        itemId: index % 5 === 0 ? MOUNT_ITEM_IDS[index % MOUNT_ITEM_IDS.length] : 'non_mount_junk',
        count: 1,
      }));
    // Ten characters per realm, full containers and incompressible unrelated
    // state force real JSONB detoast work before the SQL-local projection.
    for (let index = 0; index < 20; index++) {
      await db.pool.query('INSERT INTO characters (account_id, realm, state) VALUES ($1, $2, $3)', [
        1,
        index < 10 ? 'east' : 'west',
        {
          inventory: slots(32),
          bank: { inventory: slots(128) },
          unrelatedHistory: randomBytes(20_000).toString('hex'),
        },
      ]);
    }
    await db.pool.query(`INSERT INTO characters (account_id, realm, state)
      SELECT 10 + n, 'unrelated', jsonb_build_object('inventory',
        jsonb_build_array(jsonb_build_object('itemId', 'reins_valorsteed', 'count', 1)))
      FROM generate_series(1, 1000) AS n`);
    await db.pool.query('ANALYZE characters');
    const explained = await db.pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${mounts.ACCOUNT_MOUNT_ITEMS_SQL}`,
      [1, MOUNT_ITEM_IDS],
    );
    const plan = explained.rows[0]['QUERY PLAN'][0];
    expect(JSON.stringify(plan)).toContain('characters_account');
    expect(plan.Plan['Actual Rows']).toBe(20);
    expect(plan.Plan['Shared Hit Blocks']).toBeGreaterThan(0);
    const projected = await mounts.loadAccountMountItems(1);
    const responseBytes = Buffer.byteLength(JSON.stringify(projected));
    expect(projected).toHaveLength(20);
    expect(projected.every((row) => row.mountSkinIds.length <= MOUNT_ITEM_IDS.length)).toBe(true);
    expect(responseBytes).toBeLessThan(6_000);
    console.log(
      'account mount item projection with 20 full target characters, 3200 slot rows, and 1000 unrelated characters:',
      plan['Execution Time'],
      'ms; shared hits:',
      plan.Plan['Shared Hit Blocks'],
      '; response bytes:',
      responseBytes,
    );
  });
});
