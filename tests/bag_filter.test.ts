import { describe, expect, it } from 'vitest';
// Aliased: this file declares a small synthetic ITEMS table for the filter
// arms, so the real merged catalog (needed for the reachability census) comes
// in renamed.
import { ITEMS as REAL_ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  applyBagFilter,
  BAG_CATEGORIES,
  type BagFilterState,
  bagFilterIsDefault,
  bagOrderIsManual,
  bagQuestItemCount,
  DEFAULT_BAG_FILTER,
  matchesCategory,
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
  // A REAL catalog id: the material chip is honest-taxonomy set membership
  // (src/sim/material_taxonomy.ts), so a synthetic id can never match it.
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', kind: 'junk', quality: 'common' },
  // Its REAL fine grade (MATERIAL_GRADES links the pair), for the grade-family
  // grouping arm of the quality view.
  fine_iron_ore: { id: 'fine_iron_ore', name: 'Fine Iron Ore', kind: 'junk', quality: 'common' },
  // A REAL material whose name sorts BETWEEN 'Fine Iron Ore' and 'Iron Ore',
  // so the grade-family arm is decisive: a plain name order would interleave it.
  goldleaf_herb: { id: 'goldleaf_herb', name: 'Goldleaf Herb', kind: 'junk', quality: 'common' },
  keystone: { id: 'keystone', name: 'Crypt Keystone', kind: 'quest', quality: 'common' },
  relic: { id: 'relic', name: 'Ancient Relic', kind: 'armor', slot: 'chest', quality: 'legendary' },
  reins: {
    id: 'reins',
    name: 'Reins of the Valorsteed',
    kind: 'mount',
    mount: 'valorsteed',
    quality: 'common',
  },
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

describe('applyBagFilter: category filtering', () => {
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

  it('keeps only honest materials: grey junk and tools no longer match the chip', () => {
    // The material chip narrowed from junk-or-tool to the derived taxonomy
    // (phase 19): the real material matches; the grey pelt and the tool are
    // out (the tool moves to its own chip below).
    const inv: InvSlot[] = [
      { itemId: 'pelt', count: 5 },
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'rod', count: 1 },
      { itemId: 'blade', count: 1 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'material', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['iron_ore']);
  });

  it('keeps only tools under the tool chip (the displaced implements)', () => {
    const inv: InvSlot[] = [
      { itemId: 'pelt', count: 5 },
      { itemId: 'iron_ore', count: 2 },
      { itemId: 'rod', count: 1 },
      { itemId: 'blade', count: 1 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'tool', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['rod']);
  });

  it('keeps only quest items', () => {
    const out = applyBagFilter(INV, lookup, { category: 'quest', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['keystone']);
  });

  it('keeps only mounts (reins items)', () => {
    // A local inventory so the shared INV-based order/quality/name assertions
    // above stay stable; only this case exercises the mount category.
    const inv: InvSlot[] = [
      { itemId: 'blade', count: 1 },
      { itemId: 'reins', count: 1 },
      { itemId: 'potion', count: 1 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'mount', sort: 'recent', search: '' });
    expect(ids(out)).toEqual(['reins']);
  });

  it('keeps an unknown-id slot visible in the everything view (stale-client guard, R34)', () => {
    // Inventory is server truth: a bundle one deploy behind the server can
    // hold ids it predates, and each one still occupies a real, counted bag
    // slot. Dropping it from the everything view is how a counted slot turns
    // invisible, the exact failure the phase 11 guard removes.
    const inv: InvSlot[] = [...INV, { itemId: 'ghost', count: 1 }];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'recent', search: '' });
    expect(ids(out)).toEqual([...ids(INV), 'ghost']);
  });

  it('excludes an unknown-id slot from every category chip and from a name search', () => {
    // With no def there is no kind to classify and no display name to match;
    // only the everything view keeps the slot. The search arm also proves a
    // query does not match the raw id (a player searches names, not ids).
    const inv: InvSlot[] = [...INV, { itemId: 'ghost', count: 1 }];
    for (const category of BAG_CATEGORIES) {
      if (category === 'all') continue;
      const out = applyBagFilter(inv, lookup, { category, sort: 'recent', search: '' });
      expect(ids(out), category).not.toContain('ghost');
    }
    const searched = applyBagFilter(inv, lookup, {
      category: 'all',
      sort: 'recent',
      search: 'ghost',
    });
    expect(ids(searched)).not.toContain('ghost');
  });
});

describe('applyBagFilter: search', () => {
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

describe('applyBagFilter: sorting', () => {
  it('sorts by quality descending (legendary first, poor last), ties on the clean-up ladder', () => {
    // Within a quality band the order is the canonical clean-up ladder
    // (weapons, consumables, food, tools, quest), not insertion order: the
    // common band here reads dagger, potion, bread, rod, keystone.
    const out = applyBagFilter(INV, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(out)).toEqual([
      'relic',
      'helm',
      'blade',
      'dagger',
      'potion',
      'bread',
      'rod',
      'keystone',
      'pelt',
    ]);
  });

  it('quality view keeps every stack of an item adjacent (the scattered-stacks report)', () => {
    const inv: InvSlot[] = [
      { itemId: 'iron_ore', count: 20 },
      { itemId: 'bread', count: 2 },
      { itemId: 'iron_ore', count: 7 },
      { itemId: 'potion', count: 1 },
      { itemId: 'iron_ore', count: 12 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(out)).toEqual(['potion', 'bread', 'iron_ore', 'iron_ore', 'iron_ore']);
    // Fuller stacks lead within the item.
    expect(out.slice(2).map((s) => s.count)).toEqual([20, 12, 7]);
  });

  it('quality view seats a fine material grade beside its base grade, fine first', () => {
    // iron_ore has a real MATERIAL_GRADES row (fine_iron_ore); both grades are
    // quality common, so only the grade family, never quality, can group them.
    // Goldleaf Herb alphabetizes between the two grade NAMES, so a plain name
    // order would read fine_iron_ore, goldleaf_herb, iron_ore: the family key
    // is what pulls the grades together past it.
    const inv: InvSlot[] = [
      { itemId: 'iron_ore', count: 9 },
      { itemId: 'bread', count: 1 },
      { itemId: 'goldleaf_herb', count: 4 },
      { itemId: 'fine_iron_ore', count: 3 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(out)).toEqual(['bread', 'goldleaf_herb', 'fine_iron_ore', 'iron_ore']);
  });

  it('name view breaks a same-name tie with the ladder (fuller stacks first)', () => {
    const inv: InvSlot[] = [
      { itemId: 'iron_ore', count: 7 },
      { itemId: 'iron_ore', count: 20 },
    ];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'name', search: '' });
    expect(out.map((s) => s.count)).toEqual([20, 7]);
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

  it('ranks an unknown-id slot below poor in the quality sort, never a throw', () => {
    // The unknown slot is prepended so landing LAST proves ranking, not
    // stable-order luck; before the guard this sort dereferenced the missing
    // def through a non-null assertion.
    const inv: InvSlot[] = [{ itemId: 'ghost', count: 1 }, ...INV];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'quality', search: '' });
    expect(ids(out)).toEqual([
      'relic',
      'helm',
      'blade',
      'dagger',
      'potion',
      'bread',
      'rod',
      'keystone',
      'pelt',
      'ghost',
    ]);
  });

  it('name-sorts an unknown-id slot by its raw id', () => {
    const inv: InvSlot[] = [{ itemId: 'ghost', count: 1 }, ...INV];
    const out = applyBagFilter(inv, lookup, { category: 'all', sort: 'name', search: '' });
    expect(ids(out)).toEqual([
      'relic',
      'bread',
      'keystone',
      'rod',
      'ghost',
      'helm',
      'potion',
      'blade',
      'dagger',
      'pelt',
    ]);
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

  it('includes the mounts category', () => {
    expect(BAG_CATEGORIES).toContain('mount');
  });

  it('pins the whole chip row, in order', () => {
    expect([...BAG_CATEGORIES]).toEqual([
      'all',
      'weapon',
      'armor',
      'consumable',
      'material',
      'tool',
      'quest',
      'mount',
    ]);
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

describe('bagQuestItemCount (Quest chip badge metric)', () => {
  // Metric lock (Phase 3): total STACK COUNT of quest pieces, not unique stack
  // count. "Boar Hide x5" + "Fang x1" reads 6 on the chip, matching cell badges
  // and tracker progress. Unknown defs contribute 0.
  it('sums stack counts of kind===quest items only', () => {
    const inv: InvSlot[] = [
      { itemId: 'blade', count: 1 },
      { itemId: 'keystone', count: 1 },
      { itemId: 'potion', count: 3 },
    ];
    expect(bagQuestItemCount(inv, lookup)).toBe(1);
  });

  it('sums multi-count quest stacks (prefer total pieces over unique stacks)', () => {
    // Two quest stacks: keystone x1 and a second keystone stack x4 = 5 pieces.
    // Unique-stack count would wrongly report 2.
    const inv: InvSlot[] = [
      { itemId: 'keystone', count: 1 },
      { itemId: 'blade', count: 1 },
      { itemId: 'keystone', count: 4 },
    ];
    expect(bagQuestItemCount(inv, lookup)).toBe(5);
  });

  it('returns 0 when the bag holds no quest items', () => {
    const inv: InvSlot[] = [
      { itemId: 'blade', count: 1 },
      { itemId: 'potion', count: 2 },
    ];
    expect(bagQuestItemCount(inv, lookup)).toBe(0);
    expect(bagQuestItemCount([], lookup)).toBe(0);
  });

  it('ignores unknown-def slots and floors fractional counts', () => {
    const inv: InvSlot[] = [
      { itemId: 'ghost', count: 9 },
      { itemId: 'keystone', count: 2.7 },
    ];
    expect(bagQuestItemCount(inv, lookup)).toBe(2);
  });

  it('clamps negative stack counts to zero (never shrinks the badge)', () => {
    const inv: InvSlot[] = [
      { itemId: 'keystone', count: -3 },
      { itemId: 'keystone', count: 2 },
    ];
    expect(bagQuestItemCount(inv, lookup)).toBe(2);
  });
});

describe('chip reachability census: the All-only set, pinned', () => {
  // The market pins "no item reachable only through All" as a doctrine
  // (tests/market_filters.test.ts); the bags/bank chips deliberately do NOT
  // carry it: the 2026-08-01 settlement ruled grey trash and the five trophy
  // oddments out of every chip (Q3/Q4), and the six bag-kind items matched no
  // chip before the narrowing either. This census makes the ruling
  // enforceable: a chip or taxonomy edit that strands MORE items (or quietly
  // rescues one the settlement excluded) reds an exact-set diff naming it.
  const ALL_ONLY = [
    'amber_hide',
    'bandit_bandana',
    'bogiron_nugget',
    'briny_idol',
    'chipped_tusk',
    'cracked_fetish',
    'cracked_ogre_tusk',
    'cracked_wyrm_scale',
    'deepfen_pearl',
    'emberwing_cinderscale',
    'frayed_prayer_beads',
    'gleamstag_charm',
    'gravewoven_bag',
    'guardian_core',
    'inert_storm_shard',
    'last_keep_signet',
    'linen_pouch',
    'mistcallers_duffel',
    'moonpale_scale',
    'mudfin_scale',
    'ogre_toe_ring',
    'old_cragmaws_pelt',
    'pale_pearl',
    'silkspun_satchel',
    'soft_down',
    'soggy_boot',
    'soggy_moccasin',
    'stag_antler',
    'tallow_candle',
    'tangled_weed',
    'travelers_knapsack',
    'wolfhide_satchel',
  ] as const;

  it('exactly the ruled 26 junk items plus the 6 bag-kind items match no chip', () => {
    const allOnly = Object.values(REAL_ITEMS)
      .filter((def) => !BAG_CATEGORIES.some((c) => c !== 'all' && matchesCategory(def, c)))
      .map((d) => d.id)
      .sort();
    expect(allOnly).toEqual([...ALL_ONLY]);
  });
});
