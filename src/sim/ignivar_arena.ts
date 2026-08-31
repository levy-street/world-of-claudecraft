// Pure geometry and stable object identities for Ignivar's raid arena. The
// encounter driver, dungeon content, renderer, and tests all consume these
// values so conduit placement and frontal resolution cannot drift.

import { polygonContainsPoint } from './geometry2d';

export type IgnivarConduitId = 'north_west' | 'north_east' | 'south_east' | 'south_west';

export type IgnivarConduitState = 'ready' | 'active' | 'cooldown';

export interface IgnivarConduitPoint {
  id: IgnivarConduitId;
  x: number;
  z: number;
}

export const IGNIVAR_ARENA_SHELL_POLYGON = [
  { x: -14, z: -33 },
  { x: 14, z: -33 },
  { x: 33, z: -14 },
  { x: 33, z: 14 },
  { x: 14, z: 33 },
  { x: -14, z: 33 },
  { x: -33, z: 14 },
  { x: -33, z: -14 },
] as const;

/** The dry stone platform inside the perimeter moat. */
export const IGNIVAR_PLAYABLE_FLOOR_POLYGON = [
  { x: -12, z: -29 },
  { x: 12, z: -29 },
  { x: 29, z: -12 },
  { x: 29, z: 12 },
  { x: 12, z: 29 },
  { x: -12, z: 29 },
  { x: -29, z: 12 },
  { x: -29, z: -12 },
] as const;

export const IGNIVAR_LAVA_MOAT_DEPTH = 0.8;
export const IGNIVAR_LAVA_BRIDGE_HALF_WIDTH = 4;
export const IGNIVAR_LAVA_BRIDGE_INNER_Z = 27.5;
/** Keeps the boss on the central dais while leaving the south entry outside
 *  its automatic aggro radius. */
export const IGNIVAR_BOSS_SPAWN_Z = 4;
/** KayKit's authored Ignivar floor is a 4u grid. These origins are the exact
 * first centers emitted by DungeonInteriors.placeFloor for IGNIVAR_LAYOUT. */
export const IGNIVAR_FLOOR_TILE_SIZE = 4;
export const IGNIVAR_FLOOR_GRID_X_ORIGIN = -33;
export const IGNIVAR_FLOOR_GRID_Z_ORIGIN = -35;
export const IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION = Object.freeze({
  normal: 0.25,
  heroic: 0.45,
});
export const IGNIVAR_LAVA_MOAT_ABILITY_ID = 'ignivar_crucible_perimeter';
export const IGNIVAR_LAVA_MOAT_ABILITY_NAME = 'Crucible Perimeter';

export function ignivarArenaBridgeAt(x: number, z: number): boolean {
  return (
    polygonContainsPoint(IGNIVAR_ARENA_SHELL_POLYGON, x, z) &&
    Math.abs(x) <= IGNIVAR_LAVA_BRIDGE_HALF_WIDTH &&
    Math.abs(z) >= IGNIVAR_LAVA_BRIDGE_INNER_Z
  );
}

/** Whether the renderer authors the 4x4 KayKit tile at this exact grid center.
 * Bridges are separate exact-width decks and intentionally do not participate. */
export function ignivarArenaFloorTileCenterHasStone(x: number, z: number): boolean {
  return polygonContainsPoint(IGNIVAR_PLAYABLE_FLOOR_POLYGON, x, z);
}

/** Pointwise union of every visible 4x4 KayKit tile. Gameplay consumes the
 * union, not the idealized octagon, so no visible slab can ever be lethal. */
export function ignivarArenaTiledFloorAt(x: number, z: number): boolean {
  const size = IGNIVAR_FLOOR_TILE_SIZE;
  const half = size / 2;
  const firstX =
    IGNIVAR_FLOOR_GRID_X_ORIGIN + Math.floor((x - IGNIVAR_FLOOR_GRID_X_ORIGIN) / size) * size;
  const firstZ =
    IGNIVAR_FLOOR_GRID_Z_ORIGIN + Math.floor((z - IGNIVAR_FLOOR_GRID_Z_ORIGIN) / size) * size;

  // At a shared tile edge either adjacent visible tile makes the point dry.
  // Checking both candidate centers avoids assigning the exact boundary by a
  // floating-point rounding convention that the renderer does not have.
  for (const centerX of [firstX, firstX + size]) {
    if (Math.abs(x - centerX) > half + 1e-6) continue;
    for (const centerZ of [firstZ, firstZ + size]) {
      if (Math.abs(z - centerZ) > half + 1e-6) continue;
      if (ignivarArenaFloorTileCenterHasStone(centerX, centerZ)) return true;
    }
  }
  return false;
}

export function ignivarArenaHasStoneFloorAt(x: number, z: number): boolean {
  return ignivarArenaTiledFloorAt(x, z) || ignivarArenaBridgeAt(x, z);
}

export function ignivarArenaPointInLava(x: number, z: number): boolean {
  return (
    polygonContainsPoint(IGNIVAR_ARENA_SHELL_POLYGON, x, z) && !ignivarArenaHasStoneFloorAt(x, z)
  );
}

// Anchored on the maintainer's baked water_pump dressing placements: each
// conduit object sits on the pump the player sees, so the cleanse pool and the
// state overlay render on the pump body. Keep these in sync with the four
// water_pump entries in ignivarArenaPropPlacements.
export const IGNIVAR_CONDUITS: readonly IgnivarConduitPoint[] = [
  { id: 'north_west', x: -16.2, z: 16.4 },
  { id: 'north_east', x: 17.1, z: 16.8 },
  { id: 'south_east', x: 16.6, z: -16.5 },
  { id: 'south_west', x: -17.4, z: -17.1 },
];

export const IGNIVAR_WATER_CONDUIT_TEMPLATES = {
  ready: 'ignivar_water_conduit_ready',
  active: 'ignivar_water_conduit_active',
  cooldown: 'ignivar_water_conduit_cooldown',
} as const satisfies Record<IgnivarConduitState, string>;

export const IGNIVAR_FRONTAL_RANGE = 36;
export const IGNIVAR_FRONTAL_HALF_ANGLE = Math.PI / 15;
export const IGNIVAR_ROTATING_RAYS_COUNT = 3;
export const IGNIVAR_ROTATING_RAYS_RANGE = 34;
export const IGNIVAR_ROTATING_RAYS_INNER_RANGE = 2.5;
export const IGNIVAR_ROTATING_RAYS_HALF_WIDTH = 1;

/** True when a point sits inside Ignivar's currently aimed frontal cone. */
export function ignivarPointInFrontal(
  origin: { x: number; z: number },
  facing: number,
  point: { x: number; z: number },
): boolean {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0 || distance > IGNIVAR_FRONTAL_RANGE) return false;
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  return (dx * forwardX + dz * forwardZ) / distance >= Math.cos(IGNIVAR_FRONTAL_HALF_ANGLE);
}

/** True when a point sits inside any of three evenly spaced rays. */
export function ignivarPointInRotatingRay(
  origin: { x: number; z: number },
  baseFacing: number,
  point: { x: number; z: number },
): boolean {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  for (let ray = 0; ray < IGNIVAR_ROTATING_RAYS_COUNT; ray++) {
    const facing = baseFacing + (ray * Math.PI * 2) / IGNIVAR_ROTATING_RAYS_COUNT;
    const forwardX = Math.sin(facing);
    const forwardZ = Math.cos(facing);
    const forward = dx * forwardX + dz * forwardZ;
    if (forward < IGNIVAR_ROTATING_RAYS_INNER_RANGE || forward > IGNIVAR_ROTATING_RAYS_RANGE) {
      continue;
    }
    const lateral = Math.abs(dx * forwardZ - dz * forwardX);
    if (lateral <= IGNIVAR_ROTATING_RAYS_HALF_WIDTH) return true;
  }
  return false;
}

/** Returns the available conduit struck by a frontal emitted from `origin`.
 * Facing follows the sim convention: zero points along +z. */
export function ignivarConduitHitByFrontal(
  origin: { x: number; z: number },
  facing: number,
  available?: ReadonlySet<IgnivarConduitId>,
): IgnivarConduitId | null {
  let hit: IgnivarConduitId | null = null;
  let hitDistance = Infinity;

  for (const conduit of IGNIVAR_CONDUITS) {
    if (available && !available.has(conduit.id)) continue;
    const dx = conduit.x - origin.x;
    const dz = conduit.z - origin.z;
    const distance = Math.hypot(dx, dz);
    if (!ignivarPointInFrontal(origin, facing, conduit)) continue;
    if (distance >= hitDistance) continue;
    hit = conduit.id;
    hitDistance = distance;
  }

  return hit;
}

export function ignivarConduitStateForTemplate(templateId: string): IgnivarConduitState | null {
  for (const state of ['ready', 'active', 'cooldown'] as const) {
    if (IGNIVAR_WATER_CONDUIT_TEMPLATES[state] === templateId) return state;
  }
  return null;
}
