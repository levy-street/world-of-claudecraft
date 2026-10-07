import { bankPools, personalBankInfoFor } from '../bank';
import { INSTANCE_X_BASE } from '../data';
import { membershipActive } from '../membership';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneInvSlot } from '../types';
import type { CourierInfo, CourierPose, CourierState } from './types';

// Derived read cache only. PlayerMeta owns all authoritative state and weak keys
// release entries with the resident character; no history survives logout.
const snapshots = new WeakMap<
  PlayerMeta,
  { key: string; state: CourierState; info: CourierInfo }
>();

function remainingDistance(ctx: SimContext, pid: number, state: CourierState): number {
  if (state.phase !== 'outbound' && state.phase !== 'returning') return 0;
  const targetId = state.phase === 'outbound' ? state.bankerId : pid;
  const target = targetId === null ? undefined : ctx.entities.get(targetId);
  if (
    !target ||
    target.dead ||
    target.pos.x >= INSTANCE_X_BASE ||
    (state.phase === 'outbound' && target.kind !== 'npc')
  )
    return 0;
  return Math.hypot(target.pos.x - state.x, target.pos.z - state.z);
}

export function courierPoseFor(ctx: SimContext, pid: number): CourierPose | null {
  const meta = ctx.players.get(pid);
  const state = meta?.courier;
  return state && meta
    ? {
        phase: state.phase,
        x: state.x,
        z: state.z,
        bankerId: state.bankerId,
        travelDistance: state.travelDistance,
        remainingDistance: remainingDistance(ctx, pid, state),
        inventoryRevision: meta.wireRev,
      }
    : null;
}
export function courierWireRevisionFor(ctx: SimContext, pid: number): string | null {
  const meta = ctx.players.get(pid);
  const state = meta?.courier;
  return meta && state
    ? `${state.revision}:${state.phase === 'ready' ? meta.bankWireRev : 0}:${membershipActive(meta, ctx.time)}`
    : null;
}
export function courierInfoFor(ctx: SimContext, pid: number): CourierInfo | null {
  const meta = ctx.players.get(pid);
  const state = meta?.courier;
  if (!meta || !state) return null;
  const key = courierWireRevisionFor(ctx, pid)!;
  const cached = snapshots.get(meta);
  if (cached?.key === key && cached.state === state) {
    cached.info.x = state.x;
    cached.info.z = state.z;
    cached.info.inventoryRevision = meta.wireRev;
    cached.info.travelDistance = state.travelDistance;
    cached.info.remainingDistance = remainingDistance(ctx, pid, state);
    return cached.info;
  }
  const pools = bankPools(meta.bank);
  const info: CourierInfo = {
    ...courierPoseFor(ctx, pid)!,
    cargo: state.cargo.map(cloneInvSlot),
    withdrawals: state.withdrawals.map((s) => ({ ...s })),
    revision: state.revision + meta.bankWireRev,
    active: membershipActive(meta, ctx.time),
    bankSlots: state.phase === 'ready' ? meta.bank.inventory.map(cloneInvSlot) : [],
    bankCapacity: pools.general + pools.materials,
    inventoryRevision: meta.wireRev,
    bankRevision: meta.bankWireRev,
  };
  snapshots.set(meta, { key, state, info });
  return info;
}
export function courierBankInfoFor(ctx: SimContext, pid: number) {
  return ctx.players.get(pid)?.courier ? personalBankInfoFor(ctx, pid) : null;
}
