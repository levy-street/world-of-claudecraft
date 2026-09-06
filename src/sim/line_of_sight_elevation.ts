import { lineOfSightClear, MOVE_TOP_EPS, supportHeightAt } from './colliders';
import { DUNGEON_X_THRESHOLD } from './data';
import { PLAYER_BODY_RADIUS } from './pathfind';
import type { Entity, Vec3 } from './types';
import { groundHeight } from './world';

// Pet recovery deliberately remains on raw collider LOS in pet/pet_ai.ts: it
// gates only the long-distance teleport heuristic, not a combat decision.

interface OpenWorldSightHeights {
  ground: number;
  support: number;
}

function openWorldSightHeights(seed: number, pos: Vec3): OpenWorldSightHeights | undefined {
  // Every instanced band lies beyond this threshold. Leaving those endpoints
  // undefined preserves lineOfSightClear's zone policy, including the
  // battleground's deliberate caller-y behavior.
  if (pos.x > DUNGEON_X_THRESHOLD) return undefined;
  return {
    ground: groundHeight(pos.x, pos.z, seed),
    support: supportHeightAt(seed, pos.x, pos.z, PLAYER_BODY_RADIUS, pos.y + MOVE_TOP_EPS),
  };
}

function boundedSightFeet(pos: Vec3, heights: OpenWorldSightHeights, onGround: boolean): number {
  // Open-world endpoints may retain authored support beneath their current
  // footprint. When grounded, sight feet are at least the support height
  // (stall canopy, crate top, etc.) so a mounted player on a stall sees from
  // the stall height, not from ground+mount height. When airborne, sight is
  // clamped to the support we left so a jump doesn't lift the eye over cover.
  const support = Math.max(heights.ground, heights.support);
  return onGround ? Math.max(pos.y, support) : Math.min(pos.y, support);
}

function playerSightFeet(seed: number, entity: Entity): number | undefined {
  if (entity.kind !== 'player') return undefined;
  const heights = openWorldSightHeights(seed, entity.pos);
  return heights ? boundedSightFeet(entity.pos, heights, entity.onGround) : undefined;
}

function bodySightFeet(seed: number, body: Vec3): number | undefined {
  const heights = openWorldSightHeights(seed, body);
  return heights ? boundedSightFeet(body, heights, true) : undefined;
}

export function entityLineOfSightClear(
  seed: number,
  source: Entity,
  target: Entity,
  r = 0.05,
  delveModules?: readonly string[],
  riftToken = 0,
): boolean {
  const sightFeet = {
    from: playerSightFeet(seed, source),
    to: playerSightFeet(seed, target),
  };
  return lineOfSightClear(seed, source.pos, target.pos, r, delveModules, riftToken, sightFeet);
}

export function entityToBodyLineOfSightClear(
  seed: number,
  source: Entity,
  body: Vec3,
  r = 0.05,
  delveModules?: readonly string[],
  riftToken = 0,
): boolean {
  const sightFeet = {
    from: playerSightFeet(seed, source),
    to: bodySightFeet(seed, body),
  };
  return lineOfSightClear(seed, source.pos, body, r, delveModules, riftToken, sightFeet);
}
