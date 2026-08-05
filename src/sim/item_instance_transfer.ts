// Instanced-transfer rules for the exchange pipes OUTSIDE the face-to-face
// trade: World Market listings and Ravenpost mail (the #1165 completion).
// The one per-copy lock rule is shared here so the two pipes can never
// drift: an ARMED copy (bindOnTrade, not yet stamped) or a bound copy
// (boundTo) never rides an anonymous pipe where no stamp can land (a
// bind-on-trade windfall is not resellable or mail-launderable). trade.ts
// keeps its own per-copy lock, isTradeLocked (boundTo only), so an armed
// copy may still trade in person, where the stamp lands on the recipient.
// trade.ts also carries a def-level exclusion of its own (RIFT_GEAR_ITEMS);
// the pipes cover that family through each pipe's def-level rules instead
// (every rift gear def carries noMarketList).
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Pure bookkeeping, zero draws.

import { sanitizeItemInstancePayloadOnLoad } from './item_instance_load';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { cloneItemInstancePayload, type InvSlot, type ItemInstancePayload } from './types';

/** True when this copy is locked out of the anonymous exchange pipes (market
 *  listing, mail attachment): armed (bindOnTrade) or bound (boundTo). The
 *  def-level rules (soulbound/quest/noMarketList) stay with each pipe; this is
 *  only the per-copy lock. A plain copy is never locked. */
export function isTransferLockedInstance(instance: ItemInstancePayload | undefined): boolean {
  return (
    instance !== undefined && (instance.bindOnTrade === true || instance.boundTo !== undefined)
  );
}

/** The public display projection of a payload, for wire surfaces other players
 *  see (market browse rows, letter attachment chips). The allowlist is the eqi
 *  wire's (server/game.ts identityFields): signer, enchant, rolled, and nothing
 *  else, so boundTo / bindOnTrade / charges are excluded BY CONSTRUCTION, as is
 *  any future non-cosmetic field. Deep-copies the mutable rolled maps so a
 *  projection never aliases the live escrowed payload. */
export function publicInstanceView(instance: ItemInstancePayload): ItemInstancePayload {
  const pub: ItemInstancePayload = {};
  if (instance.signer !== undefined) pub.signer = instance.signer;
  if (instance.enchant !== undefined) pub.enchant = instance.enchant;
  if (instance.rolled !== undefined) {
    pub.rolled = {
      ...instance.rolled,
      ...(instance.rolled.stats && { stats: { ...instance.rolled.stats } }),
    };
  }
  return pub;
}

/** How many held units of `itemId` carry a payload structurally equal to
 *  `instance` AND are not transfer-locked. The escrow validation count: the
 *  client names a copy by its payload (never by index, so a bag reshuffle
 *  between staging and submit cannot redirect the escrow), and byte-equal
 *  copies are interchangeable by definition. */
export function countMatchingUnlocked(
  meta: PlayerMeta,
  itemId: string,
  instance: ItemInstancePayload,
): number {
  let n = 0;
  for (const s of meta.inventory ?? []) {
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance)) continue;
    if (itemInstancePayloadsEqual(s.instance, instance)) n += s.count;
  }
  return n;
}

/** True when the player holds at least one transfer-LOCKED copy whose payload
 *  equals `instance`: the caller distinguishes "that copy is bound" from "you
 *  do not have that copy" in its denial. */
export function holdsMatchingLocked(
  meta: PlayerMeta,
  itemId: string,
  instance: ItemInstancePayload,
): boolean {
  for (const s of meta.inventory ?? []) {
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance) && itemInstancePayloadsEqual(s.instance, instance))
      return true;
  }
  return false;
}

/** Escrow removal for one instanced unit: consumes the highest-index unlocked
 *  copy whose payload equals `instance` (removeItem's walk order) and returns
 *  the SLOT'S OWN payload, never the caller's needle, so a wire-supplied
 *  selector can never mint state: what enters escrow is exactly what left the
 *  bags. Clone-on-survival per removeItem's contract: the final unit of a
 *  fully-consumed slot returns the original object (its slot is gone), a
 *  surviving stack's payload is deep-cloned out. Returns null (and removes
 *  nothing) when no matching unlocked copy is held. Fires the same
 *  post-removal quest hook the inventory hub fires. */
export function removeMatchingInstance(
  ctx: SimContext,
  itemId: string,
  instance: ItemInstancePayload,
  pid?: number,
): ItemInstancePayload | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta } = r;
  // `?? []`: same decoupled-test-ctx contract as the two counters above.
  const inventory = meta.inventory ?? [];
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance)) continue;
    if (!itemInstancePayloadsEqual(s.instance, instance)) continue;
    const consumed = s.count === 1 ? s.instance : cloneItemInstancePayload(s.instance);
    s.count -= 1;
    if (s.count <= 0) inventory.splice(i, 1);
    ctx.onInventoryChangedForQuests?.(meta);
    return consumed;
  }
  return null;
}

/** The ONE grant the exchange pipes share (market buy/cancel/collect, mail
 *  claim), payload-aware on both arms: an instanced copy routes through
 *  addItemInstance so its payload survives (merging only byte-equal), a plain
 *  count through addItem. The instanced arm always grants a DEEP CLONE:
 *  addItemInstance parks the caller's object in the first bag slot, and while
 *  every current source row is destroyed after the grant, a surviving source
 *  (a future instanced house listing, which never depletes) must never alias
 *  one payload object into every buyer's bags. Capacity is the caller's
 *  pre-check (bags.ts canGrantCopies, this function's twin).
 *
 *  `craftedRecipeId` (bags.ts InvSlot.craftedRecipeId, professions/crafting.ts)
 *  is the PLAIN-STACK provenance marker, orthogonal to `instance`: a row on
 *  the market/mail book carries one or the other, never both (an instanced
 *  copy is escrowed through marketListInstance/its own pipe; a plain crafted
 *  stack through marketList/mailSendResolved). It is a no-op on the instanced
 *  arm and threaded into the plain grant otherwise, so a market/mail round
 *  trip never launders a crafted item's provenance and reopens the disenchant
 *  anti-farming gate (professions/enchanting.ts isCraftedDisenchantVictim). */
export function grantCopies(
  ctx: SimContext,
  pid: number,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): void {
  if (instance) ctx.addItemInstance(itemId, cloneItemInstancePayload(instance), pid, count);
  else ctx.addItem(itemId, count, pid, { craftedRecipeId });
}

/** Rebuild a persisted exchange-escrow slot (market collection item, mail
 *  attachment): unknown ids stay dormant recoverable data, counts clamp to
 *  what identical-payload merges could legitimately have built (the character
 *  load's instancedCountCap rule), and payloads deep-clone so a loaded book
 *  never aliases the raw save object. `cap` is instancedCountCap(def, instance)
 *  from bags.ts, passed in so this module stays free of the ITEMS table. */
export function sanitizeEscrowSlot(raw: InvSlot, cap: number, dropped?: string[]): InvSlot {
  const count = Math.min(Math.max(1, raw.count | 0), cap);
  if (!raw.instance || typeof raw.instance !== 'object') {
    return { itemId: raw.itemId, count };
  }
  // The SAME load-side payload bound the four character-blob containers take
  // (item_instance_load.ts), on the clone this function owns: the phase 18
  // whole-branch review found the two persisted escrow books (mail
  // attachments, market listings and collections) were the only load arms
  // outside it, and unlike a character blob these rows can persist forever
  // with no later login to self-heal them. The bound also catches the
  // clone-mangled array case (typeof [] is 'object', so the guard above
  // passes an array into the spread, and the numeric-key arm drops the
  // junk whole). `dropped` aggregates for the caller's one-per-book log.
  const clone = cloneItemInstancePayload(raw.instance);
  const { payload, dropped: drops } = sanitizeItemInstancePayloadOnLoad(clone);
  if (dropped) for (const d of drops) dropped.push(`${raw.itemId}.${d}`);
  if (!payload) return { itemId: raw.itemId, count };
  return { itemId: raw.itemId, count, instance: payload };
}
