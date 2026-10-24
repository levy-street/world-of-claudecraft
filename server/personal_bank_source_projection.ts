// Preserve the personal ledger's historical item plus effective-payload key.
// A mixed consumable contributes one row per source bucket, never per unit.
import { isMaterialItemId } from '../src/sim/material_ids';
import { materialSourceUnitPayload } from '../src/sim/material_inventory_units';
import { normalizeMaterialStack } from '../src/sim/material_stack';
import { isStackProvenanceItemId, stackProvenanceItemIds } from '../src/sim/stack_provenance_ids';
import type { InvSlot } from '../src/sim/types';

export function personalBankSourceProjection(slot: InvSlot): readonly InvSlot[] {
  if (isMaterialItemId(slot.itemId) || !isStackProvenanceItemId(slot.itemId)) return [slot];
  const normalized = normalizeMaterialStack(slot, stackProvenanceItemIds());
  if (!normalized.ok) throw new Error('unreadable personal bank consumable sources');
  return (normalized.value.materialSources ?? []).map(({ source, count }) => ({
    itemId: slot.itemId,
    count,
    instance: materialSourceUnitPayload(normalized.value, source),
  }));
}
