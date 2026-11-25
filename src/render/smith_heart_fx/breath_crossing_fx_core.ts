// The Gale Crossing's look, pure (breath_crossing_fx.ts paints it; the sim is
// encounters/smith_heart/breath_crossing.ts). The road of wind over the chasm
// follows the ride's own FIXED arc (breath_isle_geometry.ts rideArc with the
// crossing's apex), so the current drawn is exactly where a body is carried:
// a bright core along the arc and strands of wind wound round it in a
// helix, turning as they go.

import { CORNICE_CROSSING } from '../../sim/content/smith_heart_layout';
import { CROSSING_TUNING } from '../../sim/encounters/smith_heart/breath_crossing_ids';
import { rideArc } from '../../sim/encounters/smith_heart/breath_isle_geometry';

export interface CrossingPoint {
  x: number;
  y: number;
  z: number;
}

/** The current's look: strands round the core, their radius, turns over the
 *  whole road, samples along it, and the body's carry height over the arc
 *  (the arc is the feet's; the current wraps the body). */
export const CROSSING_LOOK = {
  strands: 3,
  radius: 1.25,
  turns: 4.5,
  samples: 72,
  lift: 1.1,
} as const;

/** The road's centre line from `a` to `b` (instance-local, y the floors),
 *  `n` + 1 points along the ride's arc, lifted to a body's middle. */
export function crossingPath(
  a: { x: number; z: number },
  b: { x: number; z: number },
  floorY: number,
  n: number = CROSSING_LOOK.samples,
): CrossingPoint[] {
  const from = { x: a.x, y: floorY, z: a.z };
  const to = { x: b.x, y: floorY, z: b.z };
  const out: CrossingPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const p = rideArc(from, to, i / n, CROSSING_TUNING.apex);
    out.push({ x: p.x, y: p.y + CROSSING_LOOK.lift, z: p.z });
  }
  return out;
}

/** Strand `k`'s points wound round `path` (a helix about the line, its phase
 *  `k` of the strands round, its radius easing in at both ends so it rises
 *  out of the pad and settles where the body is set down). */
export function crossingStrand(path: readonly CrossingPoint[], k: number): CrossingPoint[] {
  const L = CROSSING_LOOK;
  const n = path.length - 1;
  const out: CrossingPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // A side across the road (level) and an up square to both.
    const sl = Math.hypot(tz, tx) || 1;
    const sx = -tz / sl;
    const sz = tx / sl;
    const ux = ty * sz;
    const uy = tz * sx - tx * sz;
    const uz = -ty * sx;
    const t = i / n;
    const ang = t * L.turns * Math.PI * 2 + (k / L.strands) * Math.PI * 2;
    const ease = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.6;
    const r = L.radius * (0.35 + 0.65 * ease);
    const p = path[i];
    out.push({
      x: p.x + (sx * Math.cos(ang) + ux * Math.sin(ang)) * r,
      y: p.y + uy * Math.sin(ang) * r,
      z: p.z + (sz * Math.cos(ang) + uz * Math.sin(ang)) * r,
    });
  }
  return out;
}

/** The two roads: out over the chasm to the Cornice, and home. */
export function crossingRoads(floorY: number): {
  out: CrossingPoint[];
  home: CrossingPoint[];
} {
  const C = CORNICE_CROSSING;
  return {
    out: crossingPath(C.out, C.arrive, floorY),
    home: crossingPath(C.home, C.back, floorY),
  };
}
