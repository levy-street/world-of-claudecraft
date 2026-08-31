import { addThreat } from '../threat';
import type { Entity } from '../types';

/** Pull every idle member of an explicitly authored dungeon pack. Placement
 * claims namespace the key by dungeon and slot, so this scan cannot cross raid
 * rooms or simultaneous instances even when their local pack labels match. */
export function aggroDungeonPackmates(
  entities: Iterable<Entity>,
  mob: Entity,
  target: Entity,
): void {
  if (!mob.dungeonPackId) return;
  for (const packmate of entities) {
    if (
      packmate.kind !== 'mob' ||
      packmate.id === mob.id ||
      packmate.dead ||
      !packmate.hostile ||
      packmate.aiState !== 'idle' ||
      packmate.ownerId !== null ||
      packmate.dungeonPackId !== mob.dungeonPackId
    ) {
      continue;
    }
    packmate.aiState = 'chase';
    packmate.aggroTargetId = target.id;
    packmate.inCombat = true;
    packmate.leashAnchor = { ...packmate.pos };
    addThreat(packmate, target.id, 1);
  }
}
