import { isMaterialItem } from '../sim/material_taxonomy';
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
  'tool',
  'quest',
  'mount',
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

// Total stack count of quest items in the bag: sum of slot.count for every
// stack whose def is kind==='quest'. Prefer stack count (how many quest pieces
// the player holds) over unique-stack count so a "Boar Hide x5" chip reads 5,
// matching the bag cell badge and tracker progress. Unknown/missing defs and
// non-quest kinds contribute 0. Used by the Quest filter chip count badge.
export function bagQuestItemCount(inventory: readonly InvSlot[], lookup: ItemLookup): number {
  let total = 0;
  for (const slot of inventory) {
    const item = lookup(slot.itemId);
    if (item?.kind !== 'quest') continue;
    total += Math.max(0, Math.floor(slot.count));
  }
  return total;
}

// Look up an item definition by id. Injected for the kind/name/quality arms so
// tests can supply a synthetic table; the 'material' arm is the one exception,
// answering from content-derived set membership on the def's id
// (src/sim/material_taxonomy.ts), so a material fixture must carry a REAL
// catalog id no matter what table the caller injects.
export type ItemLookup = (itemId: string) => ItemDef | undefined;

// Shared with the bank filter (bank_filter.ts): the bank reuses the same category
// predicate so a "material"/"weapon"/... chip means the same thing in both windows.
// 'material' is the honest derived taxonomy (src/sim/material_taxonomy.ts), not a
// kind test: grey vendor trash and the unclassified trophies match only 'all', and
// the implements/charms/cosmetic tokens the old junk-or-tool predicate swept in
// live under the 'tool' chip instead.
export function matchesCategory(item: ItemDef, category: BagCategory): boolean {
  switch (category) {
    case 'all':
      return true;
    case 'weapon':
      return item.kind === 'weapon';
    case 'armor':
      return item.kind === 'armor' || item.kind === 'held_offhand';
    case 'consumable':
      return (
        item.kind === 'food' ||
        item.kind === 'drink' ||
        item.kind === 'potion' ||
        item.kind === 'elixir'
      );
    case 'material':
      return isMaterialItem(item);
    case 'tool':
      return item.kind === 'tool';
    case 'quest':
      return item.kind === 'quest';
    case 'mount':
      return item.kind === 'mount';
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

// Where a slot with no resolvable def sorts in a quality view: below poor, so
// server-truth ids this bundle predates (R34) gather at the end rather than
// interleaving with known items. Shared with bank_filter.ts like qualityRank.
export const UNKNOWN_QUALITY_RANK = QUALITY_RANK.poor + 1;

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
    // Stale-client guard (R34): a slot whose id this bundle predates stays
    // VISIBLE in the everything view (it occupies a real, counted bag slot;
    // dropping it here is how a stack turns invisible), but a category chip
    // or a name search excludes it, because with no def there is no kind to
    // classify and no name to match.
    if (!item) return state.category === 'all' && !query;
    if (!matchesCategory(item, state.category)) return false;
    if (query && !item.name.toLowerCase().includes(query)) return false;
    return true;
  });
  // Sort keys tolerate the unknown-def slots the 'all' view now keeps: they
  // rank below poor and name-sort by their raw id.
  if (state.sort === 'quality') {
    const rank = (slot: InvSlot) => {
      const item = lookup(slot.itemId);
      return item ? qualityRank(item) : UNKNOWN_QUALITY_RANK;
    };
    filtered.sort((a, b) => rank(a) - rank(b));
  } else if (state.sort === 'name') {
    const name = (slot: InvSlot) => lookup(slot.itemId)?.name ?? slot.itemId;
    filtered.sort((a, b) => name(a).localeCompare(name(b)));
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
