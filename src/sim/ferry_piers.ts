// The ferry piers at the two far berths (content/transport_ships.ts): the
// Moonrest ferry pier off the Nightbloom's sunset shore, and the Wyrmwatch
// ferry pier below the Drakelands bank. Built from the same pieces as the
// Eastbrook and Wickharbor ferry piers: level stilt decks (the GaleDeckDef
// idiom of gale_harbor.ts, drawn by the shared plank-walkway builder
// render/deck_render.ts through render/ferry_piers.ts) standing in the water,
// their planks at Eastbrook's ferry-pier height so the gangplank lands on them
// the same way. The Wyrmwatch pier's root opens onto the cliff harbor
// (content/wyrmwatch_harbor.ts: its quays, switchback stair and top landing),
// whose decks join this surface query but are drawn by their own Blender model
// (render/wyrmwatch_harbor.ts), not the plank builder; the Wickharbor ferry wharf
// (content/wickharbor_wharf.ts: its pier, berth head, arm and the flight up from the
// town's boardwalk) joins it the same way, drawn by its own Blender model
// (render/wickharbor_wharf.ts). WALKABLE raised ground:
// deck_surfaces.ts folds them into world.ts groundHeight. Nothing on the land
// moves: each pier roots at the water's edge.
//
// Pure leaf: deterministic, no SimContext; terrain and water level are
// passed in.

import { WICKHARBOR_WHARF_DECKS } from './content/wickharbor_wharf';
import { WYRMWATCH_HARBOR_DECKS } from './content/wyrmwatch_harbor';
import { type GaleDeckDef, galeDeckSurfaceAt } from './gale_harbor';

/** The ferry pier deck, yards above the waterline: Eastbrook's ferry pier
 *  height (its quay-anchored planks), which the gangplank's outer tread
 *  meets 0.22 above (content/transport_ships.ts). */
export const FERRY_PIER_DECK_ABOVE_WATER = 2.64;

const PIER = FERRY_PIER_DECK_ABOVE_WATER;

/** The piers, each its own list of decks (the renderer draws each pier as
 *  its own local mesh). */
export const FERRY_PIERS: readonly (readonly GaleDeckDef[])[] = [
  [
    // Moonrest: from the sunset shore (x -490, where the bank stands 2.4 above
    // the water) straight out west to the berth, its end 8 yd from the ship's
    // centre line like Eastbrook's T-head
    {
      x: -501,
      z: 1506,
      rot: -Math.PI / 2,
      hl: 11,
      hw: 2.2,
      ax: -490,
      az: 1506,
      nearAboveWater: PIER,
      farAboveWater: PIER,
    },
  ],
  [
    // Wyrmwatch: from the foot of the bank (x 490) straight out east to the
    // berth (the cliff harbor's decks join it at its root)
    {
      x: 498.5,
      z: 1899.2,
      rot: Math.PI / 2,
      hl: 8.5,
      hw: 2.2,
      ax: 490,
      az: 1899.2,
      nearAboveWater: PIER,
      farAboveWater: PIER,
    },
  ],
];

/** Every walkable ferry pier deck, in one list (the surface query): the piers
 *  the plank builder draws, then the Wyrmwatch cliff harbor's own decks, then the
 *  Wickharbor ferry wharf's. */
export const FERRY_PIER_DECKS: readonly GaleDeckDef[] = [
  ...FERRY_PIERS.flat(),
  ...WYRMWATCH_HARBOR_DECKS,
  ...WICKHARBOR_WHARF_DECKS,
];

// Per-site bounding boxes for the cheap early-out (the berths are a world
// apart, so one box would cover the whole east of the map): Moonrest's pier,
// the Wyrmwatch pier with its cliff harbor, and the Wickharbor wharf.
const BOXES: readonly (readonly [number, number, number, number])[] = [
  [-514, 1502, -488, 1510],
  [486, 1880, 509, 1922],
  [451, 364, 484, 389],
];

/** Whether (x, z) lies under a ferry pier's planks (nothing grows through).
 *  The footprint never depends on the water level (only the plank height
 *  does), so none is asked for. */
export function onFerryPier(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
): boolean {
  return ferryPierSurface(x, z, terrainAt, 0) !== Number.NEGATIVE_INFINITY;
}

/**
 * The ferry pier deck surface at (x, z): the highest plank plane underfoot,
 * or -Infinity outside every deck footprint. Shape mirrors galeDeckSurface.
 */
export function ferryPierSurface(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  // the site boxes first: this runs inside every ground-height sample
  let inBox = false;
  for (let i = 0; i < BOXES.length && !inBox; i++) {
    const b = BOXES[i];
    inBox = x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
  }
  if (!inBox) return Number.NEGATIVE_INFINITY;
  let surface = Number.NEGATIVE_INFINITY;
  for (const deck of FERRY_PIER_DECKS) {
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
