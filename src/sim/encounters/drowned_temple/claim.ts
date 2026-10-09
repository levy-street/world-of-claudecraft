// Claim plumbing for the Drowned Temple encounters: the live Temple claims and
// the Temple's own ephemeral encounter objects. The claim-generic reads (its
// players, bosses, objects, mechanic damage, the deed grant, "is the boss in
// its fight") are the Sunken Bastion's, which were written claim-generic and
// are shared here rather than copied. Zero rng.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

export {
  bossEngaged,
  claimBoss,
  claimObjectAt,
  claimPlayers,
  dropEncounterObject,
  grantClaimDeed,
  localOf,
  mechanicDamage,
} from '../sunken_bastion/claim';

export const TEMPLE_DUNGEON = 'drowned_temple';

/** Every live Drowned Temple claim. */
export function templeClaims(ctx: SimContext): InstanceSlot[] {
  return ctx.instances.filter((i) => i.partyKey !== null && i.dungeonId === TEMPLE_DUNGEON);
}

/** An ephemeral Temple encounter object (a spit pool, an echo, a tide half):
 *  added to the claim's object roster so a freed claim drops it with
 *  everything else. Its template id carries its look; `scale` its radius. */
export function spawnTempleObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  lx: number,
  lz: number,
  scale: number,
): Entity {
  const o = ctx.instanceOriginOf(inst);
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(o.x + lx, o.z + lz));
  obj.templateId = templateId;
  obj.dungeonId = TEMPLE_DUNGEON;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = scale;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj;
}

/** Clear a boss's (or an add's) cast bar when it carries `castId`. */
export function clearCastOf(e: Entity, castId: string): void {
  if (e.castingAbility !== castId) return;
  e.castingAbility = null;
  e.castRemaining = 0;
  e.castTotal = 0;
  e.castTargetId = null;
  e.channeling = false;
}

/** Start a real cast bar on a boss. */
export function startCast(
  e: Entity,
  castId: string,
  seconds: number,
  targetId: number | null,
  channel = false,
): void {
  e.castingAbility = castId;
  e.castTotal = seconds;
  e.castRemaining = seconds;
  e.castTargetId = targetId;
  e.channeling = channel;
}
