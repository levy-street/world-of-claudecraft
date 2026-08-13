// Player-controlled per-item lock (issue 3042): an item the owner has locked
// refuses salvage, profession-craft reagent consumption, and vendor sell
// (single and bulk) until unlocked again. An optional safety mark the player
// toggles themself, distinct from the def-level noVendorSell/noDiscard
// content flags (items.ts) and the per-copy transfer lock the anonymous
// exchange pipes enforce (item_instance_transfer.ts isTransferLockedInstance,
// keyed on boundTo/bindOnTrade): those are content/trade rules nobody
// chooses, this is nothing but the owner's own choice, so it lives on the
// SAME optional ItemInstancePayload every other per-copy fact rides (types.ts),
// which is what carries it through save/load and the online wire for free.
//
// Behind the SimContext seam (see src/sim/CLAUDE.md): a new self-contained
// system, its own sibling module, no state of its own beyond the payload
// field.
//
// `src/sim`-pure: no DOM/render/ui/game/net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Draws no rng.

import { bagCapacity, canGrantItemInstance } from './bags';
import { selectedInventorySlot } from './item_copy_ref';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { InvSlot, ItemInstancePayload } from './types';

export interface SetItemLockedResult {
  ok: boolean;
  itemId: string;
  locked: boolean;
  reason?: 'not_held' | 'no_bag_space';
}

/** True when this copy is locked by its owner against salvage, profession
 *  craft consumption, and vendor sell. A plain (no payload) copy, or one
 *  whose payload never had the flag set, is never locked. */
export function isItemLocked(instance: ItemInstancePayload | undefined): boolean {
  return instance?.locked === true;
}

/** Units of `itemId` held in `meta`'s bags that are NOT locked: the gate every
 *  disposal boundary (salvage, craft reagent consumption, vendor sell) checks
 *  sufficiency against instead of the raw held count. Absent meta (a
 *  decoupled test ctx) holds nothing. */
export function countUnlockedItem(meta: PlayerMeta | undefined, itemId: string): number {
  if (!meta) return 0;
  let n = 0;
  for (const s of meta.inventory) {
    if (s.itemId === itemId && !isItemLocked(s.instance)) n += s.count;
  }
  return n;
}

/** Same read, over an arbitrary `InvSlot[]` (a scratch capacity-simulation
 *  copy, or `meta.inventory` itself): the #2350 capacity gate has to make the
 *  identical availability decision on a scratch array before the real
 *  removal runs on the live one, so both share this rather than drifting
 *  (material_grades.ts planGradeRemoval's own `available` callback shape). */
export function countUnlockedInSlots(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const s of inventory) {
    if (s.itemId === itemId && !isItemLocked(s.instance)) n += s.count;
  }
  return n;
}

/** Lock-aware removal mirroring the Sim inventory hub's removeItem walk
 *  (highest bag index first) but SKIPPING any locked slot entirely: a locked
 *  copy is never a valid removal victim, so unlike removePreferFungible's
 *  `skip` predicate (which only spares a copy when a preferred one exists)
 *  this never falls through to a locked slot even as a last resort. Used on
 *  an arbitrary `InvSlot[]`: the real removal (a live `meta.inventory`) and
 *  the #2350 capacity scratch simulation share this one walk so the two can
 *  never disagree about which slots free up. */
export function removeUnlockedFromSlots(inventory: InvSlot[], itemId: string, count: number): void {
  let remaining = count;
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || isItemLocked(s.instance)) continue;
    const take = Math.min(s.count, remaining);
    s.count -= take;
    remaining -= take;
    if (s.count <= 0) inventory.splice(i, 1);
  }
}

/** The command body: lock or unlock the ONE bag copy the caller named. Mirrors
 *  the mutate-in-place recipe item_copy_ref.ts documents (rift forge/enchant
 *  apply): resolve the named slot WITHOUT consuming, refuse before anything
 *  mutates. Always requires a `slotIndex` (an id-only call is ambiguous
 *  the moment two copies of one item exist, and every caller here is a bag
 *  cell the player clicked, which always knows its own index).
 *
 *  Locking a copy out of a STACKABLE slot (count > 1) splits one unit into
 *  its own fresh slot rather than tainting the whole stack (a locked payload
 *  is never mergeable, item_instance_merge.ts isMergeableInstancePayload), so
 *  it needs one free bag slot; refuses `no_bag_space` rather than silently
 *  locking the wrong quantity. Unlocking never needs capacity: it only ever
 *  shrinks a payload, never grows the slot count. */
export function setItemLocked(
  ctx: SimContext,
  itemId: string,
  locked: boolean,
  pid?: number,
  slotIndex?: number,
): SetItemLockedResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, itemId, locked, reason: 'not_held' };
  const { meta } = r;
  const selected = selectedInventorySlot(meta.inventory, itemId, slotIndex);
  if (!selected) return { ok: false, itemId, locked, reason: 'not_held' };
  if (isItemLocked(selected.instance) === locked) return { ok: true, itemId, locked };
  if (selected.count > 1) {
    const nextInstance: ItemInstancePayload = { ...selected.instance, locked };
    if (!canGrantItemInstance(meta.inventory, bagCapacity(meta.bags), itemId, nextInstance)) {
      return { ok: false, itemId, locked, reason: 'no_bag_space' };
    }
    selected.count -= 1;
    meta.inventory.push({
      itemId,
      count: 1,
      instance: nextInstance,
      ...(selected.craftedRecipeId === undefined
        ? {}
        : { craftedRecipeId: selected.craftedRecipeId }),
    });
    ctx.onInventoryChangedForQuests?.(meta);
    return { ok: true, itemId, locked };
  }
  if (!locked && selected.instance) {
    const { locked: _drop, ...rest } = selected.instance;
    selected.instance = Object.keys(rest).length > 0 ? rest : undefined;
  } else {
    selected.instance = { ...selected.instance, locked };
  }
  ctx.onInventoryChangedForQuests?.(meta);
  return { ok: true, itemId, locked };
}
