import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BASE_WORLD_SEED,
  DEFAULT_REALM_NAME,
  mergeRealmDirectory,
  worldSeedForRealm,
  type DbRealmSummary,
  type RealmEntry,
} from '../server/realm';
import {
  getRealmById,
  listRealmsForDirectory,
  rolesForAccountOnRealm,
} from '../server/realm_db';

// A minimal fake of the `Queryable` the realm_db functions accept: it returns a
// canned result for each call and records the SQL + params so we can assert the
// query shape and the row→domain coercion without a live Postgres.
function fakeDb(results: Array<{ rows: Array<Record<string, unknown>> }>): {
  db: Pool;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const query = (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve(results[i++] ?? { rows: [] });
  };
  return { db: { query } as unknown as Pool, calls };
}

describe('worldSeedForRealm', () => {
  it('keeps the canonical world seed for the default realm', () => {
    expect(worldSeedForRealm(DEFAULT_REALM_NAME)).toBe(BASE_WORLD_SEED);
    // an unset / nonsense realm name resolves to the default realm, so it also
    // keeps the canonical seed rather than deriving a stray world
    expect(worldSeedForRealm('')).toBe(BASE_WORLD_SEED);
    expect(worldSeedForRealm('!!! not a realm !!!')).toBe(BASE_WORLD_SEED);
  });

  it('derives a stable, distinct, in-range seed for other realms', () => {
    const a = worldSeedForRealm('Ironforge');
    const b = worldSeedForRealm('Stormwind');
    expect(a).toBe(worldSeedForRealm('Ironforge')); // deterministic
    expect(a).not.toBe(b); // distinct names → distinct worlds
    expect(a).not.toBe(BASE_WORLD_SEED);
    for (const s of [a, b]) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(0x7fff_ffff);
    }
  });

  it('is case-insensitive (realm names are unique case-insensitively)', () => {
    expect(worldSeedForRealm('Ironforge')).toBe(worldSeedForRealm('ironforge'));
  });
});

describe('mergeRealmDirectory', () => {
  const env: RealmEntry[] = [
    { name: 'Claudemoon', url: '', type: 'Normal' },
    { name: 'Ironforge', url: 'https://ironforge.example.com', type: 'PvP' },
  ];

  function dbRealm(p: Partial<DbRealmSummary> & { name: string }): DbRealmSummary {
    return {
      realmId: 1,
      type: 'Normal',
      originUrl: '',
      status: 'active',
      ownerAccountId: null,
      tier: 0,
      ...p,
    };
  }

  it('returns env entries enriched with a null identity when there is no registry row', () => {
    const out = mergeRealmDirectory(env, []);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: 'Claudemoon', realmId: null, status: 'active', owned: false, tier: 0 });
  });

  it('enriches an env entry from its matching registry row but keeps the pinned env url', () => {
    const out = mergeRealmDirectory(env, [
      dbRealm({ name: 'ironforge', realmId: 7, originUrl: '', ownerAccountId: 42, tier: 2, type: 'PvP' }),
    ]);
    const iron = out.find((r) => r.name === 'Ironforge')!;
    expect(iron.url).toBe('https://ironforge.example.com'); // env url wins
    expect(iron).toMatchObject({ realmId: 7, owned: true, tier: 2 });
  });

  it('appends an active player-provisioned realm not pinned in env, using its origin url', () => {
    const out = mergeRealmDirectory(env, [
      dbRealm({ name: 'Aerie Peak', realmId: 9, originUrl: 'https://aerie.example.com', ownerAccountId: 5, tier: 1 }),
    ]);
    expect(out).toHaveLength(3);
    const aerie = out[2];
    expect(aerie).toMatchObject({ name: 'Aerie Peak', url: 'https://aerie.example.com', realmId: 9, owned: true });
  });

  it('hides registry realms that are not active (provisioning / decommissioning / etc.)', () => {
    const out = mergeRealmDirectory(env, [
      dbRealm({ name: 'Half-Built', realmId: 11, status: 'provisioning', ownerAccountId: 5 }),
      dbRealm({ name: 'Leaving', realmId: 12, status: 'decommissioning', ownerAccountId: 6 }),
    ]);
    expect(out.map((r) => r.name)).toEqual(['Claudemoon', 'Ironforge']);
  });

  it('de-dupes case-insensitively, env first', () => {
    const out = mergeRealmDirectory(env, [dbRealm({ name: 'CLAUDEMOON', realmId: 3, ownerAccountId: 1 })]);
    expect(out).toHaveLength(2);
    // the env entry absorbs the registry id rather than producing a duplicate
    expect(out[0]).toMatchObject({ name: 'Claudemoon', realmId: 3, owned: true });
  });
});

describe('realm_db row mapping', () => {
  it('coerces BIGINT id/seed strings to numbers and null owner to null', async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            realm_id: '42',
            name: 'Ironforge',
            type: 'PvP',
            owner_account_id: null,
            tier: 0,
            status: 'active',
            world_seed: '1234567',
            origin_url: '',
            provisioned_at: null,
            decommission_requested_at: null,
            release_eligible_at: null,
            created_at: new Date('2026-06-21T00:00:00Z'),
          },
        ],
      },
    ]);
    const realm = await getRealmById(db, 42);
    expect(realm).not.toBeNull();
    expect(realm!.realmId).toBe(42);
    expect(typeof realm!.realmId).toBe('number');
    expect(realm!.worldSeed).toBe(1234567);
    expect(realm!.ownerAccountId).toBeNull();
    expect(realm!.type).toBe('PvP');
  });

  it('maps an unknown status defensively to active', async () => {
    const { db } = fakeDb([
      { rows: [{ realm_id: 5, name: 'X', type: 'bogus', origin_url: '', status: 'weird', owner_account_id: 2, tier: 1 }] },
    ]);
    const [row] = await listRealmsForDirectory(db);
    expect(row.status).toBe('active'); // defensive fallback
    expect(row.type).toBe('Normal'); // resolveRealmType normalizes a bad type
    expect(row.ownerAccountId).toBe(2);
  });

  it('unions the owner role off the realms row with delegated roles', async () => {
    const { db, calls } = fakeDb([{ rows: [{ role: 'owner' }, { role: 'builder' }] }]);
    const roles = await rolesForAccountOnRealm(db, 7, 99);
    expect(roles.sort()).toEqual(['builder', 'owner']);
    expect(calls[0].params).toEqual([7, 99]);
  });
});
