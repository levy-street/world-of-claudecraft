// Player housing content: the Land Steward who sells the homestead deed in
// Eastbrook, and the shared plot layout every homestead slot uses. The
// Homestead Glens live in their own far-west x-band (see data.ts); each owner
// visits a private slot laid out from this one blueprint, so the renderer,
// the colliders, and the sim all read the same offsets. Data-as-code only.

import type { NpcDef } from '../types';

// The deed: a flat 100 gold, paid once at the Land Steward.
export const HOMESTEAD_DEED_COPPER = 1_000_000;

export const LAND_STEWARD: NpcDef = {
  id: 'land_steward',
  name: 'Steward Fenwick',
  title: 'Land Steward',
  pos: { x: -9, z: -11 },
  facing: 0.8,
  color: 0xb08a52,
  questIds: [],
  housing: true,
  greeting:
    'Dreaming of a hearth of your own? The Homestead Glens keep a plot ' +
    'ready for anyone with a hundred gold and the deed-hand to sign for it.',
};

// Everything below is expressed in plot-local offsets from a slot's origin.
// The plot faces south: you arrive at the gate and look up the path to the
// front door.

export const HOMESTEAD_ARRIVAL = { x: 0, z: -20 };
export const HOMESTEAD_ARRIVAL_FACING = 0; // facing +z, toward the house
export const HOMESTEAD_EXIT_PORTAL = { x: -13, z: -18 };
export const HOMESTEAD_MAILBOX = { x: 6.5, z: -7 };

// The cottage: one house model, gently rotated to face the gate. Footprint
// (w x d) is the collider the sim shares with the renderer.
export const HOMESTEAD_HOUSE = { x: 0, z: 7, rot: Math.PI, w: 11, d: 9 };
export const HOMESTEAD_WELL = { x: -9, z: -2, radius: 1.3 };
export const HOMESTEAD_CAMPFIRE = { x: 8.5, z: -12.5 };

// Fence ring with a south gate gap (render-only dressing; no collider, so a
// wandering pet can never wedge its owner into a corner).
export const HOMESTEAD_FENCE = { minX: -18, maxX: 18, minZ: -16, maxZ: 20, gateHalfWidth: 3.5 };

// Garden dressing: trees and shrubs, kept clear of the path and buildings.
export const HOMESTEAD_TREES: { x: number; z: number; scale: number }[] = [
  { x: -14.5, z: 15, scale: 1.25 },
  { x: 14.5, z: 14, scale: 1.05 },
  { x: 15.5, z: -3, scale: 0.9 },
  { x: -15, z: -12, scale: 1.1 },
];
export const HOMESTEAD_SHRUBS: { x: number; z: number; scale: number }[] = [
  { x: -4.5, z: 2.5, scale: 0.8 },
  { x: 4.5, z: 3, scale: 0.9 },
  { x: -8, z: -9, scale: 0.7 },
  { x: 11, z: 5, scale: 0.75 },
];
