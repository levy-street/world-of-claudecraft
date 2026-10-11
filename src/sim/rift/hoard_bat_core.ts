// The Colossal Bat (a common/rare Buried Hoard cave boss), the pure half: every
// tunable. No rng, no DOM: the renderer imports this file.
//
// The rule: it hangs in the air over the party. It marks a straight lane and
// dives down it, bowling over whoever is still in it; it screeches (a cast any
// interrupt stops; left to finish it hurts and slows the whole room); and on a
// rare map it lets loose a swarm of small bats.
//
// Cues:
//   bat-dive     the lane it will dive: a narrow fan from it to the lane's end,
//                re-aimed at its mark while it takes aim
//   bat-screech  the reach of its screech, for as long as the cast runs

export const HOARD_BAT_BOSS_TEMPLATE = 'hoard_boss_bat';
export const HOARD_BAT_SWARMLING_TEMPLATE = 'hoard_bat_swarmling';

export const BAT = Object.freeze({
  // ---- Dive
  diveFirstSec: 6,
  diveEverySec: 13,
  diveAimSec: 1.6,
  diveSpeed: 26,
  /** A cave is small: the dive never runs further than this. */
  diveMaxYards: 30,
  /** The lane is drawn as a narrow fan from it (this half angle); what it hits is
   *  exactly that fan, never narrower than its own body next to it. */
  diveLaneHalfAngle: 0.075,
  diveBodyYards: 1.2,
  diveDamageFraction: 0.18,
  diveKnockback: 5,
  /** It hangs where it stopped for a breath after the dive. */
  diveRecoverSec: 0.8,
  // ---- Screech
  screechFirstSec: 11,
  screechEverySec: 19,
  screechCastSec: 2.4,
  screechDoubleCastSec: 1.9,
  screechRadius: 16,
  screechDamageFraction: 0.22,
  screechSlow: 0.5,
  screechSlowSec: 4,
  // ---- Swarm (rare maps only)
  swarmFirstSec: 15,
  swarmEverySec: 26,
  swarmCount: 4,
  swarmDoubleCount: 6,
  /** No new swarm while this many of its bats still fly. */
  swarmCap: 6,
});

/** Is a point in the dive lane: the drawn fan (ahead of it, inside its reach,
 *  within the half angle), never narrower than its body right next to it. */
export function pointInBatDive(
  from: { x: number; z: number },
  facing: number,
  reach: number,
  point: { x: number; z: number },
): boolean {
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  const along = dx * Math.sin(facing) + dz * Math.cos(facing);
  const across = dx * Math.cos(facing) - dz * Math.sin(facing);
  if (along < -0.5 || along > reach + 0.5) return false;
  const half = Math.max(BAT.diveBodyYards, Math.max(0, along) * Math.tan(BAT.diveLaneHalfAngle));
  return Math.abs(across) <= half;
}
