// Korzul's Break Free, the cinematic of his pull (design 6.3), as a plan: the
// timeline and the flight path, shared by the sim (korzul_emerge.ts drives
// his body along it) and the renderer (the boss effects read the same beats
// for the burst, the takeoff, the landing and its shadow). A pure leaf: no
// SimContext, no rng, no wall clock; every pose is a fixed function of the
// seconds since the pull.
//
//   burst  3 s    Break Free's bar where he lies: the Calving Face bursts and
//                 he tears out of it onto the north shelf under the face
//   rise   1.8 s  he climbs to the hover over the shelf (the flights' climb)
//   arc    3.2 s  a short glide over the lake to the arena centre, lifting a
//                 little at the middle, so the whole body is seen against it
//   land   1.4 s  he drops onto the centre plate (accelerating: the weight)
//
// Through the whole of it he is out of reach (korzul_emerge.ts): the fight,
// and every clock of it, begins at the touchdown.

import { WYRMS_HOLLOW } from '../../content/gravewyrm_sanctum_layout';
import { KORZUL_TUNING } from './boss_ids';

/** Each beat's length (seconds). `burst` is Break Free's bar. */
export const KORZUL_EMERGE = { burst: 3, rise: 1.8, arc: 3.2, land: 1.4 } as const;

/** When each beat starts (seconds since the pull), and the whole cinematic. */
export const KORZUL_EMERGE_RISE_AT = KORZUL_EMERGE.burst;
export const KORZUL_EMERGE_ARC_AT = KORZUL_EMERGE_RISE_AT + KORZUL_EMERGE.rise;
export const KORZUL_EMERGE_LAND_AT = KORZUL_EMERGE_ARC_AT + KORZUL_EMERGE.arc;
export const KORZUL_EMERGE_SECONDS = KORZUL_EMERGE_LAND_AT + KORZUL_EMERGE.land;

/** Where he tears out of the ice (claim-local): on the Wyrm's Hollow's north
 *  shelf, at the foot of the Calving Face (the face itself stands past the
 *  field's edge, render only). Walkable floor inside the shelf's rim. */
export const KORZUL_EMERGE_FROM = { x: 0, z: WYRMS_HOLLOW.z + 43 } as const;
/** Where he lands: the arena centre (the lake's middle plate). */
export const KORZUL_EMERGE_TO = { x: WYRMS_HOLLOW.x, z: WYRMS_HOLLOW.z } as const;
/** The hover height of the rise and the arc (his flights' altitude). */
export const KORZUL_EMERGE_ALTITUDE = KORZUL_TUNING.flightAltitude;
/** How much higher he lifts at the arc's middle. */
export const KORZUL_EMERGE_LIFT = 6;

/** The pull's trigger: a living player of the claim within this many yards
 *  of the arena centre (out on the plates, well past the Hollow Ward, with
 *  the whole lake between them and the face). */
export const KORZUL_WAKE_RADIUS = 30;
/** The landing throws the close clear (no damage): anyone within this reach
 *  of the centre is pushed this far, so nobody stands inside his body. */
export const KORZUL_LANDING_REACH = 10;
export const KORZUL_LANDING_SHOVE = 8;

export type KorzulEmergeBeat = 'burst' | 'rise' | 'arc' | 'land' | 'done';

/** The beat at `t` seconds since the pull. */
export function emergeBeat(t: number): KorzulEmergeBeat {
  if (t < KORZUL_EMERGE_RISE_AT) return 'burst';
  if (t < KORZUL_EMERGE_ARC_AT) return 'rise';
  if (t < KORZUL_EMERGE_LAND_AT) return 'arc';
  if (t < KORZUL_EMERGE_SECONDS) return 'land';
  return 'done';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Where he is at `t` (claim-local x, z; `h` the height over the floor),
 *  starting from `from` (the face's foot, or where he stood when the ice was
 *  already gone). Continuous through every beat. */
export function emergePose(
  t: number,
  from: { x: number; z: number },
): { x: number; z: number; h: number; beat: KorzulEmergeBeat } {
  const beat = emergeBeat(t);
  const to = KORZUL_EMERGE_TO;
  const alt = KORZUL_EMERGE_ALTITUDE;
  if (beat === 'burst') return { x: from.x, z: from.z, h: 0, beat };
  if (beat === 'rise') {
    // The flights' climb: a quarter sine, quick off the ground.
    const k = clamp01((t - KORZUL_EMERGE_RISE_AT) / KORZUL_EMERGE.rise);
    return { x: from.x, z: from.z, h: alt * Math.sin((Math.PI / 2) * k), beat };
  }
  if (beat === 'arc') {
    const k = clamp01((t - KORZUL_EMERGE_ARC_AT) / KORZUL_EMERGE.arc);
    const g = k * k * (3 - 2 * k);
    return {
      x: from.x + (to.x - from.x) * g,
      z: from.z + (to.z - from.z) * g,
      h: alt + KORZUL_EMERGE_LIFT * Math.sin(Math.PI * k),
      beat,
    };
  }
  if (beat === 'land') {
    // Falling, faster the lower he gets: he comes down with his weight.
    const k = clamp01((t - KORZUL_EMERGE_LAND_AT) / KORZUL_EMERGE.land);
    return { x: to.x, z: to.z, h: alt * (1 - k * k), beat };
  }
  return { x: to.x, z: to.z, h: 0, beat };
}

/** His heading along the flight (toward the centre), or null when he
 *  already stands on it. */
export function emergeFacing(from: { x: number; z: number }): number | null {
  const dx = KORZUL_EMERGE_TO.x - from.x;
  const dz = KORZUL_EMERGE_TO.z - from.z;
  return Math.hypot(dx, dz) < 1e-6 ? null : Math.atan2(dx, dz);
}

/** Is a claim-local point inside the pull's trigger? */
export function inKorzulWakeRing(lx: number, lz: number): boolean {
  return Math.hypot(lx - KORZUL_EMERGE_TO.x, lz - KORZUL_EMERGE_TO.z) <= KORZUL_WAKE_RADIUS + 1e-9;
}
