// The reward-list ids the inventory hub credits as a currency counter rather
// than stacking into the bags: Heroic Marks (heroic_marks.ts) and Lantern Seals
// (lantern_seals.ts). The bag capacity gates (bags.ts) treat them as costing no
// space, and grantPlainStack (inventory_grant.ts) routes them here.
//
// `src/sim`-pure (no DOM/Three, no wall-clock, draws no rng).

import { HEROIC_MARK_CURRENCY_ID } from './content/dungeon_difficulty';
import { LANTERN_SEAL_ITEM_ID } from './content/guild_contracts';
import { creditHeroicMarks } from './heroic_marks';
import { creditLanternSeals } from './lantern_seals';

/** True for a reward-list id the hub credits as currency rather than an item. */
export function isCurrencyGrantId(itemId: string): boolean {
  return itemId === HEROIC_MARK_CURRENCY_ID || itemId === LANTERN_SEAL_ITEM_ID;
}

/** Credit a currency grant id onto its counter (no-op for any other id). */
export function creditCurrencyGrant(
  holder: { heroicMarks?: number; lanternSeals?: number },
  itemId: string,
  count: number,
): void {
  if (itemId === HEROIC_MARK_CURRENCY_ID) creditHeroicMarks(holder, count);
  else if (itemId === LANTERN_SEAL_ITEM_ID) creditLanternSeals(holder, count);
}
