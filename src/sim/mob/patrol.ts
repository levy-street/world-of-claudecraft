// Dungeon patrols (G8): an idle mob stamped with a patrol loop walks it
// instead of wandering. The mob chases a point that travels the loop at the
// patrol pace, placed by the sim clock: s(t) = (time * pace + offset) mod L.
// So the walk is a pure function of time (zero rng, no per-mob state beyond
// the stamp), the members of one patrolling pack keep their spacing through
// their offsets, and a mob returning from an evade simply rejoins its point.
//
// Routed by the idle arm of mob/locomotion.ts after the aggro scan, so a
// patrol still notices players the way any idle mob does, and its pack pulls
// together through the ordinary packId social pull.
//
// The point travels the loop, never the straight line between: a ground
// patroller spawns ON its point for the claim's clock (placeOnPatrolPoint),
// and one that finds itself off it (a shove, the walk home from an evade)
// walks back ALONG its loop (mob/patrol_route.ts), so a loop laid on a zigzag
// road never sends a body across the void between two of its legs; the evade
// home rides the loop the same way (patrolEvadeWaypoint).

import { DUNGEON_FLOOR_Y } from '../data';
import type { SimContext } from '../sim_context';
import { DT, type DungeonSpawnPatrol, type Entity, type Vec3 } from '../types';
import { MAX_AGGRO_RADIUS } from './aggro_ranges';
import { LOOP_ROUTE_LOOKAHEAD, loopRouteTarget, projectOntoLoop } from './patrol_route';

/** A loop's default pace: a stroll at 40 percent of the mob's run speed. */
export const PATROL_DEFAULT_PACE = 0.4;
/** A mob this far behind its patrol point hurries to rejoin it. */
const CATCH_UP_DISTANCE = 1.5;
const CATCH_UP_MULT = 1.6;
/** A ground patroller this far from its patrol point (a claim made long after
 *  the sim clock started, a return from an evade, a knockback) walks back to
 *  it ALONG its loop instead of straight at it: a straight chase across a
 *  zigzag road runs off a terrace edge into the cliff wall (mob/patrol_route.ts). */
export const PATROL_REJOIN_DISTANCE = 4;

/** World-space patrol stamp for a spawn placed at instance origin (ox, oz). */
export function stampDungeonPatrol(
  patrol: DungeonSpawnPatrol,
  ox: number,
  oz: number,
): NonNullable<Entity['dungeonPatrol']> {
  return {
    points: patrol.points.map((p) => ({ x: ox + p.x, z: oz + p.z })),
    offset: patrol.offset ?? 0,
    pace: patrol.pace ?? PATROL_DEFAULT_PACE,
    ...(patrol.altitude !== undefined ? { flightY: DUNGEON_FLOOR_Y + patrol.altitude } : {}),
  };
}

/** Total length of a closed loop. */
export function patrolLoopLength(points: readonly { x: number; z: number }[]): number {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

/** The point `s` yards along the closed loop (wrapping), plus its heading. */
export function patrolPointAt(
  points: readonly { x: number; z: number }[],
  s: number,
): { x: number; z: number; facing: number } {
  const len = patrolLoopLength(points);
  if (points.length === 0) return { x: 0, z: 0, facing: 0 };
  if (len <= 0 || points.length === 1) return { x: points[0].x, z: points[0].z, facing: 0 };
  let d = ((s % len) + len) % len;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= seg || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, d / seg) : 0;
      // Sim facing convention: 0 = +z, atan2(dx, dz).
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        facing: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    d -= seg;
  }
  return { x: points[0].x, z: points[0].z, facing: 0 };
}

/**
 * Walk an idle patrolling mob one tick along its loop. Returns true when the
 * mob patrols (the caller then skips the wander step), false otherwise.
 */
export function updateMobPatrol(ctx: SimContext, mob: Entity): boolean {
  const patrol = mob.dungeonPatrol;
  if (!patrol || patrol.points.length === 0 || mob.moveSpeed <= 0) return false;
  const speed = mob.moveSpeed * patrol.pace;
  const target = patrolPointAt(patrol.points, ctx.time * speed + patrol.offset);
  if (patrol.flightY !== undefined) {
    flyPatrol(mob, patrol.flightY, target, speed);
    return true;
  }
  const dest = ctx.groundPos(target.x, target.z);
  const behind = Math.hypot(dest.x - mob.pos.x, dest.z - mob.pos.z);
  if (behind > PATROL_REJOIN_DISTANCE) {
    const s = ctx.time * speed + patrol.offset;
    const via = loopRouteTarget(patrol.points, mob.pos.x, mob.pos.z, s);
    ctx.moveToward(mob, ctx.groundPos(via.x, via.z), speed * CATCH_UP_MULT);
    return true;
  }
  const step = behind > CATCH_UP_DISTANCE ? speed * CATCH_UP_MULT : speed;
  if (ctx.moveToward(mob, dest, step)) mob.facing = target.facing;
  return true;
}

/**
 * Stand a freshly spawned GROUND patroller on its patrol point for the
 * current sim clock (the claim's spawn pass, instances/dungeons.ts), facing
 * along its loop, so it starts walking instead of chasing a point that the
 * clock has carried round the loop. Its spawn point (the evade home) is that
 * spot. A flier keeps its placement: it reaches its point in a straight line
 * over any gap.
 */
export function placeOnPatrolPoint(ctx: SimContext, mob: Entity): void {
  const patrol = mob.dungeonPatrol;
  if (!patrol || patrol.flightY !== undefined || patrol.points.length === 0) return;
  if (mob.moveSpeed <= 0) return;
  const target = patrolPointAt(
    patrol.points,
    ctx.time * mob.moveSpeed * patrol.pace + patrol.offset,
  );
  const at = ctx.groundPos(target.x, target.z);
  mob.pos = { ...at };
  mob.prevPos = { ...at };
  mob.spawnPos = { ...at };
  mob.fallStartY = at.y;
  mob.facing = target.facing;
  mob.prevFacing = target.facing;
}

/**
 * Where an evading GROUND patroller steers to walk home: along its loop to
 * its spawn point while it is more than LOOP_ROUTE_LOOKAHEAD away, so the walk
 * home follows the road it was pulled from. Null for any other mob, or once
 * home is in reach (the caller then walks straight to its spawn point).
 */
export function patrolEvadeWaypoint(ctx: SimContext, mob: Entity): Vec3 | null {
  const patrol = mob.dungeonPatrol;
  if (!patrol || patrol.flightY !== undefined || patrol.points.length < 2) return null;
  const home = mob.spawnPos;
  if (Math.hypot(home.x - mob.pos.x, home.z - mob.pos.z) <= LOOP_ROUTE_LOOKAHEAD) return null;
  const goal = projectOntoLoop(patrol.points, home.x, home.z);
  const via = loopRouteTarget(patrol.points, mob.pos.x, mob.pos.z, goal.s);
  return ctx.groundPos(via.x, via.z);
}

/** A flier this far over the floor is out of every ground attack's reach. */
export const FLIER_OUT_OF_REACH = 3;

/** Is the mob a flying patrol waiting on its loop, out of every ground
 *  attack's reach? The mob AI keeps such a mob non-hostile (nobody's target)
 *  until it is pulled (mob/locomotion.ts). */
export function flierWaitingAloft(ctx: SimContext, mob: Entity): boolean {
  if (mob.dungeonPatrol?.flightY === undefined || mob.aiState !== 'idle' || mob.inCombat)
    return false;
  return mob.pos.y > ctx.groundPos(mob.pos.x, mob.pos.z).y + FLIER_OUT_OF_REACH;
}

/** Is the mob a flying patrol on the wing (non-hostile while it waits)? Its
 *  pack and a boss's chain pull still bring it down with the rest, and make it
 *  a target at once. */
export function patrolFlierAloft(mob: Entity): boolean {
  return mob.dungeonPatrol?.flightY !== undefined && mob.aiState === 'idle' && !mob.hostile;
}

/** How far a flying patrol sees a player on the floor under it. A walker's
 *  sight shrinks with the player's level (to 4 yd for one far above it), which
 *  a loop flown yards off the walkways can never close: a flier keeps its
 *  whole authored sight, so a pass overhead is a pull at any level. */
export function flierSightRadius(mob: Entity, radius: number, authored: number): number {
  if (mob.dungeonPatrol?.flightY === undefined) return radius;
  return Math.max(radius, Math.min(MAX_AGGRO_RADIUS, authored));
}

/** How fast a flier climbs back to its loop after a landing (yards/second). */
export const FLIGHT_CLIMB_RATE = 6;

/**
 * A FLYING patrol (DungeonSpawnPatrol.altitude): the flier holds its loop
 * point in straight lines at its altitude, over walls and gaps, and climbs
 * back up at FLIGHT_CLIMB_RATE after a landing. Zero rng, pure of time.
 */
function flyPatrol(
  mob: Entity,
  flightY: number,
  target: { x: number; z: number; facing: number },
  speed: number,
): void {
  const dx = target.x - mob.pos.x;
  const dz = target.z - mob.pos.z;
  const d = Math.hypot(dx, dz);
  const step = (d > CATCH_UP_DISTANCE ? speed * CATCH_UP_MULT * 1.5 : speed) * DT;
  if (d <= step || d < 1e-6) {
    mob.pos.x = target.x;
    mob.pos.z = target.z;
    mob.facing = target.facing;
  } else {
    mob.pos.x += (dx / d) * step;
    mob.pos.z += (dz / d) * step;
    mob.facing = Math.atan2(dx, dz);
  }
  const climb = FLIGHT_CLIMB_RATE * DT;
  mob.pos.y =
    Math.abs(flightY - mob.pos.y) <= climb
      ? flightY
      : mob.pos.y + Math.sign(flightY - mob.pos.y) * climb;
}
