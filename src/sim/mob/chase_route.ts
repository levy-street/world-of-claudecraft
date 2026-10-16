// A chasing mob's way round an obstacle. Mobs chase in a straight line with a
// slide fan (Sim.moveToward) and no nav mesh, which rounds a rock or a crate
// but pins on a wall: inside an instance the mob stood against it, was held
// immune, and then phased straight THROUGH the wall
// (instances/instance_combat_hold.ts). This module gives such a mob a real
// route instead: a bounded grid search over the same colliders its movement
// obeys (mob/route_search.ts), cached on the mob and walked waypoint by
// waypoint with the ordinary moveToward, so it goes round by the doorway.
//
// Consumers, both in mob/combat_profile.ts:
//   - a caster with no line of sight to its target walks its route until it
//     sees them (mob/cast_sight.ts decides when; this module is how);
//   - a melee mob whose straight chase has stopped dead on geometry takes a
//     route before the stall detector ever calls it unreachable
//     (chaseAroundObstacles).
//
// WHO: a mob that leashes, is nobody's pet and is not an encounter's own body
// (mobPlansRoutes; the callers hold the leash half of the gate). A boss or a
// scripted great body (mob/encounter_body.ts) keeps its base movement in every
// encounter: the search knows nothing of an encounter's keep-out circles or
// scripted positions.
//
// WHERE: only for a mob and a target standing in the same claimed instance
// slot (a dungeon or one raid room). That is where the hold-and-phase rule
// lives and where the walls are authored colliders on a flat floor the search
// can judge exactly as the mover does. The open world, rifts and delves keep
// the straight chase and the classic stall: out there the mover also refuses a
// step on a steep slope, which the search does not model (a route it found
// could be one the mob cannot walk), the classic leash already ends a chase a
// wall has stopped, and a delve's doors and room bounds are clamps the mover
// applies that no collider search can see. The search itself is as cheap out
// there as in a slot (scripts/mob_route_bench.ts measures both); widening the
// scope is a matter of teaching it the slope gate, not of cost.
//
// COST, bounded by construction (the server runs one 50 ms tick for a whole
// realm):
//   - a search stops at ROUTE_NODES_PER_PLAN judged cells, found or not;
//   - the whole sim spends at most ROUTE_NODES_PER_TICK judged cells a tick:
//     the tally is Sim-owned and reset by the sim at the top of every tick
//     (mobScanCounters.routeNodes), mobs are served in entity order, and one
//     over budget keeps its straight chase and is put back to its OWN next
//     plan slot, a re-plan period later (tallied as routeDeferred). It does
//     not stay eligible every tick, so a large blocked pull cannot stand at
//     the head of the queue and starve the other instances: the ticks between
//     its slots belong to whoever is due on them;
//   - a mob plans on its own tick slot of the re-plan period and no sooner
//     than its throttle allows, which doubles after every search that fails;
//   - a mob spends at most ROUTE_MAX_TRIES plans, found or failed, before it
//     must wait ROUTE_TRY_FORGIVE_TICKS for each one back. Nothing the
//     players do (stepping aside, dancing a doorway, coming back into sight,
//     trading threat so the mob changes target, dropping off its table) hands
//     them back: the throttle and the tries outlive the path AND the target,
//     and are dropped only when the pull ends;
//   - a search refused outright because the pair is too far apart for the
//     window judged nothing and costs nothing: no try, no backoff, no memo;
//   - a search that failed is remembered on the TARGET for a few seconds
//     (Entity.routeDenied), so the rest of a pack standing with the mob that
//     asked (and moving as it does: a swimmer's answer is not a walker's)
//     does not prove the same thing again mob by mob.
//
// THE ANTI-PERCH RULE STILL WINS. A target no route reaches (a perch, a sealed
// room) is "no route": the mob pushes straight on, commits no movement, and
// mob/reachability.ts counts it down to the evade or the hold exactly as
// before. A route that stops getting the mob nearer its next waypoint is
// dropped as a failure (the stall detector probes the step toward the TARGET,
// so without this a mob wedged on a waypoint behind a collider would stand
// there for ever, attackable and never stalling), and with its tries spent a
// mob is back on the straight chase and the stall whatever the target does:
// a route whose end the target has left is thrown away when no plan is left to
// replace it, never walked on away from a target standing in plain sight.
//
// Draws no rng. Entity.chaseRoute exists only once something has been in the
// mob's way, so a fight on open ground leaves no trace of it.

import { MOBS } from '../data';
import { attackerLeftInstance, claimedSlotOf } from '../instances/instance_combat_hold';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity, type MobChaseRoute, TICK_RATE } from '../types';
import { isEncounterBody } from './encounter_body';
import { type RouteSearchOpts, searchRoute } from './route_search';

/** Sim ticks between two plans of one mob's route (a second), and the period
 *  of the tick slots the plans are spread over. */
export const ROUTE_REPLAN_TICKS = TICK_RATE;
/** The most cells one search may judge (route_search.ts). */
export const ROUTE_NODES_PER_PLAN = 900;
/** The most cells the whole sim may judge in one tick. */
export const ROUTE_NODES_PER_TICK = 1200;
/** Plans, found or failed, a mob may spend before it must wait for one back. */
export const ROUTE_MAX_TRIES = 4;
/** Sim ticks that hand one spent plan back (ten seconds). */
export const ROUTE_TRY_FORGIVE_TICKS = TICK_RATE * 10;
/** The longest a failed search holds the next one back (its backoff doubles
 *  from one re-plan period up to this). */
export const ROUTE_MAX_BACKOFF_TICKS = TICK_RATE * 16;
/** Yards of slack round the mob-to-target box the search may use: wide enough
 *  to find the doorway in a curtain wall. */
export const ROUTE_MARGIN = 24;
/** A waypoint this near is reached. */
export const ROUTE_WAYPOINT_REACHED = 0.75;
/** A route whose end is this far from where the target now stands is stale. */
export const ROUTE_STALE_YARDS = 3;
/** Sim ticks a mob may go without closing on its next waypoint before the
 *  route is dropped as a failure (half a second). */
export const ROUTE_STUCK_TICKS = TICK_RATE / 2;
/** How much nearer (yards) counts as closing on a waypoint. */
const ROUTE_PROGRESS_YARDS = 0.05;
/** Sim ticks a failed search is remembered on the target for the pack. */
export const ROUTE_DENIED_TICKS = TICK_RATE * 3;
/** A mob this near where the failed search began shares its answer. */
export const ROUTE_DENIED_NEAR = 8;
/** Seconds a melee chase must have stood dead on geometry before it routes:
 *  past a body block or a one-tick hiccup, far inside the stall window. */
export const ROUTE_AFTER_STALL_SECONDS = 0.3;

/** May this mob plan routes at all: nobody's pet and not an encounter's own
 *  body. (The third part, that it leashes, is the callers' gate:
 *  mob/combat_profile.ts asks for a route only on behalf of a canLeash
 *  profile.) */
export function mobPlansRoutes(mob: Entity): boolean {
  return mob.ownerId === null && !isEncounterBody(mob.templateId);
}

/** Does routing apply to this pair: a mob that plans routes, and both of them
 *  in one claimed instance slot? */
export function routesHere(ctx: SimContext, mob: Entity, target: Entity): boolean {
  if (!mobPlansRoutes(mob)) return false;
  const slot = claimedSlotOf(ctx, mob);
  return slot !== null && !attackerLeftInstance(slot, target);
}

/** The first tick at or after `tick` that is this mob's plan slot. */
function nextSlot(tick: number, mobId: number): number {
  const off = (((mobId - tick) % ROUTE_REPLAN_TICKS) + ROUTE_REPLAN_TICKS) % ROUTE_REPLAN_TICKS;
  return tick + off;
}

/**
 * The mob's route record, pointed at this target. A mob that changes target in
 * the middle of a pull keeps its throttle (the plan clock, the spent tries, the
 * failures in a row): only what belonged to the old target goes, its path, its
 * sight answer and the watchdog's marks. Two players trading threat, or one
 * dropping off the table and back, buy nothing.
 */
export function chaseRouteFor(ctx: SimContext, mob: Entity, target: Entity): MobChaseRoute {
  const now = ctx.tickCount;
  let route = mob.chaseRoute;
  if (!route) {
    route = {
      targetId: target.id,
      path: [],
      planAt: nextSlot(now, mob.id),
      tries: 0,
      triesAt: now,
      fails: 0,
      stuckDist: Infinity,
      stuckAt: now,
      walkedAt: now,
      sightClear: true,
    };
    mob.chaseRoute = route;
  } else if (route.targetId !== target.id) {
    route.targetId = target.id;
    if (route.path.length > 0) route.path = [];
    route.sightClear = true;
    route.stuckDist = Infinity;
    route.stuckAt = now;
    route.walkedAt = now;
  }
  return route;
}

/** The pull ended (evade, reset, death): forget the route and its throttle. */
export function endChaseRoute(mob: Entity): void {
  // Written as undefined, never deleted (the Entity shape stays stable).
  if (mob.chaseRoute !== undefined) mob.chaseRoute = undefined;
}

/**
 * The mob stands where it fights, is held in place, or has no target for the
 * moment: the path is done with. The throttle and the spent tries STAY (a
 * target dancing in and out of sight, or off the threat table and back, must
 * not buy a fresh plan each time).
 */
export function restChaseRoute(mob: Entity): void {
  const route = mob.chaseRoute;
  if (route === undefined) return;
  if (route.path.length > 0) route.path = [];
  route.sightClear = true;
}

/** Is the mob walking a real route (waypoints before the last straight leg)? */
export function isRouting(mob: Entity, target: Entity): boolean {
  const route = mob.chaseRoute;
  return route !== undefined && route.targetId === target.id && route.path.length > 1;
}

/** The search options the mob AI plans with (also what the benchmark in
 *  scripts/mob_route_bench.ts calls the search with, so it measures the same
 *  search and adds nothing to a tick's tally). */
export function routeSearchOpts(ctx: SimContext, mob: Entity): RouteSearchOpts {
  return {
    seed: ctx.cfg.seed,
    margin: ROUTE_MARGIN,
    maxNodes: ROUTE_NODES_PER_PLAN,
    swim: ctx.mobCanSwim(MOBS[mob.templateId]),
    riftToken: ctx.riftCollisionToken,
  };
}

/** A plan failed (nothing found, or its route stopped making headway): the
 *  path goes and the next search waits twice as long as the last one did. */
function failRoute(ctx: SimContext, mob: Entity, route: MobChaseRoute): void {
  if (route.path.length > 0) route.path = [];
  route.fails++;
  const wait = Math.min(ROUTE_MAX_BACKOFF_TICKS, ROUTE_REPLAN_TICKS * 2 ** route.fails);
  route.planAt = nextSlot(ctx.tickCount + wait, mob.id);
}

/** Spend one plan; the first one spent starts the clock that hands them back. */
function spendTry(ctx: SimContext, route: MobChaseRoute): void {
  if (route.tries === 0) route.triesAt = ctx.tickCount;
  route.tries++;
}

/** Plan the mob's route now: a packmate's word, the tick's budget, then one
 *  bounded search. */
function planRoute(ctx: SimContext, mob: Entity, target: Entity, route: MobChaseRoute): void {
  const now = ctx.tickCount;
  const opts = routeSearchOpts(ctx, mob);
  const denied = target.routeDenied;
  if (
    denied !== undefined &&
    denied.swim === opts.swim &&
    now >= denied.tick &&
    now - denied.tick < ROUTE_DENIED_TICKS &&
    Math.hypot(target.pos.x - denied.x, target.pos.z - denied.z) <= ROUTE_STALE_YARDS &&
    Math.hypot(mob.pos.x - denied.fromX, mob.pos.z - denied.fromZ) <= ROUTE_DENIED_NEAR
  ) {
    // A packmate beside it just proved there is no way: take its word.
    spendTry(ctx, route);
    failRoute(ctx, mob, route);
    return;
  }
  const counters = ctx.mobScanCounters;
  if (counters.routeNodes + ROUTE_NODES_PER_PLAN > ROUTE_NODES_PER_TICK) {
    // Over the tick's budget: nothing is spent, and it comes back on its own
    // next slot (never the next tick: see COST in the header).
    counters.routeDeferred++;
    route.planAt = nextSlot(now + 1, mob.id);
    return;
  }
  const result = searchRoute(mob.pos, target.pos, opts);
  if (!result.attempted) {
    // Too far apart for the search window: nothing was judged, so nothing is
    // spent, nothing backs off and nobody is told "no route". It asks again a
    // period on, by when the chase has usually closed the gap.
    if (route.path.length > 0) route.path = [];
    route.planAt = nextSlot(now + ROUTE_REPLAN_TICKS, mob.id);
    return;
  }
  counters.routePlans++;
  counters.routeNodes += result.nodes;
  spendTry(ctx, route);
  if (!result.found) {
    counters.routeFailed++;
    failRoute(ctx, mob, route);
    target.routeDenied = {
      tick: now,
      x: target.pos.x,
      z: target.pos.z,
      fromX: mob.pos.x,
      fromZ: mob.pos.z,
      swim: opts.swim,
    };
    return;
  }
  route.path = result.path.map((w) => ({ x: w.x, y: 0, z: w.z }));
  route.fails = 0;
  route.planAt = nextSlot(now + ROUTE_REPLAN_TICKS, mob.id);
  route.stuckDist = Infinity;
  route.stuckAt = now;
}

/**
 * One chase step along the mob's route, planning it first when it has none or
 * its end has gone stale. Returns true when the step was taken along a route;
 * false when no route stands (routing does not apply here, none exists, the
 * mob is on its last straight leg, or the plan must wait), in which case the
 * caller takes its ordinary straight step.
 */
export function followChaseRoute(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  speed: number,
): boolean {
  if (!routesHere(ctx, mob, target)) return false;
  const route = chaseRouteFor(ctx, mob, target);
  const now = ctx.tickCount;
  // One spent plan comes back every ROUTE_TRY_FORGIVE_TICKS, whatever happens,
  // and a mob with every plan back starts its backoff afresh.
  if (route.tries > 0 && now - route.triesAt >= ROUTE_TRY_FORGIVE_TICKS) {
    const back = Math.floor((now - route.triesAt) / ROUTE_TRY_FORGIVE_TICKS);
    route.tries = Math.max(0, route.tries - back);
    route.triesAt += back * ROUTE_TRY_FORGIVE_TICKS;
    if (route.tries === 0) route.fails = 0;
  }
  // The watchdog: a route is only a route while it brings the mob nearer its
  // next waypoint. A mob that was not walking it last tick (stunned, rooted,
  // planted by a bar, in sight for a while) starts the watch afresh, and one
  // slowed so far that it could not cover the watch's own yardstick in the
  // window is not judged at all: it is crawling, not wedged.
  if (now - route.walkedAt > 1) {
    route.stuckDist = Infinity;
    route.stuckAt = now;
  }
  route.walkedAt = now;
  if (route.path.length > 1) {
    const d = dist2d(mob.pos, route.path[0]);
    if (d < route.stuckDist - ROUTE_PROGRESS_YARDS) {
      route.stuckDist = d;
      route.stuckAt = now;
    } else if (speed * DT * ROUTE_STUCK_TICKS < ROUTE_PROGRESS_YARDS * 2) {
      route.stuckAt = now;
    } else if (now - route.stuckAt >= ROUTE_STUCK_TICKS) {
      failRoute(ctx, mob, route);
    }
  }
  const end = route.path[route.path.length - 1];
  const stale = end === undefined || dist2d(end, target.pos) > ROUTE_STALE_YARDS;
  if (route.tries >= ROUTE_MAX_TRIES) {
    // No plan left to replace it: a route whose end the target has left is
    // thrown away, and the caller takes the straight step at the target.
    if (stale && route.path.length > 0) route.path = [];
  } else if ((stale || route.path.length <= 1) && now >= route.planAt) {
    // With no route in hand (none was found, or its last waypoint is behind
    // the mob and it is still being asked) the search is made again, on its
    // throttle.
    planRoute(ctx, mob, target, route);
  }
  while (route.path.length > 1 && dist2d(mob.pos, route.path[0]) < ROUTE_WAYPOINT_REACHED) {
    route.path.shift();
    route.stuckDist = Infinity;
    route.stuckAt = now;
  }
  if (route.path.length <= 1) return false;
  ctx.moveToward(mob, route.path[0], speed);
  return true;
}

/**
 * A melee chase step: straight at the target as always, and round the
 * obstacle once the straight chase has stood dead on geometry for
 * ROUTE_AFTER_STALL_SECONDS (Entity.chaseStall, mob/reachability.ts). A mob
 * with open ground ahead pays one comparison. For a canLeash mob only (the
 * caller's gate): chaseStall is the stall detector's, and only a mob that
 * leashes has one.
 */
export function chaseAroundObstacles(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  speed: number,
): void {
  if (
    (isRouting(mob, target) || mob.chaseStall >= ROUTE_AFTER_STALL_SECONDS) &&
    followChaseRoute(ctx, mob, target, speed)
  ) {
    return;
  }
  ctx.moveToward(mob, target.pos, speed);
}
