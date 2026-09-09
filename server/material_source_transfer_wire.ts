// Shared storage command envelope. Legacy optional count coercion stays intact;
// explicit source intent must be internally consistent before reserving audit rows.
import {
  type MaterialSourceTransferSelection,
  materialSourceTransferSelectionMatches,
  readMaterialSourceTransferSelection,
} from '../src/sim/material_source_transfer_selection';

export interface MaterialSourceTransferWire {
  readonly count: number | undefined;
  readonly selection?: MaterialSourceTransferSelection;
}

export function readMaterialSourceTransferWire(
  message: Record<string, unknown>,
  slotIndex: number,
): MaterialSourceTransferWire | null {
  const count = typeof message.count === 'number' ? message.count : undefined;
  if (!Object.hasOwn(message, 'selection')) return { count };
  const selection = readMaterialSourceTransferSelection(message.selection);
  if (
    selection === null ||
    !materialSourceTransferSelectionMatches(selection, {
      slotIndex,
      count: message.count,
    })
  )
    return null;
  return { count, selection };
}
