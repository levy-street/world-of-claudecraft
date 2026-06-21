// Real-Postgres integration test for the realm registry (#475). Every other test
// in this repo mocks `pg`, so the realm_db DDL + SQL has never actually executed:
// the partial expression unique index, the FKs/CHECKs, the idempotent boot seed,
// the UNION owner-role query, and the status-guarded lifecycle UPDATEs were all
// unproven. This drives them against a live database via the REAL boot path
// (ensureSchema), asserting on the actual rows returned.
//
// Gated on PG_TEST_URL so CI (no Postgres) skips it. It resets the shared DB, so
// run the realm DB-integration tests sequentially against one Postgres:
//   docker run -d --rm -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
//     -e POSTGRES_DB=test -p 5544:5432 postgres:16-alpine
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test \
//     npx vitest run --no-file-parallelism tests/realm_*.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG_TEST_URL = process.env.PG_TEST_URL;
// db.ts builds its Pool from DATABASE_URL at import time, so point it at the
// test database before that module is (dynamically) imported below.
if (PG_TEST_URL) process.env.DATABASE_URL ??= PG_TEST_URL;

const run = PG_TEST_URL ? describe : describe.skip;

run('realm_db against real Postgres', () => {
  let db: typeof import('../server/db');
  let realm: typeof import('../server/realm');
  let realmDb: typeof import('../server/realm_db');
  let stakeDb: typeof import('../server/realm_stake_db');
  let ownerId: number;
  let modId: number;

  beforeAll(async () => {
    db = await import('../server/db');
    realm = await import('../server/realm');
    realmDb = await import('../server/realm_db');
    stakeDb = await import('../server/realm_stake_db');
    // Clean slate so the suite is deterministic on a reused database.
    await db.pool.query('DROP TABLE IF EXISTS realm_stakes, realm_roles, realms CASCADE');
    // The REAL boot path: applies SCHEMA + SOCIAL_SCHEMA + REALM_SCHEMA, then
    // seeds this process's env realm. If any DDL is invalid this throws here.
    await db.ensureSchema();
    const a = await db.createAccount(`owner_${Date.now()}`, 'hash');
    const b = await db.createAccount(`mod_${Date.now()}`, 'hash');
    ownerId = a.id;
    modId = b.id;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('ensureSchema seeded the env default realm as an active, ownerless, tier-0 row', async () => {
    const dir = await realmDb.listRealmsForDirectory(db.pool);
    const def = dir.filter((r) => r.name === realm.REALM);
    expect(def).toHaveLength(1);
    expect(def[0]).toMatchObject({ status: 'active', ownerAccountId: null, tier: 0 });

    const full = await realmDb.getLiveRealmByName(db.pool, realm.REALM);
    expect(full).not.toBeNull();
    expect(full!.worldSeed).toBe(realm.worldSeedForRealm(realm.REALM));
    expect(full!.worldSeed).toBe(realm.BASE_WORLD_SEED); // default realm keeps 20061
  });

  it('seedDefaultRealm is idempotent (no duplicate on re-run)', async () => {
    await realmDb.seedDefaultRealm(db.pool);
    await realmDb.seedDefaultRealm(db.pool);
    const dir = await realmDb.listRealmsForDirectory(db.pool);
    expect(dir.filter((r) => r.name === realm.REALM)).toHaveLength(1);
  });

  it('creates a provisioning realm with a name-derived world seed and reads it back', async () => {
    const created = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Ironforge',
      type: 'PvP',
      ownerAccountId: ownerId,
      tier: 1,
    });
    expect(created.status).toBe('provisioning');
    expect(created.worldSeed).toBe(realm.worldSeedForRealm('Ironforge'));
    expect(created.ownerAccountId).toBe(ownerId);

    // round-trips through Postgres with the BIGINT id/seed coerced to numbers
    const back = await realmDb.getRealmById(db.pool, created.realmId);
    expect(back).toEqual(created);
    expect(typeof back!.realmId).toBe('number');

    // a provisioning realm is not yet active → hidden from the directory's
    // active-only view but present in the full listing
    const dir = await realmDb.listRealmsForDirectory(db.pool);
    expect(dir.find((r) => r.name === 'Ironforge')?.status).toBe('provisioning');
  });

  it('rejects a duplicate realm name case-insensitively (partial unique index)', async () => {
    const { isUniqueViolation } = await import('../server/http_util');
    let caught: unknown;
    await realmDb
      .createProvisioningRealm(db.pool, { name: 'IRONFORGE', type: 'Normal', ownerAccountId: ownerId, tier: 1 })
      .catch((e) => {
        caught = e;
      });
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it('runs the lifecycle state machine with status-guarded transitions', async () => {
    const r = await realmDb.getLiveRealmByName(db.pool, 'Ironforge');
    const id = r!.realmId;

    // activate: provisioning → active, stamps provisioned_at
    const activated = await realmDb.activateRealm(db.pool, id);
    expect(activated?.status).toBe('active');
    expect(activated?.provisionedAt).toBeInstanceOf(Date);
    // re-activating an already-active realm matches no rows → null (no-op guard)
    expect(await realmDb.activateRealm(db.pool, id)).toBeNull();

    // decommission: active → decommissioning, stamps the release timelock
    const eligible = new Date('2026-07-01T00:00:00Z');
    const dec = await realmDb.requestDecommission(db.pool, id, eligible);
    expect(dec?.status).toBe('decommissioning');
    expect(dec?.releaseEligibleAt?.toISOString()).toBe(eligible.toISOString());
    // decommissioning a non-active realm is a no-op → null
    expect(await realmDb.requestDecommission(db.pool, id, eligible)).toBeNull();
  });

  it('releases a name for re-provisioning once a realm is closed', async () => {
    const r = await realmDb.getLiveRealmByName(db.pool, 'Ironforge');
    await realmDb.setRealmStatus(db.pool, r!.realmId, 'closed');

    // the closed realm drops out of the live lookup and the directory
    expect(await realmDb.getLiveRealmByName(db.pool, 'Ironforge')).toBeNull();
    expect((await realmDb.listRealmsForDirectory(db.pool)).find((x) => x.name === 'Ironforge')).toBeUndefined();

    // and the freed name can be provisioned anew (partial index excludes closed)
    const reborn = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Ironforge',
      type: 'RP',
      ownerAccountId: ownerId,
      tier: 2,
    });
    expect(reborn.status).toBe('provisioning');
    expect(reborn.realmId).not.toBe(r!.realmId);
  });

  it('manages delegated roles and unions the owner role off the realm row', async () => {
    const realmRow = await realmDb.getLiveRealmByName(db.pool, 'Ironforge');
    const id = realmRow!.realmId;

    // owner has no delegated rows yet but is authoritative via the realms row
    expect((await realmDb.rolesForAccountOnRealm(db.pool, id, ownerId)).sort()).toEqual(['owner']);
    // a stranger has nothing
    expect(await realmDb.rolesForAccountOnRealm(db.pool, id, modId)).toEqual([]);

    // grant moderator (idempotent: granting twice yields one row)
    await realmDb.addRealmRole(db.pool, id, modId, 'moderator', ownerId);
    await realmDb.addRealmRole(db.pool, id, modId, 'moderator', ownerId);
    const roles = await realmDb.listRealmRoles(db.pool, id);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ accountId: modId, role: 'moderator', grantedBy: ownerId });
    expect(await realmDb.rolesForAccountOnRealm(db.pool, id, modId)).toEqual(['moderator']);

    // an owner who is also granted builder sees both, de-duped by the UNION
    await realmDb.addRealmRole(db.pool, id, ownerId, 'builder', ownerId);
    expect((await realmDb.rolesForAccountOnRealm(db.pool, id, ownerId)).sort()).toEqual(['builder', 'owner']);

    // revoke
    await realmDb.removeRealmRole(db.pool, id, modId, 'moderator');
    expect(await realmDb.rolesForAccountOnRealm(db.pool, id, modId)).toEqual([]);
  });

  it('counts only live owned realms (per-account provisioning cap)', async () => {
    // ownerId currently owns the reborn Ironforge (provisioning) = 1 live realm
    expect(await realmDb.countOwnedRealms(db.pool, ownerId)).toBe(1);

    const extra = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Stormwind',
      type: 'Normal',
      ownerAccountId: ownerId,
      tier: 1,
    });
    expect(await realmDb.countOwnedRealms(db.pool, ownerId)).toBe(2);

    // closing one drops it from the count
    await realmDb.setRealmStatus(db.pool, extra.realmId, 'closed');
    expect(await realmDb.countOwnedRealms(db.pool, ownerId)).toBe(1);
  });

  it('cascades role rows when a realm is deleted', async () => {
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Aerie Peak',
      type: 'Normal',
      ownerAccountId: ownerId,
      tier: 1,
    });
    await realmDb.addRealmRole(db.pool, r.realmId, modId, 'builder', ownerId);
    await db.pool.query('DELETE FROM realms WHERE realm_id = $1', [r.realmId]);
    const orphans = await db.pool.query('SELECT 1 FROM realm_roles WHERE realm_id = $1', [r.realmId]);
    expect(orphans.rowCount).toBe(0);
  });

  it('records a stake with a replay guard, bigint amounts, and a lifecycle', async () => {
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Mal Ganis',
      type: 'PvP',
      ownerAccountId: ownerId,
      tier: 3,
    });
    // A whale-scale stake: 1e17 base units, well beyond Number.MAX_SAFE_INTEGER.
    const amount = 100_000_000_000_000_000n;
    expect(amount).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const stake = await stakeDb.insertStake(db.pool, {
      realmId: r.realmId,
      accountId: ownerId,
      ownerWallet: 'OWNERwa11et',
      pda: 'StakePDA',
      vault: 'VaultATA',
      mint: 'MockWocMint',
      amountBase: amount,
      tier: 3,
      lockTxSig: 'locksig_abc',
    });
    expect(typeof stake.amountBase).toBe('bigint');
    expect(stake.amountBase).toBe(amount); // full bigint round-trips, no precision loss
    expect(stake.status).toBe('locked');
    expect((await stakeDb.getActiveStakeByRealm(db.pool, r.realmId))?.amountBase).toBe(amount);

    // Replay guard: a second confirm reusing the finalized tx is rejected.
    const { isUniqueViolation } = await import('../server/http_util');
    let dup: unknown;
    await stakeDb
      .insertStake(db.pool, {
        realmId: r.realmId,
        accountId: ownerId,
        ownerWallet: 'OWNERwa11et',
        pda: 'StakePDA',
        vault: 'VaultATA',
        mint: 'MockWocMint',
        amountBase: amount,
        tier: 3,
        lockTxSig: 'locksig_abc',
      })
      .catch((e) => {
        dup = e;
      });
    expect(isUniqueViolation(dup)).toBe(true);

    // Lifecycle: locked -> releasing -> released.
    expect((await stakeDb.setStakeReleasing(db.pool, stake.stakeId))?.status).toBe('releasing');
    const released = await stakeDb.setStakeReleased(db.pool, stake.stakeId, 'releasesig_xyz');
    expect(released?.status).toBe('released');
    expect(released?.releaseTxSig).toBe('releasesig_xyz');
    expect(await stakeDb.getActiveStakeByRealm(db.pool, r.realmId)).toBeNull();
  });

  it('QUARANTINE: a stake never writes to woc_flow_ledger', async () => {
    const before = await db.pool.query('SELECT count(*)::int AS n FROM woc_flow_ledger');
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Quarantine Realm',
      type: 'Normal',
      ownerAccountId: ownerId,
      tier: 1,
    });
    await stakeDb.insertStake(db.pool, {
      realmId: r.realmId,
      accountId: ownerId,
      ownerWallet: 'W',
      pda: 'P',
      vault: 'V',
      mint: 'M',
      amountBase: 50_000_000n,
      tier: 1,
      lockTxSig: 'qsig_1',
    });
    const after = await db.pool.query('SELECT count(*)::int AS n FROM woc_flow_ledger');
    // The stake principal lives only in realm_stakes plus the escrow PDA; it adds
    // nothing to the emission-headroom ledger. This is the load-bearing invariant.
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
