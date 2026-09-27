// The Wyrmwatch cliff harbor's colliders (content/wyrmwatch_harbor.ts): the rails
// that line every drop off its quays, flights and landings, the solid things
// standing on it (the gate posts, the lantern posts, bollards, cargo), and the
// Harbormaster's House (wyrmwatch_harbor_house.ts: its walls and furnishings).
// Its walkable decks are not here: they join the ferry pier surface query
// (ferry_piers.ts), so world.ts groundHeight walks them like any harbor planks.
//
// Rails are cut into short blocking boxes that follow the planks under them (a
// rail up a flight climbs with it), each topped a rail height over its highest
// plank so a jump never clears it, and seen through above its bottom rail (the
// ferry's open balustrade idiom, content/transport_ships.ts). Consecutive boxes
// overlap by the rail's thickness so a corner never leaves a slit.
//
// Pure leaf: deterministic, no SimContext, no rng. Joined to the static grid by
// colliders.ts (built-in world only), ungated: the harbor stands whatever the
// ferry's timetable.

import type { Collider } from './colliders';
import {
  WYRMWATCH_HARBOR_PROPS,
  WYRMWATCH_HARBOR_RAILS,
  WYRMWATCH_RAIL_HEIGHT,
  WYRMWATCH_RAIL_SIGHT,
  WYRMWATCH_RAIL_THICKNESS,
  type WyrmwatchHarborProp,
} from './content/wyrmwatch_harbor';
import { groundHeight } from './world';
import { harborHouseColliders } from './wyrmwatch_harbor_house';

/** A rail box is never longer than this, so its top tracks a flight's rise. */
export const WYRMWATCH_RAIL_SEGMENT = 1.2;

/** The rail boxes of one polyline: short overlapping OBBs along every leg. */
export function wyrmwatchRailColliders(
  points: readonly (readonly [number, number])[],
  seed: number,
): Collider[] {
  const out: Collider[] = [];
  const half = WYRMWATCH_RAIL_THICKNESS / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const pieces = Math.max(1, Math.ceil(len / WYRMWATCH_RAIL_SEGMENT));
    // local z runs along the leg: yaw so (0, 1) maps onto its direction
    const rot = Math.atan2(x1 - x0, z1 - z0);
    for (let k = 0; k < pieces; k++) {
      const t0 = k / pieces;
      const t1 = (k + 1) / pieces;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const t of [t0, (t0 + t1) / 2, t1]) {
        const y = groundHeight(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, seed);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      const tm = (t0 + t1) / 2;
      out.push({
        type: 'obb',
        x: x0 + (x1 - x0) * tm,
        z: z0 + (z1 - z0) * tm,
        hw: half,
        hd: len / pieces / 2 + half,
        rot,
        moveTopY: hi + WYRMWATCH_RAIL_HEIGHT,
        cameraTopY: lo + WYRMWATCH_RAIL_SIGHT,
      });
    }
  }
  return out;
}

/** One prop's collider, seated on the ground or planks under its centre. */
export function wyrmwatchPropCollider(prop: WyrmwatchHarborProp, seed: number): Collider {
  const base = groundHeight(prop.x, prop.z, seed);
  const top = base + prop.height;
  // full height to movement unless it is cargo or a bollard to stand on
  const move = prop.standable ? { moveTopY: top, standable: true as const } : {};
  if (prop.r !== undefined) {
    return { type: 'circle', x: prop.x, z: prop.z, r: prop.r, cameraTopY: top, ...move };
  }
  return {
    type: 'obb',
    x: prop.x,
    z: prop.z,
    hw: prop.hw ?? 0.5,
    hd: prop.hd ?? 0.5,
    rot: prop.rot,
    cameraTopY: top,
    ...move,
  };
}

/** Every collider of the harbor: the rails, then the props, then the house. */
export function wyrmwatchHarborColliders(seed: number): Collider[] {
  const out: Collider[] = [];
  for (const rail of WYRMWATCH_HARBOR_RAILS) out.push(...wyrmwatchRailColliders(rail, seed));
  for (const prop of WYRMWATCH_HARBOR_PROPS) out.push(wyrmwatchPropCollider(prop, seed));
  out.push(...harborHouseColliders(seed));
  return out;
}
