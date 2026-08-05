import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { BAG_CATEGORIES, type BagFilterState } from '../src/ui/bag_filter';
import { filterBankSlots } from '../src/ui/bank_filter';
import type { BankSlotModel } from '../src/ui/bank_view';

// The bank filter reuses bag_filter's shared vocabulary (categories/sorts/predicates)
// but operates on the bank's own BankSlotModel[] and matches/sorts on the LOCALIZED
// item name via an injected resolver. These tests pin every category, all three sorts
// (including a localized-name sort whose order differs from the English item.name),
// case-insensitive localized search (with a decisive negative: an English-name
// substring that is absent from the localized name must NOT match), slotIndex
// preservation through filter + sort, and the unknown-id exclusion.

const ITEMS: Record<string, ItemDef> = {
  blade: {
    id: 'blade',
    name: 'Redbrook Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
  },
  helm: { id: 'helm', name: 'Iron Helm', kind: 'armor', slot: 'helmet', quality: 'rare' },
  potion: { id: 'potion', name: 'Minor Healing Potion', kind: 'potion', quality: 'common' },
  pelt: { id: 'pelt', name: 'Wolf Pelt', kind: 'junk', quality: 'poor' },
  rod: { id: 'rod', name: 'Fishing Rod', kind: 'tool', quality: 'common' },
  // A REAL catalog id: the material chip is honest-taxonomy set membership
  // (src/sim/material_taxonomy.ts), so a synthetic id can never match it.
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', kind: 'junk', quality: 'common' },
  keystone: { id: 'keystone', name: 'Crypt Keystone', kind: 'quest', quality: 'common' },
  relic: { id: 'relic', name: 'Ancient Relic', kind: 'armor', slot: 'chest', quality: 'legendary' },
} as unknown as Record<string, ItemDef>;

const lookup = (id: string): ItemDef | undefined => ITEMS[id];

// A localized display name deliberately UNRELATED to the English item.name: a different
// alphabet order AND no shared substrings, so a match/sort on this proves the resolver
// (not item.name) drives search and the name-sort.
const LOCALIZED: Record<string, string> = {
  blade: 'Zwaard',
  helm: 'Aardhelm',
  potion: 'Mirakel',
  pelt: 'Bontvel',
  rod: 'Hengel',
  keystone: 'Sleutelsteen',
  relic: 'Relikwie',
  iron_ore: 'Ysterets',
};
const nameOf = (id: string): string => LOCALIZED[id] ?? id;

// slotIndex is intentionally NOT the array position, so a filter/sort that dropped or
// reordered it would visibly corrupt the pinned slotIndex sequences below.
const MODELS: BankSlotModel[] = [
  { slotIndex: 5, itemId: 'potion', count: 3, showCount: true, qualityKey: 'common' },
  { slotIndex: 2, itemId: 'blade', count: 1, showCount: false, qualityKey: 'uncommon' },
  { slotIndex: 8, itemId: 'keystone', count: 1, showCount: false, qualityKey: 'common' },
  { slotIndex: 0, itemId: 'pelt', count: 5, showCount: true, qualityKey: 'poor' },
  { slotIndex: 7, itemId: 'relic', count: 1, showCount: false, qualityKey: 'legendary' },
  { slotIndex: 3, itemId: 'helm', count: 1, showCount: false, qualityKey: 'rare' },
  { slotIndex: 1, itemId: 'rod', count: 1, showCount: false, qualityKey: 'common' },
];

const state = (over: Partial<BagFilterState> = {}): BagFilterState => ({
  category: 'all',
  sort: 'recent',
  search: '',
  ...over,
});

const indices = (out: BankSlotModel[]): number[] => out.map((m) => m.slotIndex);
const ids = (out: BankSlotModel[]): string[] => out.map((m) => m.itemId);

describe('filterBankSlots: category', () => {
  it('keeps everything in original slot order for all + recent', () => {
    expect(indices(filterBankSlots(MODELS, lookup, state(), nameOf))).toEqual([
      5, 2, 8, 0, 7, 3, 1,
    ]);
  });

  it('keeps only weapons', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ category: 'weapon' }), nameOf))).toEqual([
      'blade',
    ]);
  });

  it('keeps only armor (original order)', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ category: 'armor' }), nameOf))).toEqual([
      'relic',
      'helm',
    ]);
  });

  it('keeps only consumables', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ category: 'consumable' }), nameOf))).toEqual(
      ['potion'],
    );
  });

  it('keeps only honest materials: grey junk and tools no longer match the chip', () => {
    // The material chip narrowed from junk-or-tool to the derived taxonomy
    // (phase 19): only the real material matches; the grey pelt and the rod
    // fall out of MODELS entirely, and the rod moves to the tool chip below.
    const models: BankSlotModel[] = [
      { slotIndex: 4, itemId: 'iron_ore', count: 2, showCount: true, qualityKey: 'common' },
      ...MODELS,
    ];
    expect(ids(filterBankSlots(models, lookup, state({ category: 'material' }), nameOf))).toEqual([
      'iron_ore',
    ]);
  });

  it('keeps only tools under the tool chip (the displaced implements)', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ category: 'tool' }), nameOf))).toEqual([
      'rod',
    ]);
  });

  it('keeps only quest items', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ category: 'quest' }), nameOf))).toEqual([
      'keystone',
    ]);
  });
});

describe('filterBankSlots: search matches the LOCALIZED name, not item.name', () => {
  it('matches a case-insensitive substring of the localized name', () => {
    expect(ids(filterBankSlots(MODELS, lookup, state({ search: 'zwa' }), nameOf))).toEqual([
      'blade',
    ]);
    expect(ids(filterBankSlots(MODELS, lookup, state({ search: 'ZWAARD' }), nameOf))).toEqual([
      'blade',
    ]);
  });

  it('does NOT match an English item.name substring absent from the localized name', () => {
    // "Redbrook Blade" contains "red"; the localized name is "Zwaard", which does not.
    // A search that matched item.name would wrongly return the blade here.
    expect(filterBankSlots(MODELS, lookup, state({ search: 'red' }), nameOf)).toEqual([]);
  });

  it('combines search with a category', () => {
    expect(
      ids(filterBankSlots(MODELS, lookup, state({ category: 'tool', search: 'hengel' }), nameOf)),
    ).toEqual(['rod']);
  });

  it('trims blank search to a no-op', () => {
    expect(filterBankSlots(MODELS, lookup, state({ search: '   ' }), nameOf).length).toBe(
      MODELS.length,
    );
  });
});

describe('filterBankSlots: sorting preserves slotIndex', () => {
  it('sorts by quality descending (legendary first), ties keep insertion order', () => {
    const out = filterBankSlots(MODELS, lookup, state({ sort: 'quality' }), nameOf);
    expect(ids(out)).toEqual(['relic', 'helm', 'blade', 'potion', 'keystone', 'rod', 'pelt']);
    expect(indices(out)).toEqual([7, 3, 2, 5, 8, 1, 0]);
  });

  it('sorts by the LOCALIZED name (order differs from the English item.name)', () => {
    const out = filterBankSlots(MODELS, lookup, state({ sort: 'name' }), nameOf);
    // Localized A-Z: Aardhelm, Bontvel, Hengel, Mirakel, Relikwie, Sleutelsteen, Zwaard.
    expect(ids(out)).toEqual(['helm', 'pelt', 'rod', 'potion', 'relic', 'keystone', 'blade']);
    expect(indices(out)).toEqual([3, 0, 1, 5, 7, 8, 2]);
    // A sort on the English item.name would instead lead with 'Ancient Relic' (relic),
    // so this order proves the name-sort uses nameOf.
    expect(ids(out)[0]).not.toBe('relic');
  });

  it('carries slotIndex through a combined category + sort', () => {
    const out = filterBankSlots(
      MODELS,
      lookup,
      state({ category: 'armor', sort: 'quality' }),
      nameOf,
    );
    expect(ids(out)).toEqual(['relic', 'helm']);
    expect(indices(out)).toEqual([7, 3]);
  });

  it('does not mutate the input array', () => {
    const before = indices(MODELS);
    filterBankSlots(MODELS, lookup, state({ sort: 'quality' }), nameOf);
    expect(indices(MODELS)).toEqual(before);
  });
});

describe('filterBankSlots: unknown ids', () => {
  // Bank contents are server truth, so a stale bundle can hold ids it
  // predates (R34). The everything view keeps such a slot visible (its
  // slotIndex intact, since withdraw acts on it); chips and searches still
  // exclude it, mirroring the bag filter.
  const withGhost: BankSlotModel[] = [
    { slotIndex: 9, itemId: 'ghost', count: 1, showCount: false, qualityKey: 'common' },
    ...MODELS,
  ];

  it('keeps an unknown-id slot visible in the everything view, slotIndex intact', () => {
    const out = filterBankSlots(withGhost, lookup, state(), nameOf);
    expect(ids(out)).toEqual([
      'ghost',
      'potion',
      'blade',
      'keystone',
      'pelt',
      'relic',
      'helm',
      'rod',
    ]);
    expect(indices(out)[0]).toBe(9);
  });

  it('excludes an unknown-id slot from every category chip and from search', () => {
    for (const category of BAG_CATEGORIES) {
      if (category === 'all') continue;
      expect(
        ids(filterBankSlots(withGhost, lookup, state({ category }), nameOf)),
        category,
      ).not.toContain('ghost');
    }
    // The injected resolver falls back to the raw id, but search is a NAME
    // match: a query equal to the id must not surface the slot.
    expect(filterBankSlots(withGhost, lookup, state({ search: 'ghost' }), nameOf)).toEqual([]);
  });

  it('ranks an unknown-id slot below poor in the quality sort, never a throw', () => {
    // Prepended above, so landing LAST proves ranking, not stable-order luck;
    // before the guard this sort dereferenced the missing def through a
    // non-null assertion.
    const out = filterBankSlots(withGhost, lookup, state({ sort: 'quality' }), nameOf);
    expect(ids(out)[out.length - 1]).toBe('ghost');
    expect(ids(out).indexOf('pelt')).toBeLessThan(ids(out).indexOf('ghost'));
  });

  it('name-sorts an unknown-id slot by what the resolver returns for it (the raw id)', () => {
    const out = filterBankSlots(withGhost, lookup, state({ sort: 'name' }), nameOf);
    // Localized order with 'ghost' (raw id) collated in: Aardhelm, Bontvel,
    // ghost, Hengel, Mirakel, Relikwie, Sleutelsteen, Zwaard.
    expect(ids(out)).toEqual([
      'helm',
      'pelt',
      'ghost',
      'rod',
      'potion',
      'relic',
      'keystone',
      'blade',
    ]);
  });
});

// The "showing everything" predicate is the shared bagFilterIsDefault, consolidated
// into bag_filter.ts (one copy for bags and bank) and pinned in bag_filter.test.ts.
