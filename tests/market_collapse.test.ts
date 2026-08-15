import { describe, expect, it } from 'vitest';
import { collapseToLowestPerItem } from '../src/sim/market_collapse';

describe('collapseToLowestPerItem', () => {
  it('keeps only the lowest-priced listing per distinct item id', () => {
    const listings = [
      { id: 1, itemId: 'sword_basic', price: 500 },
      { id: 2, itemId: 'sword_basic', price: 300 },
      { id: 3, itemId: 'shield_basic', price: 200 },
      { id: 4, itemId: 'sword_basic', price: 400 },
    ];
    const result = collapseToLowestPerItem(listings);
    expect(result).toEqual([
      { id: 2, itemId: 'sword_basic', price: 300 },
      { id: 3, itemId: 'shield_basic', price: 200 },
    ]);
  });

  it('breaks an exact price tie by the smaller (older) listing id, deterministically', () => {
    const listings = [
      { id: 10, itemId: 'sword_basic', price: 300 },
      { id: 5, itemId: 'sword_basic', price: 300 },
      { id: 7, itemId: 'sword_basic', price: 300 },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([
      { id: 5, itemId: 'sword_basic', price: 300 },
    ]);
    // Order of the tied rows in the input must not change the winner.
    expect(collapseToLowestPerItem([...listings].reverse())).toEqual([
      { id: 5, itemId: 'sword_basic', price: 300 },
    ]);
  });

  it('preserves first-occurrence item order, independent of price order within the input', () => {
    const listings = [
      { id: 1, itemId: 'b_item', price: 100 },
      { id: 2, itemId: 'a_item', price: 50 },
      { id: 3, itemId: 'b_item', price: 10 },
    ];
    const result = collapseToLowestPerItem(listings);
    expect(result.map((l) => l.itemId)).toEqual(['b_item', 'a_item']);
    expect(result.find((l) => l.itemId === 'b_item')).toEqual({
      id: 3,
      itemId: 'b_item',
      price: 10,
    });
  });

  it('passes through a stack whose cheapest row is a multi-count listing unchanged', () => {
    const listings = [
      { id: 1, itemId: 'ore', price: 50, count: 1 },
      { id: 2, itemId: 'ore', price: 40, count: 8 },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([
      { id: 2, itemId: 'ore', price: 40, count: 8 },
    ]);
  });

  it('keeps materially distinct instanced copies separate from plain-item collapse', () => {
    const listings = [
      { id: 1, itemId: 'sword_basic', price: 100 },
      { id: 2, itemId: 'sword_basic', price: 300, instance: { enchant: 'fiery' } },
      {
        id: 3,
        itemId: 'sword_basic',
        price: 400,
        instance: { rolled: { masterwork: true, stats: { str: 2 } } },
      },
      { id: 4, itemId: 'sword_basic', price: 500, instance: { signer: 'Artisan' } },
      { id: 5, itemId: 'sword_basic', price: 200 },
    ];

    expect(collapseToLowestPerItem(listings)).toEqual(listings.slice(0, 4));
  });

  it('returns an empty array for an empty input, and a single row unchanged', () => {
    expect(collapseToLowestPerItem([])).toEqual([]);
    const solo = [{ id: 1, itemId: 'x', price: 10 }];
    expect(collapseToLowestPerItem(solo)).toEqual(solo);
  });
});
