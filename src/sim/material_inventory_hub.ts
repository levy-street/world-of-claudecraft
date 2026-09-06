// Source-aware adapters for the existing inventory count/removal hub.

import { materialItemIds } from './material_ids';
import {
  applyMaterialInventoryTake,
  type MaterialTakePlan,
  planMaterialInventoryTake,
} from './material_inventory_take';
import { materialSourceUnitPayload } from './material_inventory_units';
import { normalizeMaterialStack } from './material_stack';
import type { InvSlot, ItemInstancePayload } from './types';

export type MaterialUnitEligibility = (payload: ItemInstancePayload | undefined) => boolean;
const REFUSED = 'material inventory operation refused invalid source state';

export function countMaterialInventoryForHub(
  inventory: readonly InvSlot[],
  itemId: string,
  eligible?: MaterialUnitEligibility,
): number {
  let count = 0;
  for (const raw of inventory) {
    if (raw.itemId !== itemId) continue;
    const read = normalizeMaterialStack(raw, materialItemIds());
    if (!read.ok) throw new Error(REFUSED);
    const slot = read.value;
    if (slot.instance?.locked === true) continue;
    for (const bucket of slot.materialSources ?? []) {
      if (eligible && !eligible(materialSourceUnitPayload(slot, bucket.source))) continue;
      count += bucket.count;
      if (!Number.isSafeInteger(count)) throw new Error(REFUSED);
    }
  }
  return count;
}

/** Legacy removers take up to availability. The plan still validates before any write. */
export function takeMaterialInventoryForHub(
  inventory: InvSlot[],
  itemId: string,
  count: number,
  eligible?: MaterialUnitEligibility,
): MaterialTakePlan {
  const plan = planMaterialInventoryTake({
    inventory,
    itemId,
    count,
    materialIds: materialItemIds(),
    allowPartial: true,
    ...(eligible
      ? { eligibleSource: (source, slot) => eligible(materialSourceUnitPayload(slot, source)) }
      : {}),
  });
  if (!plan.ok) throw new Error(REFUSED);
  applyMaterialInventoryTake(inventory, plan.value);
  return plan.value;
}
