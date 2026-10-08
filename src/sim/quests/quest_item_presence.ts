// Where a quest-required item still counts as HELD for the accept-time
// re-grant (finalizeQuestAccept -> questFallbackGrants).
//
// The fallback grant exists so a LOST prerequisite item can never permanently
// block a quest. `ctx.countItem` scans bags only, and bags-only was the
// starter-tool mint (items.ts, the tier-1 tool comment block): bank the tool,
// or leave it escrowed on the market or unclaimed in the mailbox, abandon,
// re-accept, and the fallback hands over another copy every time. Each place
// this predicate adds is one the player can recover the item FROM by
// themselves (bank withdrawal, Materials Vault withdrawal, listing reclaim,
// mailTake). The vault arm cannot fire for live content today (no
// requiredItems quest names a material), but the vault is a self-recoverable
// store, so it joins the predicate rather than the uncovered list below the
// day it lands. The mail read
// counts IN-FLIGHT letters too (mailTake requires delivery), a deliberate
// asymmetry: during the delivery window the copy is neither retrievable nor
// re-grantable, which errs toward no duplicate.
//
// EQUIPMENT SLOTS are covered, and that arm is not defense in depth: it fires for live
// content today. The world boss's Shardpike (`skerrits_shardpike`) is the first required
// item that is meant to be WIELDED, so the slot gate that used to fence this store does not
// apply to it, and without the arm below a player holding the pike in hand read as not
// holding it at all: abandon, re-accept, and the fallback mints a second one. This is exactly
// the widening the comment block used to merely predict.
//
// KNOWN-UNCOVERED stores, deliberately: the vendor buy-back list, the
// expired-listing market collection (an expired listing is spliced OUT of
// marketListings before the player claims it), and the bag sockets (equipBag
// parks the item id in meta.bags, recoverable through unequipBag). Neither is
// reachable today, and each is fenced by its own gate: buy-back and the
// collection by the quest-kind/noVendorSell/noMarketList flags every
// requiredItems item carries, and the bag sockets by equipBag's bag-kind gate.
// The sweep in tests/professions_starter_tools.test.ts pins those item
// properties for every requiredItems quest, so a future quest requiring an
// item either store could hold must widen this predicate first.
//
// A traded-away copy is genuinely gone and DOES re-grant: direct trade stays
// an open transfer route by ruling (R10). The quest cadence bounds only the
// turn-in loop, so the trade route's real bound is the granted items' zero
// value, not this predicate.
//
// The narrow Pick keeps the read surface explicit and the unit tests honest:
// a fake ctx implements exactly these four members and nothing else. The
// equipment arm needs no ctx member at all: the worn set lives on the meta.
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
  // A hostile itemId ('toString') reads an inherited function here; NaN
  // comparisons make that arm false, so no Object.hasOwn dance is needed.
  if ((meta.vault.stock[itemId] ?? 0) > 0) return true;
  if (meta.vault.special.some((slot) => slot.itemId === itemId && slot.count > 0)) return true;
  // Worn counts as held. Object.values over the paperdoll rather than a slot list: a new
  // equip slot must not silently fall out of this scan.
  // `?? {}` rather than a bare read: this runs inside the accept path, and a meta shape
  // narrower than the full paperdoll (a fixture, a partially restored character) must degrade
  // to "not worn" instead of throwing where a quest is being handed over.
  if (Object.values(meta.equipment ?? {}).some((worn) => worn === itemId)) return true;
  if (ctx.mailboxHoldsItem(meta, itemId)) return true;
  return ctx.marketListings.some(
    (l) => l.itemId === itemId && l.count > 0 && ctx.marketListingBelongsTo(l, meta),
  );
}
