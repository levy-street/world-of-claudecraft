// The Anvil of the World's four quarters (design doc section 5.21, phase 2K):
// the final boss's platform is split by four curved ridges, set in a pinwheel
// round a central ring, into one quarter per vein, each holding its altar at
// the rim. The quarter the Masterless Strength stands in is the active
// strength; the central ring is where it goes for the final phase.
//
// One pure, host-agnostic geometry core: the renderer (the quarters' floors,
// the ridges, the awakening) and the future fight mechanics both read it.
//
//   - The central ring: everything nearer the platform's centre than
//     `ringR` (the dais round the heart's light).
//   - Ridge k (0 to 3) runs from the ring to the rim between the quarters
//     `HEART_QUARTER_ORDER[k]` and `HEART_QUARTER_ORDER[k + 1]`. Its bearing
//     at radius r is `heartRidgeBearingDeg(k, r)`: it leaves the ring swept
//     back by `sweepDeg` and straightens out to the rim, where it ends at
//     45 + 90 k + `rimOffsetDeg` (clear of the Heart Bridge's landing and of
//     every altar).
//   - Unwinding a point's bearing by the sweep at its radius leaves four
//     straight 90 degree sectors: that is how a point finds its quarter.
//
// Bearings are degrees clockwise from the room's +z (north), 90 = +x (east),
// the layout's own (HEART_ALTARS: Breath north, Quench east, Hammer south,
// Heat west). Points on a ridge's centre line belong to the quarter on its
// clockwise side (deterministic). Points past the rim keep the rim's
// sectors (the ridge straightens out there).
//
// Pure: no rng, no clock, no DOM. Instance-local yards.

import { HEART_ALTARS, HEART_ROOM, type SmithHeartVein } from './smith_heart_layout';

/** A zone of the platform: one vein's quarter, or the central ring. */
export type HeartQuarterZone = SmithHeartVein | 'ring';

/** The quarters in bearing order from north, clockwise: each altar's own
 *  bearing (Breath 0, Quench 90, Hammer 180, Heat 270). */
export const HEART_QUARTER_ORDER: readonly SmithHeartVein[] = [...HEART_ALTARS]
  .map((a) => ({
    vein: a.vein,
    b: ((Math.atan2(a.x - HEART_ROOM.x, a.z - HEART_ROOM.z) * 180) / Math.PI + 360) % 360,
  }))
  .sort((p, q) => p.b - q.b)
  .map((p) => p.vein);

/** The pinwheel's measures (yards, degrees). */
export const HEART_QUARTERS = {
  /** The central ring's radius (the dais round the heart's light). */
  ringR: 11,
  /** The platform's walk ends here (its balustrade beyond). */
  rimR: HEART_ROOM.r,
  /** How far back a ridge is swept where it leaves the ring. */
  sweepDeg: 85,
  /** The sweep's falloff toward the rim (1 straight spiral; higher curls
   *  near the ring and runs straight out to the rim). */
  power: 1.5,
  /** A ridge's rim end past the diagonal between its two altars. */
  rimOffsetDeg: 20,
  /** A ridge's half width on the walk (its foot either side of its line). */
  ridgeHalfWidth: 1.7,
  /** How far from the room's centre the boss stands in a quarter (the dev
   *  preview, `heartQuarterSpot`): its middle, short of the altar. */
  spotR: 24,
} as const;

const DEG = Math.PI / 180;
/** The tolerance (degrees) inside which a point is ON a ridge's line. */
const ON_LINE_DEG = 1e-7;

function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** The sweep's share at radius `r` (1 at the ring, 0 at the rim and past). */
function sweepShare(r: number): number {
  const { ringR, rimR, power } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  return (1 - u) ** power;
}

/** Ridge `k`'s bearing (degrees, 0 to 360) at radius `r` from the room's
 *  centre. */
export function heartRidgeBearingDeg(k: number, r: number): number {
  const { sweepDeg, rimOffsetDeg } = HEART_QUARTERS;
  return wrap360(45 + 90 * k + rimOffsetDeg - sweepDeg * sweepShare(r));
}

/** A point on ridge `k` at radius `r` (instance-local x, z). */
export function heartRidgePoint(k: number, r: number): { x: number; z: number } {
  const b = heartRidgeBearingDeg(k, r) * DEG;
  return { x: HEART_ROOM.x + Math.sin(b) * r, z: HEART_ROOM.z + Math.cos(b) * r };
}

/** The bearing (degrees, 0 to 360) of instance-local (x, z) from the room's
 *  centre. */
export function heartRoomBearingDeg(x: number, z: number): number {
  return wrap360((Math.atan2(x - HEART_ROOM.x, z - HEART_ROOM.z) * 180) / Math.PI);
}

/** Which quarter's sector (0 to 3, `HEART_QUARTER_ORDER`) holds (x, z),
 *  the ring ignored (a point at the centre reads the north sector). */
export function heartQuarterIndexAt(x: number, z: number): number {
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  const { sweepDeg, rimOffsetDeg } = HEART_QUARTERS;
  // Unwind the sweep: the ridges become the straight lines 45 + 90 k +
  // rimOffset, the quarters the sectors between them.
  const flat = wrap360(heartRoomBearingDeg(x, z) + sweepDeg * sweepShare(r));
  const first = wrap360(-45 + rimOffsetDeg);
  // A breath of tolerance so a point computed ON a ridge (floating point)
  // still reads the clockwise quarter.
  return Math.floor((wrap360(flat - first) + ON_LINE_DEG) / 90) % 4;
}

/** The zone of instance-local (x, z): the central ring, or the vein whose
 *  quarter holds it. */
export function heartQuarterAt(x: number, z: number): HeartQuarterZone {
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  if (r < HEART_QUARTERS.ringR) return 'ring';
  return HEART_QUARTER_ORDER[heartQuarterIndexAt(x, z)];
}

/** The ridge between two neighbouring quarters (its index), or null when
 *  they are not neighbours (the same quarter, opposite quarters, the ring). */
export function heartRidgeBetween(a: HeartQuarterZone, b: HeartQuarterZone): number | null {
  if (a === 'ring' || b === 'ring' || a === b) return null;
  const i = HEART_QUARTER_ORDER.indexOf(a);
  const j = HEART_QUARTER_ORDER.indexOf(b);
  if ((i + 1) % 4 === j) return i;
  if ((j + 1) % 4 === i) return j;
  return null;
}

/** The two ridges bounding a quarter: [counter-clockwise, clockwise]. */
export function heartQuarterRidges(vein: SmithHeartVein): readonly [number, number] {
  const i = HEART_QUARTER_ORDER.indexOf(vein);
  return [(i + 3) % 4, i];
}

/** How far (yards, along the arc at its radius) (x, z) lies from ridge
 *  `k`'s centre line. */
export function heartRidgeDistance(k: number, x: number, z: number): number {
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  const d = Math.abs(((heartRoomBearingDeg(x, z) - heartRidgeBearingDeg(k, r) + 540) % 360) - 180);
  return d * DEG * r;
}

/** Where the boss stands for a zone's preview: the ring's centre, or the
 *  middle of a quarter `spotR` out (between its ridges, short of its altar). */
export function heartQuarterSpot(zone: HeartQuarterZone): { x: number; z: number } {
  if (zone === 'ring') return { x: HEART_ROOM.x, z: HEART_ROOM.z };
  const r = HEART_QUARTERS.spotR;
  const [a, b] = heartQuarterRidges(zone);
  const ba = heartRidgeBearingDeg(a, r);
  const bb = heartRidgeBearingDeg(b, r);
  const mid = (ba + wrap360(bb - ba) / 2) * DEG;
  return { x: HEART_ROOM.x + Math.sin(mid) * r, z: HEART_ROOM.z + Math.cos(mid) * r };
}

/** The zones a dev preview names (`/dev heart final quarter <zone>`). */
export const HEART_QUARTER_ZONES: readonly HeartQuarterZone[] = [...HEART_QUARTER_ORDER, 'ring'];
