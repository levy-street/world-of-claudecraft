// Claim plumbing for the Gravewyrm Sanctum encounters: the live Sanctum
// claims, the Sanctum's own ephemeral encounter objects (the soulfire patches),
// and the planted hold a body keeps while a bar runs. The claim-generic reads
// (its players, bosses, mechanic damage, the deed grant, "is the boss in its
// fight", the boss bar) are the Sunken Bastion's, written claim-generic and
// shared here rather than copied. Zero rng.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { SANCTUM_DUNGEON } from './ids';

export {
  bossEngaged,
  claimBoss,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  startBar,
} from '../sunken_bastion/claim';

/** Every live Gravewyrm Sanctum claim. */
export function sanctumClaims(ctx: SimContext): InstanceSlot[] {
  return ctx.instances.filter((i) => i.partyKey !== null && i.dungeonId === SANCTUM_DUNGEON);
}

/** An ephemeral Sanctum encounter object (a soulfire patch): added to the
 *  claim's object roster so a freed claim drops it with everything else. Its
 *  template id carries its look, `scale` its radius. World coordinates. */
export function spawnSanctumObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  x: number,
  z: number,
  scale: number,
): Entity {
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(x, z));
  obj.templateId = templateId;
  obj.dungeonId = SANCTUM_DUNGEON;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = scale;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj;
}

/** Hold a body where it braced for its bar (the mob AI may walk it). */
export function holdPlanted(
  ctx: SimContext,
  mob: Entity,
  at: { x: number; y: number; z: number },
): void {
  if (mob.pos.x === at.x && mob.pos.z === at.z) return;
  mob.pos.x = at.x;
  mob.pos.y = at.y;
  mob.pos.z = at.z;
  ctx.rebucket(mob);
}
