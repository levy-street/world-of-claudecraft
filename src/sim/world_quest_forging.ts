import {
  FORGE_INTERACT_RANGE,
  FORGE_NPC_DEF,
  FORGE_NPC_ID,
  FORGE_QUEST_ID,
  FORGE_STATIONS,
} from './content/world_quest_forging';
import { createGroundObject, createNpc } from './entity';
import {
  advanceForgeWorkshop,
  createForgeWorkshop,
  stokeForge,
  strikeForge,
} from './minigames/forge_workshop';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, INTERACT_RANGE, type WorldQuestProgress } from './types';
import { emitWorldQuestScore } from './world_quest_score_events';

export function forgeStationForEntity(entity: Entity) {
  return FORGE_STATIONS.find(
    (station) =>
      station.entityId === entity.id &&
      entity.kind === 'object' &&
      entity.templateId === `ground_${station.objectItemId}` &&
      entity.objectItemId === station.objectItemId &&
      Math.hypot(entity.pos.x - station.x, entity.pos.z - station.z) < 0.1,
  );
}

export function ensureForgeWorkshop(ctx: SimContext): void {
  if (ctx.cfg.world && !ctx.cfg.world.npcs[FORGE_NPC_DEF.id]) return;
  if (!ctx.entities.has(FORGE_NPC_ID))
    ctx.addEntity(
      createNpc(
        FORGE_NPC_ID,
        FORGE_NPC_DEF,
        ctx.groundPos(FORGE_NPC_DEF.pos.x, FORGE_NPC_DEF.pos.z),
      ),
    );
  for (const station of FORGE_STATIONS) {
    if (!ctx.entities.has(station.entityId))
      ctx.addEntity(
        createGroundObject(
          station.entityId,
          station.objectItemId,
          station.name,
          ctx.groundPos(station.x, station.z),
        ),
      );
  }
}

function canWork(ctx: SimContext, player: Entity): boolean {
  return (
    !player.dead &&
    !player.inCombat &&
    !player.mountKey &&
    player.chargeTargetId === null &&
    !player.leap &&
    !player.climb &&
    !player.valkyrsCalling &&
    Math.hypot(player.pos.x - FORGE_NPC_DEF.pos.x, player.pos.z - FORGE_NPC_DEF.pos.z) <=
      FORGE_INTERACT_RANGE &&
    Math.abs(player.pos.y - ctx.groundPos(player.pos.x, player.pos.z).y) < 3
  );
}

export function clearForgeWorkshop(meta: PlayerMeta, progress: WorldQuestProgress): void {
  if (!progress.forging) return;
  delete progress.forging;
  meta.wireRev++;
}

export function startForgeWorkshop(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
  progress: WorldQuestProgress,
): void {
  if (
    npc.id !== FORGE_NPC_ID ||
    npc.templateId !== FORGE_NPC_DEF.id ||
    npc.kind !== 'npc' ||
    npc.dead ||
    Math.hypot(npc.pos.x - FORGE_NPC_DEF.pos.x, npc.pos.z - FORGE_NPC_DEF.pos.z) > 0.1 ||
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE + 2 ||
    !canWork(ctx, player)
  )
    return;
  if (
    progress.forging &&
    progress.forging.phase !== 'success' &&
    progress.forging.phase !== 'failed'
  )
    return;
  progress.forging = createForgeWorkshop(
    Math.imul(meta.entityId, 0x45d9f3b) ^ ctx.tickCount,
    ctx.time,
  );
  meta.wireRev++;
}

export function updateForgeWorkshop(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  progress: WorldQuestProgress,
): void {
  if (!progress.forging) return;
  if (!canWork(ctx, player)) {
    clearForgeWorkshop(meta, progress);
    return;
  }
  if (advanceForgeWorkshop(progress.forging, ctx.time)) meta.wireRev++;
}

/** The canonical quest module alone owns completion and reward credit. */
export function respondForgeWorkshop(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  object: Entity,
  progress: WorldQuestProgress,
): boolean {
  const station = forgeStationForEntity(object);
  if (
    !station ||
    progress.questId !== FORGE_QUEST_ID ||
    !canWork(ctx, player) ||
    Math.hypot(player.pos.x - object.pos.x, player.pos.z - object.pos.z) > FORGE_INTERACT_RANGE ||
    Math.abs(player.pos.y - object.pos.y) > FORGE_INTERACT_RANGE
  )
    return false;
  const state = progress.forging;
  if (!state) return false;
  // The anvil is the hammer blow, the woodpile the stoke; the ingot crate and
  // the well stay scenery of the workshop (ordinary props, no input).
  const accepted =
    station.id === 'tools'
      ? strikeForge(state, ctx.time)
      : station.id === 'fuel'
        ? stokeForge(state, ctx.time)
        : false;
  if (!accepted) return false;
  meta.wireRev++;
  if (state.phase !== 'success' || !state.result) return false;
  if (!progress.forgeResult || state.result.adjustedTime < progress.forgeResult.adjustedTime) {
    progress.forgeResult = { ...state.result };
    emitWorldQuestScore(
      ctx,
      meta.entityId,
      FORGE_QUEST_ID,
      state.result.rating,
      state.result.adjustedTime,
    );
  }
  return true;
}
