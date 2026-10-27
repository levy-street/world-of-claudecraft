// The Frozen Lake's geometry for the Guardian of the Quench (design doc
// section 7.3), pure over the layout and the authored field: who stands in
// the fight, the shore ice's ring, the huddles and their warmth, the holes and
// where a trapped body climbs out, the echoes' footprints, the safe lee
// behind each blade and heroic's crossing lanes. Instance-local yards
// throughout. No SimContext, no rng (the picks are hashed), so the raid
// bots' tactics (scripts/lib) can reuse it.

import {
  QUENCH,
  QUENCH_BLADE_SPOTS,
  QUENCH_RIMEWALL,
  SMITH_HEART_FIELD,
} from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import { quenchHash, QUENCH_TUNING as T } from './quench_ids';

const F = SMITH_HEART_FIELD;
const L = QUENCH.lake;
const S = QUENCH.shelf;
const R = QUENCH_RIMEWALL;

/** A point on the floor (instance-local). */
export interface QPoint {
  x: number;
  z: number;
}

/** The lake's ice floor id (holes open only here). */
const LAKE_FLOOR = 'frozen_lake';

/** Is (x, z) in the Quench Basin at all (the lake or its rock shelf, a
 *  little past its rim): who the fight counts and hears. */
export function inQuenchBasin(x: number, z: number): boolean {
  return Math.hypot((x - S.x) / (S.rx + 2), (z - S.z) / (S.rz + 2)) <= 1;
}

/** Is (x, z) on the lake's ice (where the ice cracks and holes open)? */
export function onLakeIce(x: number, z: number): boolean {
  return authoredFieldSurfaceAt(F, x, z)?.id === LAKE_FLOOR;
}

/** Is (x, z) inside the shore ice's ring, `margin` yards in from its line? */
export function insideRimewall(x: number, z: number, margin = 0): boolean {
  return Math.hypot((x - R.x) / (R.rx - margin), (z - R.z) / (R.rz - margin)) <= 1;
}

/** Where a body outside the ring is set down inside it: on its own bearing
 *  from the lake's middle, `inset` yards inside the ring's line. */
export function insideRimewallSpot(x: number, z: number, inset = 3): QPoint {
  const a = Math.atan2(x - R.x, z - R.z);
  return { x: R.x + Math.sin(a) * (R.rx - inset), z: R.z + Math.cos(a) * (R.rz - inset) };
}

/** The shore ice's slabs: their middles on the ring's ellipse and their yaw
 *  (the slab's length along the ring: an oriented box's local x). */
export function rimewallSegments(): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  for (let k = 0; k < R.segments; k++) {
    const a = (k / R.segments) * Math.PI * 2;
    out.push({
      x: R.x + Math.sin(a) * R.rx,
      z: R.z + Math.cos(a) * R.rz,
      rot: Math.atan2(R.rz * Math.sin(a), R.rx * Math.cos(a)),
    });
  }
  return out;
}

/** The lake's middle (the guardian's spot) and the blades' homes. */
export const QUENCH_LAKE_MIDDLE: QPoint = { x: L.x, z: L.z };
export const QUENCH_BLADE_HOMES: readonly QPoint[] = QUENCH_BLADE_SPOTS;

// ---- the huddle -----------------------------------------------------------------------

/** A body the huddle reads: its id and place. */
export interface QBody {
  id: number;
  x: number;
  z: number;
}

/** How many of `others` stand within `r` of `b` (itself never counted). */
export function warmNeighbours(b: QBody, others: readonly QBody[], r: number = T.warmR): number {
  let n = 0;
  for (const o of others) {
    if (o.id === b.id) continue;
    if (Math.hypot(o.x - b.x, o.z - b.z) <= r + 1e-9) n++;
  }
  return n;
}

/** A huddle: three or more warm bodies joined within `r` of one another,
 *  its members (id order) and its middle. */
export interface QHuddle {
  ids: number[];
  x: number;
  z: number;
}

/**
 * The huddles among `bodies` (each warm: `warmNeighbours` at least the
 * difficulty's need), joined within `r` and three or more strong; in the
 * order of their lowest id. Pure; the bots read it to see a group the ice
 * will give under.
 */
export function huddlesOf(bodies: readonly QBody[], r: number = T.warmR): QHuddle[] {
  const warm = bodies.filter((b) => warmNeighbours(b, bodies, r) >= T.warmNeed);
  const n = warm.length;
  const parent = warm.map((_, i) => i);
  const find = (i: number): number => {
    let k = i;
    while (parent[k] !== k) k = parent[k];
    return k;
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(warm[i].x - warm[j].x, warm[i].z - warm[j].z) > r + 1e-9) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  const groups = new Map<number, QBody[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(warm[i]);
    else groups.set(root, [warm[i]]);
  }
  const out: QHuddle[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const ids = g.map((b) => b.id).sort((a, b) => a - b);
    let x = 0;
    let z = 0;
    for (const b of g) {
      x += b.x;
      z += b.z;
    }
    out.push({ ids, x: x / g.length, z: z / g.length });
  }
  return out.sort((a, b) => a.ids[0] - b.ids[0]);
}

// ---- the holes ------------------------------------------------------------------------

/** A hole in the ice (instance-local middle, radius). */
export interface QHole {
  x: number;
  z: number;
  r: number;
}

/** The index of the hole a body at (x, z) has fallen into (its middle more
 *  than `margin` inside the rim), or -1. */
export function holeAt(
  x: number,
  z: number,
  holes: readonly QHole[],
  margin: number = T.holeMargin,
): number {
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    if (Math.hypot(x - h.x, z - h.z) < h.r - margin) return i;
  }
  return -1;
}

/** Is (x, z) clear of every hole by `pad` yards past its rim? */
export function clearOfHoles(x: number, z: number, holes: readonly QHole[], pad = 0): boolean {
  for (const h of holes) if (Math.hypot(x - h.x, z - h.z) < h.r + pad) return false;
  return true;
}

/**
 * Where a body trapped in `hole` climbs out: on the rim `out` yards past
 * its edge, on the side it went in (from the hole's middle toward `from`),
 * turned round the rim until the spot stands on the lake inside the shore
 * ice and clear of every other hole. Pure.
 */
export function climbOutSpot(
  hole: QHole,
  from: QPoint,
  holes: readonly QHole[],
  out: number = T.climbOut,
): QPoint {
  const base = Math.atan2(from.x - hole.x, from.z - hole.z);
  const d = hole.r + out;
  for (let k = 0; k < 24; k++) {
    // 0, +15, -15, +30, -30 ... degrees off the way it went in.
    const turn = ((k + 1) >> 1) * (k % 2 === 1 ? 1 : -1) * ((15 * Math.PI) / 180);
    const a = base + turn;
    const x = hole.x + Math.sin(a) * d;
    const z = hole.z + Math.cos(a) * d;
    if (!insideRimewall(x, z, 1) || !onLakeIce(x, z)) continue;
    if (clearOfHoles(x, z, holes, 0.6)) return { x, z };
  }
  // Ringed by water: the way it went in.
  return { x: hole.x + Math.sin(base) * d, z: hole.z + Math.cos(base) * d };
}

// ---- the echoes -----------------------------------------------------------------------

/** A unit along a facing (sim yaw: 0 = +z). */
function along(facing: number): QPoint {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

const wrap = (a: number): number => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

/** Does an attack from `origin` facing `facing` (a cone or arc of `arcDeg`,
 *  `range` deep) cover `p`? */
export function inEchoReach(
  origin: QPoint,
  facing: number,
  p: QPoint,
  range: number,
  arcDeg: number,
): boolean {
  const dx = p.x - origin.x;
  const dz = p.z - origin.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 1e-6) return true;
  return Math.abs(wrap(Math.atan2(dx, dz) - facing)) <= (arcDeg * Math.PI) / 360 + 1e-9;
}

/** Is `p` in the lee of the blade at `blade` from an attack facing `facing`:
 *  behind it (on the side away from the attack) and within `r`? There the
 *  cold breaks on the blade's ice: always safe. */
export function inBladeLee(blade: QPoint, facing: number, p: QPoint, r: number = T.leeR): boolean {
  const u = along(facing);
  const dx = p.x - blade.x;
  const dz = p.z - blade.z;
  if (Math.hypot(dx, dz) > r) return false;
  return dx * u.x + dz * u.z < 0;
}

/** Is `p` sheltered behind any of `blades` from an attack facing `facing`? */
export function shelteredByBlade(
  blades: readonly QPoint[],
  facing: number,
  p: QPoint,
  r: number = T.leeR,
): boolean {
  for (const b of blades) if (inBladeLee(b, facing, p, r)) return true;
  return false;
}

// ---- heroic: the crossing -------------------------------------------------------------

/** The pairs of blades that may cross (by index), in the order they are
 *  dealt from: the two diagonals, then the four sides. */
export const CROSSING_PAIRS: readonly (readonly [number, number])[] = [
  [0, 2],
  [1, 3],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

/** The `k`-th crossing of a pull salted by `salt`: a hashed pair, never the
 *  last one again. Returns its index into CROSSING_PAIRS. */
export function crossingPair(salt: number, k: number, last: number): number {
  const n = CROSSING_PAIRS.length;
  let i = quenchHash(salt, k) % n;
  if (i === last) i = (i + 1 + (quenchHash(salt, k + 97) % (n - 1))) % n;
  return i;
}

/** The distance from `p` to the segment a-b. */
export function segmentDistance(a: QPoint, b: QPoint, p: QPoint): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t =
    len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}

/** Where the crossing's cracked lane opens into holes: every `every` yards
 *  along a-b, clear of both ends (where the blades now float) by `endPad`. */
export function laneHoleSpots(
  a: QPoint,
  b: QPoint,
  every: number = T.laneHoleEvery,
  endPad = 4,
): QPoint[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const out: QPoint[] = [];
  const usable = len - endPad * 2;
  if (usable <= 0) return out;
  const n = Math.max(1, Math.floor(usable / every) + 1);
  const step = n > 1 ? usable / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const d = (n > 1 ? endPad + step * i : len / 2) / len;
    out.push({ x: a.x + (b.x - a.x) * d, z: a.z + (b.z - a.z) * d });
  }
  return out;
}
