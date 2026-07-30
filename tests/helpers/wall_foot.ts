// A real terrain WALL FOOT in the current generated world: a cell with FLAT
// footing (so no downhill slide fires) that still has terrain steeper than the
// climb limit within one body radius, which is exactly the situation
// `terrainWallStandoff` exists to ease the player out of.
//
// The wall-standoff tests used to hardcode the strip world's western rim wall
// (x ~ -150, z 555..645). The 2D atlas-grid world replaced that rim with sealed
// border ridges elsewhere, so those literals now sit on open ground and the tests
// asserted a push that could never happen. These fixtures are validated against
// the real heightfield on every lookup, so a world change fails loudly instead
// of silently turning the tests into no-ops.
//
// Do not rediscover the fixture during a test run. A continent-wide scan calls
// the heightfield hundreds of thousands of times and used to make two otherwise
// tiny tests consume the entire 20-second budget under suite load. Coordinates
// are test data; the assertions below are the contract that makes them safe.

import {
  groundHeight,
  terrainSteepnessAt,
  terrainWallStandoff,
  WATER_LEVEL,
} from '../../src/sim/world';

export interface WallFoot {
  /** A standable cell within a body radius of a wall. */
  x: number;
  z: number;
  /** How far the standoff eases a body out of the wall here. */
  push: number;
  /** Unit vector pointing INTO the wall (the standoff pushes the opposite way). */
  intoWallX: number;
  intoWallZ: number;
  /** Facing (sim convention: 0 = +z, dir = (sin f, cos f)) that walks into the wall. */
  facingIntoWall: number;
}

const cache = new Map<string, WallFoot | null>();

const WALL_FOOT_ANCHORS = new Map<number, { x: number; z: number }>([[20061, { x: 704, z: 624 }]]);

/** Return a pinned wall foot after proving it still satisfies the live terrain
 * contract. `minPush` rejects a wall that is only barely in reach. */
export function wallFootFixture(
  seed: number,
  bodyRadius: number,
  maxSlope: number,
  minPush = 0.2,
): WallFoot {
  const key = `${seed}:${bodyRadius}:${maxSlope}:${minPush}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    if (hit === null) throw new Error(`stale wall-foot fixture for seed ${seed}`);
    return hit;
  }
  const anchor = WALL_FOOT_ANCHORS.get(seed);
  if (!anchor) throw new Error(`missing wall-foot fixture for seed ${seed}`);

  const { x, z } = anchor;
  const dry = groundHeight(x, z, seed) >= WATER_LEVEL + 0.4;
  const flat = terrainSteepnessAt(x, z, seed) < 1.0;
  const standoff = terrainWallStandoff(x, z, seed, bodyRadius, maxSlope);
  const dx = standoff.x - x;
  const dz = standoff.z - z;
  const push = Math.hypot(dx, dz);
  if (!dry || !flat || push < minPush || push > bodyRadius + 1e-9) {
    cache.set(key, null);
    throw new Error(
      `stale wall-foot fixture for seed ${seed}: dry=${dry}, flat=${flat}, push=${push}`,
    );
  }

  const fixture: WallFoot = {
    x,
    z,
    push,
    intoWallX: -dx / push,
    intoWallZ: -dz / push,
    facingIntoWall: Math.atan2(-dx / push, -dz / push),
  };
  cache.set(key, fixture);
  return fixture;
}
