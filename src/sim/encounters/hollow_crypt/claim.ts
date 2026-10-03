// Claim plumbing for the Hollow Crypt finale: the live crypt claims and the
// crypt's own ephemeral encounter objects. The claim-generic reads (its
// players, bosses, mechanic damage, the deed grant, "is the boss in its
// fight") are the Sunken Bastion's, shared rather than copied. Zero rng.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

export { clearCastOf, startCast } from '../drowned_temple/claim';
export {
  bossEngaged,
  claimBoss,
  claimPlayers,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
} from '../sunken_bastion/claim';

export const CRYPT_DUNGEON = 'hollow_crypt';

/** Every live Hollow Crypt claim. */
export function cryptClaims(ctx: SimContext): InstanceSlot[] {
  return ctx.instances.filter((i) => i.partyKey !== null && i.dungeonId === CRYPT_DUNGEON);
}

/** An ephemeral crypt encounter object (the burning ritual circle, a burning
 *  lane): in the claim's object roster, so a freed claim drops it with
 *  everything else. Its template id carries its look, `facing` a lane's yaw
 *  and `scale` its size (a radius, a length). */
export function spawnCryptObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  lx: number,
  lz: number,
  facing: number,
  scale: number,
): Entity {
  const o = ctx.instanceOriginOf(inst);
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(o.x + lx, o.z + lz));
  obj.templateId = templateId;
  obj.dungeonId = CRYPT_DUNGEON;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = facing;
  obj.prevFacing = facing;
  obj.scale = scale;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj;
}
