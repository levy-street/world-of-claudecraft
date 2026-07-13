import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  applyBagFilter,
  BAG_CATEGORIES,
  type BagFilterState,
  bagFilterIsDefault,
  bagOrderIsManual,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from '../src/ui/bag_filter';

// A tiny synthetic item table so the test never depends on live content balance.
const ITEMS: Record<string, ItemDef> = {
  blade: {
    id: 'blade',
    name: 'Redbrook Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
  },
  dagger: {
    id: 'dagger',
    name: 'Rusty Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 1, max: 2, speed: 1.5, dagger: true },
  },
  helm: { id: 'helm', name: 'Iron Helm', kind: 'armor', slot: 'helmet', quality: 'rare' },
  potion: { id: 'potion', name: 'Minor Healing Potion', kind: 'potion', quality: 'common' },
  bread: { id: 'bread', name: 'Crusty Bread', kind: 'food', quality: 'common' },
  pelt: { id: 'pelt', name: 'Wolf Pelt', kind: 'junk', quality: 'poor' },
  rod: { id: 'rod', name: 'Fishing Rod', kind: 'tool', quality: 'common' },
  keystone: { id: 'keystone', name: 'Crypt Keystone', kind: 'quest', quality: 'common' },
  relic: { id: 'relic', name: 'Ancient Relic', kind: 'armor', slot: 'chest', quality: 'legendary' },
} as unknown as Record<string, ItemDef>;

const lookup = (id: string): ItemDef | undefined => ITEMS[id];

// Insertion order is intentionally scrambled across categories/qualities.
const INV: InvSlot[] = [
  { itemId: 'potion', count: 3 },
  { itemId: 'blade', count: 1 },
  { itemId: 'keystone', count: 1 },
  { itemId: 'pelt', count: 5 },
  { itemId: 'relic', count: 1 },
  { itemId: 'helm', count: 1 },
  { itemId: 'bread', count: 2 },
  { itemId: 'dagger', count: 1 },
  { itemId: 'rod', count: 1 },
];

function ids(slots: InvSlot[]): string[] {
  return slots.map((s) => s.itemId);
}

describe('applyBagFilter — category filtering', () => {
  it('returns everything (insertion order) for "all" + "recent"', () => {
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(ids(INV));
  });

  it('keeps only weapons', () => {
    const out = applyBagFilter(INV, lookup, { category: 'weapon', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['blade', 'dagger']);
  });

  it('keeps only armor', () => {
    const out = applyBagFilter(INV, lookup, { category: 'armor', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['relic', 'helm']);
  });

  it('keeps food, drink, potions and elixirs as consumables', () => {
    const out = applyBagFilter(INV, lookup, { category: 'consumable', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['potion', 'bread']);
  });

  it('keeps junk and tools as materials', () => {
    const out = applyBagFilter(INV, lookup, { category: 'material', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['pelt', 'rod']);
  });

  it('keeps only quest items', () => {
    const out = applyBagFilter(INV, lookup, { category: 'quest', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['keystone']);
  });

  it('drops slots whose item is missing from the table', () => {
    const inv: InvSlot[] = [...INV, { itemId: 'ghost', count: 1 }];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'recent', search: '' });
    expect(ids(out)).not.toContain('ghost');
  });
});

describe('applyBagFilter — search', () => {
  it('matches a case-insensitive name substring', () => {
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'recent', search: 'red' });
    expect(ids(out)).toEqual(['blade']);
  });

  it('combines search with a category', () => {
    const out = applyBagFilter(INV, lookup, {
      category: 'consumable',
      sort: 'recent',
      search: 'potion',
    });
    expect(ids(out)).toEqual(['potion']);
  });

  it('trims and ignores blank search', () => {
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'recent', search: '   ' });
    expect(out.length).toBe(INV.length);
  });
});

describe('applyBagFilter — sorting', () => {
  it('sorts by quality descending (legendary first, poor last), ties keep insertion order', () => {
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(out)).toEqual([
      'relic',
      'helm',
      'blade',
      'potion',
      'keystone',
      'bread',
      'dagger',
      'rod',
      'pelt',
    ]);
  });

  it('sorts by name A to Z', () => {
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'name', search: '' });
    expect(ids(out)).toEqual([
      'relic',
      'bread',
      'keystone',
      'rod',
      'helm',
      'potion',
      'blade',
      'dagger',
      'pelt',
    ]);
  });

  it('does not mutate the input array', () => {
    const before = ids(INV);
    applyBagFilter(INV, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(INV)).toEqual(before);
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips a valid state', () => {
    const state: BagFilterState = { category: 'armor', sort: 'name', search: 'iron' };
    expect(parseBagFilter(serializeBagFilter(state))).toEqual(state);
  });

  it('falls back to defaults on garbage input', () => {
    expect(parseBagFilter('not json')).toEqual(DEFAULT_BAG_FILTER);
    expect(parseBagFilter(null)).toEqual(DEFAULT_BAG_FILTER);
    expect(parseBagFilter('{"category":"bogus","sort":"nope","search":42}')).toEqual(
      DEFAULT_BAG_FILTER,
    );
  });

  it('coerces a non-string search to empty and keeps valid enum fields', () => {
    const parsed = parseBagFilter('{"category":"weapon","sort":"quality","search":123}');
    expect(parsed).toEqual({ category: 'weapon', sort: 'quality', search: '' });
  });
});

describe('BAG_CATEGORIES', () => {
  it('lists every category exactly once, starting with all', () => {
    expect(BAG_CATEGORIES[0]).toBe('all');
    expect(new Set(BAG_CATEGORIES).size).toBe(BAG_CATEGORIES.length);
  });
});

describe('bagFilterIsDefault (shared by the bags grid and the bank window)', () => {
  const state = (over: Partial<BagFilterState> = {}): BagFilterState => ({
    ...DEFAULT_BAG_FILTER,
    ...over,
  });

  it('is true only with the all category and an empty search (any sort)', () => {
    expect(bagFilterIsDefault(state())).toBe(true);
    expect(bagFilterIsDefault(state({ sort: 'quality' }))).toBe(true);
    expect(bagFilterIsDefault(state({ category: 'weapon' }))).toBe(false);
    expect(bagFilterIsDefault(state({ search: 'x' }))).toBe(false);
    expect(bagFilterIsDefault(state({ search: '   ' }))).toBe(true);
  });
});

describe('bagOrderIsManual (the reorder gate)', () => {
  // Dragging a stack onto a cell only means "put it there" while the view PRESERVES the
  // inventory array order. A quality/name sort REORDERS the view, so a cell names no
  // array position and the sort would put both stacks straight back: that view refuses
  // the drop (with a toast). A category chip or a search only HIDES stacks, leaving the
  // survivors in array order, so a swap between two visible stacks stays coherent there.
  it('is true only for the pristine view, the one that shows the bag REAL cells', () => {
    expect(bagOrderIsManual({ category: 'all', sort: 'recent', search: '' })).toBe(true);
  });

  it('is false for any derived view: its squares are rows, not bag positions', () => {
    expect(bagOrderIsManual({ category: 'all', sort: 'quality', search: '' })).toBe(false);
    expect(bagOrderIsManual({ category: 'all', sort: 'name', search: '' })).toBe(false);
    expect(bagOrderIsManual({ category: 'weapon', sort: 'recent', search: '' })).toBe(false);
    expect(bagOrderIsManual({ category: 'all', sort: 'recent', search: 'clo' })).toBe(false);
  });
});
