import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MarketSave } from '../../src/sim/sim';

// Two-realm World Market isolation regression.
//
// WHAT THIS PINS: every realm process shares one DATABASE_URL. Before realm
// scoping the market persisted to the single bare world_state row 'market', so
// two realms read and wrote the SAME row and the last 30s autosave silently
// overwrote the other realm's listings and escrowed gold. Under the old
// behavior this test would fail: with a bare shared key, RealmB's save would
// clobber store['market'] and RealmA's reload would return RealmB's blob (or
// vice versa). With per-realm scoping each realm gets its own
// 'market:<realm>' key, so the two never collide.
//
// We drive the real server/db module against ONE shared fake world_state store,
// re-importing it once per simulated realm process (vi.resetModules + a distinct
// REALM_NAME) so each import derives its own REALM exactly as a separate process
// would. See tests/market_db.test.ts for the base pg-mock pattern this copies.
//
// NOTE: this depends on Agent A's rewritten server/db.ts (the boot write gate
// plus the no-lazy-migration read path). If server/db.ts still ships the old
// lazy-migration loadMarketState or lacks openMarketWriteGate, this fails at
// runtime; that is the documented pending-A signal, not a test bug.

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  // One store shared by BOTH simulated realm processes: they point at the same
  // DATABASE_URL, so there is exactly one world_state table between them.
  const store = new Map<string, unknown>();
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/insert\s+into\s+world_state/i.test(text)) {
      const raw = params[1];
      store.set(String(params[0]), typeof raw === 'string' ? JSON.parse(raw) : raw);
      return { rowCount: 1, rows: [] };
    }
    if (/from\s+world_state/i.test(text)) {
      const key = String(params[0]);
      return store.has(key) ? { rows: [{ data: store.get(key) }] } : { rows: [] };
    }
    // BEGIN/COMMIT and anything else this test does not model resolve empty.
    return { rows: [], rowCount: 0 };
  });
  // Same store-backed handler on a transactional client, so a read that ever
  // runs through pool.connect() still sees the shared rows.
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return { store, query, connect };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

// The subset of server/db this test drives. Imported through `as unknown as`
// so the file type-checks against the current db.ts even before Agent A adds
// openMarketWriteGate; a missing export then surfaces as a runtime throw
// (pending-A), never a masked type error once A lands.
interface MarketDb {
  marketStateKey(realm: string): string;
  loadMarketState(): Promise<MarketSave | null>;
  saveMarketState(save: MarketSave): Promise<void>;
  openMarketWriteGate(): void;
  closeMarketWriteGateForTests?(): void;
}

async function bootRealm(realm: string): Promise<MarketDb> {
  vi.resetModules();
  process.env.REALM_NAME = realm;
  return (await import('../../server/db')) as unknown as MarketDb;
}

const originalRealmName = process.env.REALM_NAME;
afterAll(() => {
  if (originalRealmName === undefined) delete process.env.REALM_NAME;
  else process.env.REALM_NAME = originalRealmName;
});

function saveFor(
  sellerKey: string,
  sellerName: string,
  itemId: string,
  copper: number,
): MarketSave {
  return {
    listings: [
      {
        id: 1,
        sellerKey,
        sellerName,
        itemId,
        count: 1,
        price: 1900,
        secondsLeft: 3600,
      },
    ],
    collections: [{ key: sellerKey, copper, items: [] }],
    nextListingId: 2,
  };
}

describe('two-realm World Market isolation', () => {
  it('keeps each realm on its own key and never writes the bare shared "market" row', async () => {
    const saveA = saveFor('101', 'Aldwin', 'oiled_boots', 250);
    const saveB = saveFor('202', 'Brenna', 'silk_sash', 999);

    // RealmA process: open the boot write gate, then autosave its own market.
    const dbA = await bootRealm('RealmA');
    expect(dbA.marketStateKey('RealmA')).toBe('market:RealmA');
    dbA.openMarketWriteGate();
    await dbA.saveMarketState(saveA);

    // RealmB process against the SAME store: it must not disturb RealmA's row.
    const dbB = await bootRealm('RealmB');
    dbB.openMarketWriteGate();
    await dbB.saveMarketState(saveB);

    // Each realm reloads ITS OWN listings, not the other realm's.
    const dbA2 = await bootRealm('RealmA');
    const loadedA = await dbA2.loadMarketState();
    expect(loadedA).toEqual(saveA);
    expect(loadedA).not.toEqual(saveB);

    const dbB2 = await bootRealm('RealmB');
    const loadedB = await dbB2.loadMarketState();
    expect(loadedB).toEqual(saveB);
    expect(loadedB).not.toEqual(saveA);

    // The store holds exactly the two realm-scoped keys, and the pre-scoping
    // bare 'market' row was never written by either realm.
    expect([...dbMock.store.keys()].sort()).toEqual(['market:RealmA', 'market:RealmB']);
    expect(dbMock.store.has('market')).toBe(false);
  });
});
