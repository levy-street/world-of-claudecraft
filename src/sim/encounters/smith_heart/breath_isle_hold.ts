// The Islands of the Wind's leash on their adds (Jose's call of 2026-11-04:
// the isles' lips lie open, their outlines bitten into bays). A Gale
// Sentinel chasing a raider across a bay, or a Mender shoved by a knockback,
// would walk straight off the rim and drop into the void: so each add's last
// spot on its own isle's floor is kept, and a step that left that floor is
// undone, as the guardian is held to its Cornice (breath_void.ts
// tetherGuardian). Run after the mob AI moved them this tick. An add thrown
// up over its own isle is left to land; one carried off it any other way (a
// grip, a pull to the Cornice) is set back too: the isle is its post.
//
// Zero rng; positions are claim-local yards for the floor test.

import { BREATH_ISLES } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { isleAt } from './breath_isle_geometry';
import { living } from './breath_scope';
import type { BreathFightState } from './breath_state';

/** How far over or under its isle's floor (its ledges a stride up) an add
 *  still stands on it. */
const ADD_FLOOR_SLACK = 1.5;

/** Is a body at claim-local (x, z) and height y on isle `isle`'s floor? */
export function onIsleFloor(isle: number, x: number, z: number, y: number): boolean {
  return isleAt(x, z) === isle && Math.abs(y - BREATH_ISLES[isle].h) <= ADD_FLOOR_SLACK;
}

/** Hold every living add of the round to its isle's floor. */
export function holdIsleAdds(ctx: SimContext, inst: InstanceSlot, st: BreathFightState): void {
  const o = ctx.instanceOriginOf(inst);
  for (const a of st.isles.adds) {
    const e = ctx.entities.get(a.id);
    if (!living(e)) continue;
    const lx = e.pos.x - o.x;
    const lz = e.pos.z - o.z;
    if (onIsleFloor(a.isle, lx, lz, e.pos.y)) {
      if (a.floor) {
        a.floor.x = e.pos.x;
        a.floor.y = e.pos.y;
        a.floor.z = e.pos.z;
      } else a.floor = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      continue;
    }
    // Thrown up over its own isle (a knockback's arc): left to land.
    if (isleAt(lx, lz) === a.isle && e.pos.y > BREATH_ISLES[a.isle].h) continue;
    if (!a.floor) continue;
    e.pos.x = a.floor.x;
    e.pos.y = a.floor.y;
    e.pos.z = a.floor.z;
    e.prevPos = { ...e.pos };
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
    e.jumping = false;
    e.fallStartY = e.pos.y;
    ctx.rebucket(e);
  }
}
