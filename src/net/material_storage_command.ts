// The five slot-index storage commands share one optional source-intent envelope.
// Keep absent fields absent so ordinary transfers retain their existing wire shape.
import type { MaterialSourceTransferSelection } from '../sim/material_source_transfer_selection';

export function materialStorageTransferPayload(
  slotIndex: number,
  count?: number,
  selection?: MaterialSourceTransferSelection,
) {
  return {
    slot: slotIndex,
    ...(count === undefined ? {} : { count }),
    ...(selection === undefined ? {} : { selection }),
  };
}
