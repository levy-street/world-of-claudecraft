import { addThreat } from '../threat';
import type { Entity } from '../types';
import { patrolFlierAloft } from './patrol';

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
      // (a flying patrol on the wing is not hostile, and still lands with its pack)
      (!packmate.hostile && !patrolFlierAloft(packmate)) ||
      packmate.aiState !== 'idle' ||
      packmate.ownerId !== null ||
      packmate.dungeonPackId !== mob.dungeonPackId
    ) {
      continue;
    }
    // A flier pulled off its loop is a target from this tick.
    packmate.hostile = true;
    packmate.aiState = 'chase';
    packmate.aggroTargetId = target.id;
    packmate.inCombat = true;
    packmate.leashAnchor = { ...packmate.pos };
    addThreat(packmate, target.id, 1);
  }
}
