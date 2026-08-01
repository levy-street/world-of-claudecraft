// Unreachable-target detection for engaged mobs: the classic evade trigger.
// Mobs chase in a straight line with a slide fan and no pathfinding, so a mob
// whose target stands past a wall or under an unclimbable ledge pins in place
// forever, still in combat, while the target chips it down risk-free (the rift
// ledge exploit). This module watches for that shape: engaged, out of reach,
// committing zero movement, with the straight step toward the target refused
// by the same block modes moveToward enforces. After CHASE_STALL_TIMEOUT
// seconds of that, the caller (combat_profile.ts) sends the mob home through
// the existing evade state (immune, heals to full on arrival).
//
// This applies to EVERY canLeash mob, bosses included: pinning a boss out of
// reach force-resets the pull (full heal, loot rights dropped). That is the
// intended classic behavior, the whole point being that an unreachable
// attacker gets nothing; only canLeash false encounter scripts (Nythraxis)
// opt out.
//
// Draws NO rng and writes nothing but mob.chaseStall, so the parity goldens
// are unaffected: the accumulator stays 0 in every scenario where mobs fight
// in contact or make chase progress.
import { MOBS } from '../data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import type { SimContext } from '../sim_context';
import { angleTo, DT, dist2d, type Entity, type Vec3 } from '../types';
import {
  crossesGardenHedge,
  groundHeight,
  nearSteepWalls,
  terrainSteepnessAt,
  waterLevelAt,
} from '../world';

// Longer than the evade arm's EVADE_STALL_TIMEOUT (3s, locomotion.ts): a false
// positive there merely phases a mob home, while a false positive here full
// heals the mob mid-fight and punishes players. 5 seconds absorbs brief body
// blocks, root-break re-chases, and prop-circling hiccups while still denying
// sustained free damage from an unreachable perch.
export const CHASE_STALL_TIMEOUT = 5;

// Would a chase step of `speed` toward `dest` be blocked, i.e. is a prop, deep
// water, an unclimbable cliff face, or a maze hedge right in front of this
// mob? Mirrors every block mode moveToward (sim.ts) enforces, in the same
// order, so a mob that commits zero movement AND probes blocked is genuinely
// pinned by geometry. `speed` is the caller's actual attempted chase speed so
// the probed step matches the step moveToward just refused. (The deep-water
// arm is kept for mirror fidelity with moveToward and blockedTowardSpawn even
// though every template-backed mob currently swims.)
export function blockedTowardTarget(
  ctx: SimContext,
  e: Entity,
  dest: Vec3,
  speed: number,
): boolean {
  const d = dist2d(e.pos, dest);
  const step = Math.min(speed * DT, d);
  if (step < 1e-4) return false;
  const facing = angleTo(e.pos, dest);
  const nx = e.pos.x + Math.sin(facing) * step;
  const nz = e.pos.z + Math.cos(facing) * step;
  const canSwim = ctx.mobCanSwim(MOBS[e.templateId]);
  const seed = ctx.cfg.seed;
  if (!canSwim && groundHeight(nx, nz, seed) < waterLevelAt(nx, nz) - PLAYER_SWIM_DEPTH)
    return true;
  // The uphill steep-wall gate: a cliff face refuses a chase step exactly as it
  // does in moveToward, so a mob pinned under a ledge reads as blocked, not as
  // "open ground ahead". Swimmers clamp submerged ground to the waterline (a
  // sloped lake bed is not a wall), matching moveToward's ride().
  if (nearSteepWalls(nx, nz) && terrainSteepnessAt(nx, nz, seed) > PLAYER_MAX_CLIMB_SLOPE) {
    const ride = (x: number, z: number): number => {
      const h = groundHeight(x, z, seed);
      const wl = waterLevelAt(x, z);
      return canSwim && h < wl ? wl : h;
    };
    if (ride(nx, nz) > ride(e.pos.x, e.pos.z)) return true;
  }
  const resolved = ctx.resolveMovePoint(nx, nz, PLAYER_BODY_RADIUS, e);
  // The Great Maze's hedge walls are hard for mobs too (moveToward refuses the
  // crossing), so a hedge-pinned chase reads as blocked.
  if (crossesGardenHedge(e.pos.x, e.pos.z, resolved.x, resolved.z)) return true;
  // a collider ate most of the intended movement -> blocked
  return Math.hypot(nx - resolved.x, nz - resolved.z) > step * 0.5;
}

// One evaluation per engaged tick, AFTER the combat arm has moved the mob (so
// "did it move this tick" is mob.pos vs mob.prevPos, which the roster pass
// refreshed at tick start). `chaseSpeed` is the speed the arm just attempted.
// Returns true exactly once per full stall window; the caller flips the mob to
// evade. The clock accumulates only on qualifying ticks: states that bypass
// the engaged runner (stun, fear, charge dashes, healer hold) freeze it, so
// "5 seconds pinned" means 5 accumulated seconds of genuine pinning, however
// much CC interleaves.
export function chaseStalledUnreachable(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  reach: number,
  chaseSpeed: number,
): boolean {
  // A phasing mob walks through the geometry this probe models; its moveToward
  // always commits the straight step, so it can never be terrain-pinned.
  if (MOBS[mob.templateId]?.phasesThroughObstacles) return false;
  // In reach is fighting fine: melee in swing range, casters standing at spell
  // range on purpose. Also covers a mob close enough to hit through thin walls
  // (mob melee has no line-of-sight check), which is a fight, not a stall.
  if (dist2d(mob.pos, target.pos) <= reach) {
    mob.chaseStall = 0;
    return false;
  }
  // Root is crowd control, not geometry: HOLD the accumulator (no growth, no
  // reset) so root spam can neither trigger an evade nor re-arm a pinned
  // mob's clock.
  if (ctx.isRooted(mob)) return false;
  // The slide fan only commits movement when it makes real progress, so a
  // circling or wall-sliding mob moves every tick and resets; a truly pinned
  // mob commits exactly zero.
  if (dist2d(mob.pos, mob.prevPos) > 1e-3) {
    mob.chaseStall = 0;
    return false;
  }
  // Stationary with open ground ahead is a transient AI hiccup, not an
  // unreachable target.
  if (!blockedTowardTarget(ctx, mob, target.pos, chaseSpeed)) {
    mob.chaseStall = 0;
    return false;
  }
  mob.chaseStall += DT;
  if (mob.chaseStall < CHASE_STALL_TIMEOUT) return false;
  mob.chaseStall = 0;
  return true;
}
