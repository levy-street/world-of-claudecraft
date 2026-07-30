// The Palmreach's walkways: little plank bridges spanning the jungle rivers
// and stilt decks reaching out over the big water (the Sapphire Lagoon pier
// and the jungle-pool viewing deck). Same idiom as the Wickharbor harbor
// (sim/gale_harbor.ts): each deck is a rotated rectangle whose surface is
// anchored to the terrain at its shore root(s), WALKABLE raised ground via
// world.ts groundHeight, drawn by render/jungle_features.ts from these same
// definitions. Steep two-anchor ramps render as stepped stairs with rails.
// Pure leaf: deterministic, no SimContext; terrain and water level are
// passed in. Reuses the GaleDeckDef shape and per-deck surface math.

import { type GaleDeckDef, galeDeckSurfaceAt } from './gale_harbor';

export const REACH_DECKS: GaleDeckDef[] = [
  // the Emerald Run bridge: a plank crossing on the Vinefall approach,
  // rooted on both banks so the walkway meets each side flush
  { x: -419, z: 996, rot: 2.836, hl: 10, hw: 1.6, ax: -422, az: 1006, ax2: -416, az2: 987 },
  // the Tanglewash bridge on the north cape's flank
  {
    x: -358,
    z: 1206,
    rot: 1.052,
    hl: 8.5,
    hw: 1.5,
    ax: -365.4,
    az: 1201.8,
    ax2: -350.6,
    az2: 1210.2,
  },
  // the Sapphire Lagoon boardwalk: a shore deck on the west rim with a
  // railed pier running out over the turquoise water (one shared anchor)
  { x: -302.5, z: 953, rot: 0, hl: 6.5, hw: 2.0, ax: -302, az: 947 },
  { x: -295.5, z: 950, rot: Math.PI / 2, hl: 8.5, hw: 2.2, ax: -302, az: 947 },
  // the jungle-pool deck: a small viewing platform off the pool's east rim,
  // with a stair climbing the tangle-side rise behind it
  { x: -372, z: 1004, rot: 0.5, hl: 4.5, hw: 2.2, ax: -368, az: 1000 },
  // the stair's bottom end runs INTO the platform rect so the two decks
  // share walkable ground at the junction (no dead wedge, the harbor rule)
  { x: -366.69, z: 998.99, rot: 2.265, hl: 7.3, hw: 1.8, ax: -368, az: 1000, ax2: -361, az2: 994 },
];

// bounding box for the cheap early-out, grown from the deck list itself
let bb: { x1: number; x2: number; z1: number; z2: number } | null = null;
function bounds(): { x1: number; x2: number; z1: number; z2: number } {
  if (bb) return bb;
  let x1 = Infinity;
  let x2 = -Infinity;
  let z1 = Infinity;
  let z2 = -Infinity;
  for (const d of REACH_DECKS) {
    const reach = d.hl + d.hw;
    x1 = Math.min(x1, d.x - reach);
    x2 = Math.max(x2, d.x + reach);
    z1 = Math.min(z1, d.z - reach);
    z2 = Math.max(z2, d.z + reach);
  }
  bb = { x1, x2, z1, z2 };
  return bb;
}

/**
 * The Palmreach walkway surface at (x, z): the highest plank plane
 * underfoot, or -Infinity outside every deck footprint.
 */
export function reachDeckSurface(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  const b = bounds();
  if (x < b.x1 || x > b.x2 || z < b.z1 || z > b.z2) return -Infinity;
  let surface = -Infinity;
  for (const deck of REACH_DECKS) {
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

/** True when (x, z) stands clear of every walkway footprint by `pad`. */
export function reachDeckClear(x: number, z: number, pad: number): boolean {
  const b = bounds();
  if (x < b.x1 - pad || x > b.x2 + pad || z < b.z1 - pad || z > b.z2 + pad) return true;
  for (const deck of REACH_DECKS) {
    const dx = x - deck.x;
    const dz = z - deck.z;
    const dirx = Math.sin(deck.rot);
    const dirz = Math.cos(deck.rot);
    const along = dx * dirx + dz * dirz;
    const across = dx * dirz - dz * dirx;
    if (Math.abs(along) < deck.hl + pad && Math.abs(across) < deck.hw + pad) return false;
  }
  return true;
}
