// The Fire and Fly Shockwave on screen, the pure half: the stone chips the slam
// knocks off the tower's plinth, and the wall of beige dust with its thin line
// of warm sparks that rolls out from the tower's wall to the reach on the SAME
// front the sim throws the monsters with (turretShockwaveFront), so the dust
// touches each monster on the tick it flies. The painter is
// turret_shockwave_visual.ts, on the cannon's pooled puff bursts
// (cannon_puff_burst_core.ts); the head's hop is turret_tower_core.ts.
//
// The front is linear in time and held at the reach once rolled, so each wall
// puff rides it as a flight at the front's speed that halts when the front
// does (CannonPuff.halt): its distance from the tower is the front's at every
// instant, sampled from the sim's own curve at the ends of the roll.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a hash
// of the ring and the puff's index) and allocation-free after construction.

import { TURRET_SHOCKWAVE } from '../sim/content/turret_defense';
import { FIRE_AND_FLY_TOWER } from '../sim/fire_and_fly_field';
import { turretShockwaveFront } from '../sim/minigames/turret_shockwave';
import { DT } from '../sim/types';
import {
  CANNON_DIRT_GRAVITY,
  CANNON_PUFF_STYLES,
  type CannonPuff,
  cannonHash01,
  cannonPuffLaunch,
  cannonTierAlpha,
  PUFF,
} from './cannon_puff_core';

export const TURRET_SHOCKWAVE_LOOK = {
  /** How far behind the front a wall puff's centre rides (yd): its leading edge is the front. */
  wallBack: 0.55,
  /** The wall puffs' centre over the ground (yd) and their size as the ring grows (yd). */
  wallLift: 0.75,
  wallSize0: 1.2,
  wallSize1: 2.3,
  /** The wall's peak opacity against a blast's shock ring puff (a wall, not a ring of wisps). */
  wallDensity: 2.2,
  /** Seconds the wall hangs at the reach, fading, once the front has stopped. */
  linger: 0.45,
  /** How far ahead of the front the sparks skim (yd), and how high (yd). */
  sparkLead: 0.3,
  sparkLift: 0.18,
  sparkLife: 0.22,
  /** Camera trauma and FOV punch of the slam (the renderer squares trauma). */
  shake: 0.75,
  fovPunch: 3,
  /** The pale cracked mark's half-width around the foot (yd). */
  markHalf: 4,
} as const;

/** Cosmetic counts per Shockwave (the low preset sheds these; its wall carries the same opacity). */
export interface TurretShockwaveCounts {
  wall: number;
  sparks: number;
  chips: number;
}

const FULL_COUNTS: Readonly<TurretShockwaveCounts> = { wall: 36, sparks: 24, chips: 14 };
const LOW_COUNTS: Readonly<TurretShockwaveCounts> = { wall: 18, sparks: 10, chips: 6 };

export function turretShockwaveCounts(low: boolean): Readonly<TurretShockwaveCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

/** The most puffs one front launches (its wall and sparks) and one slam (its chips). */
export const TURRET_SHOCKWAVE_FRONT_PUFFS = FULL_COUNTS.wall + FULL_COUNTS.sparks;
export const TURRET_SHOCKWAVE_CHIP_PUFFS = FULL_COUNTS.chips;

/** Seconds the front takes from the tower's wall to the reach. */
export const TURRET_SHOCKWAVE_ROLL_SECONDS = TURRET_SHOCKWAVE.rollTicks * DT;

/** Seconds a front's puffs can live: the roll, then the wall's linger. */
export const TURRET_SHOCKWAVE_FRONT_LIFE =
  TURRET_SHOCKWAVE_ROLL_SECONDS + TURRET_SHOCKWAVE_LOOK.linger;

/** Seconds a slam's chips can live. */
export const TURRET_SHOCKWAVE_CHIP_LIFE = 1.3;

/** The front's distance from the tower's centre `seconds` after the slam: the sim's curve. */
export function turretShockwaveRadiusAt(seconds: number): number {
  return turretShockwaveFront(seconds / DT);
}

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;

/**
 * Launches the front's wall and spark line around the tower at (cx, cz) into
 * `out` from index 0 and returns how many; `seed` is the ring. Each wall puff
 * leaves the tower's wall with the front and halts where it does, its centre
 * `wallBack` behind it; each spark shows up on the front a little ahead of it,
 * skimming the ground, and stops with it. The ground is sampled once per puff,
 * where it starts and where it stops, never per frame.
 */
export function turretShockwaveFrontPuffs(
  out: CannonPuff[],
  seed: number,
  cx: number,
  cz: number,
  counts: Readonly<TurretShockwaveCounts>,
  ground: (x: number, z: number) => number,
  centreY: number,
): number {
  const look = TURRET_SHOCKWAVE_LOOK;
  const roll = TURRET_SHOCKWAVE_ROLL_SECONDS;
  const from = turretShockwaveRadiusAt(0);
  const to = turretShockwaveRadiusAt(roll);
  const speed = roll > 0 ? (to - from) / roll : 0;
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x51c3, i * 16 + k);
  const floorAt = (x: number, z: number): number => {
    const g = ground(x, z);
    return Number.isFinite(g) ? g : centreY;
  };
  const dense = CANNON_PUFF_STYLES[PUFF.shock].alpha * look.wallDensity;
  const wallAlpha = look.wallDensity * cannonTierAlpha(dense, FULL_COUNTS.wall, counts.wall);
  let n = 0;
  for (let i = 0; i < counts.wall; i++) {
    const a = ((i + 0.6 * h(i, 0)) / Math.max(1, counts.wall)) * TAU;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const r0 = from - look.wallBack;
    const r1 = to - look.wallBack;
    const lift = look.wallLift * (0.8 + 0.4 * h(i, 1));
    const y0 = floorAt(cx + sx * r0, cz + sz * r0) + lift;
    const y1 = floorAt(cx + sx * r1, cz + sz * r1) + lift;
    cannonPuffLaunch(
      out[n],
      PUFF.shock,
      cx + sx * r0,
      y0,
      cz + sz * r0,
      sx * speed,
      roll > 0 ? (y1 - y0) / roll : 0,
      sz * speed,
      0,
      0,
      look.wallSize0 * (0.85 + 0.3 * h(i, 2)),
      look.wallSize1 * (0.85 + 0.3 * h(i, 3)),
      TURRET_SHOCKWAVE_FRONT_LIFE * (0.9 + 0.1 * h(i, 4)),
      0,
      h(i, 5) * TAU,
      (h(i, 6) - 0.5) * 0.8,
      NO_FLOOR,
    );
    out[n].halt = roll;
    out[n++].alpha = wallAlpha;
  }
  for (let i = 0; i < counts.sparks; i++) {
    const idx = 64 + i;
    const a = h(idx, 0) * TAU;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    // Born on the front partway out, it rides it from there until the front stops.
    const delay = roll * 0.85 * h(idx, 1);
    const r0 = turretShockwaveRadiusAt(delay) + look.sparkLead;
    const r1 = to + look.sparkLead;
    const y0 = floorAt(cx + sx * r0, cz + sz * r0) + look.sparkLift * (0.6 + 0.8 * h(idx, 2));
    const y1 = floorAt(cx + sx * r1, cz + sz * r1) + look.sparkLift;
    const ride = roll - delay;
    cannonPuffLaunch(
      out[n],
      PUFF.spark,
      cx + sx * r0,
      y0,
      cz + sz * r0,
      sx * speed,
      ride > 0 ? (y1 - y0) / ride : 0,
      sz * speed,
      0,
      0,
      0.32 + 0.14 * h(idx, 3),
      0.12,
      look.sparkLife * (0.8 + 0.4 * h(idx, 4)),
      delay,
      0,
      0,
      NO_FLOOR,
    );
    out[n++].halt = ride;
  }
  return n;
}

/**
 * Launches the slam's stone chips into `out` from index 0 and returns how
 * many: grey chips popping off the plinth all around the tower at (cx, cz),
 * whose foot is at `footY`, flung out and up and falling back onto the ground.
 */
export function turretShockwaveChipPuffs(
  out: CannonPuff[],
  seed: number,
  cx: number,
  footY: number,
  cz: number,
  count: number,
  ground: (x: number, z: number) => number,
): number {
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x2e61, i * 16 + k);
  const wall = FIRE_AND_FLY_TOWER.radius;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const a = ((i + h(i, 0)) / Math.max(1, count)) * TAU;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const speed = 2.5 + 3.5 * h(i, 1);
    const vy = 5 + 4 * h(i, 2);
    const y = footY + 0.3 + 1.1 * h(i, 3);
    const land =
      (vy + Math.sqrt(vy * vy + 2 * CANNON_DIRT_GRAVITY * (y - footY))) / CANNON_DIRT_GRAVITY;
    const g = ground(cx + sx * (wall + speed * land), cz + sz * (wall + speed * land));
    cannonPuffLaunch(
      out[n++],
      PUFF.stone,
      cx + sx * (wall + 0.1),
      y,
      cz + sz * (wall + 0.1),
      sx * speed,
      vy,
      sz * speed,
      0,
      CANNON_DIRT_GRAVITY,
      0.26 + 0.24 * h(i, 4),
      0.22 + 0.18 * h(i, 4),
      (TURRET_SHOCKWAVE_CHIP_LIFE - 0.02) * (0.8 + 0.2 * h(i, 5)),
      0.01 * (i % 3),
      h(i, 6) * TAU,
      (h(i, 7) - 0.5) * 10,
      (Number.isFinite(g) ? g : footY) + 0.1,
    );
  }
  return n;
}
