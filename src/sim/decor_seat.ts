// Seat a hand-placed decor piece on its whole footprint instead of its centre.
//
// A decorProps row is drawn at the ground height under its CENTRE (src/render/props.ts),
// so a wide piece on a slope or a fissure edge floats on its downhill side. A row that
// opts in with `seat: 'footprint'` is fitted here instead: a low, flat piece (a vent
// ring, a plaza) leans with the ground under it, up to a capped tilt, unless it is a
// standable top (a floe, a rubble slab), and every piece then sinks until the lowest point of the ground under its
// footprint meets its base. Tall pieces stay upright: a spire leaning with a hillside
// reads as falling over.
//
// Pure: a function of the row and a caller-supplied height probe, no state. The renderer
// (src/render/muster_camps.ts renderDecorProps) and the collider build
// (decor_prop_colliders.ts) both read it, so a sunk model and its collider top agree.
// Pinned by tests/decor_seat.test.ts.
import { DECOR_FOOTPRINTS } from './content/decor_footprints';
import type { WorldContent } from './types';

type DecorProp = NonNullable<WorldContent['props']['decorProps']>[number];

export interface DecorSeat {
  /** Yards the piece sits below the ground at its centre. */
  sink: number;
  /** Lean about the piece's local x axis (radians, the render's rotation.x). */
  pitch: number;
  /** Lean about the piece's local z axis (radians, the render's rotation.z). */
  roll: number;
}

/** The steepest lean a low, flat piece takes from the ground under it (about 14 deg). */
export const DECOR_SEAT_MAX_TILT = 0.25;
/** A piece leans only while its height is under this share of its narrowest width. */
export const DECOR_SEAT_FLAT_RATIO = 0.5;
/** The footprint is sampled on rings at these fractions of its half extents. Not the
 *  full extent: the pieces are rocks and slabs, rounder than their bounding boxes, and a
 *  probe at a box corner would sink a piece to ground it never covers. */
const RINGS: readonly { at: number; n: number }[] = [
  { at: 0.95, n: 24 },
  { at: 0.5, n: 8 },
];

const NO_SEAT: DecorSeat = Object.freeze({ sink: 0, pitch: 0, roll: 0 });

/** The row's footprint half extents in its local axes, already scaled, plus its height;
 *  undefined when nothing says how big it is. */
function footprintOf(d: DecorProp): { hw: number; hd: number; h: number } | undefined {
  const scale = typeof d.scale === 'number' ? d.scale : 1;
  const f = Object.hasOwn(DECOR_FOOTPRINTS, d.key) ? DECOR_FOOTPRINTS[d.key] : undefined;
  if (f) return { hw: (f.x / 2) * scale, hd: (f.z / 2) * scale, h: f.y * scale };
  if (d.hw !== undefined && d.hd !== undefined) return { hw: d.hw, hd: d.hd, h: d.h ?? 4 };
  if (d.r) return { hw: d.r, hd: d.r, h: d.h ?? 4 };
  return undefined;
}

/**
 * The seat for one row: zero for a row that does not opt in, floats on water, or has no
 * known footprint. `heightAt` is the terrain height the renderer draws the piece on.
 */
export function decorSeat(d: DecorProp, heightAt: (x: number, z: number) => number): DecorSeat {
  if (d.seat !== 'footprint' || d.float !== undefined) return NO_SEAT;
  const fp = footprintOf(d);
  if (!fp) return NO_SEAT;
  const rot = d.rot ?? 0;
  // the render's yaw (rotation.y): local x runs along (cos, -sin), local z along (sin, cos)
  const ax = Math.cos(rot);
  const az = -Math.sin(rot);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const at = (u: number, v: number): number =>
    heightAt(d.x + ax * u + fx * v, d.z + az * u + fz * v);
  const centre = heightAt(d.x, d.z);
  const reachU = fp.hw * RINGS[0].at;
  const reachV = fp.hd * RINGS[0].at;
  let pitch = 0;
  let roll = 0;
  // a standable piece stays level: its collider top is flat (decor_prop_colliders.ts),
  // so a leaned slab would put the landing surface off its art
  if (d.standableTop === undefined && fp.h < DECOR_SEAT_FLAT_RATIO * 2 * Math.min(fp.hw, fp.hd)) {
    const gradU = (at(reachU, 0) - at(-reachU, 0)) / (2 * reachU);
    const gradV = (at(0, reachV) - at(0, -reachV)) / (2 * reachV);
    const clamp = (a: number): number =>
      Math.max(-DECOR_SEAT_MAX_TILT, Math.min(DECOR_SEAT_MAX_TILT, a));
    // the muster camps' convention (muster_camp_layout.ts fitMusterPiece): roll follows
    // the slope along local x, pitch the slope along local z
    roll = clamp(Math.atan(gradU));
    pitch = clamp(-Math.atan(gradV));
  }
  const du = Math.tan(roll);
  const dv = -Math.tan(pitch);
  // how far the ground sits below (-) the leaned base plane, at its lowest
  let lo = 0;
  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2;
      const u = Math.cos(a) * fp.hw * ring.at;
      const v = Math.sin(a) * fp.hd * ring.at;
      const gap = at(u, v) - (centre + u * du + v * dv);
      if (gap < lo) lo = gap;
    }
  }
  // `|| 0` folds -0 to 0, so flat ground reads as no seat at all
  const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
  return { sink: r3(-lo), pitch: r3(pitch), roll: r3(roll) };
}

/** Opt every row into the footprint seat (a zone's whole decor list). */
export function seatedOnFootprint<T extends DecorProp>(rows: readonly T[]): T[] {
  return rows.map((d) => ({ ...d, seat: 'footprint' as const }));
}
