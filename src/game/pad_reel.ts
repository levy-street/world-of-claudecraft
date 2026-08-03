// The pad reel (the UX pass): while the local player is mid fishing cast,
// the controller's interact press IS the reel. Before this, a pad angler had
// to flip into the virtual-cursor mode and click the rod in the bags row
// inside the reel window, while the B button's game-mode meaning (interact)
// ran a nearby-interaction scan that answered "nothing to interact" over a
// live bobber. The sim already treats a rod re-use during the session as the
// reel press (startFishing's armed-window arm) and stays authoritative about
// the timing, so the client decision here is only WHICH item to re-use.

import { ITEMS } from '../sim/data';
import { FISHING_CAST_ID, type InvSlot } from '../sim/types';

/**
 * The rod item id an interact press should re-use to answer the bite, or
 * null when the press is a plain interact: no live fishing cast, or no
 * fishing implement carried (unreachable inside a legal session, where the
 * cast required one; fail-safe for a stale mirror). The FIRST implement in
 * bag order is enough: the reel judges timing, never the rod, and the
 * session's rod gate was resolved at cast time. Pure decision, so the
 * dispatch stays a thin consumer.
 */
export function padReelItemId(
  castingAbility: string | null,
  inventory: readonly InvSlot[],
): string | null {
  if (castingAbility !== FISHING_CAST_ID) return null;
  for (const slot of inventory) {
    const use = ITEMS[slot.itemId]?.use;
    if (use === undefined) continue;
    if (use.type === 'fishing') return slot.itemId;
    if (use.type === 'gatherTool' && use.professionId === 'fishing') return slot.itemId;
  }
  return null;
}
