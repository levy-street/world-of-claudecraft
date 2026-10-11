// The evade "walk home" for an authored-immobile mob (moveSpeed 0: the
// Broodmother egg clutch, the Drakelands sac puzzle objects). The locomotion
// evade arm walks a mob back to its spawn point with moveToward, which arrives
// only when the mob steps inside the arrival band; a zero step never gets
// there. A mob shoved off its spawn point (a player aoeKnockback lands on every
// hostile in radius, eggs included) that later evaded (its last attacker died,
// ran off, or logged out) therefore stayed in 'evade' forever, immune to every
// hit: the "invincible Broodmother Egg" report. An immobile mob has nowhere to
// walk, so its walk home is a snap: put it back on the spawn point and let the
// shared resetEvadingMob run on the same tick. Pure, no ctx, no rng, no clock.
import type { Entity } from '../types';

/** Snap an immobile mob onto its spawn point. Returns false, touching nothing,
 *  for a mob that can walk (it takes the normal evade walk instead).
 *
 *  The guard reads the LIVE moveSpeed on purpose: "a zero step never arrives"
 *  is a fact about the speed the walk would use, not about the template.
 *  Slows go through moveSpeedMult, so today only an authored 0 reaches it.
 *  spawnPos.y is kept as is (camp spawns already sit on groundHeight, and an
 *  instance spawn's y is not a world ground sample), and the spatial grid
 *  re-buckets at the end of the tick like every other in-tick teleport. */
export function immobileEvadeSnapsHome(mob: Entity): boolean {
  if (mob.moveSpeed > 0) return false;
  mob.pos = { ...mob.spawnPos };
  mob.prevPos = { ...mob.pos };
  return true;
}
