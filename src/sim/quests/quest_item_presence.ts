// Where a quest-required item still counts as HELD for the accept-time
// re-grant (finalizeQuestAccept -> questFallbackGrants).
//
// The fallback grant exists so a LOST prerequisite item can never permanently
// block a quest. `ctx.countItem` scans bags only, and bags-only was the
// starter-tool mint (items.ts, the tier-1 tool comment block): bank the tool,
// or leave it escrowed on the market or unclaimed in the mailbox, abandon,
// re-accept, and the fallback hands over another copy every time. Each place
// this predicate adds is one the player can recover the item FROM by
// themselves (bank withdrawal, listing reclaim, mailTake). The mail read
// counts IN-FLIGHT letters too (mailTake requires delivery), a deliberate
// asymmetry: during the delivery window the copy is neither retrievable nor
// re-grantable, which errs toward no duplicate.
//
// KNOWN-UNCOVERED stores, deliberately: the vendor buy-back list, the
// expired-listing market collection (an expired listing is spliced OUT of
// marketListings before the player claims it), equipment slots, and the bag
// sockets (equipBag parks the item id in meta.bags, recoverable through
// unequipBag). None is reachable today, and each is fenced by its own gate:
// buy-back and the collection by the quest-kind/noVendorSell/noMarketList
// flags every requiredItems item carries, the equipment slots by equipItem's
// slot-plus-kind gate, and the bag sockets by equipBag's bag-kind gate. The
// sweep in tests/professions_starter_tools.test.ts pins ALL of those item
// properties for every requiredItems quest, so a future quest requiring an
// item any of the four stores could hold must widen this predicate first.
// Today only the bags and bank arms can fire for live content; mail and
// escrow are the defense in depth for that future.
//
// A traded-away copy is genuinely gone and DOES re-grant: direct trade stays
// an open transfer route by ruling (R10). The quest cadence bounds only the
// turn-in loop, so the trade route's real bound is the granted items' zero
// value, not this predicate.
//
// The narrow Pick keeps the read surface explicit and the unit tests honest:
// a fake ctx implements exactly these four members and nothing else.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
export type QuestItemPresenceCtx = Pick<
  SimContext,
  'countItem' | 'mailboxHoldsItem' | 'marketListings' | 'marketListingBelongsTo'
>;

export function playerHoldsQuestItem(
  ctx: QuestItemPresenceCtx,
  meta: PlayerMeta,
  itemId: string,
): boolean {
  if (ctx.countItem(itemId, meta.entityId) > 0) return true;
  if (meta.bank.inventory.some((s) => s.itemId === itemId && s.count > 0)) return true;
  if (ctx.mailboxHoldsItem(meta, itemId)) return true;
  return ctx.marketListings.some(
    (l) => l.itemId === itemId && l.count > 0 && ctx.marketListingBelongsTo(l, meta),
  );
}
