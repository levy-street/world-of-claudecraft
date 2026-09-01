import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARKET_METRICS_BUCKET_SETS,
  MARKET_METRICS_BUCKETS,
} from '../../server/admin_market_metrics';
import {
  buyWithSoldVolume,
  marketSaleFromBuy,
  resetMarketSoldVolumeForTests,
  SOLD_VOLUME_TAIL_MAX_DEPTH,
  soldVolumeTailStats,
  soldVolumeWriterIdle,
} from '../../server/market_sold_volume';
import {
  MARKET_SOLD_VOLUME_LOCK_TIMEOUT_MS,
  MARKET_SOLD_VOLUME_RETENTION_DAYS,
  MARKET_SOLD_VOLUME_SCHEMA,
  MARKET_SOLD_VOLUME_WINDOW_DAYS,
  MARKET_SOLD_VOLUME_WRITE_TIMEOUT_MS,
  type MarketSoldVolumeBoundedRunner,
  marketSoldVolumeRetentionTable,
  pruneMarketSoldVolumeBatch,
  readMarketSoldVolumeSince,
  recordMarketSoldVolumeRow,
  recordMarketSoldVolumeRowBounded,
} from '../../server/market_sold_volume_db';
import type { MarketListing } from '../../src/sim/market';
import { stripComments } from '../helpers/strip_comments';
import { tsFilesUnder } from '../helpers/ts_files_under';

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
    // saleCount is stamped at admission (the coalescing accumulator's unit),
    // so the writer always receives an explicit count rather than an implied 1.
    expect(recorded).toEqual([{ itemId: 'wyrmfall_core', quantity: 3, copper: 900, saleCount: 1 }]);
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

// ---------------------------------------------------------------------------
// THE DEFERRAL PIN. Three independent reviewers found this whole cluster wired
// to NOTHING, and the decision recorded here is that it STAYS that way until a
// maintainer rules on it: turning on a database write for every market sale is
// a production behavior call, not a QA fix. So rather than wire it, this pins
// the ALL-FOUR-ABSENT state, and the pin is what makes the deferral safe.
//
// THE FAILURE ORDERING IS WHY IT MUST BE ALL FOUR. The writer WITHOUT the DDL
// turns every tracked sale into a 42P01 at sale rate. The writer WITH the DDL
// but WITHOUT the sweep registration is an unbounded table. Either half landing
// alone is worse than nothing landing, so the day one seam lands this reds and
// names the other three.
//
// It is written to be DECISIVE in both directions, which a bare `not.toContain`
// is not: every needle is first proven to MATCH inside the module that defines
// it (so a typo cannot pass forever), and every absence assertion is paired
// with an ANCHOR in the same file (so a moved, renamed, or unreadable file
// fails loudly instead of trivially satisfying an absence). Sources are
// comment-stripped, so the prose in market_sold_volume_db.ts naming these very
// seams cannot satisfy a pin.
// ---------------------------------------------------------------------------
const REPO_ROOT = process.cwd();

function codeOf(relPath: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
}

/** The four seams, each with the live anchor proving its file was really read. */
const UNWIRED_SEAMS = [
  {
    what: 'MARKET_SOLD_VOLUME_SCHEMA in the ensureSchema DDL ladder',
    file: 'server/db.ts',
    anchor: 'await client.query(BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);',
    absent: 'MARKET_SOLD_VOLUME_SCHEMA',
  },
  {
    what: "marketSoldVolumeRetentionTable in the retention sweep's tables array",
    file: 'server/main.ts',
    anchor: "{ name: 'chat_logs', pruneBatch:",
    absent: 'marketSoldVolumeRetentionTable',
  },
  {
    what: 'buyWithSoldVolume at the market_buy dispatch arm',
    file: 'server/game.ts',
    anchor: 'sim.marketBuy(msg.id, pid);',
    absent: 'buyWithSoldVolume',
  },
  {
    what: 'configureMarketSoldVolume at boot',
    file: 'server/main.ts',
    anchor: 'retentionSweep.start();',
    absent: 'configureMarketSoldVolume',
  },
] as const;

/** Where each needle IS defined, so the spelling is proven before it is denied. */
const NEEDLE_HOMES: Readonly<Record<string, string>> = {
  MARKET_SOLD_VOLUME_SCHEMA: 'server/market_sold_volume_db.ts',
  marketSoldVolumeRetentionTable: 'server/market_sold_volume_db.ts',
  buyWithSoldVolume: 'server/market_sold_volume.ts',
  configureMarketSoldVolume: 'server/market_sold_volume.ts',
  configureAdminMarketSoldVolume: 'server/admin_market_metrics.ts',
};

/** The modules that DEFINE the cluster; every other server module is scanned. */
const CLUSTER_MODULES = new Set([
  'market_sold_volume.ts',
  'market_sold_volume_db.ts',
  'admin_market_metrics.ts',
]);

describe('the sold-volume cluster is wired to nothing, and the deferral is pinned', () => {
  it('spells every needle the way its own module does (the anti-vacuity floor)', () => {
    // Without this, a renamed export would make every absence assertion below
    // pass forever while the seam it guards quietly landed.
    for (const [needle, home] of Object.entries(NEEDLE_HOMES)) {
      expect(codeOf(home), `${needle} should be defined in ${home}`).toContain(needle);
    }
  });

  it.each(UNWIRED_SEAMS)('$what is still absent from $file', ({ file, anchor, absent }) => {
    const code = codeOf(file);
    // The anchor first: an absence assertion over a file that moved, was
    // renamed, or lost the region entirely would pass while measuring nothing.
    expect(code, `anchor missing from ${file}; re-point this pin`).toContain(anchor);
    expect(code, `${absent} is now wired in ${file}: land all four seams together`).not.toContain(
      absent,
    );
  });

  it('no other server module reaches for the cluster either', () => {
    // The three file-specific arms above name the seams the reviewers found;
    // this one closes the rest of the surface, so wiring it up from any other
    // module (a new boot module, a domain route) reds here instead of shipping.
    const needles = Object.keys(NEEDLE_HOMES);
    const scanned = tsFilesUnder(join(REPO_ROOT, 'server')).filter(
      (f) => !CLUSTER_MODULES.has(f.file.split('/').pop() ?? ''),
    );
    // Vacuity floor: server/ is a large tree, so a walk that returned a handful
    // means the scan broke, not that the tree shrank.
    expect(scanned.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const found of scanned) {
      const code = stripComments(readFileSync(found.full, 'utf8'));
      for (const needle of needles) {
        if (code.includes(needle)) offenders.push(`${found.file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans the server tree through the shared walker, never its own read', () => {
    // The mechanical half of the shared-walker rule (tests/CLAUDE.md). Written
    // out here rather than through helpers/scan_guard_self_audit.ts because
    // that helper's walker regex is hard-coded to a `./helpers/<walker>`
    // specifier, which only a guard sitting at the tests/ ROOT can produce; a
    // tests/server/ guard imports `../helpers/<walker>` and fails it. Same two
    // checks, same two traps avoided:
    //   (1) the needles are assembled from pieces, so this assertion's own
    //       source text cannot satisfy the ban it is making;
    //   (2) every spelling of a directory read is banned, not just one, since
    //       opendirSync and globSync rebuild a hand-rolled walk with the
    //       readdirSync count still at zero.
    const self = stripComments(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
    for (const verb of ['readdir', 'opendir', 'glob']) {
      for (const suffix of ['Sync(', '(']) {
        const spelling = `${verb}${suffix}`;
        expect(
          self.split(spelling).length - 1,
          `this guard reads a directory itself via ${spelling}`,
        ).toBe(0);
      }
    }
    const walker = ['ts', 'files', 'under'].join('_');
    expect(new RegExp(`from\\s+'\\.\\./helpers/${walker}'`).test(self)).toBe(true);
  });
});

describe('the write tail budget (the server/bank_ledger.ts shape)', () => {
  /** A sim whose buys always splice, so every call is a completed sale. */
  function sellingSim(rows: MarketListing[]) {
    return {
      marketListings: rows,
      marketBuy: vi.fn((id: number) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      }),
    };
  }

  interface WrittenRow {
    itemId: string;
    quantity: number;
    copper: number;
    saleCount?: number;
  }

  /** A writer whose every call parks until its gate is released. */
  function gatedWriter() {
    const written: WrittenRow[] = [];
    const gates: Array<() => void> = [];
    const write = (row: WrittenRow): Promise<void> => {
      // Snapshot at write time: the row object is the coalescing accumulator,
      // so recording it by reference could read post-write mutations back.
      written.push({ ...row });
      return new Promise<void>((release) => gates.push(release));
    };
    return { written, gates, write };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    resetMarketSoldVolumeForTests();
  });

  it('folds a whole tick of same-item sales into ONE write', async () => {
    // The row is an ACCUMULATOR (every counter is added by the upsert), so
    // several queued sales of one item and one entry carrying all of them write
    // identical totals. Coalescing is therefore lossless, which is why it is
    // preferred over the plain cap-drop the sibling FIFO has to take. The
    // dispatch arms of one tick run synchronously, so this is the ordinary
    // case, not the edge: three sales, one statement.
    const written: Array<{ itemId: string; quantity: number; copper: number; saleCount?: number }> =
      [];
    resetMarketSoldVolumeForTests((row) => {
      written.push({ ...row });
      return Promise.resolve();
    });
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core', count: 3, price: 900 }),
      listing({ id: 2, itemId: 'wyrmfall_core', count: 2, price: 500 }),
      listing({ id: 3, itemId: 'wyrmfall_core', count: 4, price: 100 }),
    ];
    const sim = sellingSim(book);
    for (const id of [1, 2, 3]) buyWithSoldVolume(sim, id, 42);
    expect(soldVolumeTailStats().depth).toBe(1);
    expect(soldVolumeTailStats().coalescedSales).toBe(2);
    await soldVolumeWriterIdle();
    // Nothing is lost: one row carries all three sales' totals exactly.
    expect(written).toEqual([
      {
        itemId: 'wyrmfall_core',
        quantity: 3 + 2 + 4,
        copper: 900 + 500 + 100,
        saleCount: 3,
      },
    ]);
    expect(soldVolumeTailStats().depth).toBe(0);
  });

  it('folds sales arriving BEHIND an in-flight write into one following entry', async () => {
    const { written, gates, write } = gatedWriter();
    resetMarketSoldVolumeForTests(write);
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core', count: 3, price: 900 }),
      listing({ id: 2, itemId: 'wyrmfall_core', count: 2, price: 500 }),
      listing({ id: 3, itemId: 'wyrmfall_core', count: 4, price: 100 }),
    ];
    const sim = sellingSim(book);
    buyWithSoldVolume(sim, 1, 42);
    await tick();
    // Sale 1 is on the wire and can no longer absorb anything.
    expect(written).toHaveLength(1);
    expect(soldVolumeTailStats().depth).toBe(0);
    buyWithSoldVolume(sim, 2, 42);
    buyWithSoldVolume(sim, 3, 42);
    expect(soldVolumeTailStats().depth).toBe(1);
    expect(soldVolumeTailStats().coalescedSales).toBe(1);
    gates[0]();
    await tick();
    expect(written).toHaveLength(2);
    expect(written[1]).toEqual({
      itemId: 'wyrmfall_core',
      quantity: 2 + 4,
      copper: 500 + 100,
      saleCount: 2,
    });
    gates[1]();
    await soldVolumeWriterIdle();
    const totals = written.reduce(
      (acc, row) => ({
        quantity: acc.quantity + row.quantity,
        copper: acc.copper + row.copper,
        saleCount: acc.saleCount + (row.saleCount ?? 1),
      }),
      { quantity: 0, copper: 0, saleCount: 0 },
    );
    expect(totals).toEqual({ quantity: 3 + 2 + 4, copper: 900 + 500 + 100, saleCount: 3 });
    expect(soldVolumeTailStats().depth).toBe(0);
  });

  it('keeps DIFFERENT items on their own entries (coalescing is per item, never a merge)', async () => {
    const { written, gates, write } = gatedWriter();
    resetMarketSoldVolumeForTests(write);
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core' }),
      listing({ id: 2, itemId: 'vale_wheat_seed' }),
      listing({ id: 3, itemId: 'vale_wheat_seed' }),
    ];
    const sim = sellingSim(book);
    for (const id of [1, 2, 3]) buyWithSoldVolume(sim, id, 42);
    // Two distinct ids, so two entries, and only the repeat seed sale folded.
    expect(soldVolumeTailStats().depth).toBe(2);
    expect(soldVolumeTailStats().coalescedSales).toBe(1);
    await tick();
    gates[0]();
    await tick();
    gates[1]();
    await soldVolumeWriterIdle();
    expect(written.map((row) => row.itemId)).toEqual(['wyrmfall_core', 'vale_wheat_seed']);
    expect(written[0].saleCount).toBe(1);
    expect(written[1].saleCount).toBe(2);
  });

  it('freezes an entry the moment its write starts, so a later sale queues a fresh one', async () => {
    // The queued/in-flight boundary. Mutating a row already handed to the
    // writer would change what the database is being asked to write mid-flight.
    const { written, gates, write } = gatedWriter();
    resetMarketSoldVolumeForTests(write);
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core', count: 3, price: 900 }),
      listing({ id: 2, itemId: 'wyrmfall_core', count: 5, price: 700 }),
    ];
    const sim = sellingSim(book);
    buyWithSoldVolume(sim, 1, 42);
    await tick();
    expect(written).toHaveLength(1);
    expect(soldVolumeTailStats().depth).toBe(0);
    buyWithSoldVolume(sim, 2, 42);
    expect(soldVolumeTailStats().depth).toBe(1);
    expect(soldVolumeTailStats().coalescedSales).toBe(0);
    gates[0]();
    await tick();
    gates[1]();
    await soldVolumeWriterIdle();
    expect(written).toEqual([
      { itemId: 'wyrmfall_core', quantity: 3, copper: 900, saleCount: 1 },
      { itemId: 'wyrmfall_core', quantity: 5, copper: 700, saleCount: 1 },
    ]);
  });

  it('refuses admission past the depth cap, counts the dropped sales, and never disturbs the sale', async () => {
    const { written, gates, write } = gatedWriter();
    const errors: unknown[] = [];
    resetMarketSoldVolumeForTests(write, (err) => errors.push(err), { maxDepth: 1 });
    const ids = ['wyrmfall_core', 'vale_wheat_seed', 'compost', 'brook_carrot_seed'];
    const book: MarketListing[] = ids.map((itemId, i) => listing({ id: i + 1, itemId }));
    const sim = sellingSim(book);
    buyWithSoldVolume(sim, 1, 42);
    await tick();
    // The first sale is on the wire, so the one queue slot is free again.
    expect(written).toHaveLength(1);
    expect(soldVolumeTailStats().depth).toBe(0);
    // Three more DISTINCT ids: one fills the slot, the last two are refused.
    for (const id of [2, 3, 4]) buyWithSoldVolume(sim, id, 42);
    expect(soldVolumeTailStats().depth).toBe(1);
    expect(soldVolumeTailStats().droppedSales).toBe(2);
    expect(soldVolumeTailStats().coalescedSales).toBe(0);
    // The sale itself is untouched: every buy ran and nothing threw.
    expect(sim.marketBuy).toHaveBeenCalledTimes(4);
    expect(errors).toEqual([]);
    gates[0]();
    await tick();
    for (const gate of gates) gate();
    await soldVolumeWriterIdle();
    expect(written).toHaveLength(2);
    expect(soldVolumeTailStats().depth).toBe(0);
  });

  it('coalesces BEFORE it drops, so a capped queue still counts repeat sales of a queued item', async () => {
    // Ordering matters: a cap checked first would throw away sales the
    // accumulator could have absorbed for free.
    const { gates, write } = gatedWriter();
    resetMarketSoldVolumeForTests(write, undefined, { maxDepth: 1 });
    const book: MarketListing[] = [
      listing({ id: 1, itemId: 'wyrmfall_core' }),
      listing({ id: 2, itemId: 'vale_wheat_seed' }),
      listing({ id: 3, itemId: 'vale_wheat_seed' }),
    ];
    const sim = sellingSim(book);
    buyWithSoldVolume(sim, 1, 42);
    await tick();
    // The one slot is free; a seed sale takes it, and the SECOND seed sale is
    // at the cap yet still folds, because coalescing is checked first.
    buyWithSoldVolume(sim, 2, 42);
    buyWithSoldVolume(sim, 3, 42);
    expect(soldVolumeTailStats()).toMatchObject({
      depth: 1,
      coalescedSales: 1,
      droppedSales: 0,
    });
    gates[0]();
    await tick();
    for (const gate of gates) gate();
    await soldVolumeWriterIdle();
  });

  it('sizes the production cap ABOVE the structural bound coalescing gives it', () => {
    // Coalescing keys on item id and the writer only ever admits a TRACKED id
    // (buyWithSoldVolume gates on classifyMarketMetricsItem), so the queue can
    // hold at most one entry per tracked id no matter how hard the realm
    // trades. That is the real bound; the cap is the guard on that premise.
    // If the tracked set ever grew past the cap, players could push the queue
    // to the cap and start losing rows, so this must stay true.
    const trackedIds = new Set<string>();
    for (const bucket of MARKET_METRICS_BUCKETS) {
      for (const id of MARKET_METRICS_BUCKET_SETS[bucket]) trackedIds.add(id);
    }
    expect(trackedIds.size).toBeGreaterThan(0);
    expect(SOLD_VOLUME_TAIL_MAX_DEPTH).toBeGreaterThan(trackedIds.size);
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
    // The count is a PARAMETER, not a literal +1: a coalesced entry stands for
    // several sales, and a hard-coded 1 would under-count sale_count by exactly
    // the number of sales coalescing folded away.
    expect(text).toContain('sale_count = market_sold_volume.sale_count + EXCLUDED.sale_count');
    expect(text).toContain('quantity = market_sold_volume.quantity + EXCLUDED.quantity');
    expect(text).toContain('copper = market_sold_volume.copper + EXCLUDED.copper');
    // Parameterized, never interpolated. An entry with no explicit count is one sale.
    expect(values).toEqual(['eastbrook', 'wyrmfall_core', 3, 900, 1]);
    expect(text).not.toContain('wyrmfall_core');
  });

  it("carries a coalesced entry's own sale count into the upsert", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        return { rowCount: 1, rows: [] };
      },
    };
    await recordMarketSoldVolumeRow(db, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 7,
      copper: 2_100,
      saleCount: 3,
    });
    expect(queries[0].values).toEqual(['eastbrook', 'wyrmfall_core', 7, 2_100, 3]);
  });

  it('binds the sale write to its own lock and statement allowance, not the ambient default', async () => {
    // The clear-item-name probe precedent (CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS) and
    // the marketplace guard precedent (ESCROW_LOCK_TIMEOUT_MS): a single-row
    // upsert on a three-column primary key must not be able to pin a pooled
    // client for the 15s session default while the tick loop keeps queueing.
    const statements: string[] = [];
    let timeoutMs = -1;
    const run: MarketSoldVolumeBoundedRunner = async (ms, fn) => {
      timeoutMs = ms;
      return fn(async (text) => {
        statements.push(text);
        return { rowCount: 1, rows: [] };
      });
    };
    await recordMarketSoldVolumeRowBounded(run, 'eastbrook', {
      itemId: 'wyrmfall_core',
      quantity: 3,
      copper: 900,
    });
    expect(timeoutMs).toBe(MARKET_SOLD_VOLUME_WRITE_TIMEOUT_MS);
    expect(statements[0]).toBe(`SET LOCAL lock_timeout = ${MARKET_SOLD_VOLUME_LOCK_TIMEOUT_MS}`);
    expect(statements[1]).toContain('INSERT INTO market_sold_volume');
    expect(statements).toHaveLength(2);
    // Both bounds are an order of magnitude under the 15s pool default they
    // exist to avoid, and neither is zero (which would mean "no bound").
    for (const ms of [MARKET_SOLD_VOLUME_WRITE_TIMEOUT_MS, MARKET_SOLD_VOLUME_LOCK_TIMEOUT_MS]) {
      expect(Number.isSafeInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(15_000);
    }
  });

  it('has db.ts runWithStatementTimeout satisfy the bounded runner, checked by tsc', () => {
    // A TYPE-level pin, so the day-one wiring can pass runWithStatementTimeout
    // straight in and a drift in either signature fails the build rather than
    // at the (not yet written) binding site. Type-only: no pool is touched.
    type Real = typeof import('../../server/db').runWithStatementTimeout;
    const assignable: (r: Real) => MarketSoldVolumeBoundedRunner = (r) => r;
    expect(typeof assignable).toBe('function');
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

  it('keeps the retention window comfortably wider than the readout window', () => {
    // An operator widening the readout should not immediately fall off the end
    // of the retained data. Pure constants, so it belongs in the unit suite:
    // it used to live inside the pg suite's describeDb, where it skipped in every
    // DB-less run and therefore never guarded anything on the default gate.
    expect(MARKET_SOLD_VOLUME_RETENTION_DAYS).toBeGreaterThan(MARKET_SOLD_VOLUME_WINDOW_DAYS);
  });

  it('exposes a retention table the sweep can register directly', async () => {
    const db = { query: async () => ({ rowCount: 3, rows: [] }) };
    const table = marketSoldVolumeRetentionTable(db);
    expect(table.name).toBe('market_sold_volume');
    expect(await table.pruneBatch(1000)).toBe(3);
  });
});
