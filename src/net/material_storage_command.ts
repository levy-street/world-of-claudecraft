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

/** Exact-copy bag selector shared by carried and bank socket commands. */
export function bagSocketPayload(
  itemId: string,
  socket?: number,
  target?: { slotIndex: number },
): { item: string; socket: number | undefined; slot?: number } {
  return target === undefined
    ? { item: itemId, socket }
    : { item: itemId, socket, slot: target.slotIndex };
}
