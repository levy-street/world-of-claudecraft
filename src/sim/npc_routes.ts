// Waypoint patrol routes. Walks a routed entity along its authored NpcRoute
// (loop or pingpong) through the shared ctx.moveToward mover, pausing at
// waypoints that declare a wait. Friendly NPCs walk theirs every tick
// (updateNpcRoute); camp mobs walk theirs on idle ticks only, so a pull always
// wins over the patrol (updateMobRoute). Parity-critical: this module draws
// ZERO rng and reads no wall clock; every step scales by the fixed DT tick, so
// a world without routed entities behaves byte-identically with or without
// this phase.

import type { SimContext } from './sim_context';
import { DT, type Entity } from './types';

// Default patrol walk pace (yards per second) plus the authoring clamps.
const ROUTE_SPEED_DEFAULT = 2.2;
const ROUTE_SPEED_MIN = 0.5;
const ROUTE_SPEED_MAX = 8;
// Longest allowed waypoint pause (seconds).
const ROUTE_WAIT_MAX = 600;

/** Advance one routed entity by one tick: wait out a pause or step toward the
 *  target waypoint, advancing the index (wrap or bounce) on arrival. Returns
 *  true when the entity is under route control this tick (so a caller with its
 *  own idle behavior can stand down). */
function advanceRoute(ctx: SimContext, e: Entity): boolean {
  const route = e.route;
  if (!route || route.points.length < 2) return false;
  const n = route.points.length;
  if (e.routeIdx === undefined || e.routeIdx >= n) {
    // Lazy init: start at point 0 (the spawn point, so the first "arrival" is
    // immediate and the walk begins toward point 1 next tick).
    e.routeIdx = 0;
    e.routeDir = 1;
    e.routeWaitLeft = 0;
  }
  const waitLeft = e.routeWaitLeft ?? 0;
  if (waitLeft > 0) {
    // Standing at a waypoint: burn the pause down and hold position (the
    // renderer reads the zero position delta as idle).
    e.routeWaitLeft = waitLeft - DT;
    return true;
  }
  const wp = route.points[e.routeIdx];
  const speed = Math.min(
    ROUTE_SPEED_MAX,
    Math.max(ROUTE_SPEED_MIN, route.speed ?? ROUTE_SPEED_DEFAULT),
  );
  if (!ctx.moveToward(e, { x: wp.x, y: e.pos.y, z: wp.z }, speed)) return true;
  // Arrived: arm this waypoint's pause, then pick the next target index.
  e.routeWaitLeft = Math.min(ROUTE_WAIT_MAX, Math.max(0, wp.wait ?? 0));
  if (route.mode === 'loop') {
    e.routeIdx = (e.routeIdx + 1) % n;
    return true;
  }
  // pingpong: bounce the walk direction at either end of the list.
  let dir: 1 | -1 = e.routeDir ?? 1;
  let next = e.routeIdx + dir;
  if (next < 0 || next >= n) {
    dir = dir === 1 ? -1 : 1;
    next = e.routeIdx + dir;
  }
  e.routeDir = dir;
  e.routeIdx = next;
  return true;
}

/** Per-tick patrol step for a friendly NPC. */
export function updateNpcRoute(ctx: SimContext, e: Entity): void {
  if (e.kind !== 'npc' || e.dead) return;
  advanceRoute(ctx, e);
}

/**
 * Idle-tick patrol step for a camp mob (editor Mob tool). Returns true when the
 * route drove the mob, so updateMob's idle arm skips its random wander.
 *
 * A patroller drags its leash home along with it: leash and evade-home both
 * measure from spawnPos, so a mob that walked 80 yards down its path would
 * otherwise evade the instant it aggroed. Keeping spawnPos under the mob makes
 * the leash local to wherever the patrol currently is, and a killed patroller
 * respawns on its path (respawnMob).
 */
export function updateMobRoute(ctx: SimContext, mob: Entity): boolean {
  if (!advanceRoute(ctx, mob)) return false;
  mob.spawnPos.x = mob.pos.x;
  mob.spawnPos.y = mob.pos.y;
  mob.spawnPos.z = mob.pos.z;
  return true;
}
