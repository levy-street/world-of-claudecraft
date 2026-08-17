// THE HEX BUILDING KIT's measured footprints, the one source of truth for how
// big these models actually are.
//
// Every hand-placed building in the game collides as a CIRCLE, and these models
// are rectangles. A circle that contains a rectangle bulges past its flat walls,
// worst at the middle of each wall, and the player's own 0.5yd radius widens
// that band again: you are stopped in open air with the wall still a stride
// away. Player report: "the collision on things like the stables is too large
// causing a buffer around the building making it seem like there is an
// invisible wall". Undersizing is the same defect mirrored, and reads worse: the
// circle then cuts the CORNERS off, so you are walled out of ground the model
// does not occupy while also clipping into it along the axes.
//
// The three colourways (hex_ green, hexr_ red, hexb_ blue) are the same meshes,
// so one table serves Dawnhold, the Last Keep and the Ashen Bulwark. Values are
// the model's own bounding footprint at scale 1, measured off the shipped GLBs.
// Pure leaf: no rng, no SimContext, no imports.

export interface HexBuildingUnit {
  /** unit extent along the model's local x, at scale 1 */
  w: number;
  /** unit extent along the model's local z, at scale 1 */
  d: number;
}

/** Measured unit footprints, keyed by model family (colourway suffix dropped). */
export const HEX_BUILDING_UNIT: Record<string, HexBuildingUnit> = {
  castle: { w: 1.9752, d: 2.2561 },
  barracks: { w: 1.44, d: 1.5662 },
  townhall: { w: 1.4351, d: 1.5638 },
  church: { w: 1.0291, d: 1.155 },
  tavern: { w: 1.1718, d: 1.3324 },
  stables: { w: 1.8587, d: 2.1316 },
  homeA: { w: 0.7919, d: 0.8537 },
  homeB: { w: 0.8749, d: 1.0987 },
  market: { w: 1.7994, d: 1.3156 },
  blacksmith: { w: 1.2876, d: 1.2452 },
  archeryrange: { w: 1.6706, d: 1.5509 },
  towerCatapult: { w: 0.9297, d: 1.3033 },
};

/** `hexrStables` to `stables`, so one table covers all three colourways. */
export function hexBuildingFamily(key: string): string {
  const m = /^hex[rb]?([A-Z]\w*)$/.exec(key);
  if (!m) return key;
  return m[1].charAt(0).toLowerCase() + m[1].slice(1);
}

/**
 * The model's half-extents at an authored scale, in the model's LOCAL axes.
 *
 * Local, not world: the collider carries the same `rot` the prop is drawn with
 * and rotates the query point into local space, so these never need swapping
 * for a rotated building. Returns null for a key with no measurement, and the
 * caller keeps its circle.
 */
export function hexBuildingBox(key: string, scale: number): { hw: number; hd: number } | null {
  const u = HEX_BUILDING_UNIT[hexBuildingFamily(key)];
  if (!u) return null;
  return { hw: (u.w * scale) / 2, hd: (u.d * scale) / 2 };
}
