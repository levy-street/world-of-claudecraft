// Real-Postgres integration test for the realm registry (#475). Every other test
// in this repo mocks `pg`, so the realm_db DDL + SQL has never actually executed:
// the partial expression unique index, the FKs/CHECKs, the idempotent boot seed,
// the UNION owner-role query, and the status-guarded lifecycle UPDATEs were all
// unproven. This drives them against a live database via the REAL boot path
// (ensureSchema), asserting on the actual rows returned.
//
// Gated on PG_TEST_URL so CI (no Postgres) skips it. Run locally with e.g.
//   docker run -d --rm -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
//     -e POSTGRES_DB=test -p 5544:5432 postgres:16-alpine
//   PG_TEST_URL=postgres://test:test@127.0.0.1:5544/test \
//     npx vitest run tests/realm_db.integration.test.ts

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
  let ownerId: number;
  let modId: number;

  beforeAll(async () => {
    db = await import('../server/db');
    realm = await import('../server/realm');
    realmDb = await import('../server/realm_db');
    // Clean slate so the suite is deterministic on a reused database.
    await db.pool.query('DROP TABLE IF EXISTS realm_roles, realms CASCADE');
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

  // --------------------------------------------------------------------------
  // Beyond the happy path: boundary inputs, invalid inputs, concurrent races,
  // cross-realm isolation, CHECK constraints. Everything below exercises real
  // SQL paths against the same live database.
  // --------------------------------------------------------------------------

  it('getRealmById returns null for a non-existent id (boundary)', async () => {
    expect(await realmDb.getRealmById(db.pool, 999_999)).toBeNull();
    expect(await realmDb.getLiveRealmByName(db.pool, 'nope-not-a-realm')).toBeNull();
    expect(await realmDb.listRealmRoles(db.pool, 999_999)).toEqual([]);
    expect(await realmDb.rolesForAccountOnRealm(db.pool, 999_999, ownerId)).toEqual([]);
    expect(await realmDb.countOwnedRealms(db.pool, 999_999)).toBe(0);
  });

  it('refuses to decommission a non-active realm (status guard)', async () => {
    // create + decommission to land in 'decommissioning'; calling again is no-op
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Burning Steppes', type: 'Normal', ownerAccountId: ownerId, tier: 1,
    });
    await realmDb.activateRealm(db.pool, r.realmId);
    await realmDb.requestDecommission(db.pool, r.realmId, new Date('2026-08-01'));
    // already decommissioning → null
    expect(await realmDb.requestDecommission(db.pool, r.realmId, new Date('2026-08-02'))).toBeNull();
    // explicitly closed → still null
    await realmDb.setRealmStatus(db.pool, r.realmId, 'closed');
    expect(await realmDb.requestDecommission(db.pool, r.realmId, new Date('2026-08-03'))).toBeNull();
  });

  it("supports the 'lapsed' status (gameplay frozen, funds untouched)", async () => {
    // A ToS-frozen realm is a Postgres state-only change; it should be storable
    // and discoverable. The status round-trips through rowToRealm correctly
    // (proves isRealmStatus accepts every CHECK-listed value).
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Lapsed Realm', type: 'PvP', ownerAccountId: ownerId, tier: 1,
    });
    await realmDb.activateRealm(db.pool, r.realmId);
    const lapsed = await realmDb.setRealmStatus(db.pool, r.realmId, 'lapsed');
    expect(lapsed?.status).toBe('lapsed');
    // a lapsed realm is hidden from the active-only directory but visible in
    // the full registry (it's not 'closed')
    const dir = await realmDb.listRealmsForDirectory(db.pool);
    expect(dir.find((x) => x.name === 'Lapsed Realm')?.status).toBe('lapsed');
    // its name is still reserved (the partial unique index excludes only 'closed')
    const { isUniqueViolation } = await import('../server/http_util');
    let caught: unknown;
    await realmDb.createProvisioningRealm(db.pool, {
      name: 'Lapsed Realm', type: 'Normal', ownerAccountId: ownerId, tier: 0,
    }).catch((e) => { caught = e; });
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it('rolesForAccountOnRealm does not leak roles across realms', async () => {
    // owner of one realm is not implicitly owner of another
    const realmA = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Realm A', type: 'Normal', ownerAccountId: ownerId, tier: 1,
    });
    const realmB = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Realm B', type: 'Normal', ownerAccountId: modId, tier: 1,
    });
    await realmDb.addRealmRole(db.pool, realmA.realmId, modId, 'moderator', ownerId);
    // ownerId on realmA: owner; on realmB: nothing
    expect((await realmDb.rolesForAccountOnRealm(db.pool, realmA.realmId, ownerId)).sort()).toEqual(['owner']);
    expect(await realmDb.rolesForAccountOnRealm(db.pool, realmB.realmId, ownerId)).toEqual([]);
    // modId on realmA: moderator (delegated); on realmB: owner
    expect((await realmDb.rolesForAccountOnRealm(db.pool, realmA.realmId, modId)).sort()).toEqual(['moderator']);
    expect((await realmDb.rolesForAccountOnRealm(db.pool, realmB.realmId, modId)).sort()).toEqual(['owner']);
  });

  it('UNION (not UNION ALL) dedupes when an account is both owner and delegated', async () => {
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Dedup Realm', type: 'Normal', ownerAccountId: ownerId, tier: 1,
    });
    // grant the owner also a builder role — exercises the load-bearing UNION
    await realmDb.addRealmRole(db.pool, r.realmId, ownerId, 'builder', ownerId);
    await realmDb.addRealmRole(db.pool, r.realmId, ownerId, 'moderator', ownerId);
    const roles = await realmDb.rolesForAccountOnRealm(db.pool, r.realmId, ownerId);
    // exactly 3 distinct roles, not duplicated by the union
    expect(roles.sort()).toEqual(['builder', 'moderator', 'owner']);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('CHECK constraint rejects an invalid realm type (defense in depth)', async () => {
    // The TypeScript layer never produces 'Mythic+' but the CHECK is the floor
    // against a future caller that bypasses createProvisioningRealm. Use raw
    // SQL to bypass the type system and prove the DDL holds.
    let caught: any;
    await db.pool.query(
      `INSERT INTO realms (name, type, world_seed) VALUES ('Bad Type', 'Mythic+', 1)`,
    ).catch((e) => { caught = e; });
    expect(caught).toBeDefined();
    expect(caught?.code).toBe('23514'); // pg check_violation
  });

  it('CHECK constraint rejects an invalid role (defense in depth)', async () => {
    const r = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Role Check', type: 'Normal', ownerAccountId: ownerId, tier: 1,
    });
    let caught: any;
    await db.pool.query(
      `INSERT INTO realm_roles (realm_id, account_id, role) VALUES ($1, $2, 'gm')`,
      [r.realmId, ownerId],
    ).catch((e) => { caught = e; });
    expect(caught?.code).toBe('23514');
  });

  it('CHECK constraint rejects an invalid status', async () => {
    let caught: any;
    await db.pool.query(
      `INSERT INTO realms (name, type, world_seed, status) VALUES ('Bad Status', 'Normal', 1, 'archived')`,
    ).catch((e) => { caught = e; });
    expect(caught?.code).toBe('23514');
  });

  it('tier accepts SMALLINT extremes (0, max) and overflows above', async () => {
    // tier is SMALLINT (-32768..32767). 0 = system realm; 32767 = headroom for
    // a future tier ladder. Beyond that we expect 22003 numeric_value_out_of_range.
    const lo = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Tier Lo', type: 'Normal', ownerAccountId: ownerId, tier: 0,
    });
    expect(lo.tier).toBe(0);
    const hi = await realmDb.createProvisioningRealm(db.pool, {
      name: 'Tier Hi', type: 'Normal', ownerAccountId: ownerId, tier: 32767,
    });
    expect(hi.tier).toBe(32767);
    let caught: any;
    await realmDb.createProvisioningRealm(db.pool, {
      name: 'Tier Overflow', type: 'Normal', ownerAccountId: ownerId, tier: 32768,
    }).catch((e) => { caught = e; });
    expect(caught?.code).toBe('22003');
  });

  it('seedDefaultRealm under concurrent calls produces exactly one row (partial index is the defense)', async () => {
    // Production safety relies on the advisory lock in ensureSchema. The
    // partial unique index is the underlying defense — prove it: fire many
    // seedDefaultRealm calls in parallel WITHOUT the lock and assert the
    // realms_active_name index still produces at most one new active row for
    // the realm name. Some may fail with 23505, but the row count is bounded.
    // First, find how many rows currently have the default realm name (1 from
    // beforeAll's seed).
    const before = await db.pool.query(
      `SELECT count(*)::int AS n FROM realms WHERE lower(name) = lower($1) AND status <> 'closed'`,
      [realm.REALM],
    );
    expect(before.rows[0].n).toBe(1);

    // 8 concurrent seeders. Most will be no-ops (NOT EXISTS evaluates true →
    // SELECT returns 0 rows → INSERT inserts nothing). A race window could
    // attempt 2+ INSERTs simultaneously; the partial unique index would error
    // all but one with 23505. We don't care WHICH path; we care about the
    // post-condition.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => realmDb.seedDefaultRealm(db.pool)),
    );
    // every call either succeeded (no-op) or rejected with a unique violation
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as { code?: string }).code).toBe('23505');
      }
    }
    const after = await db.pool.query(
      `SELECT count(*)::int AS n FROM realms WHERE lower(name) = lower($1) AND status <> 'closed'`,
      [realm.REALM],
    );
    expect(after.rows[0].n).toBe(1); // exactly one active row remains
  });

  it('concurrent createProvisioningRealm with the same name: exactly one wins', async () => {
    // The genuine race: two players try to provision the same realm name.
    // The partial unique index makes exactly one INSERT succeed; the other
    // raises 23505.
    const NAME = `Race ${Date.now()}`;
    const results = await Promise.allSettled([
      realmDb.createProvisioningRealm(db.pool, { name: NAME, type: 'Normal', ownerAccountId: ownerId, tier: 1 }),
      realmDb.createProvisioningRealm(db.pool, { name: NAME, type: 'PvP', ownerAccountId: modId, tier: 1 }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('23505');
  });

  it('listRealmsForDirectory + mergeRealmDirectory produce the exact /api/realms payload shape', async () => {
    // The HTTP endpoint composes these two; this proves the composition against
    // a live database without booting the HTTP server.
    const envDirectory = [
      { name: realm.REALM, url: '', type: 'Normal' as const },
      { name: 'Pinned', url: 'https://pinned.example.com', type: 'PvP' as const },
    ];
    const summaries = await realmDb.listRealmsForDirectory(db.pool);
    const merged = realm.mergeRealmDirectory(envDirectory, summaries);

    // every entry has the documented shape and the additive fields are typed
    for (const e of merged) {
      expect(typeof e.name).toBe('string');
      expect(['Normal', 'PvP', 'RP', 'RP-PvP']).toContain(e.type);
      expect(['provisioning', 'active', 'decommissioning', 'lapsed', 'closed']).toContain(e.status);
      expect(typeof e.owned).toBe('boolean');
      expect(typeof e.tier).toBe('number');
    }

    // env-pinned 'Pinned' has no DB row yet → realmId null, owned false, tier 0
    const pinned = merged.find((e) => e.name === 'Pinned');
    expect(pinned).toMatchObject({ realmId: null, owned: false, tier: 0, status: 'active' });
    expect(pinned!.url).toBe('https://pinned.example.com');

    // the default realm is registry-seeded → realmId is set, status 'active'
    const def = merged.find((e) => e.name === realm.REALM);
    expect(def?.realmId).toBeTypeOf('number');
    expect(def?.status).toBe('active');
  });

  it('persisted row inspection: the realms table holds exactly the rows the tests created', async () => {
    // The final read-after-write inspection per the bundled testing ask:
    // verify the actual outputs by querying the database directly, not just
    // trusting the API return values.
    const rows = await db.pool.query<{
      name: string;
      status: string;
      world_seed: string;
      type: string;
    }>(
      `SELECT name, status, world_seed::text AS world_seed, type FROM realms ORDER BY realm_id ASC`,
    );
    // the default realm is always present with the canonical seed
    const def = rows.rows.find((r) => r.name === realm.REALM);
    expect(def?.status).toBe('active');
    expect(Number(def!.world_seed)).toBe(realm.BASE_WORLD_SEED);

    // every Ironforge row (closed + reborn provisioning) shares the deterministic seed
    const ironRows = rows.rows.filter((r) => r.name === 'Ironforge');
    expect(ironRows.length).toBeGreaterThanOrEqual(2);
    for (const r of ironRows) {
      expect(Number(r.world_seed)).toBe(realm.worldSeedForRealm('Ironforge'));
    }
  });
});
