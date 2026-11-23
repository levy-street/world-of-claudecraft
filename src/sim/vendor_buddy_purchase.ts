// Honor companion offers unlock the collection directly, without bag items.
import { grantBuddy } from './buddies';
import { buddyVendorOffer } from './content/buddy_offers';
import { NPCS } from './data';
import type { SimContext } from './sim_context';
import { dist2d, INTERACT_RANGE } from './types';
import { sanitizeBuyCount, type VendorBuyOptions } from './vendor_buy_stack';

function purchaseError(
  ctx: SimContext,
  pid: number,
  npcId: number,
  offerId: string,
  opts?: VendorBuyOptions,
): string | null {
  const buyer = ctx.resolve(pid);
  const npc = ctx.entities.get(npcId);
  const offer = buddyVendorOffer(offerId);
  if (!buyer || npc?.kind !== 'npc' || !NPCS[npc.templateId ?? '']?.warfareVendor || !offer)
    return 'That item is not sold here.';
  const { meta, e: player } = buyer;
  if (player.dead) return "You can't do that while dead.";
  if (dist2d(player.pos, npc.pos) > INTERACT_RANGE + 2) return 'Too far away.';
  if (sanitizeBuyCount(opts?.bulk === true ? undefined : opts?.count) === null)
    return 'That item is not for sale.';
  if (
    meta.buddies.owned.has(offer.buddy) ||
    meta.buddies.pending.some((p) => p.key === offer.buddy)
  )
    return 'You already have that companion.';
  if (meta.honor < offer.priceHonor) return 'Not enough honor.';
  return null;
}

/** Admission before database locks. Revalidated after the asynchronous boundary. */
export function canBuyBuddyOffer(
  ctx: SimContext,
  pid: number,
  npcId: number,
  offerId: string,
  opts?: VendorBuyOptions,
): boolean {
  return purchaseError(ctx, pid, npcId, offerId, opts) === null;
}

/** True means this collection offer was handled, including a refusal. */
export function buyBuddyOffer(
  ctx: SimContext,
  pid: number,
  npcId: number,
  offerId: string,
  opts?: VendorBuyOptions,
): boolean {
  const offer = buddyVendorOffer(offerId);
  if (!offer) return false;
  const error = purchaseError(ctx, pid, npcId, offerId, opts);
  if (error) {
    ctx.error(pid, error);
    return true;
  }
  if (grantBuddy(ctx, pid, offer.buddy)) {
    ctx.players.get(pid)!.honor -= offer.priceHonor;
    ctx.emit({ type: 'vendor', action: 'buy', pid });
  }
  return true;
}
