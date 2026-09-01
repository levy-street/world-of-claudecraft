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

export type PadReelLifecycle = 'idle' | 'waiting' | 'bite';

export type PadReelLifecycleEvent = {
  type:
    | 'fishingBite'
    | 'fishingResult'
    | 'fishingGotAway'
    | 'fishingEarlyReel'
    | 'fishingEmptyHook';
};

const TERMINAL_FISHING_EVENTS = new Set<PadReelLifecycleEvent['type']>([
  'fishingResult',
  'fishingGotAway',
  'fishingEarlyReel',
  'fishingEmptyHook',
]);

/** Fold the personal bite event into prompt state without inferring it from the hidden timer. */
export function reducePadReelLifecycle(
  current: PadReelLifecycle,
  castingAbility: string | null,
  events: readonly PadReelLifecycleEvent[],
): PadReelLifecycle {
  if (castingAbility !== FISHING_CAST_ID) return 'idle';
  let next: PadReelLifecycle = current === 'idle' ? 'waiting' : current;
  for (const event of events) {
    if (event.type === 'fishingBite') next = 'bite';
    else if (TERMINAL_FISHING_EVENTS.has(event.type)) next = 'idle';
  }
  return next;
}

function fishingImplementId(inventory: readonly InvSlot[]): string | null {
  for (const slot of inventory) {
    const use = ITEMS[slot.itemId]?.use;
    if (use === undefined) continue;
    if (use.type === 'fishing') return slot.itemId;
    if (use.type === 'gatherTool' && use.professionId === 'fishing') return slot.itemId;
  }
  return null;
}

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
  return fishingImplementId(inventory);
}

/** A truthful reel prompt appears only after the personal bite event opens the window. */
export function padReelPromptItemId(
  lifecycle: PadReelLifecycle,
  castingAbility: string | null,
  inventory: readonly InvSlot[],
): string | null {
  if (lifecycle !== 'bite' || castingAbility !== FISHING_CAST_ID) return null;
  return fishingImplementId(inventory);
}
