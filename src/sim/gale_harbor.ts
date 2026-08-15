// The Wickharbor waterfront: stilt-pier decks running out over the bay, plus
// the boardwalk decking the bluff edge between their roots and the Beacon's
// own dock off the headland's foot. Each deck is a rotated rectangle whose
// surface height is anchored to the terrain at its shore root, so every pier
// leaves the land flush and stays LEVEL on its way out over the water.
// WALKABLE raised ground: world.ts groundHeight takes the max of terrain and
// galeDeckSurface (the docks idiom, an absolute surface, not a lift), and
// render/gale_features.ts draws the plank-and-stilt geometry from the same
// definitions, so the deck the player stands on is exactly the deck they
// see. Pure leaf: deterministic, no SimContext, terrain and water level are
// passed in. Tested directly by tests/gale_harbor.test.ts.

export interface GaleDeckDef {
  /** rectangle center */
  x: number;
  z: number;
  /** heading of the long axis (radians, atan2(dx, dz) convention) */
  rot: number;
  /** half-length along the heading, half-width across it */
  hl: number;
  hw: number;
  /** shore anchor: the deck's surface height samples the terrain here */
  ax: number;
  az: number;
  /**
   * Optional far anchor: the deck becomes a ramp, its surface running from
   * the ax anchor's height at along=-hl to this anchor's height at along=+hl
   * (joins two deck levels where the shore itself climbs).
   */
  ax2?: number;
  az2?: number;
}

/** Deck plank surface sits this far above the shore anchor's ground. */
export const GALE_DECK_LIFT = 0.34;
/** A deck never sits lower than this above the waterline (freeboard). */
export const GALE_DECK_FREEBOARD = 0.55;

// Bounding box for the cheap early-out (all decks live in the harbor corner).
const DECKS_X1 = 440;
const DECKS_X2 = 536;
const DECKS_Z1 = 312;
const DECKS_Z2 = 392;

export const GALE_HARBOR_DECKS: GaleDeckDef[] = [
  // the three harbor piers, rooted on the boardwalk and fanned wide along
  // the bay so each has open water and breathing room, north to south
  // (the north shore's decks all share one anchor so the network runs flush)
  { x: 481.6, z: 353.7, rot: 1.3, hl: 12, hw: 1.8, ax: 465, az: 354 },
  { x: 479.9, z: 362.6, rot: 1.45, hl: 13, hw: 2.0, ax: 465, az: 354 },
  // the deepwater pier off the south shore, reaching the drowned channel
  { x: 464.1, z: 378.0, rot: 1.3, hl: 12, hw: 2.0, ax: 451, az: 375 },
  // the shore boardwalk, laid right along the waterline (never inland)
  { x: 467.5, z: 358.0, rot: -0.124, hl: 8.1, hw: 1.7, ax: 465, az: 354 },
  { x: 459.75, z: 371.25, rot: -0.91, hl: 8.6, hw: 1.7, ax: 465, az: 354, ax2: 451, az2: 375 },
  // the two wooden stairs climbing the bluff from the boardwalk to level
  // land (steep ramps; the renderer draws them as stepped treads)
  { x: 462.7, z: 361.7, rot: -1.648, hl: 3.3, hw: 1.3, ax: 465, az: 354, ax2: 458, az2: 361 },
  { x: 464.5, z: 352.75, rot: -1.816, hl: 3.1, hw: 1.3, ax: 465, az: 354, ax2: 460, az2: 352 },
  // the Beacon dock: long and low off the headland's bench, shifted well
  // SOUTH-EAST of the lighthouse so its stair never crowds the tower's own;
  // the stair's bottom end overlaps INTO the pier root so the two decks
  // share walkable ground at the junction (no dead wedge between rects)
  { x: 517.2, z: 337.2, rot: 0.785, hl: 13, hw: 2.2, ax: 507, az: 327 },
  { x: 503.3, z: 325.3, rot: 0.99, hl: 6.94, hw: 1.4, ax: 497, az: 321, ax2: 507, az2: 327 },
];

/**
 * The plank surface height of one deck at a point `along` its long axis
 * (terrain-anchored, freeboard-clamped; ramps lerp between their anchors).
 */
export function galeDeckSurfaceAt(
  deck: GaleDeckDef,
  along: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  const floor = waterLevel + GALE_DECK_FREEBOARD;
  const y0 = Math.max(terrainAt(deck.ax, deck.az), floor) + GALE_DECK_LIFT;
  if (deck.ax2 === undefined || deck.az2 === undefined) return y0;
  const y1 = Math.max(terrainAt(deck.ax2, deck.az2), floor) + GALE_DECK_LIFT;
  const t = Math.min(1, Math.max(0, (along + deck.hl) / (2 * deck.hl)));
  return y0 + (y1 - y0) * t;
}

/**
 * The harbor deck surface at (x, z): the highest plank plane underfoot, or
 * -Infinity outside every deck footprint.
 */
export function galeDeckSurface(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  if (x < DECKS_X1 || x > DECKS_X2 || z < DECKS_Z1 || z > DECKS_Z2) return -Infinity;
  let surface = -Infinity;
  for (const deck of GALE_HARBOR_DECKS) {
    const dx = x - deck.x;
    const dz = z - deck.z;
    const dirx = Math.sin(deck.rot);
    const dirz = Math.cos(deck.rot);
    const along = dx * dirx + dz * dirz;
    if (along < -deck.hl || along > deck.hl) continue;
    const across = dx * dirz - dz * dirx;
    if (across < -deck.hw || across > deck.hw) continue;
    surface = Math.max(surface, galeDeckSurfaceAt(deck, along, terrainAt, waterLevel));
  }
  return surface;
}
