// The World Market's pending sale ledger (src/sim/market_sale_log.ts): the pure
// leaf behind the Collect tab's itemized sales. Drives the module directly, the
// market_listing_ids.test.ts pattern.

import { describe, expect, it } from 'vitest';
import { MAX_LEGENDARY_NAME_LOAD_LENGTH } from '../src/sim/item_instance_load';
import {
  cloneSaleLog,
  emptySaleLog,
  isSaleLogEmpty,
  MARKET_SALE_LOG_MAX,
  MAX_SALE_ITEM_NAME_LEN,
  type MarketSaleRecord,
  mergeSaleLogs,
  recordSale,
  sanitizeSaleLog,
} from '../src/sim/market_sale_log';

// The default row carries a CHOSEN NAME. It used to omit itemName entirely,
// which made every whole-row arm below (the round trip above all) pass without
// ever touching the field: the load path dropped the name and nothing noticed.
// A plain copy (no name) is the common case and gets its own explicit arm
// rather than the default, so the vacuum cannot come back.
function sale(overrides: Partial<MarketSaleRecord> = {}): MarketSaleRecord {
  return {
    itemId: 'wolf_fang',
    itemName: 'Dawn Oath',
    count: 1,
    price: 200,
    proceeds: 190,
    buyerName: 'Buyer',
    ...overrides,
  };
}

/** A plain copy's row: no chosen name, the common case. */
function plainSale(overrides: Partial<MarketSaleRecord> = {}): MarketSaleRecord {
  const row = sale(overrides);
  delete row.itemName;
  return row;
}

describe('the World Market pending sale ledger', () => {
  it('records a sale with the item, stack, gross ask and net proceeds', () => {
    const log = emptySaleLog();
    recordSale(log, sale({ itemId: 'copper_ore', count: 20, price: 5000, proceeds: 4750 }));

    expect(isSaleLogEmpty(log)).toBe(false);
    expect(log.entries).toEqual([
      {
        itemId: 'copper_ore',
        itemName: 'Dawn Oath',
        count: 20,
        price: 5000,
        proceeds: 4750,
        buyerName: 'Buyer',
      },
    ]);
    expect(log.omitted).toBe(0);
  });

  it('keeps insertion order, so the ledger reads oldest first', () => {
    const log = emptySaleLog();
    recordSale(log, sale({ itemId: 'wolf_fang' }));
    recordSale(log, sale({ itemId: 'copper_ore' }));
    recordSale(log, sale({ itemId: 'spring_water' }));

    expect(log.entries.map((e) => e.itemId)).toEqual(['wolf_fang', 'copper_ore', 'spring_water']);
  });

  it('does not alias the caller record, so a later mutation cannot rewrite history', () => {
    const log = emptySaleLog();
    const source = sale();
    recordSale(log, source);
    source.proceeds = 999999;
    source.buyerName = 'Someone Else';

    expect(log.entries[0].proceeds).toBe(190);
    expect(log.entries[0].buyerName).toBe('Buyer');
  });

  it('caps at MARKET_SALE_LOG_MAX by dropping the OLDEST rows and counting them', () => {
    const log = emptySaleLog();
    for (let i = 0; i < MARKET_SALE_LOG_MAX + 7; i++) {
      recordSale(log, sale({ itemId: `item_${i}` }));
    }

    expect(log.entries.length).toBe(MARKET_SALE_LOG_MAX);
    expect(log.omitted).toBe(7);
    // The survivors are the NEWEST rows: the oldest 7 are the ones that left.
    expect(log.entries[0].itemId).toBe('item_7');
    expect(log.entries[log.entries.length - 1].itemId).toBe(`item_${MARKET_SALE_LOG_MAX + 6}`);
  });

  it('an empty log is empty; one holding only an omitted count is NOT', () => {
    expect(isSaleLogEmpty(emptySaleLog())).toBe(true);
    expect(isSaleLogEmpty({ entries: [], omitted: 3 })).toBe(false);
  });

  it('clones deeply, so a wire payload never aliases the live ledger', () => {
    const log = emptySaleLog();
    recordSale(log, sale());
    const copy = cloneSaleLog(log);
    copy.entries[0].proceeds = 1;
    copy.omitted = 42;

    expect(log.entries[0].proceeds).toBe(190);
    expect(log.omitted).toBe(0);
  });

  it('merges one bucket into another, carrying rows and the omitted count', () => {
    const into = emptySaleLog();
    recordSale(into, sale({ itemId: 'wolf_fang' }));
    const from = { entries: [sale({ itemId: 'copper_ore' })], omitted: 4 };

    mergeSaleLogs(into, from);

    expect(into.entries.map((e) => e.itemId)).toEqual(['wolf_fang', 'copper_ore']);
    expect(into.omitted).toBe(4);
    // Deep-copied on the way in: the source bucket is about to be deleted, and
    // nothing it owned may still be reachable from the survivor.
    from.entries[0].proceeds = 7;
    expect(into.entries[1].proceeds).toBe(190);
  });

  it('a merge that overflows the cap trims and counts, it does not grow past it', () => {
    const into = emptySaleLog();
    const from = emptySaleLog();
    for (let i = 0; i < MARKET_SALE_LOG_MAX; i++) recordSale(into, sale({ itemId: `a_${i}` }));
    for (let i = 0; i < 3; i++) recordSale(from, sale({ itemId: `b_${i}` }));

    mergeSaleLogs(into, from);

    expect(into.entries.length).toBe(MARKET_SALE_LOG_MAX);
    expect(into.omitted).toBe(3);
    expect(into.entries[into.entries.length - 1].itemId).toBe('b_2');
  });

  describe('sanitizeSaleLog (the one load path)', () => {
    it('loads a pre-ledger save (no sales key at all) as an empty log', () => {
      expect(sanitizeSaleLog(undefined)).toEqual({ entries: [], omitted: 0 });
      expect(sanitizeSaleLog(null)).toEqual({ entries: [], omitted: 0 });
      expect(sanitizeSaleLog('nonsense')).toEqual({ entries: [], omitted: 0 });
    });

    it('round-trips a real log unchanged', () => {
      const log = emptySaleLog();
      recordSale(log, sale({ itemId: 'copper_ore', count: 20, price: 5000, proceeds: 4750 }));
      expect(sanitizeSaleLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    });

    it("carries the sold copy's chosen name across the save", () => {
      // The field's whole reason to exist (see its docblock): the ledger row
      // describes a PAST transaction, so nothing can recover the name later.
      // Rebuilding the row without it left a seller who listed two copies of
      // one id reading two identical Collect rows after any logout.
      const log = emptySaleLog();
      recordSale(log, sale({ itemName: 'Dawn Oath' }));
      const loaded = sanitizeSaleLog(JSON.parse(JSON.stringify(log)));
      expect(loaded.entries[0].itemName).toBe('Dawn Oath');
    });

    it('a plain copy loads with no itemName key at all', () => {
      const log = emptySaleLog();
      recordSale(log, plainSale());
      const loaded = sanitizeSaleLog(JSON.parse(JSON.stringify(log)));
      expect('itemName' in loaded.entries[0]).toBe(false);
    });

    it('drops an unusable itemName rather than smuggling it to the UI', () => {
      const loaded = sanitizeSaleLog({
        entries: [
          { ...plainSale(), itemName: 42 },
          { ...plainSale({ itemId: 'copper_ore' }), itemName: '' },
        ],
      });
      expect('itemName' in loaded.entries[0]).toBe(false);
      expect('itemName' in loaded.entries[1]).toBe(false);
    });

    it('bounds a chosen name, so a blob cannot smuggle an unbounded string to the UI', () => {
      // buyerName has been fenced since the ledger landed; itemName was not,
      // and it renders raw beside it in the Collect tab.
      const loaded = sanitizeSaleLog({ entries: [sale({ itemName: 'N'.repeat(500) })] });
      expect(loaded.entries[0].itemName?.length).toBe(MAX_SALE_ITEM_NAME_LEN);
      // The live stamp is fenced the same way, so the in-memory row and the
      // reloaded row can never disagree.
      const log = emptySaleLog();
      recordSale(log, sale({ itemName: 'N'.repeat(500) }));
      expect(log.entries[0].itemName?.length).toBe(MAX_SALE_ITEM_NAME_LEN);
    });

    it('the local fence matches the mint-side load ceiling it mirrors', () => {
      // market_sale_log.ts keeps its own literal so this leaf stays out of the
      // content tree item_instance_load.ts pulls in; that is only safe while
      // the two agree, so the drift is pinned rather than trusted.
      expect(MAX_SALE_ITEM_NAME_LEN).toBe(MAX_LEGENDARY_NAME_LOAD_LENGTH);
    });

    it('drops rows with no usable item id', () => {
      const loaded = sanitizeSaleLog({
        entries: [sale(), { count: 2 }, { itemId: '' }, null, 'x'],
        omitted: 0,
      });
      expect(loaded.entries.map((e) => e.itemId)).toEqual(['wolf_fang']);
    });

    it('clamps every number field of a hand-edited blob', () => {
      const loaded = sanitizeSaleLog({
        entries: [
          { itemId: 'wolf_fang', count: -5, price: -1, proceeds: Number.NaN, buyerName: 12 },
          { itemId: 'copper_ore', count: 2.9, price: 10.7, proceeds: 9.9, buyerName: 'B' },
        ],
        omitted: -3,
      });

      expect(loaded.entries[0]).toEqual({
        itemId: 'wolf_fang',
        // count floors to at least one copy; the rest floor to zero, never negative
        count: 1,
        price: 0,
        proceeds: 0,
        buyerName: '',
      });
      expect(loaded.entries[1]).toEqual({
        itemId: 'copper_ore',
        count: 2,
        price: 10,
        proceeds: 9,
        buyerName: 'B',
      });
      expect(loaded.omitted).toBe(0);
    });

    it('truncates an oversized blob so the live cap invariant survives a bad save', () => {
      const entries = [];
      for (let i = 0; i < MARKET_SALE_LOG_MAX + 10; i++) entries.push(sale({ itemId: `x_${i}` }));

      const loaded = sanitizeSaleLog({ entries, omitted: 2 });

      expect(loaded.entries.length).toBe(MARKET_SALE_LOG_MAX);
      expect(loaded.omitted).toBe(12); // the 2 already counted plus the 10 trimmed here
    });

    it('bounds a buyer name, so a blob cannot smuggle an unbounded string to the UI', () => {
      const loaded = sanitizeSaleLog({ entries: [sale({ buyerName: 'N'.repeat(500) })] });
      expect(loaded.entries[0].buyerName.length).toBe(32);
    });
  });
});
