// The Guardian of the Heat's geometry (docs/design/raid/smith_heart.md
// section 7.4): PURE over the layout (no SimContext, no rng), so the raid
// bots' tactics and the renderer can reuse it. Instance-local yards.
//
//   the floor      the Hearth's eight-sided hall (`FORGE_POINTS`, the
//                  `smiths_forge` surface): the fight's players stand on it
//   the wellspring `HEARTH_WELL` in the hall, the shore all the way round
//                  it: the guardian stands in it, whoever steps in burns, and
//                  everything is measured from its middle (Hearth Flare's
//                  reach, Wakefire's bands, the overflow's rivers)
//   the lanes      Basalt Fist's three Molten Swell lanes and the overflow's
//                  rivers: who stands in one, and where a wave's wall is
//   the rings      the overflows' lava waves (heat_waves.ts): each ring's
//                  corridors, who stands in its wall or a corridor, how long
//                  an overflow's rings run
//   the posts      where the Wellspawn climb out, the Wellkeepers rise, and
//                  the shore points a Rolling Cinder lands on

import {
  FORGE_POINTS,
  HEART_ROOM,
  HEARTH_WELL,
  SMITH_HEART_FIELD,
} from '../../content/smith_heart_layout';
import {
  HEAT_LIP_WALL,
  type HeatWaveRule,
  heatHash,
  HEAT_TUNING as T,
  WHEEL_ARCS_DEG,
  WHEEL_SIDE,
  ZONE_BANDS,
} from './heat_ids';

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

/** Where a body standing at (x, z) inside the lip wall (deeper than half a
 *  yard past its outer face) is set down: straight out along its bearing onto the shore, `body` yards (its
 *  radius) past the wall (due east, toward the door, from the exact middle);
 *  null when it already stands outside. The wall's collider holds a body
 *  walking in from the shore; this frees one that got inside some other way
 *  (a leap or a teleport onto the well), which the ring would otherwise trap
 *  in the fire. */
export function outOfLip(x: number, z: number, body: number): HPoint | null {
  const d = wellDistance(x, z);
  // A body grazing the wall's outer face is the collider's to settle; only
  // one inside it is set down.
  if (d >= HEAT_LIP_WALL.outer - 0.5) return null;
  const out = HEAT_LIP_WALL.outer + body + 0.05;
  if (d < 1e-6) return { x: HEARTH_WELL.x + out, z: HEARTH_WELL.z };
  const k = out / d;
  return { x: HEARTH_WELL.x + (x - HEARTH_WELL.x) * k, z: HEARTH_WELL.z + (z - HEARTH_WELL.z) * k };
}

/** Is (x, z) out of the guardian's reach, where Hearth Flare strikes? */
export function beyondFlare(x: number, z: number): boolean {
  return wellDistance(x, z) > T.flareReach;
}

/** Which slice of the Wheel of the Hearth (x, z) stands in (WHEEL_ARCS_DEG). */
export function wheelSliceAt(x: number, z: number): number {
  let deg = (Math.atan2(x - HEARTH_WELL.x, z - HEARTH_WELL.z) * 180) / Math.PI;
  if (deg < -90) deg += 360;
  for (let i = 0; i < WHEEL_ARCS_DEG.length; i++) {
    const [a, b] = WHEEL_ARCS_DEG[i];
    if (deg >= a && deg < b) return i;
  }
  // 270 itself (the range's end) closes the last back wedge round.
  return WHEEL_SIDE + 1;
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
  // On the Anvil the swell rolls all the way to the rim, whatever the Heat
  // guardian's lane length (Jose's playtest of 2026-11-19: "they die halfway").
  const reach = ANVIL_LANE_MAX;
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  let d = 0;
  while (
    d < reach &&
    Math.hypot(x + s * (d + 1) - HEART_ROOM.x, z + c * (d + 1) - HEART_ROOM.z) <= HEART_ROOM.r
  )
    d++;
  return Math.max(1, Math.min(reach, d));
}

/** The longest a swell's lane runs on the Anvil of the World: across it. */
export const ANVIL_LANE_MAX = 2 * HEART_ROOM.r;

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

// ---- the lava waves' rings (heat_waves.ts) --------------------------------------------

const TAU = Math.PI * 2;

/** Bring a bearing into [0, 2 pi). */
function wrap(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** The least and the most a ring's corridors sway off the Wellspawn's side
 *  (degrees): each ring sways the other way from the last, so the next
 *  corridors stand 30 to 50 degrees round from the last ones (a real walk,
 *  more than a corridor's width even at the lip). */
export const RING_SWAY_MIN_DEG = 15;
export const RING_SWAY_MAX_DEG = 25;

/** Ring `k`'s corridors in overflow `n` (`gaps` of them, `spreadDeg` apart
 *  round the wellspring; evenly round it when not given), centred on the
 *  Wellspawn's side of the floor (`WELLSPAWN_BEARING`) and swayed off it a
 *  hashed RING_SWAY_MIN_DEG to RING_SWAY_MAX_DEG, the other way from the
 *  last ring (the first ring's way hashed per overflow). Since the bot runs of
 *  2026-11-24 the corridors face the Wellspawn's walk on every tier, so a
 *  hitter standing in one has every walking child in reach (they were hashed
 *  anywhere round the well, and the first overflow's left two children 30 to
 *  50 yards from every corridor). Pure. */
export function ringGaps(n: number, k: number, gaps: number, spreadDeg?: number): number[] {
  const first = heatHash(n * 101 + 7, 13) % 2 === 0 ? 1 : -1;
  const sign = k % 2 === 0 ? first : -first;
  const span = RING_SWAY_MAX_DEG - RING_SWAY_MIN_DEG + 1;
  const sway = RING_SWAY_MIN_DEG + (heatHash(n * 31 + k, 17) % span);
  const step = spreadDeg === undefined ? TAU / Math.max(1, gaps) : (spreadDeg * Math.PI) / 180;
  const base =
    WELLSPAWN_BEARING + (sign * sway * Math.PI) / 180 - ((Math.max(1, gaps) - 1) * step) / 2;
  const out: number[] = [];
  for (let g = 0; g < gaps; g++) out.push(wrap(base + g * step));
  return out;
}

/** Is (x, z) inside one of `gaps`' corridors (its half width `half`), on the
 *  shore side of the wellspring? Pure. */
export function inRingCorridor(
  gaps: readonly number[],
  half: number,
  x: number,
  z: number,
): boolean {
  for (const g of gaps) {
    const f = laneFrame(HEARTH_WELL.x, HEARTH_WELL.z, g, x, z);
    if (f.along > 0 && f.across <= half) return true;
  }
  return false;
}

/** Is (x, z) in the wall of a ring whose front is `front` yards out (the
 *  wall `T.ringDepth` deep behind it), outside its corridors? Pure. */
export function inRingWall(
  gaps: readonly number[],
  half: number,
  front: number,
  x: number,
  z: number,
): boolean {
  const d = wellDistance(x, z);
  if (d > front || d < front - T.ringDepth) return false;
  return !inRingCorridor(gaps, half, x, z);
}

/** The whole overflow's length under the wellspring for a rule: the lead,
 *  the rings' spacing and the last one's roll to the walls. Pure. */
export function wavesSeconds(rule: HeatWaveRule): number {
  return rule.lead + (rule.count - 1) * rule.every + (T.ringEnd - T.ringStart) / rule.speed;
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

/** The Wellspawn's side of the floor: the mean bearing of their posts from
 *  the well's middle (sim convention: 0 runs +z; due east, toward the door).
 *  The lava waves' corridors are laid round it (`ringGaps`), so moving the
 *  posts moves the corridors with them. */
export const WELLSPAWN_BEARING: number = (() => {
  let sx = 0;
  let sz = 0;
  for (const p of WELLSPAWN_SPOTS) {
    const d = Math.hypot(p.x - HEARTH_WELL.x, p.z - HEARTH_WELL.z);
    sx += (p.x - HEARTH_WELL.x) / d;
    sz += (p.z - HEARTH_WELL.z) / d;
  }
  return wrap(Math.atan2(sx, sz));
})();

/** Where heroic's second overflow raises its two Wellkeepers (as far past
 *  the grown lip as they stood past the first). */
export const WELLKEEPER_SPOTS: readonly HPoint[] = [
  { x: -201, z: -17 },
  { x: -201, z: 17 },
];

/** The nearest a shore point lies to the well's middle: a landing's circle
 *  edge clear of the lip wall's outer face. */
export const SHORE_MIN = HEAT_LIP_WALL.outer + T.cinderLandR;

/** Does a landing's circle at (x, z) overlap a prop's solid footprint on the
 *  Hearth's floor (a crystal cluster, an ember boulder), with a yard spare? */
function onHearthProp(x: number, z: number): boolean {
  const reach = T.cinderLandR + 1;
  for (const p of SMITH_HEART_FIELD.props) {
    if (!inHearthFloor(p.x, p.z)) continue;
    if (p.r !== undefined) {
      if (Math.hypot(x - p.x, z - p.z) < p.r + reach) return true;
    } else if (p.hw !== undefined && p.hd !== undefined) {
      const half = Math.hypot(p.hw, p.hd);
      if (Math.hypot(x - p.x, z - p.z) < half + reach) return true;
    }
  }
  return false;
}

/** The shore's points (a 6-yard lattice on the floor all the way round the
 *  wellspring, clear of the walls by 3, and far enough out that a landing's
 *  burning circle, `T.cinderLandR`, stays off the lip wall and the boss's
 *  disc: Jose's playtest of 2026-11-24; and off the hall's crystal clusters
 *  and ember boulders): where a Rolling Cinder lands. East of the well's
 *  middle only until Jose's playtest of 2026-11-25 took the altar-stone away
 *  and opened the shore behind the guardian. Built once, in a fixed order. */
export const SHORE_POINTS: readonly HPoint[] = (() => {
  const out: HPoint[] = [];
  for (let x = -250; x <= -176; x += 6) {
    for (let z = -42; z <= 42; z += 6) {
      if (!inHearthFloor(x, z) || wellDistance(x, z) < SHORE_MIN) continue;
      if (onHearthProp(x, z)) continue;
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
