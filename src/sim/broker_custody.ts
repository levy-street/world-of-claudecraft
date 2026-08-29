// The two broker-side custody moves for the server's $WOC marketplace: one
// exact copy leaving a player's bags into escrow, and an escrowed copy granted
// back. Both are compositions over leaves that own the real rules
// (inventory_extract.ts for extraction legality, bags.ts + item_instance_transfer.ts
// for the checked grant); the sim stays currency-blind, so what a broker does
// with the copy between the two moves is server business.
//
// `src/sim`-pure: no rng, no clock (enforced by tests/architecture.test.ts).

import { bagPools, canGrantCopies } from './bags';
import { ITEMS } from './data';
import { type ExtractOutcome, type ExtractRef, extractTradableCopy } from './inventory_extract';
import { grantCopies } from './item_instance_transfer';
import { forceDismount as forceDismountImpl, mountOwned } from './mounts';
import type { SimContext } from './sim_context';
import type { InvSlot } from './types';

// Exact-copy escrow extraction for a broker (the server's $WOC marketplace
// listing flow): one unit of the referenced slot leaves the bags, instance
// payload intact. The legality gates and the stale-reference checks live in
// the pure leaf (inventory_extract.ts); this is the thin facade delegate a
// foreign caller resolves, matching the inventory hub's shape. The sim stays
// currency-blind here: what the broker does with the copy is server business.
export function extractTradableCopyImpl(
  ctx: SimContext,
  pid: number | undefined,
  ref: ExtractRef,
): ExtractOutcome {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, reason: 'not_found' };
  const def = ITEMS[ref.itemId];
  const out = extractTradableCopy(r.meta.inventory, ref, def);
  if (out.ok) {
    ctx.onInventoryChangedForQuests(r.meta);
    // Ownership is derived from HOLDING the item (mountOwned reads the bags and
    // the bank), but a live ride is never re-validated once it has started. So
    // a seller who lists the mount they are riding would keep its speed for the
    // rest of the session while the buyer owned it. Dismount at the point
    // ownership actually ends.
    //
    // This was the only ownership-loss path when it was written, because reins
    // were soulbound and noDiscard. v0.35.0 un-soulbound the player reins, so
    // trade, mail and the guild bank can now move a mount too, and none of
    // those dismount the rider (social/trade.ts and mail/post_office.ts make no
    // mention of mountKey). That is a gap in those paths rather than this one,
    // and it is the same shape: the fix belongs at each point ownership ends.
    if (def?.kind === 'mount' && r.e.mountKey === def.mount && !mountOwned(r.meta, def.mount)) {
      forceDismountImpl(ctx, r.e);
    }
  }
  return out;
}

/**
 * The inverse of extractTradableCopy: put an escrowed copy back INTO a
 * player's bags, or refuse when it does not fit.
 *
 * Checked and granted in ONE call through the shared canGrantCopies /
 * grantCopies pair, deliberately. Splitting them across the seam is how the
 * overflow class in #2139 re-opens: a caller that pre-checks with a different
 * shape than it grants with (payload-blind, or missing the craftedRecipeId
 * that decides which stack a plain grant merges into) can see room the grant
 * cannot use, and overfill the recipient past the modelled cap.
 *
 * Returns whether the copy landed, so a broker holding the only copy can fall
 * back to a delivery it can still complete rather than dropping it.
 */
export function grantTradableCopyImpl(
  ctx: SimContext,
  pid: number | undefined,
  slot: InvSlot,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta } = r;
  if (
    !canGrantCopies(
      meta.inventory,
      bagPools(meta.bags),
      slot.itemId,
      slot.count,
      slot.instance,
      slot.craftedRecipeId,
    )
  ) {
    return false;
  }
  grantCopies(ctx, meta.entityId, slot.itemId, slot.count, slot.instance, slot.craftedRecipeId);
  return true;
}
