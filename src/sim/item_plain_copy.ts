// The "least special copy first" read for the destroy-victim walks (the
// disenchant and sunder preference, professions/enchanting.ts
// consumePreferredDisenchantVictim). Before item tracking, a plain copy was a
// slot with NO payload; now every epic or legendary copy carries a guid and a
// provenance record (item_tracking.ts) from the moment it is minted, so no
// copy of such an item is ever payload-free. The tracked identity says who
// holds the copy and where it came from, never what the copy IS: a copy whose
// payload is that identity and nothing else is exactly as plain as a
// payload-free one, and a walk that ranked it with the special copies would
// destroy a Perfected or masterwork copy while an ordinary one sat in the bags.
//
// The prefer-plain removers (items.ts removePreferFungible and
// removeSellUnitsFromInventory, inventory_consumption.ts removeEnchantableItem,
// and their capacity twin bags.ts consumeOneScratch) keep their payload-free
// pass first and then run takeIdentityOnlyUnits below as the SECOND plain
// pass, before any special copy. Unlike the payload-free pass it hands back
// each unit's payload, so a traded, re-granted or destroyed copy keeps its
// guid and provenance (or ends in its own consume row). One order shared by
// all four is what the #2139 capacity bound rests on.
//
// Pure leaf: no SimContext, no state, no rng.

import { cloneItemInstancePayload, type InvSlot, type ItemInstancePayload } from './types';

/** The payload fields that only identify a copy (item_tracking.ts). */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['guid', 'provenance']);

/** Whether a held copy is plain: no payload at all, or a payload that carries
 *  nothing but its tracked identity (an absent-valued key reads as absent). */
export function isPlainCopy(instance: ItemInstancePayload | undefined): boolean {
  if (instance === undefined) return true;
  for (const [key, value] of Object.entries(instance)) {
    if (value !== undefined && !IDENTITY_FIELDS.has(key)) return false;
  }
  return true;
}

/** A held copy that carries a payload, but nothing beyond its tracked
 *  identity: the second plain class, after a payload-free copy. */
export function isIdentityOnlyCopy(
  instance: ItemInstancePayload | undefined,
): instance is ItemInstancePayload {
  return instance !== undefined && isPlainCopy(instance);
}

/** The identity-only pass of the prefer-plain removers: takes up to `count`
 *  units from identity-only slots of `itemId`, highest index first (the walk
 *  order every remover shares), honoring `eligible` when given. Mutates
 *  `inventory`. Each unit carries its slot's payload under the removers'
 *  clone-on-survival rule (the final unit of a fully spent slot is the
 *  original object, every other unit a deep clone), so a caller that stamps
 *  the payload never aliases a surviving stack. */
export function takeIdentityOnlyUnits(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  eligible?: (instance: ItemInstancePayload) => boolean,
): { instance: ItemInstancePayload; craftedRecipeId: string | undefined }[] {
  const taken: { instance: ItemInstancePayload; craftedRecipeId: string | undefined }[] = [];
  let left = count;
  for (let i = inventory.length - 1; i >= 0 && left > 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || !isIdentityOnlyCopy(s.instance)) continue;
    if (eligible && !eligible(s.instance)) continue;
    const take = Math.min(s.count, left);
    for (let unit = 0; unit < take; unit++) {
      const finalUnitOfSlot = take >= s.count && unit === take - 1;
      taken.push({
        instance: finalUnitOfSlot ? s.instance : cloneItemInstancePayload(s.instance),
        craftedRecipeId: s.craftedRecipeId,
      });
    }
    s.count -= take;
    left -= take;
    if (s.count <= 0) inventory.splice(i, 1);
  }
  return taken;
}
