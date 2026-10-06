import { bagPools } from '../bags';
import { bankPools, bumpBankWireRev, moveBetweenContainers } from '../bank';
import { INSTANCE_X_BASE } from '../data';
import { isMaterialItemId } from '../material_ids';
import { normalizeLoadedMaterialSlot } from '../material_slot_load';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneInvSlot, DT, type Entity, type InvSlot } from '../types';
import { courierPayloadFits, courierSlotFingerprint } from './identity';
import {
  COURIER_ADMISSION_BYTES,
  COURIER_CAPACITY,
  COURIER_SPEED,
  type CourierState,
} from './types';

function withdrawOriginal(
  source: InvSlot[],
  index: number,
  original: InvSlot,
  cargo: InvSlot[],
): void {
  const current = source[index];
  if (!current || current.itemId !== original.itemId || current.count < original.count) return;
  const pools = { general: COURIER_CAPACITY, materials: 0 };
  if (original.instance && !isMaterialItemId(original.itemId) && current.count > original.count) {
    const remaining = cloneInvSlot(current);
    remaining.count -= original.count;
    const countBefore = current.count;
    current.count = original.count;
    const result = moveBetweenContainers(source, index, undefined, cargo, pools);
    if (result.moved > 0) source.splice(index, 0, remaining);
    else current.count = countBefore;
  } else {
    moveBetweenContainers(source, index, original.count, cargo, pools, original.materialSources);
  }
}

function travel(state: CourierState, x: number, z: number): boolean {
  const dx = x - state.x;
  const dz = z - state.z;
  const distance = Math.hypot(dx, dz);
  const step = COURIER_SPEED * DT;
  if (distance <= step) {
    state.x = x;
    state.z = z;
    return true;
  }
  state.x += (dx / distance) * step;
  state.z += (dz / distance) * step;
  return false;
}

function exchange(ctx: SimContext, meta: PlayerMeta, state: CourierState): boolean {
  // Deposits only top up existing indices or append. Resolve identities before
  // those top-ups, then withdraw descending indices and the original quantities.
  let selected: ({ slot: InvSlot; index: number } | null)[] = [];
  const deposit = () => {
    // A refused host admission does no fingerprinting or container cloning.
    selected = [...state.withdrawals]
      .sort((a, b) => b.index - a.index)
      .map((s) => {
        const slot = meta.bank.inventory[s.index];
        return slot && courierSlotFingerprint(slot) === s.fingerprint
          ? { slot: normalizeLoadedMaterialSlot(cloneInvSlot(slot)), index: s.index }
          : null;
      });
    for (let i = state.cargo.length - 1; i >= 0; i--) {
      moveBetweenContainers(state.cargo, i, undefined, meta.bank.inventory, bankPools(meta.bank));
    }
  };
  const withdraw = () => {
    for (const selection of selected) {
      if (!selection) continue;
      const { index, slot } = selection;
      const current = meta.bank.inventory[index];
      if (!current || current.itemId !== slot.itemId || current.count < slot.count) continue;
      // Packing can split a tolerated legacy over-stack or expand provenance.
      // Preflight one source slot and bounded cargo, never clone the whole bank.
      const plannedCargo = state.cargo.map(cloneInvSlot);
      withdrawOriginal([cloneInvSlot(current)], 0, slot, plannedCargo);
      if (!courierPayloadFits({ cargo: plannedCargo, withdrawals: [] }, COURIER_ADMISSION_BYTES))
        continue;
      withdrawOriginal(meta.bank.inventory, index, slot, state.cargo);
    }
  };
  if (ctx.courierBankExchange) {
    if (!ctx.courierBankExchange(meta.entityId, deposit, withdraw)) return false;
  } else {
    deposit();
    withdraw();
  }
  bumpBankWireRev(meta);
  state.withdrawals = [];
  state.phase = 'returning';
  state.revision++;
  return true;
}

/** Invoked once per resident player tick. No clock work while the owner is offline. */
export function updateCourier(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  const state = meta.courier;
  if (!state) return;
  if (state.phase === 'ready') {
    if (player.pos.x < INSTANCE_X_BASE) travel(state, player.pos.x, player.pos.z);
    return;
  }
  state.retryRemaining = Math.max(0, state.retryRemaining - DT);
  if (state.phase === 'outbound') {
    const banker = state.bankerId === null ? undefined : ctx.entities.get(state.bankerId);
    if (!banker || banker.kind !== 'npc' || banker.dead) {
      state.phase = 'returning';
      state.withdrawals = [];
      state.revision++;
      return;
    }
    if (!travel(state, banker.pos.x, banker.pos.z) || state.retryRemaining > 0) return;
    // A saved entity id may resolve to a different NPC after a content release.
    // Validate the static banker anchor only at arrival, never during flight.
    if (!ctx.bankerIds.includes(banker.id)) {
      state.phase = 'returning';
      state.withdrawals = [];
      state.revision++;
      return;
    }
    if (!exchange(ctx, meta, state)) state.retryRemaining = 1;
    return;
  }
  // Private instance coordinates must never redirect the overworld courier.
  if (player.pos.x >= INSTANCE_X_BASE || player.dead) return;
  if (!travel(state, player.pos.x, player.pos.z) || state.retryRemaining > 0) return;
  let delivered = 0;
  for (let i = state.cargo.length - 1; i >= 0; i--) {
    delivered += moveBetweenContainers(
      state.cargo,
      i,
      undefined,
      meta.inventory,
      bagPools(meta.bags),
    ).moved;
  }
  const phase = state.cargo.length > 0 ? 'waiting' : 'ready';
  if (state.phase !== phase || delivered > 0) state.revision++;
  state.phase = phase;
  state.retryRemaining = state.cargo.length > 0 ? 1 : 0;
  if (delivered > 0) ctx.onInventoryChangedForQuests(meta);
}
