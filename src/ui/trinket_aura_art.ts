// Trinket auras wear their trinket's own icon. Every aura a trinket applies (the
// wearer's buffs and counters, the ally's shield or heal, the enemy's bleed or
// brand) maps to the item that applied it through TRINKET_AURA_ITEM
// (src/sim/content/trinkets.ts), and paints that item's bag and paperdoll WebP
// (public/ui/items/<itemId>.webp). icons.ts folds this map into its exact aura
// art registry, so the shared aura resolver (aura_icon_view.ts) answers the
// aura's own id and every aura surface (buff bar, target frame, party strips,
// nameplates, aura tracks) shows the same icon. Pure data, no DOM.
// Pinned by tests/trinket_aura_tooltip.test.ts.

import { TRINKET_AURA_ITEM } from '../sim/content/trinkets';

/** The item icon directory the bags and paperdoll read (icons.ts itemImageUrl). */
const ITEM_ICON_DIR = '/ui/items';

/** Aura id to the trinket item's icon URL. */
export const TRINKET_AURA_IMAGE_URLS: ReadonlyMap<string, string> = new Map(
  Object.entries(TRINKET_AURA_ITEM).map(([auraId, itemId]) => [
    auraId,
    `${ITEM_ICON_DIR}/${itemId}.webp`,
  ]),
);
