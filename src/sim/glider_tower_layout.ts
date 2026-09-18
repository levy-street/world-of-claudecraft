// The Shear Windrider Flight Atalaya: the coastal flight tower standing on the
// cliffs of The Shear at Galecrest (450, 520), lifting Flightmaster Zephyr and
// the slalom launch perch to Y = 74.
//
// Single-valued heightfield surface: within the tower platform, groundHeight
// sits at deckY = 74.0. Outside the platform, it falls off sheer to the
// underlying cliff lawn, matching the physical stone tower rendered in
// gale_features.ts. An updraft funnel at the tower base (facing the cliff
// road) whisks approaching ground-level adventurers up to the launch deck.
//
// Pure leaf: deterministic, no rng, no SimContext.

export const GLIDER_TOWER = {
  x: 450.0,
  z: 520.0,
  deckRadius: 4.5,
  deckY: 74.0,
  columnRadius: 3.8,
  updraft: {
    x: 450.0,
    z: 512.5,
    radius: 3.0,
  },
} as const;

/**
 * The absolute surface height of the glider tower deck at (x, z),
 * or -Infinity outside the tower footprint.
 */
export function gliderTowerSurface(x: number, z: number): number {
  const dx = x - GLIDER_TOWER.x;
  const dz = z - GLIDER_TOWER.z;
  if (dx * dx + dz * dz <= GLIDER_TOWER.deckRadius * GLIDER_TOWER.deckRadius) {
    return GLIDER_TOWER.deckY;
  }
  return Number.NEGATIVE_INFINITY;
}
