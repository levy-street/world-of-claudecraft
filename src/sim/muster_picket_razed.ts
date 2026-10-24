// Is a warpath stop a razed muster picket? The one question Balgath's circuit asks of the
// Mirefen muster (mob/warpath.ts), split out so the generic warpath imports a leaf rather
// than the muster's whole lifecycle module (src/sim/mirefen_muster.ts).
//
// Pure read over the live muster state: no rng, no clock, no mutation.

import type { MusterArmyState } from './mirefen_muster';
import type { SimContext } from './sim_context';

/**
 * Whether the stop at (x, z) is a RAZED picket: soldiers are posted within `radius` of it
 * (the reach of the arrival slam that would land there) and every one of them is down.
 *
 * False for a stop nobody is posted at (it is not a picket, so nothing can raze it) and
 * before the muster is raised, so a warpather with no muster round his stops walks his
 * circuit exactly as before. Reads posts (spawnPos), not bodies, so a corpse lying where
 * the fist left it still counts for the picket it stood at.
 */
export function musterPicketRazed(
  ctx: SimContext,
  army: MusterArmyState,
  x: number,
  z: number,
  radius: number,
): boolean {
  let posted = 0;
  for (const id of army.soldierIds) {
    const s = ctx.entities.get(id);
    if (!s || Math.hypot(s.spawnPos.x - x, s.spawnPos.z - z) > radius) continue;
    posted++;
    if (!s.dead) return false;
  }
  return posted > 0;
}
