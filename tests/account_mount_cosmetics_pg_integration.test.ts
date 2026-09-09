// Real SQL proof in a disposable per-run database, following the existing
// TEST_DATABASE_URL convention. No shared application database is modified.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.TEST_DATABASE_URL;
const database = `woc_mount_skins_${process.pid}_${process.env.VITEST_WORKER_ID ?? '0'}`;
const target = adminUrl ? new URL(adminUrl) : null;
if (target) {
  target.pathname = `/${database}`;
  process.env.DATABASE_URL = target.toString();
}
const describeDb = adminUrl ? describe : describe.skip;
describeDb('account mount cosmetics (real Postgres)', () => {
  let admin: Pool;
  let db: typeof import('../server/db');
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE "${database}"`);
    db = await import('../server/db');
    await db.ensureSchema();
  }, 60_000);
  afterAll(async () => {
    await db?.pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });
  it('unions concurrent grants, survives legacy account writes, and keeps weapon state', async () => {
    const row = await db.pool.query(
      "INSERT INTO accounts (username, password_hash) VALUES ('MountSqlBuyer', 'test') RETURNING id",
    );
    const id = Number(row.rows[0].id);
    await db.grantAccountWeaponSkins(id, ['ice_fang_sword']);
    await db.setAccountWeaponSkinLoadout(id, { sword: 'ice_fang_sword' });
    await Promise.all([
      db.grantAccountMountSkins(id, ['mech_bird', 'chimeglass_tortoise']),
      db.grantAccountMountSkins(id, ['rickshaw_mount', 'goblin_rocket_sled', 'rallycart_rxt']),
      db.grantAccountMountSkins(id, ['mech_bird']),
    ]);
    // An older binary replaces only accounts.cosmetics; paid rows survive.
    await db.pool.query("UPDATE accounts SET cosmetics = '{}'::jsonb WHERE id = $1", [id]);
    const loaded = await db.loadAccountCosmetics(id);
    expect(loaded.mountSkinIds.slice().sort()).toEqual([
      'chimeglass_tortoise',
      'goblin_rocket_sled',
      'mech_bird',
      'rallycart_rxt',
      'rickshaw_mount',
    ]);
    expect(loaded.weaponSkinIds).toEqual(['ice_fang_sword']);
    expect(loaded.weaponSkinLoadout).toEqual({ sword: 'ice_fang_sword' });
    const rows = await db.pool.query(
      'SELECT skin_ids FROM account_mount_cosmetics WHERE account_id = $1',
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].skin_ids).toHaveLength(5);
    await db.pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    expect(
      (await db.pool.query('SELECT 1 FROM account_mount_cosmetics WHERE account_id = $1', [id]))
        .rows,
    ).toEqual([]);
  });
});
