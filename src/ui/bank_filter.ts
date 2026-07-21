// Pure, DOM/i18n-free core for the Bank window's search / category / sort, the
// sibling of bag_filter.ts. The bank reuses the bag filter's shared vocabulary
// (BAG_CATEGORIES / BAG_SORTS / BagFilterState and the tolerant serialize/parse),
// so the persisted state shape is identical; only the localStorage KEY differs
// ('woc_bank_filter' in the consumer, bank_window.ts), keeping the two windows'
// preferences independent. This module adds the ONE bank-specific piece: filtering
// the bank's own BankSlotModel[] (which carries an explicit slotIndex that must
// survive filter + sort) and matching / sorting on the LOCALIZED item name via an
// injected resolver (the bank searches the displayed name, unlike bags which
// matches the raw English item.name today; that divergence is intentional).
//
// Bare-named like bag_filter.ts, so it escapes the architecture.test.ts *_view /
// *_core on-disk sweep and needs no UI_PURE_CORES registration (verified against
// the sweep's /_(?:view|core)\.ts$/ regex + the BARE_NAMED forward-completeness
// cross-check, which only lists REGISTERED bare cores).

import { type BagFilterState, type ItemLookup, matchesCategory, qualityRank } from './bag_filter';
import type { BankSlotModel } from './bank_view';

// Resolve an item id to its localized display name (itemDisplayName in the painter).
// Injected so the pure core never imports the i18n/entity layer; the bank matches
// and sorts on this string so search and the name-sort agree with what the player sees.
export type BankNameResolver = (itemId: string) => string;

// Filter, then sort a bank grid model. Returns a NEW array; never mutates the input.
// slotIndex is preserved verbatim through both filter and sort (it is the exact
// bankWithdraw/bankDeposit wire argument, so a filtered/sorted cell must still act on
// its ORIGINAL slot). Unknown-id slots (a dormant/tampered save whose itemId is not in
// the table) are EXCLUDED from every filtered view, mirroring bag_filter's
// applyBagFilter (which drops a slot when the lookup misses) and the bank painter's
// own fillGrid, which already skips an unknown id; they never carry a category or a
// name to match. Sorts are stable (spec-stable Array.prototype.sort), so 'recent' is
// simply the unsorted filtered list in original slot order.
export function filterBankSlots(
  models: readonly BankSlotModel[],
  lookup: ItemLookup,
  state: BagFilterState,
  nameOf: BankNameResolver,
): BankSlotModel[] {
  const query = state.search.trim().toLowerCase();
  const filtered = models.filter((m) => {
    const item = lookup(m.itemId);
    if (!item) return false;
    if (!matchesCategory(item, state.category)) return false;
    if (query && !nameOf(m.itemId).toLowerCase().includes(query)) return false;
    return true;
  });
  if (state.sort === 'quality') {
    filtered.sort((a, b) => qualityRank(lookup(a.itemId)!) - qualityRank(lookup(b.itemId)!));
  } else if (state.sort === 'name') {
    filtered.sort((a, b) => nameOf(a.itemId).localeCompare(nameOf(b.itemId)));
  }
  return filtered;
}

// The "is the filter showing everything" predicate is the shared bagFilterIsDefault
// in bag_filter.ts (one copy for bags and bank, like matchesCategory/qualityRank).
