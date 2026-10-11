// The trash engine's breath pool (TrashKitDef.breathPool): where a mob's
// template breath cone (MobTemplate.breathCone, mob/mob_cast_bars.ts) lands,
// it leaves a hazard pool on the floor in front of it, centred `ahead` yards
// along the facing the breath was drawn with (the Sanctum Scaleguard's heroic
// Boiling Meltwater: the cinders melt the ice into scalding water). The tank
// walks the mob off its own pools. `heroicOnly` keeps it to heroic claims.
//
// Called by tickBreathConeBar the tick the cone lands, after its damage; a
// no-op (one template read) for every breath without a pool. Zero rng here;
// the pool draws its rolls on its own beats (kit_hazard.ts).

import { claimedInstanceAt } from '../../instances/dungeons';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { spawnKitHazard } from './kit_hazard';
import { kitOf } from './kit_of';

/** The breath landed: leave its pool. Returns the pool, or null. */
export function landBreathPool(ctx: SimContext, mob: Entity): Entity | null {
  const def = kitOf(mob)?.breathPool;
  if (!def) return null;
  const inst = claimedInstanceAt(ctx, mob.pos);
  if (!inst || !inst.mobIds.includes(mob.id)) return null;
  if (def.heroicOnly && inst.difficulty !== 'heroic') return null;
  const x = mob.pos.x + Math.sin(mob.facing) * def.ahead;
  const z = mob.pos.z + Math.cos(mob.facing) * def.ahead;
  return spawnKitHazard(ctx, inst, mob, def.hazard, x, z);
}
