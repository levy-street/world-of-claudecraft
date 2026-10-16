// The Highwatch manor's lane, the pure half (the painter is highwatch_manor_lane.ts): a flagged
// path from the Sanctum road to the manor's garden gate, along the garden wall's foot. Paving
// drawn over the terrain, not a road record: the road graph, its lamps and every sim path stay
// as they are (the lane's ground is the manor's level apron, already walkable). Three-, DOM-
// and i18n-free; deterministic (each flag's length and tone come from a stable hash).

import { HIGHWATCH_BUILDINGS_BY_ID } from '../sim/highwatch_layout';

const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
/** The garden wall's outer face (the model's garden starts 28 yd south of its middle, as
 *  manor_plan.py GARDEN z0) and the gate's middle (the model's door axis, x 0). */
const WALL_Z = manor.position.z - 28;
const GATE_X = manor.position.x;

/** The lane's rectangle (world yards): from the road's shoulder to the gate's far pier, two
 *  yards wide and a hand off the garden wall, clear of the road's lamp at (3.8, 715). */
export const MANOR_LANE = {
  x0: 0,
  x1: GATE_X + 2.6,
  z0: WALL_Z - 2.3,
  z1: WALL_Z - 0.3,
} as const;

/** The path up the bank behind the manor's east wing to the crystal cave portal's bench
 *  (sim/highwatch_layout.ts PORTAL_BENCH at (10, 770)): from the manor's ground north of the
 *  library up the bank's gentlest side (a grade under 1, walkable) to the bench's lip, so the
 *  bank reads as a made way up to the portal, not a raw cut. */
export const MANOR_PORTAL_PATH = {
  x0: 3.6,
  x1: 5.2,
  z0: 760.4,
  z1: 769.4,
} as const;

function within(r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** True on the lane's or the portal path's paving (grass and scrub keep off them). */
export function onHighwatchManorLane(x: number, z: number): boolean {
  return within(MANOR_LANE, x, z) || within(MANOR_PORTAL_PATH, x, z);
}

export interface LaneFlag {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** 0..1, the flag's tone among the paving's greys */
  readonly shade: number;
}

function hash(a: number, b: number): number {
  const v = Math.sin(a * 91.17 + b * 47.53) * 43758.5453;
  return v - Math.floor(v);
}

/** The lane's flags: two staggered courses across its width, a joint between every flag. */
export function manorLaneFlags(): LaneFlag[] {
  const out: LaneFlag[] = [];
  const joint = 0.06;
  const rows = 2;
  const width = (MANOR_LANE.z1 - MANOR_LANE.z0) / rows;
  for (let r = 0; r < rows; r++) {
    const z0 = MANOR_LANE.z0 + r * width;
    let x = MANOR_LANE.x0 - (r % 2) * 0.45;
    let k = 0;
    while (x < MANOR_LANE.x1 - 0.05) {
      const len = 0.75 + 0.5 * hash(r, k);
      const a = Math.max(MANOR_LANE.x0, x);
      const b = Math.min(MANOR_LANE.x1, x + len);
      if (b - a > 0.2) {
        out.push({
          x0: a + joint / 2,
          x1: b - joint / 2,
          z0: z0 + joint / 2,
          z1: z0 + width - joint / 2,
          shade: hash(k + 0.5, r + 7),
        });
      }
      x += len;
      k++;
    }
  }
  return out;
}

/** The portal path's flags: one course up the bank, each flag across the path's width. */
export function manorPortalPathFlags(): LaneFlag[] {
  const out: LaneFlag[] = [];
  const joint = 0.06;
  let z: number = MANOR_PORTAL_PATH.z0;
  let k = 0;
  while (z < MANOR_PORTAL_PATH.z1 - 0.05) {
    const len = 0.55 + 0.25 * hash(k, 3);
    const b = Math.min(MANOR_PORTAL_PATH.z1, z + len);
    if (b - z > 0.2) {
      out.push({
        x0: MANOR_PORTAL_PATH.x0 + joint / 2,
        x1: MANOR_PORTAL_PATH.x1 - joint / 2,
        z0: z + joint / 2,
        z1: b - joint / 2,
        shade: hash(k + 0.5, 11),
      });
    }
    z = b;
    k++;
  }
  return out;
}
