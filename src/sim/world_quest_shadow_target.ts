import { SHADOW_GUARDS, SHADOW_QUEST_ID } from './content/world_quest_shadow';
import type { Entity, WorldQuestProgress } from './types';
import { shadowBehindCarrier } from './world_quest_shadow_patrol';

export interface ShadowTargetWorld {
  player: Pick<Entity, 'pos' | 'targetId' | 'dead'>;
  entities: ReadonlyMap<number, Entity>;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
}

export function shadowNearbyCarrier(
  world: ShadowTargetWorld,
  requireBehind = false,
): number | undefined {
  const stolen = world.worldQuestLog.get(SHADOW_QUEST_ID)?.creditedObjects ?? [];
  const selected = world.player.targetId;
  let nearest: number | undefined;
  let distance = 2.5;
  for (const guard of SHADOW_GUARDS) {
    if (guard.sentry || stolen.includes(String(guard.entityId))) continue;
    const entity = world.entities.get(guard.entityId);
    if (!entity || entity.dead) continue;
    const d = Math.hypot(entity.pos.x - world.player.pos.x, entity.pos.z - world.player.pos.z);
    if (d > 2.5 || Math.abs(entity.pos.y - world.player.pos.y) > 3) continue;
    if (selected === entity.id)
      return !requireBehind || shadowBehindCarrier(world.player.pos, entity)
        ? entity.id
        : undefined;
    if (requireBehind && !shadowBehindCarrier(world.player.pos, entity)) continue;
    if (d <= distance) {
      nearest = entity.id;
      distance = d;
    }
  }
  return nearest;
}

export function shadowPickpocketTarget(world: ShadowTargetWorld): number | undefined {
  return shadowNearbyCarrier(world, true);
}
