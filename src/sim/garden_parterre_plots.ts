// The Evergarden's parterre plot table: the authored bed sites, plus the
// plot-margin test the scatter generator (world.ts, through
// decoration_exclusions.ts) uses to keep random trees and rocks off the beds.
// A sim leaf because the sim now collides on it: the decoration field drops
// curated scatter at the source, so the renderer and the collision grid read
// the same list. render/garden_parterre_core.ts re-exports it for the
// planting plan; tests/garden_parterre.test.ts validates the sites.

export type ParterreKind = 'square' | 'round' | 'ring';

export interface ParterrePlot {
  x: number;
  z: number;
  r: number;
  /** 'square': a large ornamental square bed model; 'round': a small round
   * bed model orbiting a large bed; 'ring': a mill-lawn procedural ring
   * planting with a windmill at its heart. The modeled beds render and
   * collide as decorProps (content/evergarden), stand on level pads
   * (world.ts GARDEN_BED_PADS), and this table drives the planting
   * exclusions; the paired test pins all three lists against each other. */
  kind: ParterreKind;
  /** 'windmill': the ring plots' built centerpiece (a decorProps entry) */
  centerpiece?: 'windmill';
}

// The bed layout: six large square ornamental gardens, each orbited by
// three or four small round beds at its outer edges (a formal satellite
// pattern), plus the mill lawn's three procedural ring beds. Every site
// sits on flat dry lawn clear of the maze, the hamlet, the walks, camps,
// nodes, and great trees (the paired test re-validates all of that against
// the live terrain), and every modeled bed stands on a level pad.
export const PARTERRE_PLOTS: readonly ParterrePlot[] = [
  // west of the Parterre Walk: the grand garden and its four satellites
  { x: 322, z: 878, r: 10, kind: 'square' },
  { x: 322, z: 892.8, r: 3.25, kind: 'round' },
  { x: 322, z: 863.2, r: 3.25, kind: 'round' },
  { x: 336.8, z: 878, r: 3.25, kind: 'round' },
  { x: 307.2, z: 878, r: 3.25, kind: 'round' },
  // east of the Parterre Walk
  { x: 400, z: 866, r: 9, kind: 'square' },
  { x: 400, z: 879.8, r: 3.25, kind: 'round' },
  { x: 400, z: 852.2, r: 3.25, kind: 'round' },
  { x: 413.8, z: 866, r: 3.25, kind: 'round' },
  { x: 386.2, z: 866, r: 3.25, kind: 'round' },
  // the west maze forecourt
  { x: 256, z: 952, r: 9, kind: 'square' },
  { x: 256, z: 965.8, r: 3.25, kind: 'round' },
  { x: 256, z: 938.2, r: 3.25, kind: 'round' },
  { x: 269.8, z: 952, r: 3.25, kind: 'round' },
  { x: 242.2, z: 952, r: 3.25, kind: 'round' },
  // east of the maze road (the east water bites off the fourth satellite)
  { x: 476, z: 1010, r: 7.5, kind: 'square' },
  { x: 476, z: 1022.3, r: 3.25, kind: 'round' },
  { x: 476, z: 997.7, r: 3.25, kind: 'round' },
  { x: 463.7, z: 1010, r: 3.25, kind: 'round' },
  // (no bed east of the Garden Gate road: the extended gate wall and its
  // channel-bank tower hold that lawn now)
  // the north lawn
  { x: 300, z: 1118, r: 6, kind: 'square' },
  { x: 300, z: 1128.8, r: 3.25, kind: 'round' },
  { x: 300, z: 1107.3, r: 3.25, kind: 'round' },
  { x: 310.8, z: 1118, r: 3.25, kind: 'round' },
  { x: 289.2, z: 1118, r: 3.25, kind: 'round' },
  // the mill lawn: three windmills turning over their own ring beds
  { x: 504, z: 760, r: 8.5, kind: 'ring', centerpiece: 'windmill' },
  { x: 492, z: 744, r: 7, kind: 'ring', centerpiece: 'windmill' },
  { x: 516, z: 750, r: 6.5, kind: 'ring', centerpiece: 'windmill' },
] as const;

/**
 * True inside any parterre plot (plus margin): the beds stay clear of the
 * random decoration trees and boulders, the way a gardener would keep them.
 */
export function inParterrePlot(x: number, z: number, margin = 0): boolean {
  for (const p of PARTERRE_PLOTS) {
    if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true;
  }
  return false;
}
