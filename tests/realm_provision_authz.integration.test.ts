// Authorization + state-guard + boundary coverage for the stake-to-provision
// orchestration (#475), against a real Postgres. These are the security-relevant
// paths the HTTP routes (POST /api/realms/quote,/confirm,/:id/decommission,
// /:id/release) gate on, and every one of them returns BEFORE any Solana RPC
// call, so they exercise the real functions with no chain and no mocks.
//
// Gated on PG_TEST_URL (skips in CI). This and the other realm DB-integration
// tests reset the shared database, so run them sequentially against one PG:
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test \
//     npx vitest run --no-file-parallelism tests/realm_*.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG = process.env.PG_TEST_URL;
if (PG) process.env.DATABASE_URL ??= PG;
const run = PG ? describe : describe.skip;

const WALLET_A = 'AAAA1111111111111111111111111111111111111111';
const WALLET_B = 'BBBB2222222222222222222222222222222222222222';

run('stake-to-provision authorization + guards (real Postgres)', () => {
  let db: typeof import('../server/db');
  let realmDb: typeof import('../server/realm_db');
  let quoteDb: typeof import('../server/realm_quote_db');
  let provision: typeof import('../server/realm_provision');
  let accA: number;
  let accB: number;

  // Active realm owned by accA, returns its realmId.
  async function activeRealmOwnedByA(name: string): Promise<number> {
    const r = await realmDb.createProvisioningRealm(db.pool, { name, type: 'Normal', ownerAccountId: accA, tier: 1 });
    await realmDb.activateRealm(db.pool, r.realmId);
    return r.realmId;
  }

  beforeAll(async () => {
    db = await import('../server/db');
    realmDb = await import('../server/realm_db');
    quoteDb = await import('../server/realm_quote_db');
    provision = await import('../server/realm_provision');
    await db.pool.query('DROP TABLE IF EXISTS realm_quotes, realm_stakes, realm_roles, realms CASCADE');
    await db.ensureSchema();
    accA = (await db.createAccount(`a_${Date.now()}`, 'h')).id;
    accB = (await db.createAccount(`b_${Date.now()}`, 'h')).id;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  describe('prepareProvisionQuote name + cap guards (pre-RPC)', () => {
    it('rejects an invalid realm name (charset/length)', async () => {
      const r = await provision.prepareProvisionQuote(db.pool, { accountId: accA, ownerWallet: WALLET_A, name: '@@bad@@', type: 'Normal', amountBase: 1n });
      expect(r).toMatchObject({ ok: false, status: 400, error: 'invalid_realm_name' });
    });

    it('rejects a name already live', async () => {
      await activeRealmOwnedByA('TakenName');
      const r = await provision.prepareProvisionQuote(db.pool, { accountId: accB, ownerWallet: WALLET_B, name: 'TakenName', type: 'Normal', amountBase: 1n });
      expect(r).toMatchObject({ ok: false, status: 409, error: 'realm_name_taken' });
    });

    it('rejects once the per-account realm cap is reached', async () => {
      const cap = 3; // REALM_MAX_PER_ACCOUNT default
      const capAcc = (await db.createAccount(`cap_${Date.now()}`, 'h')).id;
      for (let i = 0; i < cap; i++) {
        await realmDb.createProvisioningRealm(db.pool, { name: `CapRealm ${capAcc} ${i}`, type: 'Normal', ownerAccountId: capAcc, tier: 1 });
      }
      const r = await provision.prepareProvisionQuote(db.pool, { accountId: capAcc, ownerWallet: WALLET_A, name: `OneMore ${capAcc}`, type: 'Normal', amountBase: 1n });
      expect(r).toMatchObject({ ok: false, status: 409, error: 'realm_cap_reached' });
    });
  });

  describe('confirmProvisionQuote authorization', () => {
    it('404s an unknown quote', async () => {
      const r = await provision.confirmProvisionQuote(db.pool, { accountId: accA, quoteId: 'does-not-exist', lockSig: 'x' });
      expect(r).toMatchObject({ ok: false, status: 404, error: 'quote_not_found' });
    });

    it('403s when another account tries to confirm your quote', async () => {
      const realmId = (await realmDb.createProvisioningRealm(db.pool, { name: `QuoteRealm ${Date.now()}`, type: 'Normal', ownerAccountId: accA, tier: 1 })).realmId;
      await quoteDb.createRealmQuote(db.pool, { quoteId: 'q-owned-by-a', accountId: accA, realmId, ownerWallet: WALLET_A, amountBase: 100n, tier: 1, mint: 'M', expiresAt: new Date(Date.now() + 60_000) });
      const r = await provision.confirmProvisionQuote(db.pool, { accountId: accB, quoteId: 'q-owned-by-a', lockSig: 'x' });
      expect(r).toMatchObject({ ok: false, status: 403, error: 'not_your_quote' });
    });

    it('410s an expired quote', async () => {
      const realmId = (await realmDb.createProvisioningRealm(db.pool, { name: `ExpRealm ${Date.now()}`, type: 'Normal', ownerAccountId: accA, tier: 1 })).realmId;
      await quoteDb.createRealmQuote(db.pool, { quoteId: 'q-expired', accountId: accA, realmId, ownerWallet: WALLET_A, amountBase: 100n, tier: 1, mint: 'M', expiresAt: new Date(Date.now() - 1000) });
      const r = await provision.confirmProvisionQuote(db.pool, { accountId: accA, quoteId: 'q-expired', lockSig: 'x' });
      expect(r).toMatchObject({ ok: false, status: 410, error: 'quote_expired' });
    });
  });

  describe('requestRealmDecommission authorization + state', () => {
    it('404s an unknown realm', async () => {
      const r = await provision.requestRealmDecommission(db.pool, { accountId: accA, realmId: 999999 });
      expect(r).toMatchObject({ ok: false, status: 404, error: 'realm_not_found' });
    });

    it('403s a non-owner', async () => {
      const realmId = await activeRealmOwnedByA(`DecOwn ${Date.now()}`);
      const r = await provision.requestRealmDecommission(db.pool, { accountId: accB, realmId });
      expect(r).toMatchObject({ ok: false, status: 403, error: 'not_realm_owner' });
    });

    it('409s a realm that is not active (still provisioning)', async () => {
      const realmId = (await realmDb.createProvisioningRealm(db.pool, { name: `Prov ${Date.now()}`, type: 'Normal', ownerAccountId: accA, tier: 1 })).realmId;
      const r = await provision.requestRealmDecommission(db.pool, { accountId: accA, realmId });
      expect(r).toMatchObject({ ok: false, status: 409, error: 'realm_not_active' });
    });
  });

  describe('finalizeRealmRelease authorization + timelock', () => {
    it('403s a non-owner', async () => {
      const realmId = await activeRealmOwnedByA(`FinOwn ${Date.now()}`);
      await provision.requestRealmDecommission(db.pool, { accountId: accA, realmId });
      const r = await provision.finalizeRealmRelease(db.pool, { accountId: accB, realmId });
      expect(r).toMatchObject({ ok: false, status: 403, error: 'not_realm_owner' });
    });

    it('409s a realm not in decommissioning', async () => {
      const realmId = await activeRealmOwnedByA(`FinActive ${Date.now()}`);
      const r = await provision.finalizeRealmRelease(db.pool, { accountId: accA, realmId });
      expect(r).toMatchObject({ ok: false, status: 409, error: 'realm_not_decommissioning' });
    });

    it('409s timelock_not_elapsed before the migration window (the critical fix)', async () => {
      const realmId = await activeRealmOwnedByA(`FinTimelock ${Date.now()}`);
      // default UNSTAKE_TIMELOCK is 3 days, so releaseEligibleAt is well in the future
      await provision.requestRealmDecommission(db.pool, { accountId: accA, realmId });
      const r = await provision.finalizeRealmRelease(db.pool, { accountId: accA, realmId });
      expect(r).toMatchObject({ ok: false, status: 409, error: 'timelock_not_elapsed' });
    });
  });
});
