// A maker picker adapts mixed consumables to the market's existing single-copy
// instance selector. Materials retain their existing market policy.
import { isMaterialItemId } from '../sim/material_ids';
import { materialSourceUnitPayload } from '../sim/material_inventory_units';
import type { MaterialComposition } from '../sim/material_sources';
import { normalizeMaterialStack, takeMaterialStack } from '../sim/material_stack';
import { isStackProvenanceItemId, stackProvenanceItemIds } from '../sim/stack_provenance_ids';
import type { InvSlot, ItemInstancePayload } from '../sim/types';

export function marketConsumableSellSources(slot: InvSlot): InvSlot | null {
  if (isMaterialItemId(slot.itemId) || !isStackProvenanceItemId(slot.itemId)) return null;
  const normalized = normalizeMaterialStack(slot, stackProvenanceItemIds());
  if (
    !normalized.ok ||
    !normalized.value.materialSources?.some(({ source }) => source.signer !== undefined)
  )
    return null;
  return normalized.value;
}

/** A source choice names one real unit, never the whole mixed stack. */
export function marketConsumableSellChoice(
  slot: InvSlot,
  sources: MaterialComposition,
): { instance: ItemInstancePayload | undefined } | null {
  const take = takeMaterialStack(slot, 1, stackProvenanceItemIds(), sources);
  if (!take.ok) return null;
  const source = take.value.taken.materialSources?.[0]?.source;
  return source ? { instance: materialSourceUnitPayload(take.value.taken, source) } : null;
}
