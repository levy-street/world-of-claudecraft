// Unit test for the partitioned World Market backfill
// (server/market_backfill.ts). Postgres is a plain recording fake: every call
// records { text, params } and returns a scripted rows array, so every path is
// deterministic with no live database. The pure helpers are exercised directly.
import { describe, expect, it, vi } from 'vitest';
import {
  collectSellerKeys,
  computeMarketTotals,
  LEGACY_MARKET_KEY,
  MARKET_BACKFILL_MARKER_KEY,
  marketStateKey,
  mergeMarketSaves,
  partitionMarketSave,
  runMarketBackfill,
  verifyPartitionConservation,
} from '../../server/market_backfill';
import type { MarketSave } from '../../src/sim/sim';

type Listing = MarketSave['listings'][number];
type Collection = MarketSave['collections'][number];

function mkListing(over: Partial<Listing> = {}): Listing {
  return {
    id: 1,
    sellerKey: '1',
    sellerName: 'Seller',
    itemId: 'roasted_boar',
    count: 1,
    price: 100,
    secondsLeft: 3600,
    ...over,
  };
}

function mkCollection(over: Partial<Collection> = {}): Collection {
  return { key: '1', copper: 0, items: [], ...over };
}

// A recording fake client. Each query records { text, params } and returns
// scripted rows routed by SQL shape: the legacy FOR UPDATE read, the two
// characters lookups (by id / by name), the marker read, and per-realm
// world_state reads. Every INSERT (partition upsert + marker upsert) records
// and returns no rows.
interface ClientScript {
  marker?: unknown[];
  legacy?: unknown[];
  byId?: unknown[];
  byName?: unknown[];
  realmRows?: Record<string, unknown[]>;
}

function makeClient(script: ClientScript = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = vi.fn((text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    const p = params ?? [];
    calls.push({ text, params: p });
    if (text.includes('FOR UPDATE')) return Promise.resolve({ rows: script.legacy ?? [] });
    if (text.includes('FROM characters') && text.includes('id = ANY')) {
      return Promise.resolve({ rows: script.byId ?? [] });
    }
    if (text.includes('FROM characters') && text.includes('name = ANY')) {
      return Promise.resolve({ rows: script.byName ?? [] });
    }
    if (text.startsWith('SELECT') && text.includes('world_state')) {
      const key = p[0] as string;
      if (key === MARKET_BACKFILL_MARKER_KEY) return Promise.resolve({ rows: script.marker ?? [] });
      return Promise.resolve({ rows: script.realmRows?.[key] ?? [] });
    }
    return Promise.resolve({ rows: [] }); // INSERT ... world_state
  });
  return { query, calls };
}

describe('computeMarketTotals', () => {
  it('counts listings, collections, escrow copper, and escrow items', () => {
    const save: MarketSave = {
      listings: [mkListing({ id: 1, count: 3 }), mkListing({ id: 2, count: 5 })],
      collections: [
        mkCollection({ key: '1', copper: 100, items: [{ itemId: 'x', count: 2 }] }),
        mkCollection({
          key: '2',
          copper: 50,
          items: [
            { itemId: 'y', count: 4 },
            { itemId: 'z', count: 1 },
          ],
        }),
      ],
      nextListingId: 3,
    };
    expect(computeMarketTotals(save)).toEqual({
      listingCount: 2,
      collectionCount: 2,
      escrowCopper: 150,
      escrowItemCount: 3 + 5 + 2 + 4 + 1,
    });
  });

  it('skips null/empty collection slots when counting escrow items', () => {
    const save: MarketSave = {
      listings: [],
      collections: [
        mkCollection({
          key: 'a',
          copper: 10,
          items: [null as unknown as Collection['items'][number], { itemId: 'x', count: 2 }],
        }),
      ],
      nextListingId: 1,
    };
    expect(computeMarketTotals(save).escrowItemCount).toBe(2);
  });
});

describe('collectSellerKeys', () => {
  it('returns the distinct union of listing seller keys and collection keys, first-seen order', () => {
    const save: MarketSave = {
      listings: [
        mkListing({ sellerKey: '1' }),
        mkListing({ sellerKey: 'Alice' }),
        mkListing({ sellerKey: '1' }),
      ],
      collections: [
        mkCollection({ key: 'Alice' }),
        mkCollection({ key: '' }),
        mkCollection({ key: '2' }),
      ],
      nextListingId: 1,
    };
    expect(collectSellerKeys(save)).toEqual(['1', 'Alice', '', '2']);
  });
});

describe('partitionMarketSave', () => {
  it('routes resolved keys to their realm and every unresolved key to the fallback', () => {
    const save: MarketSave = {
      listings: [
        mkListing({ id: 1, sellerKey: '42' }), // numeric id -> Ironforge
        mkListing({ id: 2, sellerKey: 'Alice' }), // name -> Stormhaven
        mkListing({ id: 3, sellerKey: '999' }), // unknown id -> fallback
        mkListing({ id: 4, sellerKey: '' }), // house -> fallback
        mkListing({ id: 5, sellerKey: 'Bob' }), // absent name -> fallback
      ],
      collections: [
        mkCollection({ key: '42', copper: 10 }),
        mkCollection({ key: 'Zed', copper: 5 }), // unknown -> fallback
      ],
      nextListingId: 6,
    };
    const map = new Map<string, string>([
      ['42', 'Ironforge'],
      ['Alice', 'Stormhaven'],
    ]);
    const plan = partitionMarketSave(save, map, 'Home');

    expect(plan.byRealm.Ironforge.listings.map((l) => l.id)).toEqual([1]);
    expect(plan.byRealm.Ironforge.collections.map((c) => c.key)).toEqual(['42']);
    expect(plan.byRealm.Stormhaven.listings.map((l) => l.id)).toEqual([2]);
    expect(plan.byRealm.Home.listings.map((l) => l.id)).toEqual([3, 4, 5]);
    expect(plan.byRealm.Home.collections.map((c) => c.key)).toEqual(['Zed']);
    // deduplicated, first-seen order
    expect(plan.unresolvedSellerKeys).toEqual(['999', '', 'Bob', 'Zed']);
    // every partition inherits the global nextListingId unchanged
    for (const part of Object.values(plan.byRealm)) expect(part.nextListingId).toBe(6);
    expect(plan.globalTotals).toEqual(computeMarketTotals(save));
    expect(verifyPartitionConservation(save, plan.byRealm).ok).toBe(true);
  });
});

describe('mergeMarketSaves', () => {
  it('remaps incoming ids, sums per-key copper, concatenates items, and conserves totals', () => {
    const existing: MarketSave = {
      listings: [mkListing({ id: 1, count: 2 }), mkListing({ id: 2, count: 2 })],
      collections: [mkCollection({ key: 'A', copper: 100, items: [{ itemId: 'x', count: 2 }] })],
      nextListingId: 3,
    };
    const incoming: MarketSave = {
      listings: [mkListing({ id: 5, count: 1 }), mkListing({ id: 6, count: 1 })],
      collections: [
        mkCollection({ key: 'A', copper: 50, items: [{ itemId: 'y', count: 1 }] }),
        mkCollection({ key: 'B', copper: 10, items: [{ itemId: 'z', count: 3 }] }),
      ],
      nextListingId: 7,
    };
    const merged = mergeMarketSaves(existing, incoming);

    // existing ids kept; incoming remapped sequentially from existing.nextListingId
    expect(merged.listings.map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(merged.nextListingId).toBe(5); // 3 + 2 incoming listings
    const a = merged.collections.find((c) => c.key === 'A');
    expect(a?.copper).toBe(150);
    expect(a?.items).toEqual([
      { itemId: 'x', count: 2 },
      { itemId: 'y', count: 1 },
    ]);
    expect(merged.collections.map((c) => c.key)).toEqual(['A', 'B']);

    // additive totals conserve (existing + incoming)
    const e = computeMarketTotals(existing);
    const i = computeMarketTotals(incoming);
    const m = computeMarketTotals(merged);
    expect(m.listingCount).toBe(e.listingCount + i.listingCount);
    expect(m.escrowCopper).toBe(e.escrowCopper + i.escrowCopper);
    expect(m.escrowItemCount).toBe(e.escrowItemCount + i.escrowItemCount);

    // inputs untouched
    expect(existing.nextListingId).toBe(3);
    expect(existing.listings).toHaveLength(2);
    expect(existing.collections[0].copper).toBe(100);
    expect(incoming.collections[0].copper).toBe(50);
  });

  it('clamps the remap start above a corrupt existing max id to avoid collisions', () => {
    // A healthy blob keeps nextListingId > every listing id (the sim recomputes
    // it on serialize); a corrupt or hand-edited row can violate that, and a
    // remap starting at the stale nextListingId would collide with a live id.
    const existing: MarketSave = {
      listings: [mkListing({ id: 9, sellerKey: '1' })],
      collections: [],
      nextListingId: 5, // corrupt: not greater than the max existing id
    };
    const incoming: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '2' }), mkListing({ id: 2, sellerKey: '3' })],
      collections: [],
      nextListingId: 3,
    };
    const merged = mergeMarketSaves(existing, incoming);
    expect(merged.listings.map((l) => l.id)).toEqual([9, 10, 11]);
    expect(merged.nextListingId).toBe(12);
  });

  it('conserves copper and items when a malformed incoming blob repeats a collection key', () => {
    // A corrupt or hand-edited blob can carry the same collection key twice
    // (e.g. two '' house rows). Merge-by-key collapses them into one row, which
    // is a dedupe, not a loss: copper sums and items concatenate, so only the
    // collection ROW count shrinks while every escrowed value survives.
    const existing: MarketSave = {
      listings: [],
      collections: [mkCollection({ key: '', copper: 5, items: [{ itemId: 'x', count: 1 }] })],
      nextListingId: 1,
    };
    const incoming: MarketSave = {
      listings: [],
      collections: [
        mkCollection({ key: '', copper: 10, items: [{ itemId: 'y', count: 2 }] }),
        mkCollection({ key: '', copper: 20, items: [{ itemId: 'z', count: 3 }] }),
      ],
      nextListingId: 1,
    };
    const merged = mergeMarketSaves(existing, incoming);

    expect(merged.collections).toHaveLength(1);
    expect(merged.collections[0].copper).toBe(35);
    expect(merged.collections[0].items).toEqual([
      { itemId: 'x', count: 1 },
      { itemId: 'y', count: 2 },
      { itemId: 'z', count: 3 },
    ]);
    const e = computeMarketTotals(existing);
    const i = computeMarketTotals(incoming);
    const m = computeMarketTotals(merged);
    expect(m.escrowCopper).toBe(e.escrowCopper + i.escrowCopper);
    expect(m.escrowItemCount).toBe(e.escrowItemCount + i.escrowItemCount);
  });
});

describe('verifyPartitionConservation', () => {
  it('is green on a real partition', () => {
    const global: MarketSave = {
      listings: [mkListing({ id: 1, count: 4 }), mkListing({ id: 2, count: 1 })],
      collections: [mkCollection({ key: 'a', copper: 20, items: [{ itemId: 'x', count: 3 }] })],
      nextListingId: 3,
    };
    const plan = partitionMarketSave(global, new Map(), 'Home');
    expect(verifyPartitionConservation(global, plan.byRealm).ok).toBe(true);
  });

  it('is false when a partition drops a listing', () => {
    const global: MarketSave = {
      listings: [mkListing({ id: 1 }), mkListing({ id: 2 })],
      collections: [],
      nextListingId: 3,
    };
    const byRealm = {
      Home: { listings: [mkListing({ id: 1 })], collections: [], nextListingId: 3 },
    };
    const result = verifyPartitionConservation(global, byRealm);
    expect(result.ok).toBe(false);
    expect(result.actual.listingCount).toBe(1);
    expect(result.expected.listingCount).toBe(2);
  });

  it('is false when escrow copper shrinks while row counts stay intact', () => {
    const global: MarketSave = {
      listings: [mkListing({ id: 1 })],
      collections: [mkCollection({ key: 'a', copper: 30 })],
      nextListingId: 2,
    };
    const byRealm = {
      Home: {
        listings: [mkListing({ id: 1 })],
        collections: [mkCollection({ key: 'a', copper: 20 })],
        nextListingId: 2,
      },
    };
    const result = verifyPartitionConservation(global, byRealm);
    expect(result.ok).toBe(false);
    expect(result.expected.escrowCopper).toBe(30);
    expect(result.actual.escrowCopper).toBe(20);
  });

  it('is false when an escrowed item count shrinks while rows and copper stay intact', () => {
    const global: MarketSave = {
      listings: [mkListing({ id: 1, count: 1 })],
      collections: [mkCollection({ key: 'a', copper: 10, items: [{ itemId: 'x', count: 3 }] })],
      nextListingId: 2,
    };
    const byRealm = {
      Home: {
        listings: [mkListing({ id: 1, count: 1 })],
        collections: [mkCollection({ key: 'a', copper: 10, items: [{ itemId: 'x', count: 2 }] })],
        nextListingId: 2,
      },
    };
    const result = verifyPartitionConservation(global, byRealm);
    expect(result.ok).toBe(false);
    expect(result.expected.escrowItemCount).toBe(4);
    expect(result.actual.escrowItemCount).toBe(3);
  });
});

describe('runMarketBackfill', () => {
  it('is a no-op issuing exactly one query when the marker already exists', async () => {
    const client = makeClient({ marker: [{ data: { backfilledBy: 'X' } }] });
    const res = await runMarketBackfill({ client, realm: 'Home' });

    expect(res).toEqual({ ran: false, dryRun: false, legacyRowFound: false, plan: null });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.calls[0].params[0]).toBe('market_backfill_done');
  });

  it('claims the legacy row FOR UPDATE by the bare "market" key', async () => {
    const legacy: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '42' })],
      collections: [],
      nextListingId: 2,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 42, realm: 'Ironforge' }],
    });
    await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    const forUpdate = client.calls.find((c) => c.text.includes('FOR UPDATE'));
    expect(forUpdate).toBeDefined();
    expect(forUpdate?.text).toContain('SELECT data FROM world_state');
    expect(forUpdate?.params[0]).toBe(LEGACY_MARKET_KEY);
    expect(LEGACY_MARKET_KEY).toBe('market');
  });

  it('under dry run computes the plan, writes nothing, and logs the per-realm lines', async () => {
    const legacy: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '42', count: 2 })],
      collections: [mkCollection({ key: '42', copper: 30 })],
      nextListingId: 2,
    };
    const logs: string[] = [];
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 42, realm: 'Ironforge' }],
    });
    const res = await runMarketBackfill({
      client,
      realm: 'Home',
      dryRun: true,
      log: (l) => logs.push(l),
    });

    expect(res.ran).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.legacyRowFound).toBe(true);
    expect(res.plan).not.toBeNull();
    // NOT a single INSERT was issued
    for (const c of client.calls) expect(c.text.startsWith('INSERT')).toBe(false);
    // and the marker is not written
    expect(
      client.calls.some(
        (c) => c.params[0] === MARKET_BACKFILL_MARKER_KEY && c.text.startsWith('INSERT'),
      ),
    ).toBe(false);
    expect(logs.some((l) => l.includes('dry run'))).toBe(true);
    // no DELETE anywhere: the legacy row is retained
    for (const c of client.calls) expect(c.text).not.toContain('DELETE');
  });

  it('logs nothing-to-partition and writes nothing on a dry run with no legacy row', async () => {
    const logs: string[] = [];
    const client = makeClient({ marker: [], legacy: [] });
    const res = await runMarketBackfill({
      client,
      realm: 'Home',
      dryRun: true,
      log: (l) => logs.push(l),
    });

    expect(res).toEqual({ ran: true, dryRun: true, legacyRowFound: false, plan: null });
    for (const c of client.calls) expect(c.text.startsWith('INSERT')).toBe(false);
    expect(logs.some((l) => l.includes('no legacy'))).toBe(true);
  });

  it('partitions the legacy row into sorted realm keys and records the marker', async () => {
    const legacy: MarketSave = {
      listings: [
        mkListing({ id: 1, sellerKey: '42', count: 2 }),
        mkListing({ id: 2, sellerKey: 'Alice', count: 1 }),
        mkListing({ id: 3, sellerKey: '', count: 5 }), // house -> fallback (Home)
      ],
      collections: [mkCollection({ key: '42', copper: 30, items: [{ itemId: 'x', count: 4 }] })],
      nextListingId: 4,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 42, realm: 'Ironforge' }],
      byName: [{ name: 'Alice', realm: 'Stormhaven' }],
    });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    expect(res).toMatchObject({ ran: true, dryRun: false, legacyRowFound: true });
    // partition upserts issued in sorted realm-key order
    const partitionUpserts = client.calls.filter(
      (c) => c.text.startsWith('INSERT') && String(c.params[0]).startsWith('market:'),
    );
    expect(partitionUpserts.map((c) => c.params[0])).toEqual([
      marketStateKey('Home'),
      marketStateKey('Ironforge'),
      marketStateKey('Stormhaven'),
    ]);
    // the Ironforge partition carries listing 1 and the inherited nextListingId
    const ironforge = JSON.parse(
      String(partitionUpserts.find((c) => c.params[0] === marketStateKey('Ironforge'))?.params[1]),
    ) as MarketSave;
    expect(ironforge.listings.map((l) => l.id)).toEqual([1]);
    expect(ironforge.nextListingId).toBe(4);
    // marker records the outcome; '' is the one unresolved key
    const marker = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === MARKET_BACKFILL_MARKER_KEY,
    );
    expect(marker).toBeDefined();
    const markerData = JSON.parse(String(marker?.params[1]));
    expect(markerData.backfilledBy).toBe('Home');
    expect(markerData.legacyRowFound).toBe(true);
    expect(markerData.unresolvedCount).toBe(1);
    // legacy retention: no DELETE, and the legacy row is never re-written
    for (const c of client.calls) {
      expect(c.text).not.toContain('DELETE');
      if (c.text.startsWith('INSERT')) expect(c.params[0]).not.toBe(LEGACY_MARKET_KEY);
    }
  });

  it('resolves a name-form seller and leaves a multi-realm name unresolved', async () => {
    const legacy: MarketSave = {
      listings: [
        mkListing({ id: 1, sellerKey: 'Bob', count: 1 }),
        mkListing({ id: 2, sellerKey: 'Carol', count: 1 }),
      ],
      collections: [],
      nextListingId: 3,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byName: [
        { name: 'Bob', realm: 'Ironforge' },
        { name: 'Bob', realm: 'Stormhaven' }, // ambiguous: two realms
        { name: 'Carol', realm: 'Stormhaven' }, // unique
      ],
    });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    expect(res.plan?.byRealm.Home.listings.map((l) => l.id)).toEqual([1]); // Bob -> fallback
    expect(res.plan?.byRealm.Stormhaven.listings.map((l) => l.id)).toEqual([2]); // Carol resolved
    expect(res.plan?.unresolvedSellerKeys).toEqual(['Bob']);
  });

  it('coerces a BIGINT-as-string character id and passes numeric id params', async () => {
    const legacy: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '7', count: 1 })],
      collections: [],
      nextListingId: 2,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: '7', realm: 'Ironforge' }], // pg returns BIGINT as a string
    });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    expect(res.plan?.byRealm.Ironforge.listings.map((l) => l.id)).toEqual([1]);
    expect(res.plan?.unresolvedSellerKeys).toEqual([]);
    const idQuery = client.calls.find((c) => c.text.includes('id = ANY'));
    expect(idQuery?.params[0]).toEqual([7]); // Number-coerced param
  });

  it('routes an out-of-int4-range numeric seller key to the fallback instead of querying it', async () => {
    const legacy: MarketSave = {
      listings: [
        mkListing({ id: 1, sellerKey: '7', count: 1 }),
        mkListing({ id: 2, sellerKey: '3000000000', count: 1 }), // above int4 max
      ],
      collections: [],
      nextListingId: 3,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 7, realm: 'Ironforge' }],
    });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    const idQuery = client.calls.find((c) => c.text.includes('id = ANY'));
    expect(idQuery?.params[0]).toEqual([7]); // the corrupt key never reaches the ::int[] cast
    expect(res.plan?.byRealm.Home.listings.map((l) => l.id)).toEqual([2]);
    expect(res.plan?.unresolvedSellerKeys).toEqual(['3000000000']);
  });

  it('merges the partition into a pre-existing realm row instead of overwriting it', async () => {
    const legacy: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '42', count: 2 })],
      collections: [mkCollection({ key: '42', copper: 30, items: [{ itemId: 'x', count: 1 }] })],
      nextListingId: 2,
    };
    const existingRow: MarketSave = {
      listings: [mkListing({ id: 10, sellerKey: '42', count: 3 })],
      collections: [mkCollection({ key: '42', copper: 5, items: [] })],
      nextListingId: 11,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 42, realm: 'Ironforge' }],
      realmRows: { [marketStateKey('Ironforge')]: [{ data: existingRow }] },
    });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    expect(res.legacyRowFound).toBe(true);
    const upsert = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === marketStateKey('Ironforge'),
    );
    expect(upsert).toBeDefined();
    const written = JSON.parse(String(upsert?.params[1])) as MarketSave;
    // partition inherits legacy.nextListingId; merge ignores it and remaps from
    // existing.nextListingId
    const expected = mergeMarketSaves(existingRow, {
      listings: legacy.listings,
      collections: legacy.collections,
      nextListingId: legacy.nextListingId,
    });
    expect(written).toEqual(expected);
    expect(written.listings.map((l) => l.id)).toEqual([10, 11]);
    expect(written.nextListingId).toBe(12);
    expect(written.collections.find((c) => c.key === '42')?.copper).toBe(35);
  });

  it('records the marker with legacyRowFound false on a fresh database', async () => {
    const client = makeClient({ marker: [], legacy: [] });
    const res = await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    expect(res).toEqual({ ran: true, dryRun: false, legacyRowFound: false, plan: null });
    const marker = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === MARKET_BACKFILL_MARKER_KEY,
    );
    expect(marker).toBeDefined();
    expect(JSON.parse(String(marker?.params[1])).legacyRowFound).toBe(false);
    // no realm partition write, no DELETE
    expect(
      client.calls.some(
        (c) => c.text.startsWith('INSERT') && String(c.params[0]).startsWith('market:'),
      ),
    ).toBe(false);
    for (const c of client.calls) expect(c.text).not.toContain('DELETE');
  });

  it('throws the conservation error and writes nothing when the blob does not conserve', async () => {
    // Synthetic hostile blob: `listings` is a getter returning one fewer
    // listing on each read, so the partition (an early read) holds more
    // listings than the verification's expected totals (a later read). A plain
    // JSON blob can never trip this (partitioning moves whole objects, so it
    // conserves by construction); the getter forces the defensive runner throw.
    // If a refactor changes how often the runner reads legacy.listings,
    // re-craft the getter rather than deleting the test.
    const base = [
      mkListing({ id: 1, sellerKey: '7', count: 1 }),
      mkListing({ id: 2, sellerKey: '8', count: 1 }),
      mkListing({ id: 3, sellerKey: '9', count: 1 }),
      mkListing({ id: 4, sellerKey: '10', count: 1 }),
      mkListing({ id: 5, sellerKey: '11', count: 1 }),
    ];
    let reads = 0;
    const hostile = {
      get listings() {
        reads++;
        return base.slice(0, Math.max(0, base.length - (reads - 1)));
      },
      collections: [],
      nextListingId: 6,
    } as unknown as MarketSave;
    const client = makeClient({ legacy: [{ data: hostile }] });

    await expect(runMarketBackfill({ client, realm: 'Home', log: () => {} })).rejects.toThrow(
      /market backfill conservation/,
    );
    expect(client.calls.some((c) => c.text.startsWith('INSERT'))).toBe(false);
  });

  it('pins the load-bearing SQL fragments to literal text', async () => {
    const legacy: MarketSave = {
      listings: [mkListing({ id: 1, sellerKey: '42' })],
      collections: [],
      nextListingId: 2,
    };
    const client = makeClient({
      legacy: [{ data: legacy }],
      byId: [{ id: 42, realm: 'Ironforge' }],
    });
    await runMarketBackfill({ client, realm: 'Home', log: () => {} });

    const forUpdate = client.calls.find((c) => c.text.includes('FOR UPDATE'));
    expect(forUpdate?.text).toContain('FOR UPDATE');
    const upsert = client.calls.find((c) => c.text.startsWith('INSERT'));
    expect(upsert?.text).toContain('INSERT INTO world_state');
    expect(upsert?.text).toContain('ON CONFLICT (key) DO UPDATE');
    const markerWrite = client.calls.find(
      (c) => c.text.startsWith('INSERT') && c.params[0] === 'market_backfill_done',
    );
    expect(markerWrite).toBeDefined();
  });
});
