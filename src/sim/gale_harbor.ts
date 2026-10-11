// The Wickharbor waterfront's walkable planks: the shore boardwalk, the two north
// piers off it, the two stairs up the bluff, and the Old Beacon's dock and stair off
// the headland. The layout itself is data (content/wickharbor_harbor.ts, drawn by the
// one Blender model render/wickharbor_harbor.ts places); this module owns the deck
// shape every plank walkway of the realm shares (GaleDeckDef: a rotated rectangle,
// optionally trimmed by straight cuts, level or a two-height ramp) and the surface
// query. WALKABLE raised ground: world.ts groundHeight takes the max of terrain and
// galeDeckSurface (the docks idiom, an absolute surface, not a lift), so the deck the
// player stands on is exactly the deck the model draws. Pure leaf: deterministic, no
// SimContext, terrain and water level are passed in. Tested directly by
// tests/gale_harbor.test.ts and tests/wickharbor_harbor.test.ts.

import { WICKHARBOR_HARBOR_DECKS } from './content/wickharbor_harbor';

/** A straight cut trimming a deck: the deck keeps only the side of the line through
 *  (x, z) that its normal (nx, nz) points into. A pier whose root meets a boardwalk at a
 *  slant is cut along the boardwalk's edge, so the two share that edge and no plank. */
export interface GaleDeckCut {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

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
  /**
   * Optional end surfaces, yards ABOVE THE WATERLINE, in place of the anchor
   * samples (near = the ax end at along -hl, far = the ax2 end at +hl): a deck
   * whose height is set by something that is not terrain (the ferry piers and
   * harbors of ferry_piers.ts, which meet the ship's gangplank).
   */
  nearAboveWater?: number;
  farAboveWater?: number;
  /** Optional straight cuts trimming the rectangle (honoured by galeDeckContains and
   *  galeDeckSurface; the other walkway queries lay plain rectangles). */
  cuts?: readonly GaleDeckCut[];
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

/** Wickharbor's harbor decks (content/wickharbor_harbor.ts), in the order their shore
 *  anchors pad the terrain (terrain_calm_anchors.ts). */
export const GALE_HARBOR_DECKS: readonly GaleDeckDef[] = WICKHARBOR_HARBOR_DECKS;

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
  const y0 =
    deck.nearAboveWater !== undefined
      ? waterLevel + deck.nearAboveWater
      : Math.max(terrainAt(deck.ax, deck.az), floor) + GALE_DECK_LIFT;
  let y1: number;
  if (deck.farAboveWater !== undefined) y1 = waterLevel + deck.farAboveWater;
  else if (deck.ax2 === undefined || deck.az2 === undefined) return y0;
  else y1 = Math.max(terrainAt(deck.ax2, deck.az2), floor) + GALE_DECK_LIFT;
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
  return deckListSurface(GALE_HARBOR_DECKS, x, z, terrainAt, waterLevel);
}

/**
 * The highest plank plane underfoot across a list of decks, or -Infinity off
 * every footprint. The harbor's own query above wraps it in a bounding-box
 * early-out; other deck runs in the same idiom (Zephyr's launch wharf,
 * glider_wharf_layout.ts) pass their own list.
 */
export function deckListSurface(
  decks: readonly GaleDeckDef[],
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  let surface = -Infinity;
  for (const deck of decks) {
    const along = galeDeckAlong(deck, x, z, 0);
    if (along === null) continue;
    surface = Math.max(surface, galeDeckSurfaceAt(deck, along, terrainAt, waterLevel));
  }
  return surface;
}

/**
 * Where (x, z) lies along the deck's heading when it stands on the deck (inside its
 * rectangle and every cut by at least `inset`), or null off it. The one footprint test
 * of the surface query and of everything that asks whether a point is on the planks.
 */
export function galeDeckAlong(deck: GaleDeckDef, x: number, z: number, inset = 0): number | null {
  const dx = x - deck.x;
  const dz = z - deck.z;
  const dirx = Math.sin(deck.rot);
  const dirz = Math.cos(deck.rot);
  const along = dx * dirx + dz * dirz;
  if (along < -deck.hl + inset || along > deck.hl - inset) return null;
  const across = dx * dirz - dz * dirx;
  if (across < -deck.hw + inset || across > deck.hw - inset) return null;
  for (const cut of deck.cuts ?? []) {
    if ((x - cut.x) * cut.nx + (z - cut.z) * cut.nz < inset) return null;
  }
  return along;
}

/** Whether (x, z) stands on the deck, at least `inset` inside every edge. */
export function galeDeckContains(deck: GaleDeckDef, x: number, z: number, inset = 0): boolean {
  return galeDeckAlong(deck, x, z, inset) !== null;
}
