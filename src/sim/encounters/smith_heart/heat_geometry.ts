// The Guardian of the Heat's geometry (docs/design/raid/smith_heart.md
// section 7.4): PURE over the layout (no SimContext, no rng), so the raid
// bots' tactics and the renderer can reuse it. Instance-local yards.
//
//   the floor      the Hearth's eight-sided hall (`FORGE_POINTS`, the
//                  `smiths_forge` surface): the fight's players stand on it
//   the wellspring `HEARTH_WELL` at the foot of the altar-stone: the
//                  guardian stands in it, whoever steps in burns, and
//                  everything is measured from its middle (Hearth Flare's
//                  reach, Wakefire's bands, the overflow's rivers)
//   the lanes      Basalt Fist's three Molten Swell lanes and the overflow's
//                  rivers: who stands in one, and where a wave's wall is
//   the posts      where the Wellspawn climb out, the Wellkeepers rise, and
//                  the shore points a Rolling Cinder lands on

import { FORGE_POINTS, HEART_ROOM, HEARTH_WELL } from '../../content/smith_heart_layout';
import { HEAT_TUNING as T, WHEEL_ARCS_DEG, ZONE_BANDS } from './heat_ids';

export interface HPoint {
  x: number;
  z: number;
}

export interface HBody extends HPoint {
  id: number;
}

/** Is (x, z) on the Hearth's floor (its eight-sided hall)? */
export function inHearthFloor(x: number, z: number): boolean {
  let inside = false;
  const pts = FORGE_POINTS;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Yards from the wellspring's middle. */
export function wellDistance(x: number, z: number): number {
  return Math.hypot(x - HEARTH_WELL.x, z - HEARTH_WELL.z);
}

/** Is (x, z) in the wellspring's fire (inside its lip)? */
export function inWell(x: number, z: number): boolean {
  return wellDistance(x, z) < HEARTH_WELL.r;
}

/** Is (x, z) out of the guardian's reach, where Hearth Flare strikes? */
export function beyondFlare(x: number, z: number): boolean {
  return wellDistance(x, z) > T.flareReach;
}

/** Which slice of the Wheel of the Hearth (x, z) stands in (WHEEL_ARCS_DEG). */
export function wheelSliceAt(x: number, z: number): number {
  let deg = (Math.atan2(x - HEARTH_WELL.x, z - HEARTH_WELL.z) * 180) / Math.PI;
  if (deg < -90) deg += 360;
  for (let i = 0; i < WHEEL_ARCS_DEG.length; i++) if (deg < WHEEL_ARCS_DEG[i][1]) return i;
  return WHEEL_ARCS_DEG.length - 1;
}

/** Is (x, z) in Wakefire band `band` (0 near, 1 the middle, 2 the back)? */
export function inBand(band: number, x: number, z: number): boolean {
  const b = ZONE_BANDS[band];
  if (!b) return false;
  const d = wellDistance(x, z);
  return d >= b[0] && d < b[1];
}

/** The facing from `from` toward `to` (sim convention: 0 runs +z). */
export function facingTo(from: HPoint, to: HPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** A point in a lane's frame: `along` it from its start, `across` it. */
export function laneFrame(
  ox: number,
  oz: number,
  facing: number,
  x: number,
  z: number,
): { along: number; across: number } {
  const dx = x - ox;
  const dz = z - oz;
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  return { along: dx * s + dz * c, across: Math.abs(dx * c - dz * s) };
}

/** Is (x, z) in a lane from (ox, oz) along `facing`, `length` long and
 *  `half` wide either side? */
export function inLane(
  ox: number,
  oz: number,
  facing: number,
  length: number,
  half: number,
  x: number,
  z: number,
): boolean {
  const f = laneFrame(ox, oz, facing, x, z);
  return f.along >= 0 && f.along <= length && f.across <= half;
}

/** How far a lane from (x, z) along `facing` runs over the Hearth's floor
 *  before it leaves it (at most `max`, a yard at a time): where a river or a
 *  swell is drawn to (nobody stands past the floor's edge). */
export function floorReach(x: number, z: number, facing: number, max: number): number {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  let d = 0;
  while (d < max && inHearthFloor(x + s * (d + 1), z + c * (d + 1))) d++;
  return Math.max(1, Math.min(max, d));
}

/** How far a Molten Swell's lane runs from (x, z) along `facing`, at most
 *  `max` yards: on the Hearth's floor to its edge (`floorReach`), on the
 *  Anvil of the World (the Masterless Strength's Heat quarter, final_heat.ts)
 *  to its rim. The sim's waves and the renderer's lanes both read it. */
export function laneReach(x: number, z: number, facing: number, max: number): number {
  if (inHearthFloor(x, z)) return floorReach(x, z, facing, max);
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  let d = 0;
  while (
    d < max &&
    Math.hypot(x + s * (d + 1) - HEART_ROOM.x, z + c * (d + 1) - HEART_ROOM.z) <= HEART_ROOM.r
  )
    d++;
  return Math.max(1, Math.min(max, d));
}

/** Basalt Fist's three Molten Swell bearings from its spot: straight away
 *  from the wellspring and to either side of it (the gap toward the
 *  guardian, and the two between, are where the raid stands). */
export function swellBearings(spot: HPoint): [number, number, number] {
  const away = facingTo(HEARTH_WELL, spot);
  return [away, away + Math.PI / 2, away - Math.PI / 2];
}

/** Is (x, z) in a wave's wall: `front` yards down its lane, the wall
 *  `T.waveDepth` deep behind it, never behind the lane's start (a wave just
 *  out of the spot is shallower: it rises out of the crater, so it never
 *  strikes back past the spot, where the drawn wall does not stand)? */
export function inWave(
  ox: number,
  oz: number,
  facing: number,
  front: number,
  x: number,
  z: number,
): boolean {
  const f = laneFrame(ox, oz, facing, x, z);
  return (
    f.across <= T.laneHalf && f.along >= 0 && f.along <= front && f.along >= front - T.waveDepth
  );
}

/** The nearest body to `from` within `range` (the lower id on a tie), or
 *  null when nobody is that near. */
export function nearestInReach(
  from: HPoint,
  bodies: readonly HBody[],
  range: number,
): HBody | null {
  let best: HBody | null = null;
  let bestD = range + 1e-9;
  for (const b of bodies) {
    const d = Math.hypot(b.x - from.x, b.z - from.z);
    if (d < bestD - 1e-9 || (best && Math.abs(d - bestD) <= 1e-9 && b.id < best.id)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

// ---- the posts ------------------------------------------------------------------------

/** Where the Wellspawn climb out at the room's edge (heroic's overflows):
 *  kept on the floor's edge; the well's middle moved 4 yd toward them in
 *  pass 4, so their feeding reach is measured from the grown lip and the
 *  walk stays within a few yards of the first pass's. */
export const WELLSPAWN_SPOTS: readonly HPoint[] = [
  { x: -175, z: -21 },
  { x: -175, z: 21 },
  { x: -194, z: -42.5 },
  { x: -194, z: 42.5 },
];

/** Where heroic's second overflow raises its two Wellkeepers (as far past
 *  the grown lip as they stood past the first). */
export const WELLKEEPER_SPOTS: readonly HPoint[] = [
  { x: -201, z: -17 },
  { x: -201, z: 17 },
];

/** The shore's points (a 6-yard lattice on the floor east of the
 *  wellspring's middle, clear of its lip by 4 yd and of the walls by 3):
 *  where a Rolling Cinder lands. Built once, in a fixed
 *  order. */
export const SHORE_POINTS: readonly HPoint[] = (() => {
  const out: HPoint[] = [];
  for (let x = -250; x <= -176; x += 6) {
    for (let z = -42; z <= 42; z += 6) {
      if (!inHearthFloor(x, z) || wellDistance(x, z) < HEARTH_WELL.r + 4) continue;
      if (x < HEARTH_WELL.x - 2) continue;
      const clear =
        inHearthFloor(x + 3, z) &&
        inHearthFloor(x - 3, z) &&
        inHearthFloor(x, z + 3) &&
        inHearthFloor(x, z - 3);
      if (clear) out.push({ x, z });
    }
  }
  return out;
})();
