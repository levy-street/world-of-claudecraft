// Clear the owner's grouping only for stacks compatible with the selected
// material identity, then reuse automatic consolidation. No source is removed.
import { compatibleMaterialStacks, normalizeMaterialStack } from './material_stack';
import { consolidateMaterialStacks } from './material_stack_grouping';
import { materialStackSelectionMatches } from './material_stack_selection';
import type {
  MaterialSeparationRequest,
  MaterialSeparationResult,
} from './material_stack_separation';
import type { InvSlot } from './types';

function withoutGrouping(slot: InvSlot): InvSlot {
  const { materialSeparated: _grouping, ...rest } = slot;
  return rest;
}

export function planMaterialStackCombination(
  request: Omit<MaterialSeparationRequest, 'maxNewSlots' | 'selectedSources'>,
): MaterialSeparationResult {
  const { inventory, itemId, selection, materialIds, stackSize } = request;
  if (!materialStackSelectionMatches(inventory, itemId, selection))
    return { ok: false, error: 'stale-selection' };
  const selected = normalizeMaterialStack(inventory[selection.slotIndex], materialIds);
  if (!selected.ok) return selected;
  const target = withoutGrouping(selected.value);
  const next = inventory.slice();
  for (let i = 0; i < next.length; i++) {
    if (next[i].itemId !== itemId) continue;
    const normalized = normalizeMaterialStack(next[i], materialIds);
    if (!normalized.ok) return normalized;
    const plain = withoutGrouping(normalized.value);
    const compatible = compatibleMaterialStacks(target, plain, materialIds);
    if (!compatible.ok) return compatible;
    if (compatible.value) next[i] = plain;
  }
  if (!Number.isSafeInteger(stackSize) || stackSize <= 0)
    return { ok: false, error: 'invalid-capacity' };
  return { ok: true, value: consolidateMaterialStacks(next, new Set([itemId]), () => stackSize) };
}
