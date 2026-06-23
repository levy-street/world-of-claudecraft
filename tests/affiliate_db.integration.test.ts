// Real-Postgres integration test for the realm affiliate program (#475): stable
// per-account affiliate codes, first-touch per-realm attribution, and the
// affiliate dashboard queries. Drives the real boot path (ensureSchema) so the
// AFFILIATE_SCHEMA DDL + the queries run against a live database.
//
// Gated on PG_TEST_URL. Run sequentially with the other realm DB-integration
// tests (they reset the shared database):
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test \
//     npx vitest run --no-file-parallelism tests/affiliate_db.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG = process.env.PG_TEST_URL;
if (PG) process.env.DATABASE_URL ??= PG;
const run = PG ? describe : describe.skip;

run('affiliate_db against real Postgres', () => {
  let db: typeof import('../server/db');
  let realmDb: typeof import('../server/realm_db');
  let aff: typeof import('../server/affiliate_db');
  let seller: number; // the affiliate (salesperson)
  let founder: number; // the realm founder referred by the affiliate

  beforeAll(async () => {
    db = await import('../server/db');
    realmDb = await import('../server/realm_db');
    aff = await import('../server/affiliate_db');
    await db.pool.query('DROP TABLE IF EXISTS realm_affiliates, affiliate_codes, realm_quotes, realm_stakes, realm_roles, realms CASCADE');
    await db.ensureSchema();
    seller = (await db.createAccount(`seller_${Date.now()}`, 'h')).id;
    founder = (await db.createAccount(`founder_${Date.now()}`, 'h')).id;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('mints a stable, unique affiliate code per account and resolves it back', async () => {
    const code = await aff.getOrCreateAffiliateCode(db.pool, seller);
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // idempotent: the same account keeps the same code
    expect(await aff.getOrCreateAffiliateCode(db.pool, seller)).toBe(code);
    // resolves back to the account; an unknown code is null
    expect(await aff.accountForAffiliateCode(db.pool, code)).toBe(seller);
    expect(await aff.accountForAffiliateCode(db.pool, 'not-a-real-code')).toBeNull();
    // a different account gets a different code
    const other = await aff.getOrCreateAffiliateCode(db.pool, founder);
    expect(other).not.toBe(code);
  });

  it('attributes a realm to an affiliate first-touch and reads it back', async () => {
    const realm = await realmDb.createProvisioningRealm(db.pool, { name: `Aff A ${Date.now()}`, type: 'PvP', ownerAccountId: founder, tier: 2 });
    await aff.setRealmAffiliate(db.pool, { realmId: realm.realmId, affiliateAccountId: seller, bps: 1500 });
    expect(await aff.getRealmAffiliate(db.pool, realm.realmId)).toEqual({ affiliateAccountId: seller, bps: 1500 });

    // first-touch: a later attribution (different affiliate or bps) is a no-op
    await aff.setRealmAffiliate(db.pool, { realmId: realm.realmId, affiliateAccountId: founder, bps: 9999 });
    expect(await aff.getRealmAffiliate(db.pool, realm.realmId)).toEqual({ affiliateAccountId: seller, bps: 1500 });

    // a realm with no affiliate returns null
    const bare = await realmDb.createProvisioningRealm(db.pool, { name: `Aff Bare ${Date.now()}`, type: 'Normal', ownerAccountId: founder, tier: 1 });
    expect(await aff.getRealmAffiliate(db.pool, bare.realmId)).toBeNull();
  });

  it('lists an affiliate\'s referred realms (non-closed, newest first) with the commission bps', async () => {
    const ts = Date.now();
    const r1 = await realmDb.createProvisioningRealm(db.pool, { name: `Ref One ${ts}`, type: 'PvP', ownerAccountId: founder, tier: 1 });
    const r2 = await realmDb.createProvisioningRealm(db.pool, { name: `Ref Two ${ts}`, type: 'RP', ownerAccountId: founder, tier: 3 });
    await realmDb.activateRealm(db.pool, r1.realmId);
    await realmDb.activateRealm(db.pool, r2.realmId);
    await aff.setRealmAffiliate(db.pool, { realmId: r1.realmId, affiliateAccountId: seller, bps: 1500 });
    await aff.setRealmAffiliate(db.pool, { realmId: r2.realmId, affiliateAccountId: seller, bps: 1500 });

    const list = await aff.listRealmsByAffiliate(db.pool, seller);
    const refNames = list.map((r) => r.name);
    expect(refNames).toContain(`Ref One ${ts}`);
    expect(refNames).toContain(`Ref Two ${ts}`);
    expect(list.find((r) => r.name === `Ref Two ${ts}`)).toMatchObject({ bps: 1500, tier: 3, type: 'RP', status: 'active' });

    const countBefore = await aff.affiliateRealmCount(db.pool, seller);
    expect(countBefore).toBe(list.length);

    // a closed realm drops out of the dashboard (and its affiliate row cascades)
    await realmDb.setRealmStatus(db.pool, r2.realmId, 'closed');
    const after = await aff.listRealmsByAffiliate(db.pool, seller);
    expect(after.map((r) => r.name)).not.toContain(`Ref Two ${ts}`);
    expect(await aff.affiliateRealmCount(db.pool, seller)).toBe(countBefore - 1);
  });

  it('cascades the affiliate row when the realm is deleted', async () => {
    const realm = await realmDb.createProvisioningRealm(db.pool, { name: `Aff Cascade ${Date.now()}`, type: 'Normal', ownerAccountId: founder, tier: 1 });
    await aff.setRealmAffiliate(db.pool, { realmId: realm.realmId, affiliateAccountId: seller, bps: 1500 });
    await db.pool.query('DELETE FROM realms WHERE realm_id = $1', [realm.realmId]);
    expect(await aff.getRealmAffiliate(db.pool, realm.realmId)).toBeNull();
  });
});
