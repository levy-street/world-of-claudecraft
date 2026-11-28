// The Anvil of the World's four vein grooves (the arrival's spiral, after a
// teammate's playtest note of 2026-11-10 that Jose approved: "could the lights
// on the ground follow the markings on the ground?"). Each altar has a channel
// carved into the walk, swept like the room's ridges (the same law,
// smith_heart_quarters.ts `heartRidgeBearingDeg`, so the grooves run parallel
// to them inside their own quarter and never cross one), then curling on
// across the central ring to the boss's feet at the same pitch, so the four
// read as one deliberate four-armed spiral converging on the Anvil.
//
//   - The floor carves it (heart_floor_glsl.ts `heartVeinGrooveGlsl`, the walk
//     from under the altar to the ring's outer foot), from these numbers.
//   - The arrival's light runs down it (final_arrival_core.ts
//     `arrivalStreamPath`, painted by final_arrival_beam.ts), on the polyline
//     `heartVeinGroovePath` lays.
// One law, read by both, pinned by tests/smith_heart_vein_groove.test.ts (each
// path starts at its altar, ends at the centre, stays inside its groove).
//
// Pure and Three-free (RENDER_PURE_CORES); instance-local yards.

import {
  HEART_ALTAR_R,
  HEART_ALTARS,
  HEART_ROOM,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { HEART_QUARTERS, heartRoomBearingDeg } from '../../sim/content/smith_heart_quarters';
import { HEART_RING_LOOK } from './heart_quarters_core';

const DEG = Math.PI / 180;

/** The groove's measures (yards). */
export const HEART_VEIN_GROOVE = {
  /** The carved channel's half width (its bed and walls). */
  halfWidth: 1.15,
  /** The worn, rolled lip either side of it. */
  lip: 0.6,
  /** Where the carving starts: just past the altar's centre, under its foot. */
  outerR: HEART_ALTAR_R + 1.5,
  /** Where the walk's carving meets the central ring's dais (its outer foot);
   *  from here the curl runs on across the ring to the boss. */
  ringR: HEART_RING_LOOK.rimOut,
  /** Where the spiral ends: at the boss's feet, short of its footprint. */
  endR: 2.4,
} as const;

/** The ridges' sweep share at radius `r` (1 at the ring, 0 at the rim). */
function sweepShare(r: number): number {
  const { ringR, rimR, power } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  return (1 - u) ** power;
}

/** How fast the walk's sweep turns at radius `r` (degrees per yard). */
function sweepSlopeDeg(r: number): number {
  const { ringR, rimR, power, sweepDeg } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  return (sweepDeg * power * (1 - u) ** (power - 1)) / (rimR - ringR);
}

/** Inside the ring the curl keeps the pitch it meets the dais with (a
 *  logarithmic spiral: `curlDeg` degrees per e-fold of radius). */
export const HEART_VEIN_GROOVE_CURL_DEG =
  HEART_VEIN_GROOVE.ringR * sweepSlopeDeg(HEART_VEIN_GROOVE.ringR);

/** The four grooves in the altars' order (HEART_ALTARS). */
export const HEART_VEIN_GROOVE_VEINS: readonly SmithHeartVein[] = HEART_ALTARS.map((a) => a.vein);

/** Groove `vein`'s unwound bearing (degrees): its altar's bearing with the
 *  sweep taken back out at the altar's radius. Constant along the walk. */
export function heartVeinGrooveFlatDeg(vein: SmithHeartVein): number {
  const a = HEART_ALTARS.find((q) => q.vein === vein) ?? HEART_ALTARS[0];
  return heartRoomBearingDeg(a.x, a.z) + HEART_QUARTERS.sweepDeg * sweepShare(HEART_ALTAR_R);
}

/** The first groove's unwound bearing folded into one quarter turn (the four
 *  are a quarter turn apart; the floor's shader reads this one number). */
export function heartVeinGrooveFlatPhaseDeg(): number {
  return ((heartVeinGrooveFlatDeg(HEART_ALTARS[0].vein) % 90) + 90) % 90;
}

/** Groove `vein`'s bearing (degrees, unwrapped) at radius `r`. */
export function heartVeinGrooveBearingDeg(vein: SmithHeartVein, r: number): number {
  const g = HEART_VEIN_GROOVE;
  const flat = heartVeinGrooveFlatDeg(vein);
  if (r >= g.ringR) return flat - HEART_QUARTERS.sweepDeg * sweepShare(r);
  const atRing = flat - HEART_QUARTERS.sweepDeg * sweepShare(g.ringR);
  return atRing - HEART_VEIN_GROOVE_CURL_DEG * Math.log(g.ringR / Math.max(r, 1e-3));
}

/** The spiral's pitch at `r`: radius times its turn rate (radians per
 *  yard), so a sideways offset `s` along the bearing is `s / hypot(1, k)`
 *  across the groove. */
export function heartVeinGroovePitch(r: number): number {
  const g = HEART_VEIN_GROOVE;
  if (r >= g.ringR) return r * sweepSlopeDeg(r) * DEG;
  return HEART_VEIN_GROOVE_CURL_DEG * DEG;
}

/** How far (x, z) lies across groove `vein`'s centreline (yards, signed:
 *  positive toward increasing bearing), measured on the arc at its radius
 *  and turned square to the groove. The floor's shader mirrors it. */
export function heartVeinGrooveOffset(vein: SmithHeartVein, x: number, z: number): number {
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  const d = ((heartRoomBearingDeg(x, z) - heartVeinGrooveBearingDeg(vein, r) + 540) % 360) - 180;
  return (d * DEG * r) / Math.hypot(1, heartVeinGroovePitch(r));
}

/** Is (x, z) on the walk's carved stretch of a groove (by radius)? */
export function heartVeinGrooveCarvedAt(r: number): boolean {
  return r >= HEART_VEIN_GROOVE.ringR && r <= HEART_VEIN_GROOVE.outerR;
}

/** A point down groove `vein` at radius `r` (instance-local). */
export function heartVeinGroovePoint(vein: SmithHeartVein, r: number): { x: number; z: number } {
  const b = heartVeinGrooveBearingDeg(vein, r) * DEG;
  return { x: HEART_ROOM.x + Math.sin(b) * r, z: HEART_ROOM.z + Math.cos(b) * r };
}

/** The radius at which groove `vein` leaves its altar: the first point
 *  inward `clear` yards from the altar's centre (by halving). */
export function heartVeinGrooveLeaveR(vein: SmithHeartVein, clear: number): number {
  const a = HEART_ALTARS.find((q) => q.vein === vein) ?? HEART_ALTARS[0];
  const away = (r: number) => {
    const p = heartVeinGroovePoint(vein, r);
    return Math.hypot(p.x - a.x, p.z - a.z);
  };
  let lo: number = HEART_VEIN_GROOVE.ringR;
  let hi: number = HEART_ALTAR_R;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (away(mid) > clear) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A groove's run as a polyline from radius `fromR` in to `toR`: points
 *  laid evenly by radius (`steps` spans), their running length (yards). */
export interface HeartVeinGroovePolyline {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Each point's radius from the room's centre. */
  readonly r: Float64Array;
  /** Yards along the run to each point (0 at the first). */
  readonly along: Float64Array;
  readonly length: number;
}

export function heartVeinGroovePath(
  vein: SmithHeartVein,
  fromR: number,
  toR: number,
  steps: number,
): HeartVeinGroovePolyline {
  const n = Math.max(1, Math.floor(steps)) + 1;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const r = new Float64Array(n);
  const along = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Evenly in the log of the radius inside the ring would bunch the
    // points at the boss; evenly by radius keeps the curl's tight end
    // sampled densely enough for a ribbon (the run's length is what reads).
    const rr = fromR + ((toR - fromR) * i) / (n - 1);
    const p = heartVeinGroovePoint(vein, rr);
    x[i] = p.x;
    z[i] = p.z;
    r[i] = rr;
    if (i > 0) along[i] = along[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  }
  return { x, z, r, along, length: along[n - 1] };
}
