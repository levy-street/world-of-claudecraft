// The action-bar state of a trinket placed on a slot. A trinket is used where it
// is worn, never from the bags (src/sim/items.ts useItem routes the worn copy to
// combat/trinkets.ts useWornTrinket), so its slot reads the equipment instead of
// the bag count: usable while it is the worn trinket, dimmed otherwise (still in
// the bags, or gone), with the swipe driven by its own use cooldown, which rides
// the player's cooldown map under trinketCooldownKey (mirrored to the client in
// the `cds` snapshot map like an ability's). Pure; registered in
// tests/architecture.test.ts UI_PURE_CORES and driven directly by
// tests/trinket_slot_core.test.ts.

import { trinketCooldownKey, trinketSpec } from '../../../sim/content/trinkets';

export interface TrinketSlotState {
  /** The player wears this trinket, so a press can use it. */
  worn: boolean;
  /** Seconds until the use is ready again (0 when ready). */
  cooldownRemaining: number;
  /** The swipe's full length: the trinket's cooldown, or the remaining time if
   *  that is ever longer, so the swipe never overflows. */
  cooldownTotal: number;
}

/** Whether an item id is a trinket with a use effect (placeable on the bar). */
export function isUsableTrinketId(itemId: string): boolean {
  return trinketSpec(itemId) !== undefined;
}

/** The slot state for a trinket, or null when the item is not a usable trinket
 *  (the ordinary item-slot rules apply). */
export function trinketSlotState(
  itemId: string,
  wornTrinketId: string | null | undefined,
  cooldowns: { get(id: string): number | undefined },
): TrinketSlotState | null {
  const spec = trinketSpec(itemId);
  if (!spec) return null;
  const remaining = Math.max(0, cooldowns.get(trinketCooldownKey(itemId)) ?? 0);
  return {
    worn: wornTrinketId === itemId,
    cooldownRemaining: remaining,
    cooldownTotal: remaining > 0 ? Math.max(spec.cooldown, remaining) : 0,
  };
}
