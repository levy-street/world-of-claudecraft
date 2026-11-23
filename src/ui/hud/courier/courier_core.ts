import { courierSlotFingerprint } from '../../../sim/courier/identity';
import type {
  CourierAccountRequest,
  CourierDispatchRequest,
  CourierInfo,
  CourierSelection,
  CourierVaultSelection,
} from '../../../sim/courier/types';
import { COURIER_CAPACITY, courierSelectionCount } from '../../../sim/courier/types';
import { ITEMS } from '../../../sim/data';
import { isVaultDepositableSlot, vaultMaterialIds } from '../../../sim/materials_vault';
import { membershipBankTransferable } from '../../../sim/membership_bank';
import type { InvSlot } from '../../../sim/types';
import type { VaultInfo } from '../../../world_api/bank';

export const COURIER_SELECTION_LIMIT = COURIER_CAPACITY;

/** The window's draft: every list present, so toggles never branch on absence;
 *  the other-character leg is null until a stack is picked for one character. */
export type CourierDraft = Required<Omit<CourierDispatchRequest, 'account'>> & {
  account: CourierAccountRequest | null;
};
/** The lists that select stacks by index: bag stacks for the bank or the vault,
 *  and bank stacks to bring back. */
export type CourierStackSide = 'deposits' | 'withdrawals' | 'vaultDeposits';

export function courierStackSelectable(slot: InvSlot | undefined): boolean {
  return !!slot && ITEMS[slot.itemId]?.kind !== 'quest';
}
/** Only materials go in the vault; the server rechecks with the same rule. */
export function courierVaultStackSelectable(slot: InvSlot | undefined): boolean {
  return !!slot && courierStackSelectable(slot) && isVaultDepositableSlot(slot, vaultMaterialIds());
}
export function emptyCourierDraft(): CourierDraft {
  return { deposits: [], withdrawals: [], vaultDeposits: [], vaultWithdrawals: [], account: null };
}
/** Only copies that may cross character ownership go to another character. */
export function courierAccountStackSelectable(slot: InvSlot | undefined): boolean {
  return !!slot && membershipBankTransferable(slot);
}
export function courierSelectionMatches(
  selection: CourierSelection,
  slots: readonly InvSlot[],
): boolean {
  const slot = slots[selection.index];
  return courierStackSelectable(slot) && courierSlotFingerprint(slot) === selection.fingerprint;
}

/** One selectable Materials Vault row as the window shows it: pooled stock by
 *  material, or an identity row by its index. */
export interface CourierVaultRow {
  itemId: string;
  count: number;
  special?: { index: number; slot: InvSlot };
}
export function courierVaultRows(vault: VaultInfo | null): CourierVaultRow[] {
  if (!vault) return [];
  const pooled = Object.entries(vault.stock)
    .filter(([, count]) => Number.isSafeInteger(count) && count > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([itemId, count]) => ({ itemId, count }));
  const special = vault.special.map((slot, index) => ({
    itemId: slot.itemId,
    count: slot.count,
    special: { index, slot },
  }));
  return [...pooled, ...special];
}
function vaultRowSelection(row: CourierVaultRow): CourierVaultSelection {
  return row.special
    ? {
        itemId: row.itemId,
        count: row.count,
        special: {
          index: row.special.index,
          fingerprint: courierSlotFingerprint(row.special.slot),
        },
      }
    : { itemId: row.itemId, count: row.count };
}
const sameVaultRow = (a: CourierVaultSelection, b: CourierVaultSelection): boolean =>
  a.itemId === b.itemId &&
  a.count === b.count &&
  a.special?.index === b.special?.index &&
  a.special?.fingerprint === b.special?.fingerprint;
export function courierVaultRowSelected(draft: CourierDraft, row: CourierVaultRow): boolean {
  const wanted = vaultRowSelection(row);
  return draft.vaultWithdrawals.some((s) => sameVaultRow(s, wanted));
}

/** Do not retarget a selected stack when the inventory compacts or an item is
 *  replaced; a vault row must still read exactly as it was selected. */
export function reconcileCourierDraft(
  draft: CourierDraft,
  bags: readonly InvSlot[],
  bank: readonly InvSlot[],
  vault: VaultInfo | null = null,
  accountBank: { characterId: number; slots: readonly InvSlot[] } | null = null,
): CourierDraft {
  const rows = courierVaultRows(vault).map(vaultRowSelection);
  const account = draft.account && {
    ...draft.account,
    deposits: draft.account.deposits.filter(
      (s) => courierSelectionMatches(s, bags) && courierAccountStackSelectable(bags[s.index]),
    ),
    // Only the loaded bank of that same character can prove a pick stale.
    withdrawals:
      accountBank && accountBank.characterId === draft.account.characterId
        ? draft.account.withdrawals.filter((s) => courierSelectionMatches(s, accountBank.slots))
        : draft.account.withdrawals,
  };
  return {
    deposits: draft.deposits.filter((s) => courierSelectionMatches(s, bags)),
    withdrawals: draft.withdrawals.filter((s) => courierSelectionMatches(s, bank)),
    vaultDeposits: draft.vaultDeposits.filter(
      (s) => courierSelectionMatches(s, bags) && courierVaultStackSelectable(bags[s.index]),
    ),
    vaultWithdrawals: draft.vaultWithdrawals.filter((s) => rows.some((r) => sameVaultRow(r, s))),
    account: account && account.deposits.length + account.withdrawals.length > 0 ? account : null,
  };
}

/** A carried stack goes to one store: drop it from every bag list but `keep`. */
function withoutBagIndex(draft: CourierDraft, index: number, keep: string): CourierDraft {
  const drop = (list: CourierSelection[]) => list.filter((s) => s.index !== index);
  return {
    ...draft,
    deposits: keep === 'deposits' ? draft.deposits : drop(draft.deposits),
    vaultDeposits: keep === 'vaultDeposits' ? draft.vaultDeposits : drop(draft.vaultDeposits),
    account:
      draft.account && keep !== 'account'
        ? { ...draft.account, deposits: drop(draft.account.deposits) }
        : draft.account,
  };
}
const bagPicked = (draft: CourierDraft, index: number): boolean =>
  [...draft.deposits, ...draft.vaultDeposits, ...(draft.account?.deposits ?? [])].some(
    (s) => s.index === index,
  );

/** Toggle a stack for another character: a carried stack (`deposits`) or one of
 *  that character's bank stacks (`withdrawals`). Picking for a different
 *  character starts that character's leg afresh: one other character per trip. */
export function toggleCourierAccountStack(
  draft: CourierDraft,
  characterId: number,
  side: 'deposits' | 'withdrawals',
  index: number,
  slots: readonly InvSlot[],
): CourierDraft {
  const slot = slots[index];
  if (!courierAccountStackSelectable(slot)) return draft;
  const fingerprint = courierSlotFingerprint(slot);
  const leg =
    draft.account?.characterId === characterId
      ? draft.account
      : { characterId, deposits: [], withdrawals: [] };
  const base = draft.account === leg ? draft : { ...draft, account: leg };
  const exists = leg[side].some((s) => s.index === index && s.fingerprint === fingerprint);
  const moving = side === 'deposits' && !exists && bagPicked(base, index);
  const count = courierSelectionCount({ ...base, account: leg });
  if (!exists && !moving && count >= COURIER_SELECTION_LIMIT) return draft;
  const cleared = side === 'deposits' ? withoutBagIndex(base, index, 'account') : base;
  const current = cleared.account ?? leg;
  const nextList = exists
    ? current[side].filter((s) => s.index !== index)
    : [...current[side].filter((s) => s.index !== index), { index, fingerprint }];
  const next = { ...current, [side]: nextList };
  return {
    ...cleared,
    account: next.deposits.length + next.withdrawals.length > 0 ? next : null,
  };
}

/** Toggle one stack. A carried stack goes to one store: choosing the vault for
 *  it drops a bank choice and the other way round. */
export function toggleCourierStack(
  draft: CourierDraft,
  side: CourierStackSide,
  index: number,
  slots: readonly InvSlot[],
): CourierDraft {
  const slot = slots[index];
  if (side === 'vaultDeposits' ? !courierVaultStackSelectable(slot) : !courierStackSelectable(slot))
    return draft;
  const fingerprint = courierSlotFingerprint(slot);
  const exists = draft[side].some((s) => s.index === index && s.fingerprint === fingerprint);
  const fromBags = side !== 'withdrawals';
  const moving = fromBags && !exists && bagPicked(draft, index);
  if (!exists && !moving && courierSelectionCount(draft) >= COURIER_SELECTION_LIMIT) return draft;
  const cleared = fromBags ? withoutBagIndex(draft, index, side) : draft;
  const next: CourierDraft = {
    ...cleared,
    [side]: exists
      ? draft[side].filter((s) => s.index !== index)
      : [...draft[side].filter((s) => s.index !== index), { index, fingerprint }],
  };
  if (next.account && next.account.deposits.length + next.account.withdrawals.length === 0)
    next.account = null;
  return next;
}
export function toggleCourierVaultRow(draft: CourierDraft, row: CourierVaultRow): CourierDraft {
  const wanted = vaultRowSelection(row);
  if (courierVaultRowSelected(draft, row))
    return {
      ...draft,
      vaultWithdrawals: draft.vaultWithdrawals.filter((s) => !sameVaultRow(s, wanted)),
    };
  if (courierSelectionCount(draft) >= COURIER_SELECTION_LIMIT) return draft;
  return { ...draft, vaultWithdrawals: [...draft.vaultWithdrawals, wanted] };
}

/** The wire request: empty vault lists are left off, so a bank-only trip reads
 *  exactly as it did before the vault leg existed. */
export function courierDispatchRequest(draft: CourierDraft): CourierDispatchRequest {
  return {
    deposits: draft.deposits,
    withdrawals: draft.withdrawals,
    ...(draft.vaultDeposits.length ? { vaultDeposits: draft.vaultDeposits } : {}),
    ...(draft.vaultWithdrawals.length ? { vaultWithdrawals: draft.vaultWithdrawals } : {}),
    ...(draft.account ? { account: draft.account } : {}),
  };
}
export function canDispatchCourier(info: CourierInfo | null, draft: CourierDraft): boolean {
  const count = courierSelectionCount(draft);
  return !!info?.active && info.phase === 'ready' && count > 0 && count <= COURIER_SELECTION_LIMIT;
}
