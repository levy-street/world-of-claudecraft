// Ephemeral, entity-worn state for World Quest delivery objectives.
//
// The delivered count belongs to WorldQuestProgress and is persisted. The crate in
// the player's hands does not: it is a public aura so every client can render it,
// while death, leaving the work area, a disconnect, or completing the delivery
// removes it without ever touching bags or character saves.

import type { SimContext } from './sim_context';
import type { Entity } from './types';

export const WORLD_QUEST_DELIVERY_AURA_ID = 'world_quest_delivery_cargo';
export const WORLD_QUEST_DELIVERY_SPEED_MULT = 0.75;

export function hasWorldQuestDeliveryCargo(entity: Pick<Entity, 'auras'>): boolean {
  return entity.auras.some(
    (aura) => aura.id === WORLD_QUEST_DELIVERY_AURA_ID && aura.kind === 'world_quest_cargo',
  );
}

export function takeWorldQuestDeliveryCargo(ctx: SimContext, entity: Entity): boolean {
  if (hasWorldQuestDeliveryCargo(entity)) return false;
  // Freight is carried on foot. This also cancels an in-flight mount summon.
  ctx.forceDismount(entity);
  ctx.applyAura(entity, {
    id: WORLD_QUEST_DELIVERY_AURA_ID,
    name: 'Carrying Freight',
    kind: 'world_quest_cargo',
    value: WORLD_QUEST_DELIVERY_SPEED_MULT,
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    sourceId: entity.id,
    school: 'physical',
  });
  return true;
}

export function dropWorldQuestDeliveryCargo(ctx: SimContext, entity: Entity): boolean {
  const index = entity.auras.findIndex(
    (aura) => aura.id === WORLD_QUEST_DELIVERY_AURA_ID && aura.kind === 'world_quest_cargo',
  );
  if (index < 0) return false;
  const [aura] = entity.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: entity.id,
    name: aura.name,
    gained: false,
    sourceId: aura.sourceId,
    abilityId: aura.id,
  });
  return true;
}
