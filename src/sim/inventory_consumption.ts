// Inventory counts and consumption behind SimContext. Materials use exact source
// plans; other items retain newest-first removal and their existing payload rules.
// Quest hooks fire once after each resolved removal, including a no-op request.
import { isMaterialItemId } from './material_ids';
import {
  countMaterialInventoryForHub,
  takeMaterialInventoryForHub,
} from './material_inventory_hub';
import {
  consumedMaterialInstancePayloads,
  materialInventoryUnits,
} from './material_inventory_units';
import { isEnchantedInstance } from './professions/enchanting';
import type { SimContext } from './sim_context';
import { cloneItemInstancePayload, type InventoryUnit, type ItemInstancePayload } from './types';

export function countFungibleItem(ctx: SimContext, itemId: string, pid?: number): number {
  const r = ctx.resolve(pid);
  if (!r) return 0;
  if (isMaterialItemId(itemId)) {
    return countMaterialInventoryForHub(
      r.meta.inventory,
      itemId,
      (payload) => payload === undefined,
    );
  }
  let n = 0;
  for (const s of r.meta.inventory) if (s.itemId === itemId && !s.instance) n += s.count;
  return n;
}

export function removeItem(
  ctx: SimContext,
  itemId: string,
  count: number,
  pid?: number,
): ItemInstancePayload[] {
  const consumedInstances: ItemInstancePayload[] = [];
  const r = ctx.resolve(pid);
  if (!r) return consumedInstances;
  const { meta } = r;
  if (isMaterialItemId(itemId) && count > 0) {
    const plan = takeMaterialInventoryForHub(meta.inventory, itemId, count);
    const consumed = consumedMaterialInstancePayloads(plan);
    ctx.onInventoryChangedForQuests(meta);
    return consumed;
  }
  for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
    const s = meta.inventory[i];
    if (s.itemId !== itemId) continue;
    const take = Math.min(s.count, count);
    if (s.instance) {
      for (let unit = 0; unit < take; unit++) {
        const finalUnitOfSlot = take >= s.count && unit === take - 1;
        consumedInstances.push(finalUnitOfSlot ? s.instance : cloneItemInstancePayload(s.instance));
      }
    }
    s.count -= take;
    count -= take;
    if (s.count <= 0) meta.inventory.splice(i, 1);
  }
  ctx.onInventoryChangedForQuests(meta);
  return consumedInstances;
}

export function removeFungibleItem(
  ctx: SimContext,
  itemId: string,
  count: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  if (isMaterialItemId(itemId) && count > 0) {
    takeMaterialInventoryForHub(meta.inventory, itemId, count, (payload) => payload === undefined);
    ctx.onInventoryChangedForQuests(meta);
    return;
  }
  for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
    const s = meta.inventory[i];
    if (s.itemId !== itemId || s.instance) continue;
    const take = Math.min(s.count, count);
    s.count -= take;
    count -= take;
    if (s.count <= 0) meta.inventory.splice(i, 1);
  }
  ctx.onInventoryChangedForQuests(meta);
}

export function countEnchantableItem(ctx: SimContext, itemId: string, pid?: number): number {
  const r = ctx.resolve(pid);
  if (!r) return 0;
  if (isMaterialItemId(itemId)) {
    return countMaterialInventoryForHub(
      r.meta.inventory,
      itemId,
      (payload) => payload === undefined || !isEnchantedInstance(payload),
    );
  }
  let n = 0;
  for (const s of r.meta.inventory) {
    if (s.itemId !== itemId) continue;
    if (s.instance && isEnchantedInstance(s.instance)) continue;
    n += s.count;
  }
  return n;
}

export function removeEnchantableItem(
  ctx: SimContext,
  itemId: string,
  count: number,
  pid?: number,
): InventoryUnit[] {
  const consumed: InventoryUnit[] = [];
  const r = ctx.resolve(pid);
  if (!r) return consumed;
  const { meta } = r;
  if (isMaterialItemId(itemId) && count > 0) {
    const plan = takeMaterialInventoryForHub(
      meta.inventory,
      itemId,
      count,
      (payload) => payload === undefined || !isEnchantedInstance(payload),
    );
    const units = materialInventoryUnits(plan);
    ctx.onInventoryChangedForQuests(meta);
    return units;
  }
  // Pass 1: plain fungible stacks only, same order removeFungibleItem uses.
  for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
    const s = meta.inventory[i];
    if (s.itemId !== itemId || s.instance) continue;
    const take = Math.min(s.count, count);
    for (let unit = 0; unit < take; unit++) {
      consumed.push({ instance: undefined, craftedRecipeId: s.craftedRecipeId });
    }
    s.count -= take;
    count -= take;
    if (s.count <= 0) meta.inventory.splice(i, 1);
  }
  // Pass 2: instanced copies that are not already enchanted. Per-unit
  // returns with the same clone-on-survival rule removeItem follows: the
  // enchant path mutates the payload it gets back, so a surviving stack's
  // shared payload must never be aliased out.
  for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
    const s = meta.inventory[i];
    if (s.itemId !== itemId || !s.instance || isEnchantedInstance(s.instance)) continue;
    const take = Math.min(s.count, count);
    for (let unit = 0; unit < take; unit++) {
      const finalUnitOfSlot = take >= s.count && unit === take - 1;
      consumed.push({
        instance: finalUnitOfSlot ? s.instance : cloneItemInstancePayload(s.instance),
        craftedRecipeId: s.craftedRecipeId,
      });
    }
    s.count -= take;
    count -= take;
    if (s.count <= 0) meta.inventory.splice(i, 1);
  }
  ctx.onInventoryChangedForQuests(meta);
  return consumed;
}
