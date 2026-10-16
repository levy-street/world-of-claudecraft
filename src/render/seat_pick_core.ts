// Which seat a screen ray points at (the seats are src/sim/seat_anchor.ts): a ray against
// each seat's pick box (an oriented box standing on the floor). A pure core: the renderer
// hands in the camera ray, no Three here, so a Vitest drives it directly.

import type { SeatAnchor } from '../sim/seat_anchor';

export interface SeatRayHit {
  seat: SeatAnchor;
  /** Distance along the (unit) ray to the box. */
  t: number;
  /** Where the ray enters the box (world). */
  x: number;
  y: number;
  z: number;
}

/** The nearest seat box a ray enters within `maxT`, or null. The ray's direction must be a
 *  unit vector. */
export function pickSeatOnRay(
  seats: readonly SeatAnchor[],
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT = 200,
): SeatRayHit | null {
  let best: SeatRayHit | null = null;
  for (const seat of seats) {
    const b = seat.pick;
    // the box's own axes (three.js rotation.y): local x and z in the world
    const cr = Math.cos(b.rot);
    const sr = Math.sin(b.rot);
    const rx = ox - b.x;
    const rz = oz - b.z;
    // ray in the box frame: u along local x (cos, -sin), w along local z (sin, cos)
    const ou = rx * cr - rz * sr;
    const ow = rx * sr + rz * cr;
    const du = dx * cr - dz * sr;
    const dw = dx * sr + dz * cr;
    let t0 = 0;
    let t1 = best ? best.t : maxT;
    const slab = (o: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d;
      let c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      return t0 <= t1;
    };
    if (!slab(ou, du, -b.hw, b.hw)) continue;
    if (!slab(ow, dw, -b.hd, b.hd)) continue;
    if (!slab(oy, dy, b.y0, b.y1)) continue;
    best = { seat, t: t0, x: ox + dx * t0, y: oy + dy * t0, z: oz + dz * t0 };
  }
  return best;
}
