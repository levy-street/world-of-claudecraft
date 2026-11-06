// Tabs, search and slot headings for the vendor window's goods list: the bag
// window's organisation carried over to shops (the inventory UX research).
//
// It reuses the bags' own vocabulary rather than minting a shop dialect: the
// category predicate (bag_filter.ts matchesCategory), the rail order and chip
// labels (BAG_CATEGORIES, bag_category_labels.ts), and the slot caption groups
// (bag_sections_core.ts bagSlotGroup). So "Armor" in a shop means exactly what
// it means in the bags and the bank, and a shop's Helmet heading is the bags'.
//
// Three shop-specific rules:
// - Only the tabs a shop can fill are offered (a baker shows no Weapons tab),
//   and none at all when the whole stock is one kind. Favorites and Junk never
//   apply to goods on a counter, so they are never offered.
// - The search box appears only for a stock long enough to need it.
// - Slot headings appear when the visible rows are all gear spread over two or
//   more slots (an armorer, or the Armor tab of a quartermaster).
//
// DOM-free and i18n-free (the name resolver is injected, so search matches the
// localized name the row shows). Registered in tests/architecture.test.ts
// UI_PURE_CORES.

import { BAG_CATEGORIES, type BagCategory, matchesCategory } from '../../bag_filter';
import { BAG_SLOT_GROUPS, type BagSlotGroup, bagSlotGroup } from '../../bag_sections_core';
import type { VendorGoodsRow } from './vendor_view';

/** The search box shows at this many goods or more. Below it every row fits on
 *  screen and a box would only crowd the counter. */
export const VENDOR_SEARCH_MIN_GOODS = 12;

/** Tabs a shop can ever offer: the bag rail minus the copy-only tabs. */
const SHOP_CATEGORIES: readonly BagCategory[] = BAG_CATEGORIES.filter(
  (c) => c !== 'favourite' && c !== 'junk',
);

export interface VendorGoodsFilter {
  category: BagCategory;
  search: string;
}

export const DEFAULT_VENDOR_GOODS_FILTER: VendorGoodsFilter = { category: 'all', search: '' };

/** Whether a goods row belongs under `category`. A riding lesson is filed with
 *  the mounts it serves (its def is a tool-kind token, which would otherwise
 *  list "Riding Training" under Tools and give a stablemaster a tab row). */
export function vendorRowMatches(row: VendorGoodsRow, category: BagCategory): boolean {
  if (row.ridingRank) return category === 'all' || category === 'mount';
  return matchesCategory(row.item, category);
}

/** The tabs this stock can fill, All first, in the bag rail's order. Empty when
 *  the whole stock is one kind (or less), where a tab row would only repeat All. */
export function vendorGoodsTabs(goods: readonly VendorGoodsRow[]): BagCategory[] {
  const present = SHOP_CATEGORIES.filter(
    (c) => c !== 'all' && goods.some((g) => vendorRowMatches(g, c)),
  );
  return present.length >= 2 ? ['all', ...present] : [];
}

/** Whether this stock is long enough to get a search box. */
export function vendorGoodsSearchable(goods: readonly VendorGoodsRow[]): boolean {
  return goods.length >= VENDOR_SEARCH_MIN_GOODS;
}

/** One painted entry: a slot heading, or a goods row (the painter adds its
 *  Buy Stack tile after it, as before). */
export type VendorGoodsEntry =
  | { kind: 'caption'; group: BagSlotGroup }
  | { kind: 'row'; row: VendorGoodsRow };

/**
 * The goods the window paints for `filter`, headings included. A tab the stock
 * no longer fills (the stock changed under a remembered tab) falls back to All,
 * and so does a search on a stock too short to show the box, so a filter the
 * player cannot see can never hide goods. Rows keep the vendor's own order
 * inside each heading.
 */
export function buildVendorGoodsEntries(
  goods: readonly VendorGoodsRow[],
  filter: VendorGoodsFilter,
  nameOf: (row: VendorGoodsRow) => string,
): VendorGoodsEntry[] {
  const tabs = vendorGoodsTabs(goods);
  const category: BagCategory = tabs.includes(filter.category) ? filter.category : 'all';
  const query = vendorGoodsSearchable(goods) ? filter.search.trim().toLowerCase() : '';
  const visible = goods.filter(
    (g) =>
      vendorRowMatches(g, category) && (query === '' || nameOf(g).toLowerCase().includes(query)),
  );
  const groups = visible.map((g) => (g.ridingRank ? null : bagSlotGroup(g.item)));
  const distinct = new Set(groups);
  const caption = !distinct.has(null) && distinct.size >= 2;
  if (!caption) return visible.map((row) => ({ kind: 'row', row }));
  const entries: VendorGoodsEntry[] = [];
  for (const group of BAG_SLOT_GROUPS) {
    if (!distinct.has(group)) continue;
    entries.push({ kind: 'caption', group });
    visible.forEach((row, i) => {
      if (groups[i] === group) entries.push({ kind: 'row', row });
    });
  }
  return entries;
}

/** The tab actually in force for `filter` (the same fallback the entries use),
 *  so the painter presses the chip that matches what is listed. */
export function effectiveVendorTab(
  goods: readonly VendorGoodsRow[],
  filter: VendorGoodsFilter,
): BagCategory {
  return vendorGoodsTabs(goods).includes(filter.category) ? filter.category : 'all';
}
