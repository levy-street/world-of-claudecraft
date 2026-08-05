// Live Source Cave contributor population. Claim and wipe reset share this seam
// so retired spectators and expired corpses can be rebuilt with fresh entity ids.

import { createMob } from '../entity';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { moduleWorldPoint } from './runtime';

/** Remove one cave mob without leaving stale player, pet, cast, or aggro targets. */
export function dropSourceCaveMob(ctx: SimContext, id: number): void {
  for (const entity of ctx.entities.values()) {
    if (entity.targetId === id) entity.targetId = null;
    if (entity.aggroTargetId === id) entity.aggroTargetId = null;
    if (entity.castTargetId === id) entity.castTargetId = null;
  }
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** Spawn the complete visible contributor roster into one claimed cave instance. */
export function spawnSourceCaveMobs(ctx: SimContext, inst: InstanceSlot): Map<string, number> {
  const cave = ctx.sourceCave;
  const mobIdsByLogin = new Map<string, number>();
  if (!cave) return mobIdsByLogin;
  const origin = ctx.instanceOriginOf(inst);
  for (let i = 0; i < cave.spec.mobs.length; i++) {
    const mobSpec = cave.spec.mobs[i];
    const template = cave.templates[i];
    const mob = createMob(
      ctx.nextId++,
      template,
      mobSpec.level,
      moduleWorldPoint(ctx, cave, origin, mobSpec.moduleIndex, mobSpec.x, mobSpec.z),
    );
    mob.facing = Math.PI;
    mob.prevFacing = mob.facing;
    mob.hostile = false;
    ctx.addEntity(mob);
    inst.mobIds.push(mob.id);
    mobIdsByLogin.set(mobSpec.login, mob.id);
  }
  return mobIdsByLogin;
}

/** Drop every surviving/corpse entity and rebuild the complete static roster. */
export function replaceSourceCaveMobs(ctx: SimContext, inst: InstanceSlot): Map<string, number> {
  for (const id of inst.mobIds) dropSourceCaveMob(ctx, id);
  inst.mobIds.length = 0;
  return spawnSourceCaveMobs(ctx, inst);
}
