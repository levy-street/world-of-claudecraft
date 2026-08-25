// The category-stamp boot backfill (server/woc_market_backfill.ts): rows
// escrowed before the category columns existed carry NULL and sat outside
// every category-filtered browse (the dev repro: Thronebane invisible under
// Category = Weapons). The derivations run against the LIVE catalog here, so
// a vocabulary drift in the sim helpers fails this file, not dev testing.
import { describe, expect, it } from 'vitest';
import { backfillListingCategoryStamps } from '../../server/woc_market_backfill';
import { WOC_MARKET_SCHEMA } from '../../server/woc_market_db';

describe('the category-stamp boot backfill', () => {
  it('the worklist read seeks a partial index over the un-stamped rows', () => {
    // The read runs at every boot; without the partial index it seq-scans a
    // growing table forever even after convergence. The predicate must match
    // the query's WHERE verbatim (the shared-SQL rule) for the planner to use
    // it, and it must be PARTIAL so the index stays empty once the one-shot
    // backfill converges (new rows stamp category at escrow, never landing in
    // it). A plain full index on item_id would grow with the table instead.
    const schema = WOC_MARKET_SCHEMA.replace(/\s+/g, ' ');
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_listings_category_missing ON woc_market_listings(item_id) WHERE category IS NULL',
    );
  });

  it('derives stamps from the live catalog and converges every walked row', async () => {
    const stamps = new Map<string, { category: string; subcategory: string | null }>();
    const db = {
      listingItemIdsMissingCategory: async () => [
        'heroic_kingsbane_last_oath',
        'no_such_item_anymore',
      ],
      stampListingCategory: async (
        itemId: string,
        category: string,
        subcategory: string | null,
      ) => {
        stamps.set(itemId, { category, subcategory });
        return 1;
      },
    };
    expect(await backfillListingCategoryStamps(db)).toBe(2);
    // The dev repro's row: a heroic sword derives weapon/sword through the
    // heroic_ prefix arm of the weapon-type vocabulary.
    expect(stamps.get('heroic_kingsbane_last_oath')).toEqual({
      category: 'weapon',
      subcategory: 'sword',
    });
    // A def the catalog no longer names stamps 'other': unreachable by the
    // category filters (honest), and the pass converges instead of
    // re-walking the same row every boot.
    expect(stamps.get('no_such_item_anymore')).toEqual({
      category: 'other',
      subcategory: null,
    });
  });

  it('does nothing on a converged database', async () => {
    let writes = 0;
    const db = {
      listingItemIdsMissingCategory: async () => [],
      stampListingCategory: async () => {
        writes += 1;
        return 1;
      },
    };
    expect(await backfillListingCategoryStamps(db)).toBe(0);
    expect(writes).toBe(0);
  });
});
