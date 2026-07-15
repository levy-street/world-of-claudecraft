import type { InvSlot, ItemDef } from '../sim/types';

// Pure, DOM-free core for the modular bag filtering system. The HUD is a thin
// consumer: it owns the controls and the DOM, and calls applyBagFilter() to turn
// the raw inventory into the ordered, filtered list it paints. Keeping this
// host-agnostic lets tests drive it directly (tests/bag_filter.test.ts) without a
// browser, mirroring unit_portrait.ts / xp_bar.ts.

export const BAG_CATEGORIES = [
  'all',
  'weapon',
  'armor',
  'consumable',
  'material',
  'quest',
] as const;
export const BAG_SORTS = ['recent', 'quality', 'name'] as const;

export type BagCategory = (typeof BAG_CATEGORIES)[number];
export type BagSort = (typeof BAG_SORTS)[number];

export interface BagFilterState {
  category: BagCategory;
  sort: BagSort;
  search: string;
}

export const DEFAULT_BAG_FILTER: BagFilterState = { category: 'all', sort: 'recent', search: '' };

// True when the filter is showing everything (no category, no search), the only
// view where free-slot squares are meaningful (a narrowed view shows matches only;
// sort never affects it, a re-ordered full view still shows everything). Shared by
// the bags grid (bags_view) and the bank window, like matchesCategory/qualityRank.
export function bagFilterIsDefault(filter: BagFilterState): boolean {
  return filter.category === 'all' && filter.search.trim() === '';
}

// Whether the grid is showing the bag's REAL cells (the fixed squares a stack can be
// parked in), which is the only view where dragging a stack onto a square can mean "put
// it there". A category chip, a search, or a quality/name sort all turn the grid into a
// derived LIST: the squares there are just rows, they hold no position, so a drop is
// refused with a toast rather than moving something the player did not aim at.
export function bagOrderIsManual(filter: BagFilterState): boolean {
  return filter.sort === 'recent' && bagFilterIsDefault(filter);
}

// Look up an item definition by id. Injected so the pure core never imports the
// live ITEMS table (and tests can supply a synthetic one).
export type ItemLookup = (itemId: string) => ItemDef | undefined;

// Shared with the bank filter (bank_filter.ts): the bank reuses the same category
// predicate so a "material"/"weapon"/... chip means the same thing in both windows.
export function matchesCategory(item: ItemDef, category: BagCategory): boolean {
  switch (category) {
    case 'all':
      return true;
    case 'weapon':
      return item.kind === 'weapon';
    case 'armor':
      return item.kind === 'armor';
    case 'consumable':
      return (
        item.kind === 'food' ||
        item.kind === 'drink' ||
        item.kind === 'potion' ||
        item.kind === 'elixir'
      );
    case 'material':
      return item.kind === 'junk' || item.kind === 'tool';
    case 'quest':
      return item.kind === 'quest';
  }
}

// Lower rank sorts first, so a descending-quality view reads legendary -> poor.
// Mirrors the /bags chat-command ordering (sim.ts), extended with legendary.
const QUALITY_RANK: Record<string, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
  poor: 5,
};

// Shared with the bank filter (bank_filter.ts) so both windows sort quality identically.
export function qualityRank(item: ItemDef): number {
  return QUALITY_RANK[item.quality ?? 'common'] ?? QUALITY_RANK.common;
}

// Filter, then sort. Returns a new array; never mutates the input. Sorts are
// stable (Array.prototype.sort is spec-stable), so ties preserve insertion order
// and the 'recent' sort is simply the unsorted filtered list.
export function applyBagFilter(
  slots: readonly InvSlot[],
  lookup: ItemLookup,
  state: BagFilterState,
): InvSlot[] {
  const query = state.search.trim().toLowerCase();
  const filtered = slots.filter((slot) => {
    const item = lookup(slot.itemId);
    if (!item) return false;
    if (!matchesCategory(item, state.category)) return false;
    if (query && !item.name.toLowerCase().includes(query)) return false;
    return true;
  });
  if (state.sort === 'quality') {
    filtered.sort((a, b) => qualityRank(lookup(a.itemId)!) - qualityRank(lookup(b.itemId)!));
  } else if (state.sort === 'name') {
    filtered.sort((a, b) => lookup(a.itemId)!.name.localeCompare(lookup(b.itemId)!.name));
  }
  return filtered;
}

export function serializeBagFilter(state: BagFilterState): string {
  return JSON.stringify(state);
}

// Tolerant parse for persisted prefs: any malformed or out-of-range field falls
// back to its default, so a corrupt localStorage value can never break the bag.
export function parseBagFilter(raw: string | null | undefined): BagFilterState {
  if (!raw) return { ...DEFAULT_BAG_FILTER };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_BAG_FILTER };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_BAG_FILTER };
  const obj = parsed as Record<string, unknown>;
  const category = (BAG_CATEGORIES as readonly string[]).includes(obj.category as string)
    ? (obj.category as BagCategory)
    : DEFAULT_BAG_FILTER.category;
  const sort = (BAG_SORTS as readonly string[]).includes(obj.sort as string)
    ? (obj.sort as BagSort)
    : DEFAULT_BAG_FILTER.sort;
  const search = typeof obj.search === 'string' ? obj.search : DEFAULT_BAG_FILTER.search;
  return { category, sort, search };
}
