import { INSTANCE_X_BASE, ITEMS } from '../data';
import { normalizeLoadedMaterialSlot } from '../material_slot_load';
import { membershipActive } from '../membership';
import type { SimContext } from '../sim_context';
import { cloneInvSlot } from '../types';
import { courierPayloadFits, courierSlotFingerprint, validCourierRequest } from './identity';
import { COURIER_ADMISSION_BYTES, COURIER_CAPACITY, type CourierDispatchRequest } from './types';

export function courierSummon(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e } = r;
  // Existing custody remains inspectable even after entitlement expiry.
  if (!meta.courier) {
    if (!membershipActive(meta, ctx.time) || e.dead || e.pos.x >= INSTANCE_X_BASE) return false;
    meta.courier = {
      phase: 'ready',
      x: e.pos.x,
      z: e.pos.z,
      bankerId: null,
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
  if (
    !state ||
    state.phase !== 'ready' ||
    state.cargo.length > 0 ||
    e.dead ||
    e.pos.x >= INSTANCE_X_BASE ||
    !membershipActive(meta, ctx.time)
  )
    return false;
  for (const [selections, inventory] of [
    [raw.deposits, meta.inventory],
    [raw.withdrawals, meta.bank.inventory],
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
  const cargo = raw.deposits.map((s) =>
    normalizeLoadedMaterialSlot(cloneInvSlot(meta.inventory[s.index])),
  );
  const withdrawals = raw.withdrawals.map((s) => ({ ...s }));
  // Refuse before custody changes if persisted state would exceed its budget.
  if (
    cargo.length > COURIER_CAPACITY ||
    !courierPayloadFits({ cargo, withdrawals }, COURIER_ADMISSION_BYTES)
  )
    return false;
  for (const selection of [...raw.deposits].sort((a, b) => b.index - a.index)) {
    meta.inventory.splice(selection.index, 1);
  }
  state.cargo = cargo;
  state.withdrawals = withdrawals;
  state.bankerId = bankerId;
  state.x = e.pos.x;
  state.z = e.pos.z;
  state.phase = 'outbound';
  state.retryRemaining = 0;
  state.revision++;
  ctx.onInventoryChangedForQuests(meta);
  return true;
}
