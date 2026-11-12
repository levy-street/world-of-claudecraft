// The wild beast a hunter tames is replaced after a delay: completeTame
// (pet/pet_commands.ts) queues a PendingMobRespawn on the live
// SimContext.pendingMobRespawns view, and the Sim's tick spawns the
// replacement through spawnPendingMobRespawn once its timer runs out.
// Moved out of sim.ts so the record can grow without growing the coordinator.
import { MOBS } from '../data';
import { createMob } from '../entity';
import type { Entity, Vec3 } from '../types';
import { spawnOpenWorldMob } from './open_world_tuning';

export interface PendingMobRespawn {
  templateId: string;
  level: number;
  pos: Vec3;
  facing: number;
  dungeonId: string | null;
  timer: number;
  /** The replaced mob idled off the shared stream (Entity.offStreamRng), as
   *  in an offStream camp: its replacement does too. */
  offStreamRng?: boolean;
}

/**
 * The replacement mob for an expired pending respawn, or null when its
 * template no longer exists (the caller then spends no entity id). Spawns
 * exactly as the inline Sim code did: a dungeon beast through createMob, an
 * open-world one through spawnOpenWorldMob.
 */
export function spawnPendingMobRespawn(
  pending: PendingMobRespawn,
  nextId: () => number,
): Entity | null {
  const template = MOBS[pending.templateId];
  if (!template) return null;
  const spawn = pending.dungeonId ? createMob : spawnOpenWorldMob;
  const mob = spawn(nextId(), template, pending.level, { ...pending.pos });
  mob.facing = pending.facing;
  mob.prevFacing = pending.facing;
  mob.dungeonId = pending.dungeonId;
  if (pending.offStreamRng) mob.offStreamRng = true;
  return mob;
}
