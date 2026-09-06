// Pure UI bridge from a displayed stack snapshot to the compact transfer
// intent accepted by the bank, guild bank, and vault IWorld commands.

import { materialItemIds } from '../sim/material_ids';
import type { MaterialSourceTransferSelection } from '../sim/material_source_transfer_selection';
import { normalizeMaterialStack } from '../sim/material_stack';
import {
  captureMaterialStackSelection,
  type MaterialStackSelection,
} from '../sim/material_stack_selection';
import type { InvSlot } from '../sim/types';
import type { SelectedMaterialSources } from './material_sources_view';

export interface CapturedMaterialSourceTransfer {
  readonly itemId: string;
  readonly target: MaterialStackSelection;
  /** The same stack normalized into the canonical order sourceIndex addresses. */
  readonly sources: NonNullable<InvSlot['materialSources']>;
}

/** Capture the source container's exact stack identity when its picker opens. */
export function captureMaterialSourceTransfer(
  slots: readonly InvSlot[],
  itemId: string,
  slotIndex: number,
): CapturedMaterialSourceTransfer | null {
  const slot = slots[slotIndex];
  if (!slot || slot.itemId !== itemId) return null;
  const target = captureMaterialStackSelection(slots, itemId, slotIndex);
  const normalized = normalizeMaterialStack(slot, materialItemIds());
  const sources = normalized.ok ? normalized.value.materialSources : undefined;
  return target && sources ? { itemId, target, sources } : null;
}

/** Add only canonical source indexes and counts chosen from the pinned array. */
export function selectedMaterialSourceTransfer(
  captured: CapturedMaterialSourceTransfer,
  selected: SelectedMaterialSources,
): MaterialSourceTransferSelection {
  return {
    itemId: captured.itemId,
    target: captured.target,
    quantities: selected.quantities,
  };
}
