// Host adapters for the existing Perfecting command and its read-only views.
// The same resolved player feeds selection, skills and station/combat state.
import { refusedWhileDead } from '../dead_gate';
import type { SimContext } from '../sim_context';
import { type PerfectItemRef, perfectingInfoFrom, resolvePerfectingAttempt } from './perfecting';
import { capturePerfectItemRef } from './perfecting_copy';
import {
  type PerfectingSwapRequest,
  perfectingSwapInfoFrom,
  swapPerfectingRanks,
} from './perfecting_swap';

export function perfectItemCommand(
  ctx: SimContext,
  pid: number | undefined,
  ref: PerfectItemRef,
  name?: string,
): void {
  if (refusedWhileDead(ctx, pid)) return;
  resolvePerfectingAttempt(ctx, pid, ref, name);
}

export function perfectingInfoFor(ctx: SimContext, pid: number | undefined, ref: PerfectItemRef) {
  const resolved = ctx.resolve(pid);
  if (!resolved) return null;
  const { meta } = resolved;
  return perfectingInfoFrom({
    ref,
    inventory: meta.inventory,
    equipment: meta.equipment,
    equipmentInstances: meta.equipmentInstance,
    craftSkills: meta.craftSkills,
  });
}

export function perfectingSwapInfoFor(
  ctx: SimContext,
  pid: number | undefined,
  request: PerfectingSwapRequest,
) {
  const resolved = ctx.resolve(pid);
  if (!resolved) return null;
  const { meta, e } = resolved;
  return perfectingSwapInfoFrom({
    ...request,
    inventory: meta.inventory,
    equipment: meta.equipment,
    equipmentInstances: meta.equipmentInstance,
    craftSkills: meta.craftSkills,
    dead: e.dead,
    inCombat: e.inCombat,
    busy: e.castingAbility !== null || e.channeling,
    pos: e.pos,
    stationPlacements: ctx.stationPlacements,
  });
}

/** Match the online IWorld adapter without ever refreshing a prompt's token. */
export function swapPerfectingRanksCommand(
  ctx: SimContext,
  pid: number | undefined,
  request: PerfectingSwapRequest,
): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta } = resolved;
  const reads = {
    inventory: meta.inventory,
    equipment: meta.equipment,
    equipmentInstances: meta.equipmentInstance,
  };
  swapPerfectingRanks(ctx, pid, {
    source: capturePerfectItemRef(reads, request.source),
    target: capturePerfectItemRef(reads, request.target),
  });
}
