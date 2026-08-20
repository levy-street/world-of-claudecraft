// Pure geometry and stable object identities for Ignivar's raid arena. The
// encounter driver, dungeon content, renderer, and tests all consume these
// values so conduit placement and frontal resolution cannot drift.

export type IgnivarConduitId = 'north_west' | 'north_east' | 'south_east' | 'south_west';

export type IgnivarConduitState = 'ready' | 'active' | 'cooldown';

export interface IgnivarConduitPoint {
  id: IgnivarConduitId;
  x: number;
  z: number;
}

export const IGNIVAR_CONDUITS: readonly IgnivarConduitPoint[] = [
  { id: 'north_west', x: -22, z: 22 },
  { id: 'north_east', x: 22, z: 22 },
  { id: 'south_east', x: 22, z: -22 },
  { id: 'south_west', x: -22, z: -22 },
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
