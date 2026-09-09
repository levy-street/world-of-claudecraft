// Counting for OWNERSHIP-style collect objectives (QuestDef.keepsCollectedItems).
//
// A normal collect objective is a DELIVERY: the player carries the items to the
// turn-in NPC, who takes them. `ctx.countItem` scans the bags only, which is
// exactly right for delivery.
//
// An ownership objective asks a different question: does the player own this
// thing at all? The tutorial island's Pouch and Purse is the first, and it is
// the case quest_item_presence.ts's KNOWN-UNCOVERED note anticipated: the quest
// tells the player to buy a Linen Pouch AND buckle it on, and equipBag parks
// the item id in meta.bags, out of the inventory `countItem` reads. Counting
// carried copies alone meant the objective ticked to 1 on purchase and back to
// 0 the moment the player followed the very next instruction, so the quest
// could never be handed in by anyone who did as they were told.
//
// Worn equipment and bag SOCKETS count too, not bank or mail: ownership
// objectives ask what the player has with them. Forgebreaker's follow-up must
// remain complete when its crafter equips the hammer before returning to Maelin.
//
// Pure and host-agnostic (no ctx, no rng): the caller passes the carried count
// it already computed, so this stays a total, not a second source of truth.

import type { PlayerMeta } from '../sim';

/** Carried copies plus worn equipment and bag sockets. */
export function ownedItemCount(carried: number, meta: PlayerMeta, itemId: string): number {
  let worn = 0;
  for (const socket of meta.bags) if (socket === itemId) worn++;
  for (const equipped of Object.values(meta.equipment)) if (equipped === itemId) worn++;
  return carried + worn;
}
