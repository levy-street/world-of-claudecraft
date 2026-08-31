import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buyWithSoldVolume,
  marketSaleFromBuy,
  resetMarketSoldVolumeForTests,
  soldVolumeWriterIdle,
} from '../../server/market_sold_volume';
import {
  MARKET_SOLD_VOLUME_RETENTION_DAYS,
  MARKET_SOLD_VOLUME_SCHEMA,
  marketSoldVolumeRetentionTable,
  pruneMarketSoldVolumeBatch,
  readMarketSoldVolumeSince,
  recordMarketSoldVolumeRow,
} from '../../server/market_sold_volume_db';
import type { MarketListing } from '../../src/sim/market';

function listing(over: Partial<MarketListing> = {}): MarketListing {
  return {
    id: 1,
    sellerKey: '77',
    sellerName: 'Seller',
    itemId: 'wyrmfall_core',
    count: 3,
    price: 900,
    expiresAt: 1000,
    house: false,
    ...over,
  };
}

describe('marketSaleFromBuy (the pure sale verdict)', () => {
  it('reads a listing that left the book as a completed sale', () => {
    const before = listing();
    expect(marketSaleFromBuy(before, null)).toEqual({
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
  });

  it('reads a listing still in the book as no sale', () => {
    // Every refusal arm (too far, bags full, not enough gold, wrong id) leaves
    // the row exactly where it was, so "still there" is the honest no.
    const before = listing();
    expect(marketSaleFromBuy(before, listing())).toBeNull();
  });

  it('reads a missing listing as no sale', () => {
    expect(marketSaleFromBuy(null, null)).toBeNull();
  });

  it('never counts house stock, which the sim does not splice', () => {
    // A house row is the Merchant's own standing stock: src/sim/market.ts
    // guards the whole seller-proceeds block on `!listing.house`, so the row
    // survives a purchase and the disappearance test cannot see it at all.
    // Refusing it explicitly means the blindness is a decision with a test on
    // it, not a silent hole: no tracked bucket contains a house item today
    // (only the two vendor-sold bags are house stock), and if one ever did,
    // under-counting is the safe side for a supply metric.
    expect(marketSaleFromBuy(listing({ house: true }), null)).toBeNull();
    expect(marketSaleFromBuy(listing({ house: true }), listing({ house: true }))).toBeNull();
  });

  it('reports the listing price, not the seller proceeds', () => {
    // The Merchant's cut is a gold sink, not lost volume: what changed hands
    // is the buyout price, and an operator watching for laundering wants the
    // gross figure.
    expect(marketSaleFromBuy(listing({ price: 1_000, count: 1 }), null)?.copper).toBe(1_000);
  });
});

describe('buyWithSoldVolume (the dispatch-site observer)', () => {
  beforeEach(() => {
    resetMarketSoldVolumeForTests();
  });

  it('records the sale that a successful buy completes', async () => {
    const recorded: unknown[] = [];
    resetMarketSoldVolumeForTests((row) => {
      recorded.push(row);
      return Promise.resolve();
    });
    const book: MarketListing[] = [listing({ id: 5 })];
    const sim = {
      marketListings: book,
      marketBuy: vi.fn((id: number) => {
        const index = book.findIndex((row) => row.id === id);
        if (index >= 0) book.splice(index, 1);
      }),
    };
    buyWithSoldVolume(sim, 5, 42);
    expect(sim.marketBuy).toHaveBeenCalledWith(5, 42);
    await soldVolumeWriterIdle();
    expect(recorded).toEqual([{ itemId: 'wyrmfall_core', quantity: 3, copper: 900 }]);
  });

  it('records nothing when the buy is refused', async () => {
    const recorded: unknown[] = [];
    resetMarketSoldVolumeForTests((row) => {
      recorded.push(row);
      return Promise.resolve();
    });
    const sim = { marketListings: [listing({ id: 5 })], marketBuy: vi.fn() };
    buyWithSoldVolume(sim, 5, 42);
    await soldVolumeWriterIdle();
    expect(recorded).toEqual([]);
  });

  it('still runs the buy when the observer is unconfigured', () => {
    // The observer is wiring, never authority: an unwired process must sell
    // exactly as before.
    const book: MarketListing[] = [listing({ id: 5 })];
    const sim = {
      marketListings: book,
      marketBuy: vi.fn(() => {
        book.length = 0;
      }),
    };
    expect(() => buyWithSoldVolume(sim, 5, 42)).not.toThrow();
    expect(sim.marketBuy).toHaveBeenCalledTimes(1);
  });

  it('lets a thrown buy propagate and records nothing', () => {
    const recorded: unknown[] = [];
    resetMarketSoldVolumeForTests((row) => {
      recorded.push(row);
      return Promise.resolve();
    });
    const sim = {
      marketListings: [listing({ id: 5 })],
      marketBuy: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    expect(() => buyWithSoldVolume(sim, 5, 42)).toThrow('boom');
    expect(recorded).toEqual([]);
  });

  it('records only items that classify into a tracked bucket', async () => {
    // The table's growth bound: rows are (realm, day, TRACKED item id), so an
    // untracked sale must write nothing. Without this gate the size of the
    // table goes back into players' hands, since anyone can list anything.
    const recorded: string[] = [];
    resetMarketSoldVolumeForTests((row) => {
      recorded.push(row.itemId);
      return Promise.resolve();
    });
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core' }), // cores bucket
      listing({ id: 2, itemId: 'vale_wheat_seed' }), // seeds bucket
      listing({ id: 3, itemId: 'linen_cloth' }), // in no bucket
      listing({ id: 4, itemId: 'not_a_real_item_id' }),
    ];
    const sim = {
      marketListings: book,
      marketBuy: vi.fn((id: number) => {
        const index = book.findIndex((row) => row.id === id);
        if (index >= 0) book.splice(index, 1);
      }),
    };
    for (const id of [1, 2, 3, 4]) buyWithSoldVolume(sim, id, 42);
    await soldVolumeWriterIdle();
    expect(sim.marketBuy, 'every buy must still run').toHaveBeenCalledTimes(4);
    expect(recorded).toEqual(['wyrmfall_core', 'vale_wheat_seed']);
  });

  it('never lets a failed write reach the game loop', async () => {
    // Fire-and-forget: the 20 Hz loop must not await this, and a rejected
    // insert must not become an unhandled rejection or a thrown dispatch.
    const errors: unknown[] = [];
    const book: MarketListing[] = [listing({ id: 5 })];
    resetMarketSoldVolumeForTests(
      () => Promise.reject(new Error('db down')),
      (err) => errors.push(err),
    );
    const sim = {
      marketListings: book,
      marketBuy: vi.fn(() => {
        book.length = 0;
      }),
    };
    expect(() => buyWithSoldVolume(sim, 5, 42)).not.toThrow();
    await soldVolumeWriterIdle();
    expect(errors).toHaveLength(1);
  });

  it('serializes writes in sale order on one FIFO tail', async () => {
    const order: string[] = [];
    const gates: Array<() => void> = [];
    resetMarketSoldVolumeForTests(
      (row) =>
        new Promise<void>((resolve) => {
          order.push(`start:${row.itemId}`);
          gates.push(() => {
            order.push(`end:${row.itemId}`);
            resolve();
          });
        }),
    );
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core' }),
      listing({ id: 2, itemId: 'vale_wheat_seed' }),
    ];
    const sim = {
      marketListings: book,
      marketBuy: vi.fn((id: number) => {
        const index = book.findIndex((row) => row.id === id);
        if (index >= 0) book.splice(index, 1);
      }),
    };
    buyWithSoldVolume(sim, 1, 42);
    buyWithSoldVolume(sim, 2, 42);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second write must not start until the first finishes.
    expect(order).toEqual(['start:wyrmfall_core']);
    gates[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['start:wyrmfall_core', 'end:wyrmfall_core', 'start:vale_wheat_seed']);
    gates[1]();
    await soldVolumeWriterIdle();
    expect(order).toEqual([
      'start:wyrmfall_core',
      'end:wyrmfall_core',
      'start:vale_wheat_seed',
      'end:vale_wheat_seed',
    ]);
  });
});

describe('market_sold_volume SQL', () => {
  it('is additive and idempotent DDL', () => {
    // There are no migration files: ensureSchema re-applies this at every boot
    // under the advisory lock, so a second boot over a populated table must be
    // a no-op.
    expect(MARKET_SOLD_VOLUME_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS market_sold_volume');
    expect(MARKET_SOLD_VOLUME_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS');
    // Nothing destructive, and no ALTER that could fail on an existing table.
    expect(MARKET_SOLD_VOLUME_SCHEMA).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bALTER TABLE\b/);
  });

  it('carries the day index the prune orders by', () => {
    // Prune SQL rule: no ORDER BY on an unindexed cutoff column, or every
    // batch plans a full sort. The PK leads with realm, so `day` needs its own.
    expect(MARKET_SOLD_VOLUME_SCHEMA).toContain('market_sold_volume_day');
    expect(MARKET_SOLD_VOLUME_SCHEMA).toContain('PRIMARY KEY (realm, day, item_id)');
  });

  it('accumulates rather than appending: the upsert adds to the existing row', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        return { rowCount: 1, rows: [] };
      },
    };
    await recordMarketSoldVolumeRow(db, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
    expect(queries).toHaveLength(1);
    const { text, values } = queries[0];
    expect(text).toContain('INSERT INTO market_sold_volume');
    expect(text).toContain('ON CONFLICT (realm, day, item_id) DO UPDATE');
    expect(text).toContain('sale_count = market_sold_volume.sale_count + 1');
    expect(text).toContain('quantity = market_sold_volume.quantity + EXCLUDED.quantity');
    expect(text).toContain('copper = market_sold_volume.copper + EXCLUDED.copper');
    // Parameterized, never interpolated.
    expect(values).toEqual(['eastbrook', 'wyrmfall_core', 3, 900]);
    expect(text).not.toContain('wyrmfall_core');
  });

  it('reads back the window as parameterized per-item totals', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        return {
          rowCount: 1,
          rows: [{ item_id: 'wyrmfall_core', sale_count: '2', quantity: '5', copper: '1500' }],
        };
      },
    };
    const rows = await readMarketSoldVolumeSince(db, 'eastbrook', 7);
    expect(queries[0].values).toEqual(['eastbrook', 7]);
    expect(queries[0].text).toContain('GROUP BY item_id');
    // BIGINT arrives from pg as a string; a readout that forwards it would
    // render "5" concatenations instead of sums downstream.
    expect(rows).toEqual([{ itemId: 'wyrmfall_core', saleCount: 2, quantity: 5, copper: 1500 }]);
  });

  it('prunes in bounded batches, oldest first, and refuses a non-positive window', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        return { rowCount: 7, rows: [] };
      },
    };
    expect(await pruneMarketSoldVolumeBatch(db, 90, 1000)).toBe(7);
    expect(queries[0].text).toContain('DELETE FROM market_sold_volume');
    expect(queries[0].text).toContain('LIMIT');
    expect(queries[0].text).toContain('ORDER BY day ASC');
    expect(queries[0].values).toEqual([90, 1000]);
    // 0 is the explicit keep-forever, matching every sibling window.
    expect(await pruneMarketSoldVolumeBatch(db, 0, 1000)).toBe(0);
    expect(await pruneMarketSoldVolumeBatch(db, Number.NaN, 1000)).toBe(0);
    expect(queries).toHaveLength(1);
  });

  it('states a positive default retention window', () => {
    expect(MARKET_SOLD_VOLUME_RETENTION_DAYS).toBeGreaterThan(0);
    expect(Number.isInteger(MARKET_SOLD_VOLUME_RETENTION_DAYS)).toBe(true);
  });

  it('exposes a retention table the sweep can register directly', async () => {
    const db = { query: async () => ({ rowCount: 3, rows: [] }) };
    const table = marketSoldVolumeRetentionTable(db);
    expect(table.name).toBe('market_sold_volume');
    expect(await table.pruneBatch(1000)).toBe(3);
  });
});
