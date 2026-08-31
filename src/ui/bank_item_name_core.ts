// The name a BANK cell shows, for the surfaces that must agree with it.
//
// The bank's search and its name-sort both run over this string, so all three
// (the label the player reads, what typing finds, and where the sort files it)
// come from one rule instead of three. Before this rule was shared, search and
// sort read the def's display name while the cell painted the copy's CHOSEN
// name, so a legendary the player had renamed was findable in their own bank
// only under a def name nothing on screen displayed any more.
//
// The rule itself is not this module's to invent: it is worn_item_cell_view's
// `wornItemCellParts`, the one item-cell authority every owned-item surface
// paints from. This only picks the NAME off it and answers the unknown-def
// case, which is the stale-client guard the bank grid already applies (a cell
// whose id resolves to no def renders the raw id, so search and sort have to
// use the raw id too or they would file a visible cell under an invisible
// name).
//
// It takes the SLOT rather than an item id on purpose: a chosen name belongs to
// a COPY, so two cells of one item id can legitimately show different names and
// an id-keyed resolver could only ever answer for one of them.
//
// LANGUAGE-DEPENDENT BY DESIGN, and the reason this is stated rather than
// assumed: `wornItemCellParts` falls through to `itemDisplayName`, which
// resolves against the ACTIVE locale catalog. So this is pure over (def,
// instance, active language), not over (def, instance), and a caller that
// memoizes the result owes the language a place in its cache key. Its test
// drives a real locale switch for the same reason: pinned against English
// alone it would pass while the localized path rotted.
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { wornItemCellParts } from './worn_item_cell_view';

/** The slot shape this reads: what the bank grid model carries per cell. */
export interface BankNamedSlot {
  itemId: string;
  instance?: ItemInstancePayload;
}

/** The name `slot`'s cell shows: the copy's chosen name when it has one, else
 *  the def's localized display name, else (no def) the raw id the cell paints. */
export function bankSlotDisplayName(item: ItemDef | undefined, slot: BankNamedSlot): string {
  if (!item) return slot.itemId;
  return wornItemCellParts(item, slot.instance).name;
}
