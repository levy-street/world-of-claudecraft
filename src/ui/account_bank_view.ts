import { isItemLocked } from '../sim/item_lock';
import type { InvSlot, ItemDef } from '../sim/types';

/** Only transferable copies can cross character ownership. The server rechecks. */
export function accountBankTransferAllowed(slot: InvSlot, item: ItemDef | undefined): boolean {
  return (
    !!item &&
    !item.soulbound &&
    !slot.instance?.boundTo &&
    !isItemLocked(slot.instance) &&
    item.kind !== 'quest'
  );
}
