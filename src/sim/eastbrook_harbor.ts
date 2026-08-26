// New Eastbrook's harbor waterfront: the quay boardwalk along the pad's east
// lip and the three stilt piers running out over the carved cove, the middle
// one the ferry berth for the tutorial-island arrival (site-plan.md wave D).
// Same idiom as the Wickharbor waterfront (gale_harbor.ts, whose GaleDeckDef
// and surface math this module reuses): each deck is a rotated rectangle
// anchored to the terrain at its shore root on the quay pad, so every pier
// leaves the quay flush and stays LEVEL out over the water. WALKABLE raised
// ground: world.ts groundHeight takes the max of terrain and
// eastbrookDeckSurface, and render/eastbrook_harbor.ts draws plank-and-stilt
// geometry from these same definitions. Pure leaf: deterministic, no
// SimContext; terrain and water level are passed in.

import { type GaleDeckDef, galeDeckSurfaceAt } from './gale_harbor';

// Bounding box for the cheap early-out (the whole waterfront lives on the
// cove's west rim).
// Widened with the round 6 pier respacing: this box silently CLIPS any deck
// sample outside it, so it has to lead the geometry, not trail it.
const DECKS_X1 = -122;
const DECKS_X2 = -88;
const DECKS_Z1 = -74;
const DECKS_Z2 = -34;

export const EASTBROOK_HARBOR_DECKS: GaleDeckDef[] = [
  // the quay boardwalk, laid along the pad's east lip; every pier roots on it
  { x: -97.5, z: -54, rot: 0, hl: 16, hw: 1.5, ax: -94, az: -54 },
  // the ferry berth: the long middle pier, reaching the cove's deep water
  { x: -107, z: -54, rot: -Math.PI / 2, hl: 10, hw: 2.2, ax: -94, az: -54 },
  // Round 6 (owner + team): the two working piers re-laid square to the quay on
  // an even 14 yd pitch (roots at z -40, -54, -68) and run out to 8 yd. They
  // used to sit 10.6 yd off the ferry berth and fan at 0.12 rad, which left no
  // berth a hull could actually lie in: the gap between neighbouring piers was
  // narrower than a ship is wide, so the fleet ended up moored on the beach.
  // Square and evenly spaced, each gap now takes a berthed hull with water on
  // both sides.
  { x: -104.5, z: -40, rot: -Math.PI / 2, hl: 8, hw: 1.6, ax: -94, az: -40 },
  { x: -104.5, z: -68, rot: -Math.PI / 2, hl: 8, hw: 1.6, ax: -94, az: -68 },
];

/**
 * The harbor deck surface at (x, z): the highest plank plane underfoot, or
 * -Infinity outside every deck footprint. Shape mirrors galeDeckSurface.
 */
export function eastbrookDeckSurface(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  if (x < DECKS_X1 || x > DECKS_X2 || z < DECKS_Z1 || z > DECKS_Z2) return -Infinity;
  let surface = -Infinity;
  for (const deck of EASTBROOK_HARBOR_DECKS) {
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
