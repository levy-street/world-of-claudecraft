import { countRawInSlots } from '../sim/item_lock';
import type { InvSlot } from '../sim/types';

/** Total copies of `itemId` held across every bag slot, not just the ONE slot the
 *  player shift-clicked. A stackable item's per-slot count is capped at its
 *  `stackSize` (commonly 20, see `sim/bags.ts` `stackSizeOf`), so a player holding
 *  more than one stack has the rest sitting in other slots. The sell-quantity
 *  prompt's cap must be the total held, or a custom amount above one slot's stack
 *  size (e.g. 100 when the player owns five stacks of 20) silently clamps down to
 *  whatever the clicked slot alone holds, never reaching what was actually typed.
 *  `Sim.sellItem` already walks every unbound stack (`removePreferFungible`) once
 *  asked for more than one slot's worth; only the UI-side cap was wrong. A thin
 *  domain alias over the shared sim walk (item_lock.ts countRawInSlots). */
export function totalHeldCount(inventory: readonly InvSlot[], itemId: string): number {
  return countRawInSlots(inventory, itemId);
}
