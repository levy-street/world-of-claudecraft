// Practice bots for an authored map's objective rehearsal.
//
// A maker pressing Playtest on their own capture-the-flag map is alone, and a
// flag nobody contests teaches you nothing about the map. These are a handful of
// opposing bodies that run for your flag, take it, and try to carry it home ,
// enough to feel whether the lanes, the maze and the rampart sightlines actually
// work, which is the whole reason to walk the map at all.
//
// They are ordinary hostile mobs, so the combat, aggro, damage, death and loot
// paths all treat them exactly as they treat anything else and none of those
// systems needed to learn about this mode. The only thing this module adds is
// STEERING, and it only steers a bot that is not already fighting: the moment
// one aggros you, the normal mob AI has it, and it goes back to running the flag
// when combat drops. `Entity.objectiveBot` is the one marker field.
//
// Deterministic with ZERO rng: every decision is a pure function of positions
// and flag state, and spawn points come from the map's own spawn ring in author
// order, so a rehearsal never perturbs the shared draw order.

import { resolvePosition } from '../colliders';
import { OBJECTIVE_BOT_MOB } from '../content/objective_bots';
import { getActiveWorldContent } from '../data';
import { createMob } from '../entity';
import type { MapObjectives } from '../map_objectives';
import { findPlayerPath } from '../pathfind';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type Vec3 } from '../types';
import { groundHeight } from '../world';
import {
  mapObjectiveFlagAction,
  type ObjectiveRun,
  type ObjTeam,
  objectiveRun,
  objectiveTeamOf,
} from './map_objectives_run';

/** How many bodies contest the flag per side with no player on it. */
const BOT_COUNT = 3;
/** How close a bot needs to be before it presses for the flag. */
const PRESS_RADIUS = 2.2;
/** Biggest upward step a bot will take in one move; matches the player's own
 *  climb over a tick, so bots use the map's ramps and stairs and nothing else. */
const MAX_STEP_UP = 0.5;
/** Dead bots come back after this, at their own spawn ring. */
const BOT_RESPAWN = 12;

const TEAM_COLORS = [0xd1413a, 0x3a78d1] as const;
const TEAM_NAMES = ['Crimson', 'Azure'] as const;

interface BotBrain {
  /** Seconds until this bot may re-path. */
  replanIn: number;
  /** Seconds until a dead bot returns. */
  respawnIn: number;
  /** Spawn ring index it belongs to, so a side's bots fan out. */
  slot: number;
  /** Which way this bot prefers to go round an obstacle (+1 / -1). Sticky, so
   *  it commits to a side instead of jittering in a doorway. */
  turnBias: 1 | -1;
  /** Distance to the goal when the current progress window opened, and how far
   *  through that window we are. Progress is judged over a WINDOW, not a tick:
   *  a bot rounding a wide obstacle makes no headway for a second or two and is
   *  working perfectly. */
  windowDist: number;
  windowFor: number;
  /** Consecutive windows with no real progress. */
  stalls: number;
  /** While positive, ignore the goal and walk to `escapeAim` instead. */
  escapeFor: number;
  escapeAim: { x: number; z: number };
  /** Solved route to the goal, and how far along it we are. */
  path: { x: number; z: number }[];
  leg: number;
  /** Seconds until the route is re-solved. */
  replanFor: number;
  /** While positive, keep steering at `commitOffset` off the goal heading
   *  instead of re-testing straight ahead. This is what turns "bounce off the
   *  wall, face the goal, bounce again" into following the wall to its corner. */
  commitFor: number;
  commitOffset: number;
}

const brains = new WeakMap<Entity, BotBrain>();

function objectivesOf(): MapObjectives | undefined {
  return getActiveWorldContent().objectives;
}

/** Where a bot of this side rises: its own spawn ring, by slot. */
function spawnPointFor(o: MapObjectives, team: ObjTeam, slot: number): { x: number; z: number } {
  const ring = o.bases[team].spawns;
  return ring[slot % ring.length];
}

function spawnBot(ctx: SimContext, o: MapObjectives, team: ObjTeam, slot: number): void {
  const spot = spawnPointFor(o, team, slot);
  const e = createMob(ctx.nextId++, OBJECTIVE_BOT_MOB, 30, ctx.groundPos(spot.x, spot.z));
  e.name = `${TEAM_NAMES[team]} Champion`;
  e.color = TEAM_COLORS[team];
  e.objectiveBot = { team };
  // The leash anchor is dragged along under its feet every tick (see the tick
  // loop); this just starts it there.
  e.spawnPos = { ...e.pos };
  e.leashAnchor = null;
  ctx.addEntity(e);
  // Alternate the opening bias by slot so a side's bots fan around cover
  // opposite ways instead of queueing behind each other.
  brains.set(e, {
    replanIn: 0,
    respawnIn: 0,
    slot,
    turnBias: slot % 2 === 0 ? 1 : -1,
    windowDist: Number.POSITIVE_INFINITY,
    windowFor: 0,
    stalls: 0,
    escapeFor: 0,
    escapeAim: { x: 0, z: 0 },
    path: [],
    leg: 0,
    replanFor: 0,
    commitFor: 0,
    commitOffset: 0,
  });
}

/** Every live bot, plus a count of live players per side. */
function census(ctx: SimContext, run: ObjectiveRun) {
  const bots: Entity[] = [];
  const players: [number, number] = [0, 0];
  for (const e of ctx.entities.values()) {
    if (e.objectiveBot) {
      bots.push(e);
      continue;
    }
    // Counted whether or not they are standing: a maker who just died is still
    // on their side, and filling it the moment they fall would put three
    // champions on the flag they were defending.
    if (e.kind === 'player') players[objectiveTeamOf(run, e)]++;
  }
  return { bots, players };
}

export function updateObjectiveBots(ctx: SimContext): void {
  const run = objectiveRun(ctx);
  const o = objectivesOf();
  if (!run || !o) {
    // The world stopped carrying objectives (a different map was opened): take
    // the bodies with it rather than leaving champions standing in a meadow.
    for (const e of [...ctx.entities.values()]) {
      if (e.objectiveBot) ctx.dropEntity(e.id);
    }
    return;
  }

  const { bots, players } = census(ctx, run);
  // Fill the side the maker is NOT on. A rehearsal wants opponents; friendly
  // bots would just run the flag for you.
  for (const team of [0, 1] as ObjTeam[]) {
    if (players[team] > 0) continue;
    if (o.bases[team].spawns.length === 0) continue;
    const have = bots.filter((b) => b.objectiveBot?.team === team).length;
    for (let i = have; i < BOT_COUNT; i++) spawnBot(ctx, o, team, i);
  }

  for (const bot of bots) {
    const brain = brains.get(bot);
    if (!brain) continue;
    if (bot.dead) {
      brain.respawnIn -= DT;
      if (brain.respawnIn <= 0) {
        ctx.dropEntity(bot.id);
        const team = bot.objectiveBot?.team ?? 0;
        if (o.bases[team].spawns.length > 0) spawnBot(ctx, o, team, brain.slot);
      } else if (brain.respawnIn === 0) {
        brain.respawnIn = BOT_RESPAWN;
      }
      continue;
    }
    brain.respawnIn = BOT_RESPAWN;
    // Fighting is the mob AI's job. Only steer a bot that is free.
    if (!bot.inCombat) steer(ctx, run, bot, brain);
    // Drag the leash anchor along behind it, every tick.
    //
    // A mob evades home once it is LEASH_DISTANCE (45yd) from `spawnPos`, and a
    // flag run here is 334. Pinning the anchor to the keep, or to the map
    // centre, both end the same way: the bot fights you at your flag, trips the
    // leash, and walks all the way back to the middle of the map full-healed.
    // Keeping the anchor under its feet means the distance is always ~one step,
    // so a rehearsal opponent chases the objective as far as the objective goes
    // and never disengages for a reason the maker cannot see.
    bot.spawnPos = { ...bot.pos };
    bot.leashAnchor = null;
  }
}

/** The point a bot is trying to reach right now. */
function goalFor(run: ObjectiveRun, bot: Entity): Vec3 | null {
  const team = objectiveTeamOf(run, bot);
  const ownFlag = run.flags[team];
  const enemyFlag = run.flags[team === 0 ? 1 : 0];
  // 1) Carrying it: run it home.
  if (enemyFlag.carrier === bot.id) return ownFlag.home;
  // 2) Our flag is loose: the nearest job is putting it back.
  if (ownFlag.state === 'dropped') return ownFlag.pos;
  // 3) Otherwise go get theirs, wherever it is.
  return enemyFlag.pos;
}

// Why this steers instead of pathing.
//
// sim/pathfind.ts is Y-BLIND: findPath probes the world with `isBlocked(seed, x,
// z, r)` and never passes a mover height, so every banded collider blocks at
// every depth. On a map built out of kit walls that means each ARCH, the keep
// gate, the sally ports, the flag court's own door, reads to the solver as
// solid stone, because an arch bakes a lintel and the lintel is a box. Ask it
// for a route into a flag court and it finds the court sealed, gives up, and
// falls back to a straight line at the wall.
//
// Making the solver height-aware is the right fix and it is not this module's:
// every mob in the game paths through it. So the bots navigate locally instead,
// against `resolvePosition` WITH their feet height, the same call the player's
// own movement uses, which passes under lintels correctly, and get round
// corners by trying a fan of headings rather than by knowing the map.

/** Headings to try, as offsets from "straight at the target" (radians). The
 *  first one that makes real progress wins, so a bot hugs an obstacle instead
 *  of stopping at it. */
const HEADING_FAN = [0, 0.45, 0.95, 1.5, 2.1, 2.7] as const;
/** A step must cover at least this fraction of its length to count as progress;
 *  below it the heading is into a wall. */
const PROGRESS_FRACTION = 0.35;
/** Seconds a bot sticks with a detour heading before re-aiming at the goal. */
const DETOUR_COMMIT = 1.1;
/** Seconds between route solves. */
const REPLAN_PERIOD = 0.75;
/** Cells per axis the route solver may search. */
const PATH_SPAN = 128;
/** How close counts as arriving at a waypoint. */
const WAYPOINT_RADIUS = 2;
/** How long one progress window runs, and how much closer to the goal a bot has
 *  to get inside it to count as progressing. Generous on purpose: rounding the
 *  Fightpit's fallen monument legitimately costs a couple of seconds. */
const PROGRESS_WINDOW = 2;
const PROGRESS_PER_WINDOW = 2.5;
/** Stalled windows in a row before a bot walks sideways to break out. */
const STALLS_BEFORE_ESCAPE = 2;
/** Seconds it then spends walking sideways, and how far it aims. */
// Far enough to clear a pocket wall AND widen the next solve's search box
// past it; Thornhollow's barbican is ten yards to a side.
const ESCAPE_FOR = 3.4;
const ESCAPE_REACH = 26;
/** How far off the goal heading the escape runs (radians). */
const ESCAPE_TURN = 2.4;

function steer(ctx: SimContext, run: ObjectiveRun, bot: Entity, brain: BotBrain): void {
  const goal = goalFor(run, bot);
  if (!goal) return;

  const toGoal = Math.hypot(goal.x - bot.pos.x, goal.z - bot.pos.z);
  // Close enough to act: press for a flag, or simply stand on the objective.
  if (toGoal <= PRESS_RADIUS) {
    mapObjectiveFlagAction(ctx, bot.id);
    return;
  }
  if (toGoal < 0.001) return;

  const seed = ctx.cfg.seed;

  // Getting out of a dead end.
  //
  // The route solver searches a grid boxed around the two endpoints with a small
  // margin, so from inside a concave pocket, Thornhollow's barbican is a U five
  // yards deep, and the gate funnels you straight into it, the way out lies
  // OUTSIDE the box it is willing to look at. It returns a straight line, the
  // fan walks that line into the screen, and the bot stands there.
  //
  // So watch for making no ground on the goal, and when that happens walk
  // deliberately SIDEWAYS for a couple of seconds. That is enough to clear the
  // pocket, and it also widens the next solve's box enough to see the door.
  // Alternating the side means a bot that picked the wrong way out tries the
  // other one rather than repeating itself.
  brain.windowFor += DT;
  if (brain.windowFor >= PROGRESS_WINDOW) {
    brain.stalls = toGoal > brain.windowDist - PROGRESS_PER_WINDOW ? brain.stalls + 1 : 0;
    brain.windowDist = toGoal;
    brain.windowFor = 0;
  }
  if (brain.escapeFor <= 0 && brain.stalls >= STALLS_BEFORE_ESCAPE) {
    brain.stalls = 0;
    brain.escapeFor = ESCAPE_FOR;
    brain.turnBias = brain.turnBias === 1 ? -1 : 1;
    // BACK OUT, not sideways. A dead end is concave: its walls are exactly the
    // perpendicular, so stepping square to the goal walks into them. Turning
    // most of the way round (about 137 degrees off) carries the bot out the way
    // it came in and still drifts it to one side, which is what clears the
    // mouth of the pocket and lets the next solve see the door.
    const heading = Math.atan2(goal.x - bot.pos.x, goal.z - bot.pos.z);
    const away = heading + brain.turnBias * ESCAPE_TURN;
    brain.escapeAim = {
      x: bot.pos.x + Math.sin(away) * ESCAPE_REACH,
      z: bot.pos.z + Math.cos(away) * ESCAPE_REACH,
    };
  }
  if (brain.escapeFor > 0) {
    brain.escapeFor -= DT;
    brain.path = [];
    brain.leg = 0;
    brain.replanFor = 0;
    stepToward(ctx, bot, brain, brain.escapeAim, seed);
    return;
  }

  // Route with the solver, walk with the fan.
  //
  // The solver knows the map and the fan does not, so it is what gets a bot
  // round a keep instead of into the side of it. But it works on a bounded grid
  // around the two endpoints, so from inside a dead end (Thornhollow's barbican
  // is exactly one) the way out can fall outside the box and it gives up and
  // returns a bare straight line. Then the fan is the fallback that walks the
  // bot out. Aiming at the next WAYPOINT rather than the goal is what combines
  // them: global route, local avoidance.
  brain.replanFor -= DT;
  if (brain.replanFor <= 0 || brain.leg >= brain.path.length) {
    brain.replanFor = REPLAN_PERIOD;
    brain.path = findPlayerPath(seed, bot.pos, goal, PATH_SPAN);
    brain.leg = 0;
  }
  let aim = brain.path[brain.leg] ?? goal;
  while (
    brain.leg < brain.path.length - 1 &&
    Math.hypot(aim.x - bot.pos.x, aim.z - bot.pos.z) <= WAYPOINT_RADIUS
  ) {
    brain.leg++;
    aim = brain.path[brain.leg];
  }

  stepToward(ctx, bot, brain, aim, seed);
}

/** One move toward `aim`, trying a fan of headings so a wall is walked around
 *  rather than stood against. */
function stepToward(
  ctx: SimContext,
  bot: Entity,
  brain: BotBrain,
  aim: { x: number; z: number },
  seed: number,
): void {
  const dx = aim.x - bot.pos.x;
  const dz = aim.z - bot.pos.z;
  if (Math.hypot(dx, dz) < 0.001) return;
  const step = bot.moveSpeed * DT;
  const feet = groundHeight(bot.pos.x, bot.pos.z, seed);
  const base = Math.atan2(dx, dz);

  const tryHeading = (offset: number): { x: number; z: number } | null => {
    const heading = base + offset;
    const nx = bot.pos.x + Math.sin(heading) * step;
    const nz = bot.pos.z + Math.cos(heading) * step;
    const solved = resolvePosition(seed, nx, nz, 0.5, false, undefined, {
      y: feet,
      lift: 0,
    });
    if (Math.hypot(solved.x - bot.pos.x, solved.z - bot.pos.z) < step * PROGRESS_FRACTION) {
      return null;
    }
    // Never step up more than the player can in a tick: bots take the map's
    // ramps and stairs, and nothing else.
    if (groundHeight(solved.x, solved.z, seed) - feet > MAX_STEP_UP) return null;
    return solved;
  };

  // A committed detour runs until it expires or fails, so the bot follows the
  // wall it is on instead of turning back into it every tick.
  brain.commitFor -= DT;
  if (brain.commitFor > 0) {
    const held = tryHeading(brain.commitOffset);
    if (held) {
      bot.prevPos = { ...bot.pos };
      bot.pos = ctx.groundPos(held.x, held.z);
      bot.facing = base;
      ctx.rebucket(bot);
      return;
    }
    brain.commitFor = 0;
  }

  // Straight at it first, then progressively wider on the side that worked last
  // time.
  let moved: { x: number; z: number } | null = null;
  let usedOffset = 0;
  for (const spread of HEADING_FAN) {
    for (const sign of spread === 0 ? [1] : [brain.turnBias, -brain.turnBias]) {
      const solved = tryHeading(sign * spread);
      if (!solved) continue;
      moved = solved;
      usedOffset = sign * spread;
      break;
    }
    if (moved) break;
  }
  if (!moved) {
    // Boxed in: flip the side we try first so the next tick unwinds the corner
    // the other way rather than re-testing the same dead end forever.
    brain.turnBias = brain.turnBias === 1 ? -1 : 1;
    return;
  }
  if (usedOffset !== 0) {
    brain.turnBias = usedOffset > 0 ? 1 : -1;
    brain.commitOffset = usedOffset;
    brain.commitFor = DETOUR_COMMIT;
  }

  bot.prevPos = { ...bot.pos };
  bot.pos = ctx.groundPos(moved.x, moved.z);
  bot.facing = base;
  ctx.rebucket(bot);
}
