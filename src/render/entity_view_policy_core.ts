// Pure policy for which world entities receive and retain renderer views.
// Candidate storage stays in view_candidate_pool_core; this module owns only
// entity classification and lifecycle decisions.

import type { Entity, QuestProgress } from '../sim/types';
import { interactionLandmarkViewPriority } from './prewarm_policy';
import type { QuestObjectGate } from './quest_object_gate_core';

export function isPersistentPortalObject(entity: Entity): boolean {
  return (
    entity.kind === 'object' &&
    (entity.templateId === 'dungeon_door' || entity.templateId === 'dungeon_exit')
  );
}

export function entityViewDistanceSq(a: Entity, b: Entity): number {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  return dx * dx + dz * dz;
}

export function entityViewIsAdmitted(
  entity: Entity,
  questLog: Map<string, QuestProgress>,
  questObjectHidden: QuestObjectGate,
): boolean {
  return !questObjectHidden(entity, questLog);
}

export function entityViewCandidatePriority(entity: Entity, player: Entity, d2: number): number {
  if (entity.id === player.id) return -100;
  if (entity.id === player.targetId) return -90;
  if (entity.kind === 'mob' && entity.hostile && d2 <= 35 * 35) return 0;
  if (entity.kind === 'npc' && d2 <= 45 * 45) return 1;
  const landmarkPriority = interactionLandmarkViewPriority(entity.templateId, d2);
  if (landmarkPriority !== null) return landmarkPriority;
  if (entity.kind === 'object' && (entity.lootable || isPersistentPortalObject(entity))) return 2;
  if (entity.kind === 'player') return 3;
  if (entity.kind === 'mob' && entity.hostile) return 4;
  if (entity.kind === 'mob') return 5;
  if (entity.kind === 'npc') return 6;
  if (entity.kind === 'object') return 7;
  return 9;
}

export function entityViewShouldDrop(
  entity: Entity | undefined,
  player: Entity,
  questLog: Map<string, QuestProgress>,
  questObjectHidden: QuestObjectGate,
  destroyRangeSq: number,
): boolean {
  if (!entity || !entityViewIsAdmitted(entity, questLog, questObjectHidden)) return true;
  return (
    !isPersistentPortalObject(entity) &&
    entity.id !== player.id &&
    entity.id !== player.targetId &&
    entityViewDistanceSq(entity, player) > destroyRangeSq
  );
}
