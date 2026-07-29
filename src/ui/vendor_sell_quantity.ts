import type { InvSlot } from '../sim/types';

/** Total copies of `itemId` held across every bag slot, not just the ONE slot the
 *  player shift-clicked. A stackable item's per-slot count is capped at its
 *  `stackSize` (commonly 20, see `sim/bags.ts` `stackSizeOf`), so a player holding
 *  more than one stack has the rest sitting in other slots. The sell-quantity
 *  prompt's cap must be the total held, or a custom amount above one slot's stack
 *  size (e.g. 100 when the player owns five stacks of 20) silently clamps down to
 *  whatever the clicked slot alone holds, never reaching what was actually typed.
 *  `Sim.sellItem` already walks every unbound stack (`removePreferFungible`) once
 *  asked for more than one slot's worth; only the UI-side cap was wrong. */
export function totalHeldCount(inventory: readonly InvSlot[], itemId: string): number {
  let total = 0;
  for (const slot of inventory) {
    if (slot.itemId === itemId) total += slot.count;
  }
  return total;
}
