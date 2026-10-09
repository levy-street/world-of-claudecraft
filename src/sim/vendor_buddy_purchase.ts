// Companion offers use the ordinary vendor's validated stock, range and price,
// but grant the collection reward directly instead of allocating an inventory slot.
import { grantBuddy } from './buddies';
import { buddyDef } from './content/buddies';
import { ITEMS, NPCS } from './data';
import type { SimContext } from './sim_context';
import { dist2d, INTERACT_RANGE, type ItemDef } from './types';
import {
  bulkBuyQuantity,
  buyPurchaseTotals,
  sanitizeBuyCount,
  type VendorBuyOptions,
  vendorCountForced,
} from './vendor_buy_stack';

/** Returns true for a handled buddy offer, including refusals. The caller has
 * already validated the merchant, living buyer, count and available currencies. */
export function buyBuddyOffer(
  ctx: SimContext,
  pid: number,
  item: ItemDef,
  copperCost: number,
  honorCost: number,
): boolean {
  if (item.kind !== 'buddy') return false;
  const meta = ctx.players.get(pid);
  const buddy = buddyDef(item.buddy);
  if (!meta || !buddy) {
    ctx.error(pid, 'That item is not for sale.');
    return true;
  }
  if (meta.buddies.owned.has(buddy.key) || meta.buddies.pending.some((p) => p.key === buddy.key)) {
    ctx.error(pid, 'You already have that companion.');
    return true;
  }
  // The raid reveal ends at this same grant: permanent ownership, reveal event
  // and an immediately summoned follower. No bag-space check or token is needed.
  if (!grantBuddy(ctx, pid, buddy.key)) return true;
  meta.copper -= copperCost;
  meta.honor -= honorCost;
  ctx.emit({ type: 'vendor', action: 'buy', itemId: item.id, pid });
  return true;
}

/** Cheap admission before the online host acquires database locks. This never
 * mutates state; buyItem must still revalidate after the asynchronous boundary. */
export function canBuyBuddyOffer(
  ctx: SimContext,
  pid: number,
  npcId: number,
  itemId: string,
  opts?: VendorBuyOptions,
): boolean {
  const buyer = ctx.resolve(pid);
  const npc = ctx.entities.get(npcId);
  const item = ITEMS[itemId];
  if (!buyer || npc?.kind !== 'npc' || !npc.vendorItems.includes(itemId) || item?.kind !== 'buddy')
    return false;
  const { meta, e: player } = buyer;
  const buddy = buddyDef(item.buddy);
  if (!buddy || player.dead || dist2d(player.pos, npc.pos) > INTERACT_RANGE + 2) return false;
  if (
    meta.buddies.owned.has(buddy.key) ||
    meta.buddies.pending.some((pending) => pending.key === buddy.key)
  )
    return false;
  const quest = NPCS[npc.templateId ?? '']?.vendorQuestGates?.[itemId];
  if (quest && !meta.questLog.has(quest) && !meta.questsDone.has(quest)) return false;
  const bulk = opts?.bulk === true;
  const count = sanitizeBuyCount(bulk ? undefined : opts?.count);
  if (count === null) return false;
  const copper =
    item.buyValue !== undefined && Number.isFinite(item.buyValue) && item.buyValue > 0
      ? item.buyValue
      : 0;
  const honor =
    item.priceHonor !== undefined && Number.isFinite(item.priceHonor) && item.priceHonor > 0
      ? Math.floor(item.priceHonor)
      : 0;
  const free = ctx.devCommands && npc.devVendor === true;
  if (!free && copper === 0 && honor === 0) return false;
  const bulkEligible = bulk && copper > 0 && honor === 0 && !item.soulbound;
  const totals = bulkEligible
    ? {
        copper: free ? 0 : copper * Math.max(1, bulkBuyQuantity(item, copper, meta.copper)),
        honor: free ? 0 : honor,
      }
    : buyPurchaseTotals(
        item,
        free ? 0 : copper,
        free ? 0 : honor,
        vendorCountForced(item) ? 1 : count,
      );
  return totals !== null && meta.copper >= totals.copper && meta.honor >= totals.honor;
}
