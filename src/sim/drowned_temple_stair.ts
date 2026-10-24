// The Moon Stair's walk surface: the dais the Drowned Temple's moongate stands
// on (door (-70, 792), Thornpeak Heights) and the built flight that climbs the
// gully to it from the old lake shelf. The gully under the stair is a V a yard
// or two deeper than the level treads, so the masonry is a real mass over the
// terrain: it lives in groundHeight through walk_lifts.ts as an ABSOLUTE
// surface (the Forgefather stair ramps' idiom, a max with the ground, so the
// flight runs out into the bed and the dais into the bank with no step), never
// in terrainHeight. The gully it is fitted to is the SHIPPED world's (the
// ground here is not stamped, so every other seed carves a different one):
// off WORLD_SEED the surface adds nothing, and a test world or the headless
// env keeps its own natural ground at the door. Pure leaf: deterministic, no
// rng, one import (the seed, itself a leaf). The models and what collides are
// src/sim/drowned_temple_entrance.ts.
import { WORLD_SEED } from './world_seed';
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), heights above the door's own terrain height.

/** The door and the terrain height under it on the shipped world seed
 *  (tests/drowned_temple_entrance.test.ts pins y against terrainHeight). */
export const DROWNED_TEMPLE_STAIR_DOOR = { x: -70, z: 792, y: 6.623246433153554 } as const;

export const DROWNED_TEMPLE_STAIR = {
  /** The dais floor. */
  dais: 0.8,
  /** The dais: half its width, and its south and north edges (lz). */
  daisHalfWidth: 7.2,
  daisZ0: -2.6,
  daisZ1: 2.4,
  /** Past its ends the dais steps down to the bank at this fall per yard. */
  daisEndFall: 0.6,
  /** The flight: it starts at the dais' south edge; tread depth, riser and
   *  count (the lowest three stand under the mirror's water). */
  tread: 0.46,
  riser: 6.65 / 23,
  treads: 26,
  /** Half the flight's width between its cheek walls; south of flareZ the
   *  flight fans out by `flare` yards a yard into the water. */
  halfWidth: 3,
  flareZ: -10.88,
  flare: 0.42,
  /** The breach in the west cheek beside Ondrel's post (lz from, to): the
   *  flight's stone runs out through it and down to the bank. */
  breachZ0: -7.0,
  breachZ1: -4.44,
  breachReach: 1.7,
  breachFall: 0.75,
} as const;

const S = DROWNED_TEMPLE_STAIR;
const FLIGHT_END = S.daisZ0 - S.treads * S.tread;

/** Half the flight's width at lz. */
export function drownedTempleStairHalfWidth(lz: number): number {
  return lz >= S.flareZ ? S.halfWidth : S.halfWidth + (S.flareZ - lz) * S.flare;
}

/** The flight's ramp at lz: the line through the middle of every tread. */
function flightAt(lz: number): number {
  return S.dais - ((S.daisZ0 - lz) / S.tread + 0.5) * S.riser;
}

/**
 * The surface above the door's terrain height at a door-local point, or
 * -Infinity where the set piece adds nothing to walk on.
 */
export function drownedTempleStairLocalSurface(lx: number, lz: number): number {
  if (lz > S.daisZ1 || lz < FLIGHT_END) return Number.NEGATIVE_INFINITY;
  const ax = Math.abs(lx);
  if (lz >= S.daisZ0) {
    const over = ax - S.daisHalfWidth;
    if (over <= 0) return S.dais;
    return over < 6 ? S.dais - over * S.daisEndFall : Number.NEGATIVE_INFINITY;
  }
  if (ax <= drownedTempleStairHalfWidth(lz)) return flightAt(lz);
  if (lx > 0 && lz >= S.breachZ0 && lz <= S.breachZ1 && lx <= S.halfWidth + S.breachReach) {
    return flightAt(lz) - (lx - S.halfWidth) * S.breachFall;
  }
  return Number.NEGATIVE_INFINITY;
}

/** The ABSOLUTE walk surface at a world point, or -Infinity outside the set
 *  piece and on every seed but the shipped one (the walk_lifts max then leaves
 *  the ground untouched). */
export function drownedTempleStairSurface(x: number, z: number, seed: number): number {
  if (seed !== WORLD_SEED) return Number.NEGATIVE_INFINITY;
  const lx = x - DROWNED_TEMPLE_STAIR_DOOR.x;
  if (lx < -14 || lx > 14) return Number.NEGATIVE_INFINITY;
  const local = drownedTempleStairLocalSurface(lx, z - DROWNED_TEMPLE_STAIR_DOOR.z);
  return local === Number.NEGATIVE_INFINITY ? local : DROWNED_TEMPLE_STAIR_DOOR.y + local;
}
