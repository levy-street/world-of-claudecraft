// The other-character leg of a courier trip, planned on detached copies. The
// host runs it inside the database transaction that holds the other character's
// row, and applies the result to the live courier only after it commits.
import { bankPools, moveBetweenContainers, type SavedBankState, sanitizeBankState } from '../bank';
import { cloneMaterialData } from '../material_payload_identity';
import { membershipBankTransferable } from '../membership_bank';
import { cloneInvSlot, type InvSlot } from '../types';
import { withdrawOriginal } from './cargo_moves';
import { courierSlotFingerprint } from './identity';
import type { CourierAccountLeg } from './types';

/** One ledger movement in the other character's bank. */
export interface CourierAccountMove {
  direction: 'deposit' | 'withdraw';
  item: InvSlot;
  moved: number;
}
export interface CourierAccountPlan {
  /** The courier's homeward cargo: what it already carried, what that bank
   *  could not hold, and what it took from that bank. */
  cargo: InvSlot[];
  bank: SavedBankState;
  moves: CourierAccountMove[];
}

/** Deposit the leg's stacks as far as that bank holds them, then take each
 *  picked stack that still reads as picked, whole, while `fits` accepts the
 *  homeward cargo. Picks resolve before the deposits can top their slots up. */
export function planCourierAccountExchange(
  leg: CourierAccountLeg,
  cargo: readonly InvSlot[],
  saved: SavedBankState | undefined,
  fits: (cargo: readonly InvSlot[]) => boolean,
): CourierAccountPlan {
  const pools = bankPools(sanitizeBankState({ ...saved, inventory: [] }));
  const bank: SavedBankState = saved
    ? cloneMaterialData(saved)
    : { inventory: [], purchasedSlots: 0, bonusSlots: 0 };
  const home = cargo.map(cloneInvSlot);
  const moves: CourierAccountMove[] = [];
  const picks = [...leg.withdrawals]
    .sort((a, b) => b.index - a.index)
    .flatMap((s) => {
      const slot = bank.inventory[s.index];
      return slot &&
        membershipBankTransferable(slot) &&
        courierSlotFingerprint(slot) === s.fingerprint
        ? [{ index: s.index, slot: cloneInvSlot(slot) }]
        : [];
    });
  const outbound = leg.cargo.map(cloneInvSlot);
  for (let i = outbound.length - 1; i >= 0; i--) {
    const item = cloneInvSlot(outbound[i]);
    // Dispatch already refused these; a stack that changed rules since rides home.
    if (!membershipBankTransferable(item)) continue;
    const { moved } = moveBetweenContainers(outbound, i, undefined, bank.inventory, pools);
    if (moved > 0) moves.push({ direction: 'deposit', item, moved });
  }
  home.push(...outbound);
  for (const { index, slot } of picks) {
    const current = bank.inventory[index];
    if (!current) continue;
    const planned = home.map(cloneInvSlot);
    if (withdrawOriginal([cloneInvSlot(current)], 0, slot, planned) <= 0 || !fits(planned))
      continue;
    const moved = withdrawOriginal(bank.inventory, index, slot, home);
    if (moved > 0) moves.push({ direction: 'withdraw', item: slot, moved });
  }
  return { cargo: home, bank, moves };
}

/** Abandon the leg without touching that bank: its stacks ride home. */
export function abandonCourierAccountLeg(state: {
  cargo: InvSlot[];
  account?: CourierAccountLeg;
}): void {
  if (state.account) state.cargo.push(...state.account.cargo);
  delete state.account;
}
