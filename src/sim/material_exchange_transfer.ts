// Exact material rows for anonymous transfers; quantities stay compressed.
import { isMaterialItemId, materialItemIds } from './material_ids';
import { type MaterialTakePlan, planMaterialInventoryTake } from './material_inventory_take';
import { materialSourceUnitPayload } from './material_inventory_units';
import { materialPayloadKey } from './material_payload_identity';
import { mergeMaterialCompositions } from './material_sources';
import { normalizeMaterialStack } from './material_stack';
import type { InvSlot } from './types';

export function coalesceMaterialTransferSlots(slots: readonly InvSlot[]): InvSlot[] {
  const rows = new Map<string, InvSlot>();
  for (const slot of slots) {
    const read = normalizeMaterialStack(slot, materialItemIds());
    if (!read.ok) throw new Error('invalid material transfer composition');
    const key = materialPayloadKey(read.value);
    const held = rows.get(key);
    if (!held) {
      rows.set(key, read.value);
      continue;
    }
    const sources = mergeMaterialCompositions(held.materialSources!, read.value.materialSources!);
    if (!sources.ok) throw new Error('invalid material transfer composition');
    rows.set(key, {
      ...held,
      count: held.count + read.value.count,
      materialSources: sources.value,
    });
  }
  return [...rows.values()];
}

export function planPlainMaterialTransfer(
  inventory: readonly InvSlot[],
  itemId: string,
  count: number,
): { plan: MaterialTakePlan; rows: InvSlot[] } | null {
  if (!isMaterialItemId(itemId)) return null;
  const plan = planMaterialInventoryTake({
    inventory,
    itemId,
    count,
    materialIds: materialItemIds(),
    eligibleSource: (source, slot) => materialSourceUnitPayload(slot, source) === undefined,
  });
  if (!plan.ok) throw new Error('material transfer does not match available stock');
  return { plan: plan.value, rows: coalesceMaterialTransferSlots(plan.value.taken) };
}
