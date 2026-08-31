import { resetDungeonMinibossStomp } from '../mob/dungeon_miniboss_stomp';
import type { DungeonSpawnMinibossTuning, Entity } from '../types';

/** Applies a placement-local miniboss promotion after difficulty has shaped the spawn. */
export function applyDungeonSpawnMinibossTuning(
  mob: Entity,
  tuning: DungeonSpawnMinibossTuning | undefined,
): void {
  if (!tuning) return;
  mob.maxHp = Math.round(mob.maxHp * tuning.healthMultiplier);
  mob.hp = mob.maxHp;
  mob.scale = tuning.scale;
  mob.dungeonSpawnMiniboss = true;
  resetDungeonMinibossStomp(mob);
  if (tuning.ccImmune !== undefined) mob.ccImmune = tuning.ccImmune;
  if (tuning.slowImmune !== undefined) mob.slowImmune = tuning.slowImmune;
}
