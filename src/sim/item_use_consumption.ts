// Direct item use deliberately permits locked items: the owner lock protects
// salvage, crafting and sales, not drinking a potion or eating a meal.
import { applyMaterialInventoryTake, planMaterialInventoryTake } from './material_inventory_take';
import { consumedMaterialInstancePayloads } from './material_inventory_units';
import { stackProvenanceItemIds } from './stack_provenance_ids';
import type { InvSlot, ItemInstancePayload } from './types';

export interface ItemUseConsumption {
  consume(): ItemInstancePayload | undefined;
}

/** Preflight before effects; consume later only when the item's own gates pass. */
export function planItemUseConsumption(
  inventory: InvSlot[],
  itemId: string,
  slotIndex?: number,
): ItemUseConsumption | null {
  const plan = planMaterialInventoryTake({
    inventory,
    itemId,
    count: 1,
    slotIndex,
    materialIds: stackProvenanceItemIds(),
    includeLocked: true,
  });
  if (!plan.ok) return null;
  return {
    consume: () => {
      applyMaterialInventoryTake(inventory, plan.value);
      return consumedMaterialInstancePayloads(plan.value)[0];
    },
  };
}
