import { bagPools } from '../bags';
import { bankPools, bumpBankWireRev, moveBetweenContainers } from '../bank';
import { INSTANCE_X_BASE } from '../data';
import { normalizeLoadedMaterialSlot } from '../material_slot_load';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { isStackProvenanceItemId } from '../stack_provenance_ids';
import { cloneInvSlot, DT, type Entity, type InvSlot } from '../types';
import { courierPayloadFits, courierSlotFingerprint } from './identity';
import { courierFollowPoint, courierLandingPoint, startCourierLeg, travelCourier } from './motion';
import { COURIER_ADMISSION_BYTES, COURIER_CAPACITY, type CourierState } from './types';

function withdrawOriginal(
  source: InvSlot[],
  index: number,
  original: InvSlot,
  cargo: InvSlot[],
): void {
  const current = source[index];
  if (!current || current.itemId !== original.itemId || current.count < original.count) return;
  const pools = { general: COURIER_CAPACITY, materials: 0 };
  if (
    original.instance &&
    !isStackProvenanceItemId(original.itemId) &&
    current.count > original.count
  ) {
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

const facingOf = (player: Entity) => (Number.isFinite(player.facing) ? player.facing : 0);

function returnHome(state: CourierState, player: Entity): void {
  state.phase = 'returning';
  state.withdrawals = [];
  state.revision++;
  if (player.pos.x >= INSTANCE_X_BASE || player.dead) {
    // Instance or corpse coordinates must not size the leg: plan it on the
    // first tick the owner is back in the overworld and alive.
    delete state.travelTicks;
    delete state.legDistance;
    delete state.landingYaw;
    return;
  }
  // Lock the landing side now, so turning the camera never swings the target.
  state.landingYaw = facingOf(player);
  const landing = courierLandingPoint(player.pos, state.landingYaw);
  startCourierLeg(state, landing.x, landing.z);
}

function exchange(ctx: SimContext, meta: PlayerMeta, player: Entity, state: CourierState): boolean {
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
  returnHome(state, player);
  return true;
}

/** Invoked once per resident player tick. No clock work while the owner is offline. */
export function updateCourier(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  const state = meta.courier;
  if (!state) return;
  if (state.phase === 'ready') {
    if (player.pos.x < INSTANCE_X_BASE) {
      const spot = courierFollowPoint(player.pos, player.facing);
      travelCourier(state, spot.x, spot.z, false);
    }
    return;
  }
  state.retryRemaining = Math.max(0, state.retryRemaining - DT);
  if (state.phase === 'outbound') {
    const banker = state.bankerId === null ? undefined : ctx.entities.get(state.bankerId);
    if (!banker || banker.kind !== 'npc' || banker.dead) {
      returnHome(state, player);
      return;
    }
    if (!travelCourier(state, banker.pos.x, banker.pos.z) || state.retryRemaining > 0) return;
    // A saved entity id may resolve to a different NPC after a content release.
    // Validate the static banker anchor only at arrival, never during flight.
    if (!ctx.bankerIds.includes(banker.id)) {
      returnHome(state, player);
      return;
    }
    if (!exchange(ctx, meta, player, state)) state.retryRemaining = 1;
    return;
  }
  // Private instance coordinates must never redirect the overworld courier.
  if (player.pos.x >= INSTANCE_X_BASE || player.dead) return;
  // The returning courier skids to a stop just in front of its owner; a legacy
  // waiting courier simply walks up to them.
  const returning = state.phase === 'returning';
  if (returning && state.landingYaw === undefined) state.landingYaw = facingOf(player);
  const end = returning ? courierLandingPoint(player.pos, state.landingYaw!) : player.pos;
  if (!travelCourier(state, end.x, end.z, returning) || state.retryRemaining > 0) return;
  // The player already owns this bounded cargo. Returning it may overflow bags;
  // capacity must never strand custody or keep the courier visible after arrival.
  const delivered = state.cargo.length;
  for (let i = state.cargo.length - 1; i >= 0; i--)
    moveBetweenContainers(state.cargo, i, undefined, meta.inventory, bagPools(meta.bags));
  meta.inventory.push(...state.cargo);
  state.cargo = [];
  delete meta.courier;
  if (delivered > 0) ctx.onInventoryChangedForQuests(meta);
}
