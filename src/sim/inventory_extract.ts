// Exact-copy escrow extraction: pull ONE unit of a specific inventory slot out
// of a player's bags so a broker (the $WOC marketplace listing flow on the
// server) can hold the copy while it is offered for sale. A pure leaf like
// bank.ts's moveBetweenContainers: no SimContext, no rng, no clock. The caller
// resolves the player, passes the live inventory array plus the item def, and
// owns persistence of the mutated inventory.
//
// Transfer legality is enforced HERE, at the moment the copy leaves the bags,
// mirroring the World Market (market.ts) and Ravenpost (mail/post_office.ts)
// gates. For instanced copies both bind-on-trade states are named, explicit
// refusals (bound_copy once the stamp has landed, bind_armed while it is still
// pending): docs/design/professions.md requires any instanced carriage to
// re-enforce that lock rather than inherit it emergently from fungible-only
// escrow.
//
// The reference is positional (array index) plus two liveness checks: the
// itemId must still match, and when the caller saw an instance payload it must
// still be structurally identical (expectInstance). A stale reference (the
// player moved or consumed the copy between seeing it and asking) refuses
// instead of extracting a different copy of the same item.

import { exchangeHardLock } from './exchange_eligibility';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import type { InvSlot, ItemDef, ItemInstancePayload } from './types';
import { cloneItemInstancePayload } from './types';

export type ExtractRefusal =
  | 'not_found' // no such slot, itemId mismatch, or unknown item def
  | 'stale_copy' // the slot's instance payload is not the one the caller saw
  | 'soulbound'
  | 'quest_item'
  | 'no_market_list'
  | 'bound_copy' // instance.boundTo set (the bind-on-trade stamp has landed)
  | 'bind_armed' // instance.bindOnTrade set, no stamp yet (it binds on hand-off)
  | 'locked'; // the owner's own item lock (issue 3042); they unlock it first

export type ExtractOutcome =
  | { ok: true; extracted: InvSlot }
  | { ok: false; reason: ExtractRefusal };

export interface ExtractRef {
  /** Index into the player's pooled inventory array (not the advisory bag cell). */
  index: number;
  /** The itemId the caller believes lives at that index. */
  itemId: string;
  /**
   * The instance payload the caller saw on the slot, or null for a plain
   * stack. Omit to skip the check (a caller that only just read the slot).
   */
  expectInstance?: ItemInstancePayload | null;
}

export function extractTradableCopy(
  inventory: InvSlot[],
  ref: ExtractRef,
  def: ItemDef | undefined,
): ExtractOutcome {
  if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= inventory.length) {
    return { ok: false, reason: 'not_found' };
  }
  const slot = inventory[ref.index];
  if (!slot || slot.itemId !== ref.itemId || slot.count < 1) {
    return { ok: false, reason: 'not_found' };
  }
  if (!def) return { ok: false, reason: 'not_found' };
  if (ref.expectInstance !== undefined) {
    const expected = ref.expectInstance === null ? undefined : ref.expectInstance;
    if (!itemInstancePayloadsEqual(slot.instance, expected)) {
      return { ok: false, reason: 'stale_copy' };
    }
  }
  // The shared lock predicate, not a fourth copy of these four checks: a mount
  // is soulbound by content design and a chroma plate is noMarketList, and both
  // trade on the Exchange, so a local copy here would refuse at the bags what
  // the server's policy had already cleared (see exchange_eligibility.ts).
  const lock = exchangeHardLock(def, slot.instance);
  if (lock) return { ok: false, reason: lock };
  // Exactly one unit leaves the bags. A surviving stack keeps the original
  // payload object and the extracted unit gets its own clone (the aliasing
  // rule at cloneItemInstancePayload in types.ts); the final unit of a
  // fully-consumed slot carries the original, matching Sim.removeItem. The
  // advisory bag cell stays behind: the copy is leaving the bags.
  const lastUnit = slot.count === 1;
  const extracted: InvSlot = {
    itemId: slot.itemId,
    count: 1,
    ...(slot.instance
      ? { instance: lastUnit ? slot.instance : cloneItemInstancePayload(slot.instance) }
      : {}),
    ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
  };
  if (lastUnit) inventory.splice(ref.index, 1);
  else slot.count -= 1;
  return { ok: true, extracted };
}
