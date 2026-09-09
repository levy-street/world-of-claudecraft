// Atomic automatic consolidation of material stacks. Work on normalized copies
// until every source is validated; only the caller commits the resulting array.
import { mergeMaterialCompositions } from './material_sources';
import {
  compatibleMaterialStacks,
  normalizeMaterialStack,
  takeMaterialStack,
} from './material_stack';
import type { InvSlot } from './types';

// Historical source-less corrupt quantities stay inert, as the old sorter
// promised. Explicit source data is always validated and may never be skipped.
const inertLegacy = (slot: InvSlot): boolean =>
  slot.materialSources === undefined && (!Number.isSafeInteger(slot.count) || slot.count <= 0);

export function consolidateMaterialStacks(
  inventory: readonly InvSlot[],
  materialIds: ReadonlySet<string>,
  stackCap: (itemId: string) => number,
): InvSlot[] {
  const next = inventory.map((slot) => {
    if (!materialIds.has(slot.itemId) || inertLegacy(slot)) return slot;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok) throw new Error(`material grouping refused: ${normalized.error}`);
    return normalized.value;
  });
  for (let i = 0; i < next.length; i++) {
    let target = next[i];
    if (!materialIds.has(target.itemId) || inertLegacy(target)) continue;
    const cap = stackCap(target.itemId);
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('invalid material stack cap');
    for (let j = i + 1; j < next.length && target.count < cap; j++) {
      const donor = next[j];
      if (donor.itemId !== target.itemId || inertLegacy(donor)) continue;
      const compatible = compatibleMaterialStacks(target, donor, materialIds);
      if (!compatible.ok) throw new Error(`material grouping refused: ${compatible.error}`);
      if (!compatible.value) continue;
      const split = takeMaterialStack(
        donor,
        Math.min(cap - target.count, donor.count),
        materialIds,
      );
      if (!split.ok) throw new Error(`material grouping refused: ${split.error}`);
      const composition = mergeMaterialCompositions(
        target.materialSources ?? [],
        split.value.taken.materialSources ?? [],
      );
      if (!composition.ok) throw new Error(`material grouping refused: ${composition.error}`);
      target = {
        ...target,
        count: target.count + split.value.taken.count,
        materialSources: composition.value,
      };
      next[i] = target;
      if (split.value.remaining === null) {
        next.splice(j, 1);
        j--;
      } else next[j] = split.value.remaining;
    }
  }
  return next;
}
