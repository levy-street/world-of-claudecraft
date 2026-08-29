// Two-pool container capacity math: a GENERAL pool (the base slots plus every
// unrestricted bag's bagSlots) and a MATERIALS pool (the bagSlots of every
// materialsOnly bag, usable only by items in the honest material taxonomy).
// A non-material item must fit in the general pool alone; a material item may
// occupy either pool; and while every pool is within budget, a FIT answer
// never lets total occupancy exceed general plus materials. A tolerated
// over-capacity state is the exception, not a violation: with the general
// pool already over budget (a shrink-guard swap, a legacy save), the free
// materials headroom is still granted to materials, so total occupancy can
// legitimately sit past the summed budget. Nothing is lost either way.
//
// ALLOCATION RULE (deterministic, pinned by tests/bag_pools.test.ts): material
// stacks pack into the MATERIALS pool FIRST and spill into the general pool
// only once the materials pool is full. The packing is recomputed from the
// whole slot list at every check; slots have no sticky pool assignment (the
// inventory stays one flat pooled list, classic-style), so freeing a
// materials-pool slot automatically migrates a spilled material back. The rule
// decides whether a later non-material pickup fits: packing materials into the
// materials pool first maximizes general-pool headroom, so a materials-only
// bag never crowds out a non-material pickup that would have fit without it.
//
// Over-capacity is TOLERATED, never repaired: a slot list that already
// exceeds a pool's budget (a pre-bag save, an unequipped materials bag, a
// shrunk budget) reports zero free slots for the affected pool and blocks new
// adds there; nothing is ever destroyed, dropped, or migrated by this module.
//
// CONTAINER-AGNOSTIC by design: the core takes a base slot budget plus a bag
// id list and answers pool arithmetic. It never assumes the carried backpack,
// BACKPACK_SLOTS, or PlayerMeta.bags, so phase 06 can reuse it unchanged for
// the bank (a socketed materials-only satchel adds materials-pool bank
// capacity). What counts as a material arrives as an injected predicate; the
// carried-bag consumer (bags.ts) wires the derived taxonomy set via
// material_ids.ts, and NOTHING here approximates the classification with an
// item kind (kind 'junk' over-includes the settlement's exclusions).
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, and no import of
// material_taxonomy.ts (the module-evaluation cycle rule; the scan lives in
// tests/material_taxonomy.test.ts). This module draws NO rng.

import { ITEMS } from './data';
import type { InvSlot, ItemDef } from './types';

/** A container's slot budget split into its two pools. */
export interface PoolCapacity {
  /** Base slots plus every unrestricted bag's bagSlots. */
  general: number;
  /** Every materialsOnly bag's bagSlots; only materials may occupy these. */
  materials: number;
}

/** True when `def` is a materials-only bag: its bagSlots feed the materials
 *  pool instead of the general pool. */
export function isMaterialsOnlyBag(def: ItemDef | undefined): boolean {
  return def?.kind === 'bag' && def.materialsOnly === true;
}

/** Extra slots a bag item grants when equipped (0 for a non-bag). Lives here,
 *  beside the pool split that consumes it, so the per-bag slot answer has ONE
 *  definition; bags.ts re-exports it for the carried-inventory consumers. */
export function bagSlotsOf(def: ItemDef | undefined): number {
  return def?.kind === 'bag' ? (def.bagSlots ?? 0) : 0;
}

/** Split a container's slot budget into pools: `baseSlots` plus every
 *  unrestricted equipped bag feed the general pool, every materialsOnly bag
 *  feeds the materials pool. Container-agnostic: the carried inventory passes
 *  BACKPACK_SLOTS, the phase 06 bank passes its own base budget. */
export function poolCapacityOf(baseSlots: number, bags: readonly (string | null)[]): PoolCapacity {
  let general = baseSlots;
  let materials = 0;
  for (const id of bags) {
    if (!id) continue;
    const def = ITEMS[id];
    const slots = bagSlotsOf(def);
    if (isMaterialsOnlyBag(def)) materials += slots;
    else general += slots;
  }
  return { general, materials };
}

/** The two pools' occupancy under the materials-first allocation rule above:
 *  material slots fill the materials pool, the spill joins the non-material
 *  slots in the general pool. Either pool may exceed its budget (tolerated
 *  over-capacity); free-slot math clamps at zero, it never repairs. */
export function poolOccupancyOf(
  slots: readonly InvSlot[],
  pools: PoolCapacity,
  isMaterial: (itemId: string) => boolean,
): { generalUsed: number; materialsUsed: number } {
  let materialSlots = 0;
  for (const s of slots) if (isMaterial(s.itemId)) materialSlots++;
  const nonMaterialSlots = slots.length - materialSlots;
  const materialsUsed = Math.min(materialSlots, pools.materials);
  return { generalUsed: nonMaterialSlots + (materialSlots - materialsUsed), materialsUsed };
}

/** Free slots available to a fresh stack of `itemId`: a non-material may only
 *  take general-pool headroom; a material takes materials-pool headroom first,
 *  then whatever the general pool still has. This is the ONE free-slot answer
 *  every fit gate consumes (bags.ts countFit and everything routed through
 *  it), so a pre-check can never disagree with the grant it gates (#2139). */
export function freePoolSlots(
  slots: readonly InvSlot[],
  pools: PoolCapacity,
  itemId: string,
  isMaterial: (itemId: string) => boolean,
): number {
  const { generalUsed, materialsUsed } = poolOccupancyOf(slots, pools, isMaterial);
  const generalFree = Math.max(0, pools.general - generalUsed);
  if (!isMaterial(itemId)) return generalFree;
  return Math.max(0, pools.materials - materialsUsed) + generalFree;
}

/** The container's total slot budget, both pools summed: the number the
 *  equip/unequip shrink guards and the HUD's used/total readout consume.
 *  Deliberately NOT a fit answer (a non-material can be refused while total
 *  headroom remains); fit questions go through freePoolSlots. */
export function totalPoolCapacity(pools: PoolCapacity): number {
  return pools.general + pools.materials;
}

/** The split for a container with NO materials pool: everything is general.
 *  The guild bank passes its flat capacity through this (its own pinned
 *  single-pool model); the personal bank moved to the socket-derived split
 *  (bank.ts bankPools) in phase 06, and bank_view.ts's offline precheck
 *  moved to the wire-fed split (bankPoolsOf) in phase 07, so the guild bank
 *  (src/sim/guild_bank.ts) is the remaining deliberate single-pool caller.
 *  Every call site of this helper is a deliberate, grep-able "single pool
 *  for now" marker rather than a silent scalar. */
export function generalOnlyPools(capacity: number): PoolCapacity {
  return { general: capacity, materials: 0 };
}
