// Finish a running enchant-family cast without advancing the world clock.
// Mirrors updateCasting: clear cast fields first, then route to complete.
// Used by suites that still drive Sim.disenchantItem / applyEnchant / salvageItem
// (cast start) and need the resolve body for outcome assertions.

import type { PlayerMeta, Sim } from '../../src/sim/sim';
import {
  CRAFT_CAST_ID,
  DISENCHANT_CAST_ID,
  ENCHANT_CAST_ID,
  type Entity,
  SALVAGE_CAST_ID,
  TOOL_RECHARGE_CAST_ID,
} from '../../src/sim/types';

function playerPair(sim: Sim, pid: number): { meta: PlayerMeta; p: Entity } {
  const meta = sim.players.get(pid) as PlayerMeta | undefined;
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  if (!meta || !p) throw new Error('player missing for cast complete');
  return { meta, p };
}

export function completeCraftCast(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid) as PlayerMeta | undefined;
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  // No-op when the start was refused (dead gate, invalid pid) or already idle.
  if (!meta || !p) return;
  if (p.castingAbility !== CRAFT_CAST_ID && p.craftCastRecipeId === '') return;
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeCraftCast(p, meta);
}

/** Start craft + complete when admitted. */
export function runCraft(
  sim: Sim,
  recipeId: string,
  commission = false,
  pid?: number,
  count?: number,
): void {
  const id = pid ?? sim.playerId;
  // Always use the four-arg form when a pid is provided so a numeric pid that
  // is not a known player is never misread as the IWorld batch count.
  if (pid !== undefined) sim.craftItem(recipeId, commission, pid, count ?? 1);
  else if (count !== undefined) sim.craftItem(recipeId, commission, count);
  else sim.craftItem(recipeId, commission);
  completeCraftCast(sim, id);
}

export function completeEnchantFamilyCast(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid) as PlayerMeta | undefined;
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  if (!meta || !p) return;
  const castId = p.castingAbility;
  if (castId === null) return;
  p.castingAbility = null;
  p.castRemaining = 0;
  if (castId === DISENCHANT_CAST_ID) sim.ctx.completeDisenchantCast(p, meta);
  else if (castId === ENCHANT_CAST_ID) sim.ctx.completeApplyEnchantCast(p, meta);
  else if (castId === SALVAGE_CAST_ID) sim.ctx.completeSalvageCast(p, meta);
  else if (castId === CRAFT_CAST_ID) sim.ctx.completeCraftCast(p, meta);
  else if (castId === TOOL_RECHARGE_CAST_ID) sim.ctx.completeRechargeCast(p, meta);
  else {
    throw new Error(`expected profession cast, got ${castId}`);
  }
}

/** Finish a running tool-recharge cast (or no-op if idle). */
export function completeRechargeCast(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid) as PlayerMeta | undefined;
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  if (!meta || !p) return;
  if (p.castingAbility !== TOOL_RECHARGE_CAST_ID && p.toolRechargeCastProfessionId === '') return;
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeRechargeCast(p, meta);
}

/** Start recharge + complete when the command admitted a cast. */
export function runRecharge(sim: Sim, professionId: string, pid?: number): void {
  const id = pid ?? sim.playerId;
  sim.rechargeToolEffect(professionId, id);
  completeRechargeCast(sim, id);
}

/** Start + complete when the command admitted a cast; denials leave no cast. */
export function runDisenchant(sim: Sim, itemId: string, pid?: number, slotIndex?: number): void {
  if (pid !== undefined && slotIndex !== undefined) {
    sim.disenchantItem(itemId, pid, slotIndex);
  } else if (pid !== undefined) {
    sim.disenchantItem(itemId, pid);
  } else {
    sim.disenchantItem(itemId);
  }
  completeEnchantFamilyCast(sim, pid ?? sim.playerId);
}

export function runSalvage(sim: Sim, itemId: string, pid?: number): void {
  sim.salvageItem(itemId, pid);
  completeEnchantFamilyCast(sim, pid ?? sim.playerId);
}

export function runApplyEnchant(
  sim: Sim,
  itemId: string,
  enchantId: string,
  slot?: import('../../src/sim/types').EquipSlot,
  confirmReplace?: boolean,
  pid?: number,
): void {
  sim.applyEnchant(itemId, enchantId, slot, confirmReplace, pid);
  completeEnchantFamilyCast(sim, pid ?? sim.playerId);
}
