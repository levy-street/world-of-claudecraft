// Launch pier rooted on the existing western mountain, facing east over the downs.
import { deckListSurface, type GaleDeckDef } from './gale_harbor';

const WHARF_ROOT = { x: 191, z: 557 } as const;
const WHARF_HEADING = Math.PI / 2;

export const GLIDER_WHARF = {
  x: 205,
  z: 557,
  // Return updraft beside the landing pad, clear of the walking approach.
  updraft: { x: 258, z: 656, radius: 3 },
} as const;

export const GLIDER_WHARF_DECKS: readonly GaleDeckDef[] = Object.freeze([
  {
    x: GLIDER_WHARF.x,
    z: GLIDER_WHARF.z,
    rot: WHARF_HEADING,
    hl: 14,
    hw: 4,
    ax: WHARF_ROOT.x,
    az: WHARF_ROOT.z,
  },
]);

// Bounding box for the cheap early-out.
const WHARF_X1 = GLIDER_WHARF.x - 20;
const WHARF_X2 = GLIDER_WHARF.x + 20;
const WHARF_Z1 = GLIDER_WHARF.z - 20;
const WHARF_Z2 = GLIDER_WHARF.z + 20;

/** The wharf plank surface at (x, z), or -Infinity off the planks. */
export function gliderWharfSurface(
  x: number,
  z: number,
  terrainAt: (x: number, z: number) => number,
  waterLevel: number,
): number {
  if (x < WHARF_X1 || x > WHARF_X2 || z < WHARF_Z1 || z > WHARF_Z2) return -Infinity;
  return deckListSurface(GLIDER_WHARF_DECKS, x, z, terrainAt, waterLevel);
}
