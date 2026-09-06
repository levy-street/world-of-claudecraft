// A bounded stale-selection witness shared by material commands and their UI.
// Ownership, eligible sources and capacity are still checked by each operation.
import { fingerprint128 } from './fingerprint128';
import { baggedCopyAnchor, type ItemCopyAnchor } from './item_copy_anchor';
import { itemCopyPin } from './item_copy_ref';
import type { InvSlot } from './types';

export interface MaterialStackSelection {
  readonly slotIndex: number;
  readonly pin: string;
  readonly anchor: ItemCopyAnchor;
}

export function captureMaterialStackSelection(
  inventory: readonly InvSlot[],
  itemId: string,
  slotIndex: number,
): MaterialStackSelection | null {
  const anchor = baggedCopyAnchor(inventory, itemId, slotIndex);
  if (anchor === null) return null;
  const slot = inventory[slotIndex];
  return {
    slotIndex,
    anchor,
    pin: fingerprint128(
      JSON.stringify([slot.count, slot.materialSeparated === true, itemCopyPin(slot)]),
    ),
  };
}

export function materialStackSelectionMatches(
  inventory: readonly InvSlot[],
  itemId: string,
  selection: MaterialStackSelection,
): boolean {
  if (!selection || typeof selection.pin !== 'string' || !/^[0-9a-f]{32}$/.test(selection.pin))
    return false;
  const live = captureMaterialStackSelection(inventory, itemId, selection.slotIndex);
  return (
    live !== null &&
    live.pin === selection.pin &&
    live.anchor.ordinal === selection.anchor?.ordinal &&
    live.anchor.count === selection.anchor?.count
  );
}
