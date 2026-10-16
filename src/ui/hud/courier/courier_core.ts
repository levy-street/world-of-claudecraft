import { courierSlotFingerprint } from '../../../sim/courier/identity';
import type {
  CourierDispatchRequest,
  CourierInfo,
  CourierSelection,
} from '../../../sim/courier/types';
import { COURIER_CAPACITY } from '../../../sim/courier/types';
import { ITEMS } from '../../../sim/data';
import type { InvSlot } from '../../../sim/types';

export const COURIER_SELECTION_LIMIT = COURIER_CAPACITY;
export function courierStackSelectable(slot: InvSlot | undefined): boolean {
  return !!slot && ITEMS[slot.itemId]?.kind !== 'quest';
}
export function emptyCourierDraft(): CourierDispatchRequest {
  return { deposits: [], withdrawals: [] };
}
export function courierSelectionMatches(
  selection: CourierSelection,
  slots: readonly InvSlot[],
): boolean {
  const slot = slots[selection.index];
  return courierStackSelectable(slot) && courierSlotFingerprint(slot) === selection.fingerprint;
}
/** Do not retarget a selected stack when the inventory compacts or an item is replaced. */
export function reconcileCourierDraft(
  draft: CourierDispatchRequest,
  bags: readonly InvSlot[],
  bank: readonly InvSlot[],
): CourierDispatchRequest {
  return {
    deposits: draft.deposits.filter((s) => courierSelectionMatches(s, bags)),
    withdrawals: draft.withdrawals.filter((s) => courierSelectionMatches(s, bank)),
  };
}
export function toggleCourierStack(
  draft: CourierDispatchRequest,
  side: keyof CourierDispatchRequest,
  index: number,
  slots: readonly InvSlot[],
): CourierDispatchRequest {
  const slot = slots[index];
  if (!courierStackSelectable(slot)) return draft;
  const fingerprint = courierSlotFingerprint(slot);
  const exists = draft[side].some((s) => s.index === index && s.fingerprint === fingerprint);
  if (!exists && draft.deposits.length + draft.withdrawals.length >= COURIER_SELECTION_LIMIT)
    return draft;
  return {
    ...draft,
    [side]: exists
      ? draft[side].filter((s) => s.index !== index)
      : [...draft[side].filter((s) => s.index !== index), { index, fingerprint }],
  };
}
export function canDispatchCourier(
  info: CourierInfo | null,
  draft: CourierDispatchRequest,
): boolean {
  const count = draft.deposits.length + draft.withdrawals.length;
  return !!info?.active && info.phase === 'ready' && count > 0 && count <= COURIER_SELECTION_LIMIT;
}
