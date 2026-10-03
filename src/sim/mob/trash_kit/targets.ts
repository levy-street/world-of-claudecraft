// Pure target and shape picks for the dungeon trash kit. Zero rng: a "random"
// player is a deterministic hash over the living players in reach (sorted by
// entity id), so every host picks the same victim and the parity gate's draw
// order never moves.

import { angleTo, dist2d, type Entity, normAngle, type Vec3 } from '../../types';

/** A 32-bit integer mix of two numbers (the kit's deterministic dice). */
export function kitHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Living players within `range` of `from`, in entity-id order. */
export function livingInReach(players: readonly Entity[], from: Vec3, range: number): Entity[] {
  return players.filter((p) => !p.dead && dist2d(p.pos, from) <= range).sort((a, b) => a.id - b.id);
}

/** The bolt's victim: one living player in reach, picked by hash. */
export function pickHashedTarget(
  players: readonly Entity[],
  from: Vec3,
  range: number,
  mobId: number,
  salt: number,
): Entity | null {
  const inReach = livingInReach(players, from, range);
  if (inReach.length === 0) return null;
  return inReach[kitHash(mobId, salt) % inReach.length];
}

/** Does `e` fight with mana (the casters and healers a leap hunts)? */
export function isManaUser(e: Entity): boolean {
  return e.resourceType === 'mana';
}

/**
 * The leap's victim: the FARTHEST living mana user between `minRange` and
 * `maxRange`, else the farthest living player in that band. Ties go to the
 * lower entity id. Null when nobody stands in the band.
 */
export function pickLeapTarget(
  players: readonly Entity[],
  from: Vec3,
  minRange: number,
  maxRange: number,
): Entity | null {
  const band = livingInReach(players, from, maxRange).filter(
    (p) => dist2d(p.pos, from) >= minRange,
  );
  if (band.length === 0) return null;
  const casters = band.filter(isManaUser);
  const pool = casters.length > 0 ? casters : band;
  let best = pool[0];
  let bestD = dist2d(best.pos, from);
  for (const p of pool) {
    const d = dist2d(p.pos, from);
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Is `p` inside the cone of `range` yards and `arcDeg` degrees about `facing`? */
export function inCone(
  origin: Vec3,
  facing: number,
  p: Vec3,
  range: number,
  arcDeg: number,
): boolean {
  if (dist2d(origin, p) > range) return false;
  const half = (arcDeg * Math.PI) / 180 / 2;
  return Math.abs(normAngle(angleTo(origin, p) - facing)) <= half;
}
