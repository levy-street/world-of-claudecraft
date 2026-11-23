import type { VaultSpecialRef } from '../../world_api/bank';
import { bagPools } from '../bags';
import { bankPools, bumpBankWireRev, moveBetweenContainers } from '../bank';
import { INSTANCE_X_BASE } from '../data';
import { normalizeLoadedMaterialSlot } from '../material_slot_load';
import type { MaterialComposition } from '../material_sources';
import { vaultDepositFromCourier, vaultWithdrawToCourier } from '../materials_vault';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneInvSlot, DT, type Entity, type InvSlot } from '../types';
import { abandonCourierAccountLeg } from './account';
import { withdrawOriginal } from './cargo_moves';
import { courierPayloadFits, courierSlotFingerprint } from './identity';
import { courierFollowPoint, courierLandingPoint, startCourierLeg, travelCourier } from './motion';
import { COURIER_ADMISSION_BYTES, COURIER_CAPACITY, type CourierState } from './types';

const facingOf = (player: Entity) => (Number.isFinite(player.facing) ? player.facing : 0);

function returnHome(state: CourierState, player: Entity): void {
  state.phase = 'returning';
  state.withdrawals = [];
  // A trip abandoned before an exchange brings its vault- and character-bound
  // stacks home.
  if (state.vaultCargo?.length) state.cargo.push(...state.vaultCargo);
  delete state.vaultCargo;
  delete state.vaultWithdrawals;
  abandonCourierAccountLeg(state);
  delete state.banked;
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
  let vaultSelected: {
    itemId: string;
    count: number | undefined;
    ref?: VaultSpecialRef;
    sources?: MaterialComposition;
  }[] = [];
  const deposit = () => {
    // Vault rows resolve before any deposit can merge into (and so re-key) the
    // identity row the player picked. Pooled stock pays the count shown; an
    // identity row pays the whole row as it was seen.
    vaultSelected = (state.vaultWithdrawals ?? []).flatMap((s) => {
      if (!s.special) return [{ itemId: s.itemId, count: s.count }];
      const row = meta.vault.special[s.special.index];
      if (!row || row.itemId !== s.itemId || courierSlotFingerprint(row) !== s.special.fingerprint)
        return [];
      return [
        {
          itemId: s.itemId,
          count: row.count,
          ref: {
            index: s.special.index,
            instance: row.instance,
            craftedRecipeId: row.craftedRecipeId,
          },
          // A vault deposit may merge into this very row before the withdrawal:
          // take back exactly the picked buckets, never the ones just deposited.
          ...(row.materialSources ? { sources: row.materialSources } : {}),
        },
      ];
    });
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
    // After the bank leg, so what the vault cannot hold rides home with the bank
    // leftovers instead of falling into the personal bank.
    const vaultCargo = state.vaultCargo ?? [];
    for (let i = vaultCargo.length - 1; i >= 0; i--) vaultDepositFromCourier(meta, vaultCargo, i);
    state.cargo.push(...vaultCargo);
    delete state.vaultCargo;
  };
  // Stacks the other-character leg still carries share the courier's 24-stack
  // and byte budgets with everything these withdrawals bring back.
  const room = () => COURIER_CAPACITY - (state.account?.cargo.length ?? 0);
  const fits = (cargo: readonly InvSlot[]) =>
    courierPayloadFits({ cargo, account: state.account, withdrawals: [] }, COURIER_ADMISSION_BYTES);
  const withdraw = () => {
    for (const selection of selected) {
      if (!selection) continue;
      const { index, slot } = selection;
      const current = meta.bank.inventory[index];
      if (!current || current.itemId !== slot.itemId || current.count < slot.count) continue;
      // Packing can split a tolerated legacy over-stack or expand provenance.
      // Preflight one source slot and bounded cargo, never clone the whole bank.
      const plannedCargo = state.cargo.map(cloneInvSlot);
      withdrawOriginal([cloneInvSlot(current)], 0, slot, plannedCargo, room());
      if (!fits(plannedCargo)) continue;
      withdrawOriginal(meta.bank.inventory, index, slot, state.cargo, room());
    }
    for (const { itemId, count, ref, sources } of vaultSelected) {
      vaultWithdrawToCourier(
        meta,
        state.cargo,
        { general: room(), materials: 0 },
        itemId,
        count,
        ref,
        fits,
        sources,
      );
    }
  };
  if (ctx.courierBankExchange) {
    if (!ctx.courierBankExchange(meta.entityId, deposit, withdraw)) return false;
  } else {
    deposit();
    withdraw();
  }
  bumpBankWireRev(meta);
  state.banked = true;
  state.withdrawals = [];
  delete state.vaultWithdrawals;
  state.revision++;
  return true;
}

/** The other-character leg, after the bank and vault legs left the cargo
 *  homeward. Without a host (an offline world has no other characters) the leg
 *  is abandoned and its stacks ride home. */
function exchangeAccount(ctx: SimContext, meta: PlayerMeta, state: CourierState): boolean {
  if (!state.account) return true;
  if (!ctx.courierAccountExchange) {
    abandonCourierAccountLeg(state);
    state.revision++;
    return true;
  }
  return ctx.courierAccountExchange(meta.entityId) === 'settled';
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
    // Already at the banker with the bank and vault legs done: the courier only
    // waits on the other-character leg, whose transaction may be committing, so
    // nothing here may send its stacks home underneath it (the host settles it).
    if (state.banked) {
      if (state.retryRemaining > 0) return;
      if (!exchangeAccount(ctx, meta, state)) {
        state.retryRemaining = 0.5;
        return;
      }
      returnHome(state, player);
      return;
    }
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
    if (!exchange(ctx, meta, player, state)) {
      state.retryRemaining = 1;
      return;
    }
    if (!exchangeAccount(ctx, meta, state)) {
      state.retryRemaining = 0.5;
      return;
    }
    returnHome(state, player);
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
