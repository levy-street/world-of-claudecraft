// Pure, DOM-free core for the mobile consumables quick bar: turns the raw
// inventory into the ordered, capped list of consumable item ids whose slots
// the bar paints (through the shared action_bar_view core, which derives the
// per-slot count / potion-cooldown / usable state itself). Touch has no way to
// drag an item onto the hotbar, so unlike the desktop bar this list is
// AUTO-POPULATED from what the player is carrying: zero setup, the bag's
// "Consumables" category made castable. Host-agnostic (a Vitest drives it
// directly); registered in tests/architecture.test.ts UI_PURE_CORES.

import type { InvSlot, ItemDef } from '../../../sim/types';

/** Slot buttons the quick bar renders; both game shells ship this many. */
export const CONSUMABLE_BAR_SLOTS = 6;

// Combat-priority order: what a player reaches for mid-fight comes first, so
// the capped row never buries a potion behind a stack of picnic food.
export const CONSUMABLE_KIND_ORDER = ['potion', 'elixir', 'food', 'drink'] as const;

export type ConsumableLookup = (itemId: string) => ItemDef | undefined;

/**
 * Fill `out` with the item ids the quick bar shows, in render order:
 * potions, then elixirs, then food, then drink; id-sorted within a kind so the
 * row stays visually stable while stacks merge, split, or shuffle bag order.
 * Multiple stacks of one item collapse to a single slot (the shared bar core
 * sums the count across stacks). Mutates and returns `out` (allocation-light:
 * per-frame callers reuse one array, matching the action_bar_view contract).
 */
export function consumableBarItems(
  inventory: readonly Pick<InvSlot, 'itemId'>[],
  lookup: ConsumableLookup,
  out: string[],
  cap = CONSUMABLE_BAR_SLOTS,
): string[] {
  out.length = 0;
  for (const kind of CONSUMABLE_KIND_ORDER) {
    const segStart = out.length;
    for (const slot of inventory) {
      const def = lookup(slot.itemId);
      if (!def || def.kind !== kind) continue;
      let seen = false;
      for (let i = segStart; i < out.length; i++) {
        if (out[i] === slot.itemId) {
          seen = true;
          break;
        }
      }
      if (seen) continue;
      // Insertion-sort the new id into its kind segment (no splice: splice
      // allocates its removed-elements array even when removing nothing).
      out.push(slot.itemId);
      for (let i = out.length - 1; i > segStart && out[i - 1] > out[i]; i--) {
        const tmp = out[i - 1];
        out[i - 1] = out[i];
        out[i] = tmp;
      }
    }
  }
  if (out.length > cap) out.length = cap;
  return out;
}
