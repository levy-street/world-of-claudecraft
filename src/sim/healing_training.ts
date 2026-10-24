import {
  HEALING_TRAINING_ENTITY_IDS,
  HEALING_TRAINING_GROUND_SPAWNS,
} from './content/healing_training';
import { HUB_SPARRING_MASTER_ID } from './content/practice_dummies';
import { MOBS } from './data';
import { createMob } from './entity';
import { playerDummyRestHp } from './mob/practice_dummies';
import { objectRemoved, practiceDummyFacing, practiceDummyPos } from './moved_objects';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

/**
 * Spawns the Eastbrook Healing Training Ground allies.
 * Uses reserved high-range ids, preserving the ordinary nextId stream and
 * byte-identical world generation up to the practice entities.
 */
export function healingTrainingGroundEnabled(world: WorldContent): boolean {
  return world.npcs[HUB_SPARRING_MASTER_ID] !== undefined;
}

export function spawnHealingTrainingGround(ctx: SimContext, world: WorldContent): void {
  if (!healingTrainingGroundEnabled(world)) return;
  for (const spawn of HEALING_TRAINING_GROUND_SPAWNS) {
    const template = MOBS[spawn.mobId];
    if (!template) continue;
    const entityId = HEALING_TRAINING_ENTITY_IDS[spawn.mobId];
    if (ctx.entities.has(entityId)) continue;
    // A Studio map may move, turn or delete a dummy (moved_objects.ts); its
    // reserved id stays, so a deleted one simply never spawns.
    if (objectRemoved(world.objectMoves, 'practiceDummy', spawn.mobId)) continue;
    const pos = practiceDummyPos(world.objectMoves, spawn.mobId, spawn.pos);
    const dummy = createMob(entityId, template, template.maxLevel, ctx.groundPos(pos.x, pos.z));
    dummy.facing = practiceDummyFacing(world.objectMoves, spawn.mobId, -Math.PI / 2);
    dummy.prevFacing = dummy.facing;
    dummy.hp = playerDummyRestHp(dummy.maxHp, template.restHpFraction);
    ctx.addEntity(dummy);
  }
}
