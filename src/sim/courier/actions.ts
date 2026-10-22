import { INSTANCE_X_BASE, ITEMS } from '../data';
import { normalizeLoadedMaterialSlot } from '../material_slot_load';
import { isVaultDepositableSlot, vaultMaterialIds } from '../materials_vault';
import { membershipActive } from '../membership';
import { membershipBankTransferable } from '../membership_bank';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneInvSlot } from '../types';
import { courierPayloadFits, courierSlotFingerprint, validCourierRequest } from './identity';
import { courierFollowPoint, startCourierLeg } from './motion';
import {
  COURIER_ADMISSION_BYTES,
  COURIER_CAPACITY,
  type CourierDispatchRequest,
  type CourierVaultSelection,
  courierSelectionCount,
} from './types';

/** A vault row the window offered: pooled stock still held, or the identity row
 *  at that index with the exact fingerprint shown. */
function vaultRowSelectable(meta: PlayerMeta, selection: CourierVaultSelection): boolean {
  const vault = meta.vault;
  if (!selection.special) {
    return Object.hasOwn(vault.stock, selection.itemId) && vault.stock[selection.itemId] > 0;
  }
  const row = vault.special[selection.special.index];
  return (
    !!row &&
    row.itemId === selection.itemId &&
    courierSlotFingerprint(row) === selection.special.fingerprint
  );
}

export function courierSummon(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e } = r;
  // Existing custody remains inspectable even after entitlement expiry.
  if (!meta.courier) {
    if (!membershipActive(meta, ctx.time) || e.dead || e.pos.x >= INSTANCE_X_BASE) return false;
    // Appear at the waiting spot off the owner's shoulder, not underfoot.
    const spot = courierFollowPoint(e.pos, e.facing);
    meta.courier = {
      phase: 'ready',
      x: spot.x,
      z: spot.z,
      bankerId: null,
      travelDistance: 0,
      cargo: [],
      withdrawals: [],
      revision: 1,
      retryRemaining: 0,
    };
  }
  ctx.emit({ type: 'courier', playerId: meta.entityId, pid: meta.entityId });
  return true;
}

export function courierDispatch(
  ctx: SimContext,
  raw: CourierDispatchRequest,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r || !validCourierRequest(raw)) return false;
  const { meta, e } = r;
  const state = meta.courier;
  // An empty request sends a ready, empty courier away (the window closed
  // without a delivery). It never touches custody, so membership is not needed.
  if (courierSelectionCount(raw) === 0) {
    if (!state || state.phase !== 'ready' || state.cargo.length > 0) return false;
    delete meta.courier;
    return true;
  }
  if (
    !state ||
    state.phase !== 'ready' ||
    state.cargo.length > 0 ||
    e.dead ||
    e.pos.x >= INSTANCE_X_BASE ||
    !membershipActive(meta, ctx.time)
  )
    return false;
  const vaultDeposits = raw.vaultDeposits ?? [];
  const vaultWithdrawals = raw.vaultWithdrawals ?? [];
  // The vault leg needs an unlocked vault, carried materials and offered rows.
  if (vaultDeposits.length + vaultWithdrawals.length > 0 && meta.vault.upgrades <= 0) return false;
  for (const selection of vaultDeposits) {
    const slot = meta.inventory[selection.index];
    if (!slot || !isVaultDepositableSlot(slot, vaultMaterialIds())) return false;
  }
  for (const selection of vaultWithdrawals) if (!vaultRowSelectable(meta, selection)) return false;
  const account = raw.account;
  // Never this character's own bank: that is the personal leg.
  if (account && account.characterId === meta.characterId) return false;
  for (const selection of account?.deposits ?? []) {
    const slot = meta.inventory[selection.index];
    if (!slot || !membershipBankTransferable(slot)) return false;
  }
  for (const [selections, inventory] of [
    [raw.deposits, meta.inventory],
    [raw.withdrawals, meta.bank.inventory],
    [vaultDeposits, meta.inventory],
    [account?.deposits ?? [], meta.inventory],
  ] as const) {
    for (const selection of selections) {
      const slot = inventory[selection.index];
      if (
        !slot ||
        !ITEMS[slot.itemId] ||
        ITEMS[slot.itemId].kind === 'quest' ||
        courierSlotFingerprint(slot) !== selection.fingerprint
      )
        return false;
    }
  }
  // Anchor scan runs only on explicit dispatch, never on a flight tick or read.
  let bankerId: number | null = null;
  let nearest = Infinity;
  for (const id of ctx.bankerIds) {
    const banker = ctx.entities.get(id);
    if (!banker || banker.kind !== 'npc' || banker.dead || banker.pos.x >= INSTANCE_X_BASE)
      continue;
    const distance = Math.hypot(banker.pos.x - e.pos.x, banker.pos.z - e.pos.z);
    if (distance < nearest) {
      bankerId = id;
      nearest = distance;
    }
  }
  if (bankerId === null) return false;
  const carried = (s: { index: number }) =>
    normalizeLoadedMaterialSlot(cloneInvSlot(meta.inventory[s.index]));
  const cargo = raw.deposits.map(carried);
  const vaultCargo = vaultDeposits.map(carried);
  const accountCargo = (account?.deposits ?? []).map(carried);
  const accountLeg = account
    ? {
        characterId: account.characterId,
        cargo: accountCargo,
        withdrawals: account.withdrawals.map((s) => ({ ...s })),
      }
    : undefined;
  const withdrawals = raw.withdrawals.map((s) => ({ ...s }));
  const vaultRows = vaultWithdrawals.map((s) => ({
    ...s,
    ...(s.special ? { special: { ...s.special } } : {}),
  }));
  // Refuse before custody changes if persisted state would exceed its budget.
  if (
    cargo.length + vaultCargo.length + accountCargo.length > COURIER_CAPACITY ||
    !courierPayloadFits(
      { cargo, withdrawals, vaultCargo, vaultWithdrawals: vaultRows, account: accountLeg },
      COURIER_ADMISSION_BYTES,
    )
  )
    return false;
  const taken = [...raw.deposits, ...vaultDeposits, ...(account?.deposits ?? [])];
  for (const selection of taken.sort((a, b) => b.index - a.index)) {
    meta.inventory.splice(selection.index, 1);
  }
  state.cargo = cargo;
  state.withdrawals = withdrawals;
  if (vaultCargo.length > 0) state.vaultCargo = vaultCargo;
  else delete state.vaultCargo;
  if (vaultRows.length > 0) state.vaultWithdrawals = vaultRows;
  else delete state.vaultWithdrawals;
  if (accountLeg) state.account = accountLeg;
  else delete state.account;
  delete state.banked;
  state.bankerId = bankerId;
  state.x = e.pos.x;
  state.z = e.pos.z;
  state.phase = 'outbound';
  const banker = ctx.entities.get(bankerId)!;
  startCourierLeg(state, banker.pos.x, banker.pos.z);
  delete state.landingYaw;
  state.retryRemaining = 0;
  state.revision++;
  ctx.onInventoryChangedForQuests(meta);
  return true;
}
