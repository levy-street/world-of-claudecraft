// Hodric's Castle: the Gauntlet, a 10-racer obstacle-course ELIMINATION SHOW
// (Fall Guys spirit, classic-MMO body). Queue at the Herald, race three
// rounds of Lord Hodric's ever-rebuilt gauntlet: round 1 qualifies six,
// round 2 qualifies three, and the final crowns one. The eliminated are
// flung to the spectator gallery by Hodric's catapult and watch the rest.
//
// Follows the Ashen Coliseum arena module shape: state lives on Sim (live
// SimContext views), this module holds only functions, and the whole system
// costs zero work and ZERO rng draws while nobody queues or races.
//
// DETERMINISM CONTRACT:
// - Every round races a GENERATED course (src/sim/hodrics_course.ts): a pure
//   function of a seed derived from tickCount + matchId + round, registered
//   in the slot's active-course registry so the base sim's ground/collider
//   routing and the renderer all read the same value. No shared-rng draws.
// - Obstacle poses are pure functions of absolute sim time (hodrics_layout);
//   the race physics below reads them, it never advances them.
// - The race itself draws NO randomness at all, from any stream. Bot skill
//   variance (social/hodrics_bots.ts) is a pure hash of the pid and tick, not
//   an rng draw, so nothing here touches the shared stream and parity goldens
//   cannot fork.
// - Racers cannot die on the course: there are no damage sources in the
//   band, falls are caught at the kill plane and respawn at the last
//   checkpoint (or the gallery, for the eliminated).

import { HC_HERALD, HC_HERALD_ID, HC_HERALD_POS } from '../content/hodrics';
import { DUNGEON_X_THRESHOLD, HODRICS_SLOT_COUNT, hodricsOrigin, isHodricsPos } from '../data';
import { createNpc } from '../entity';
import {
  type HcCourse,
  hcCheckpointSpawn,
  hcCourseFor,
  hcStartPlate,
  hodricsOnSpinner,
  hodricsSurfaceAt,
  resetHodricsCourse,
  setActiveHodricsCourse,
} from '../hodrics_course';
import {
  HC_FIELD_SIZE,
  HC_KILL_Y,
  hcAxeHead,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcPusherX,
  hcRotorAngle,
} from '../hodrics_layout';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type HcKnockKind, type PlayerClass } from '../types';
import { arenaDequeue, isArenaQueued, placeInArena, resetForArena } from './arena';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export const HC_COUNTDOWN = 5; // seconds on the start plates before GO
export const HC_RETURN_DELAY = 10; // podium moment on the keep before going home
export const HC_BOT_BACKFILL_WAIT = 30; // seconds a human waits before bots fill the field

/** The show: three rounds, the field shrinking each time. */
export const HC_ROUNDS = 3;
/** How many racers advance out of each round (the last number is the crown). */
export const HC_QUALIFY: readonly number[] = [6, 3, 1];
/** Per-round time limits; expiry ranks the unfinished by progress. */
export const HC_ROUND_TIME: readonly number[] = [110, 110, 130];
/** Intermission between rounds: eliminations fly, the castle rebuilds. */
export const HC_INTERMISSION = 6;
/** Intermission timers (counting down from HC_INTERMISSION) at which the
 * catapult launches the eliminated, then drops them in the gallery. */
const HC_GALLERY_AT = 3.4;

// No level gate: the Gauntlet has no combat, run speed is identical for every
// racer, so a day-one character can race the realm's best on even legs.

// A hit launches the racer on a ballistic arc (the base sim integrates
// airborne velocity with no air control, so a knock is committed, exactly the
// tumbling feel we want). Immunity keeps chained obstacles from stunlocking:
// hammer/axe/boulder yeets are big committed launches with a long grace, the
// spinning log and the piston rams are ground-level SHOVES with a short one.
export const HC_LAUNCH_IMMUNITY = 0.9; // seconds of no re-hit after any launch or respawn
const HC_IMMUNITY: Record<HcKnockKind, number> = {
  flail: 0.9,
  axe: 0.9,
  log: 0.4,
  boulder: 0.9,
  piston: 0.5,
};
const HC_BODY_R = 0.5; // racer body radius (PLAYER_BODY_RADIUS)
const HC_BODY_HALF_H = 0.9; // capsule half height for vertical overlap tests

const KNOCK_FLAIL = { v: 13, vy: 6.5 };
const KNOCK_AXE = { v: 14, vy: 7 };
const KNOCK_ROTOR = { tangential: 7.5, radial: 2.5, vy: 2.8 };
const KNOCK_BOULDER = { vz: -12, vx: 3, vy: 6 };
const KNOCK_PISTON = { v: 8.5, vy: 3.2 };

// Landing squash: a hard landing (drop past this) rebounds into a small hop,
// the gameshow-bouncy feel. Chained bounces decay since each peak is lower.
const HC_BOUNCE_MIN_DROP = 3.2;
const HC_BOUNCE_FACTOR = 0.5; // rebound vy = min(cap, drop * factor)
const HC_BOUNCE_VY_CAP = 3.4;

/** The catapult: the send-off arc for the freshly eliminated. */
const HC_YEET_VY = 15;

// ---------------------------------------------------------------------------
// State shapes (backing fields live on Sim, reached as live ctx views)
// ---------------------------------------------------------------------------

export interface HcQueueUnit {
  pid: number;
  joinedAtTick: number; // drives the bot-backfill wait
}

export interface HcRacer {
  pid: number;
  name: string;
  cls: PlayerClass;
  bot: boolean;
  seat: number; // start plate + respawn lane
  checkpoint: number; // last banked course checkpoint index (this round)
  furthestZ: number; // monotonic course progress this round (instance-local z)
  finished: boolean; // crossed THIS round's line (a qualification, or the crown)
  finishTime: number; // round clock seconds at the line
  place: number; // FINAL match placement 1..N once assigned
  eliminatedRound: number; // 0 while still racing; the round that cut them
  credited: boolean; // hcRaces/hcWins recorded (exactly once per match)
  falls: number;
  lastLaunchAt: number; // sim time of the last launch/respawn (immunity)
  immunity: number; // per-kind re-hit grace applied at the last launch
  airborne: boolean; // was off the ground last tick (landing-bounce edge)
  peakY: number; // highest y since leaving the ground (bounce drop metric)
  left: boolean; // logged out or fled the crag mid-race
}

export interface HcMatch {
  id: number;
  slot: number;
  state: 'countdown' | 'active' | 'intermission' | 'over';
  round: number; // 1..HC_ROUNDS
  timer: number; // countdown, then intermission, then aftermath remaining
  clock: number; // elapsed active seconds THIS round
  /** Seed base for the match; each round derives its course seed from it. */
  seedBase: number;
  courseSeed: number;
  course: HcCourse;
  racers: Map<number, HcRacer>;
  returns: Map<number, { x: number; z: number; facing: number }>;
  botPids: number[];
  /** Next place handed to a round-3 finisher (counts up from 1). */
  topPlace: number;
  /** Next place handed to the eliminated/deserters (counts down from N). */
  bottomPlace: number;
}

export interface HcStanding {
  races: number;
  wins: number;
  best: number | null; // fastest personal final-round finish, seconds
}

export function hcStanding(meta: PlayerMeta): HcStanding {
  return {
    races: meta.hcRaces ?? 0,
    wins: meta.hcWins ?? 0,
    best: meta.hcBest ?? null,
  };
}

export function addHcResult(meta: PlayerMeta, won: boolean, timeS: number | null): void {
  meta.hcRaces = (meta.hcRaces ?? 0) + 1;
  if (won) meta.hcWins = (meta.hcWins ?? 0) + 1;
  if (timeS !== null && (meta.hcBest === undefined || timeS < meta.hcBest)) meta.hcBest = timeS;
}

/** The round's course seed: pure in (seedBase, round), distinct per round. */
export function hcRoundSeed(seedBase: number, round: number): number {
  return (seedBase ^ Math.imul(round, 0x85ebca6b)) >>> 0;
}

// ---------------------------------------------------------------------------
// The Gauntlet Herald
// ---------------------------------------------------------------------------

/**
 * Spawn Herald Osric at world init. Guarded and RESERVED-id (see HC_HERALD_ID
 * in content/hodrics.ts): he never touches the nextId sequence or the shared
 * rng stream, so the parity goldens cannot see him.
 */
export function spawnHcHerald(ctx: SimContext): void {
  if (ctx.entities.has(HC_HERALD_ID)) return;
  const npc = createNpc(HC_HERALD_ID, HC_HERALD, ctx.groundPos(HC_HERALD_POS.x, HC_HERALD_POS.z));
  ctx.addEntity(npc);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export function hcIsQueued(ctx: SimContext, pid: number): boolean {
  return ctx.hcQueue.some((u) => u.pid === pid);
}

export function hcQueuePosition(ctx: SimContext, pid: number): number {
  return ctx.hcQueue.findIndex((u) => u.pid === pid) + 1;
}

export function hcQueueJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (hcIsQueued(ctx, id)) {
    ctx.emit({ type: 'hcQueued', position: hcQueuePosition(ctx, id), pid: id });
    return;
  }
  if (ctx.hcMatches.has(id)) {
    ctx.error(id, 'You are already racing the Gauntlet.');
    return;
  }
  if (r.e.dead) {
    ctx.error(id, 'You cannot queue for the Gauntlet while dead.');
    return;
  }
  if (ctx.duels.has(id)) {
    ctx.error(id, 'You cannot queue while dueling.');
    return;
  }
  if (ctx.trades.has(id)) {
    ctx.error(id, 'Finish your trade before queueing.');
    return;
  }
  if (ctx.arenaMatches.has(id) || isArenaQueued(ctx, id)) {
    ctx.error(id, 'Leave the Coliseum before racing the Gauntlet.');
    return;
  }
  if (r.e.pos.x > DUNGEON_X_THRESHOLD) {
    ctx.error(id, 'You cannot queue from inside an instance.');
    return;
  }
  ctx.hcQueue.push({ pid: id, joinedAtTick: ctx.tickCount });
  ctx.emit({ type: 'hcQueued', position: ctx.hcQueue.length, pid: id });
  ctx.emit({
    type: 'log',
    text: 'You join the Gauntlet queue. Lord Hodric oils the flails in your honor.',
    color: '#c9a2ff',
    pid: id,
  });
}

export function hcQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (!hcIsQueued(ctx, id)) return;
  ctx.hcQueue = ctx.hcQueue.filter((u) => u.pid !== id);
  ctx.emit({ type: 'hcUnqueued', pid: id });
}

export function pruneHcQueue(ctx: SimContext): void {
  ctx.hcQueue = ctx.hcQueue.filter((u) => {
    const e = ctx.entities.get(u.pid);
    return !!e && !e.dead && !ctx.hcMatches.has(u.pid) && !ctx.arenaMatches.has(u.pid);
  });
}

// ---------------------------------------------------------------------------
// Matchmaking + lifecycle
// ---------------------------------------------------------------------------

export function freeHcSlot(ctx: SimContext): number | null {
  for (let i = 0; i < HODRICS_SLOT_COUNT; i++) {
    if (!ctx.hcBusySlots.has(i)) return i;
  }
  return null;
}

export function matchmakeHc(ctx: SimContext): void {
  let guard = 3;
  while (guard-- > 0) {
    pruneHcQueue(ctx);
    if (ctx.hcQueue.length < HC_FIELD_SIZE || freeHcSlot(ctx) === null) return;
    const unit = ctx.hcQueue.slice(0, HC_FIELD_SIZE);
    ctx.hcQueue = ctx.hcQueue.slice(HC_FIELD_SIZE);
    startHcMatch(
      ctx,
      unit.map((u) => u.pid),
    );
  }
}

export function startHcMatch(ctx: SimContext, pids: number[]): void {
  const slot = freeHcSlot(ctx);
  const entities = pids.map((pid) => ctx.entities.get(pid));
  const metas = pids.map((pid) => ctx.players.get(pid));
  if (slot === null || entities.some((e) => !e) || metas.some((m) => !m)) {
    for (const pid of pids) {
      if (ctx.entities.get(pid) && !ctx.hcMatches.has(pid)) {
        ctx.hcQueue.unshift({ pid, joinedAtTick: ctx.tickCount });
      }
    }
    return;
  }
  ctx.hcBusySlots.add(slot);
  const matchId = ctx.nextHcMatchId++;
  const seedBase = (ctx.tickCount * 2654435761 + matchId * 40503) >>> 0;
  const courseSeed = hcRoundSeed(seedBase, 1);
  const course = hcCourseFor(courseSeed, 0);
  setActiveHodricsCourse(slot, course);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  const racers = new Map<number, HcRacer>();
  const botPids: number[] = [];
  const origin = hodricsOrigin(slot);
  for (let seat = 0; seat < pids.length; seat++) {
    const pid = pids[seat];
    const e = entities[seat]!;
    const meta = metas[seat]!;
    returns.set(pid, { x: e.pos.x, z: e.pos.z, facing: e.facing });
    const bot = meta.isHcBot === true;
    if (bot) botPids.push(pid);
    racers.set(pid, {
      pid,
      name: meta.name,
      cls: meta.cls,
      bot,
      seat,
      checkpoint: 0,
      furthestZ: course.checkpoints[0].z,
      finished: false,
      finishTime: 0,
      place: 0,
      eliminatedRound: 0,
      credited: false,
      falls: 0,
      lastLaunchAt: -99,
      immunity: HC_LAUNCH_IMMUNITY,
      airborne: false,
      peakY: e.pos.y,
      left: false,
    });
  }
  const match: HcMatch = {
    id: matchId,
    slot,
    state: 'countdown',
    round: 1,
    timer: HC_COUNTDOWN,
    clock: 0,
    seedBase,
    courseSeed,
    course,
    racers,
    returns,
    botPids,
    topPlace: 1,
    bottomPlace: pids.length,
  };
  for (const pid of pids) ctx.hcMatches.set(pid, match);
  const field = pids.map((pid) => {
    const rc = racers.get(pid)!;
    return { name: rc.name, cls: rc.cls, bot: rc.bot };
  });
  for (let seat = 0; seat < pids.length; seat++) {
    const e = entities[seat]!;
    arenaDequeue(ctx, pids[seat]);
    placeInArena(ctx, e, origin, hcStartPlate(course, seat));
    resetForArena(ctx, e);
    ctx.emit({ type: 'hcFound', field, pid: pids[seat] });
    ctx.emit({ type: 'hcRoundStart', round: 1, pid: pids[seat] });
    ctx.emit({ type: 'hcCountdown', seconds: HC_COUNTDOWN, pid: pids[seat] });
    ctx.emit({
      type: 'log',
      text: "The gates of Hodric's Castle grind open. Race to the crown!",
      color: '#c9a2ff',
      pid: pids[seat],
    });
  }
}

export function hcMatchFor(ctx: SimContext, pid: number): HcMatch | null {
  return ctx.hcMatches.get(pid) ?? null;
}

/** Racers still in the running: not eliminated, not gone. */
function aliveRacers(match: HcMatch): HcRacer[] {
  return [...match.racers.values()].filter((r) => !r.left && r.eliminatedRound === 0);
}

/** This round's qualification target, shrunk for short (deserted) fields. */
export function hcQualifyTarget(match: HcMatch): number {
  const alive = aliveRacers(match).length;
  const base = HC_QUALIFY[match.round - 1] ?? 1;
  if (match.round >= HC_ROUNDS) return 1;
  return Math.max(1, Math.min(base, alive - 1));
}

export function updateHodrics(ctx: SimContext): void {
  // Idle short-circuit: no queue, no matches, no work, no rng.
  if (ctx.hcQueue.length === 0 && ctx.hcMatches.size === 0) return;
  matchmakeHc(ctx);
  const seen = new Set<HcMatch>();
  for (const match of ctx.hcMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    updateHcMatch(ctx, match);
  }
}

function updateHcMatch(ctx: SimContext, match: HcMatch): void {
  // Desertion sweep: logged out, or somehow fled the crag mid-race. A
  // deserter who had no place yet takes the worst unassigned one.
  for (const racer of match.racers.values()) {
    if (racer.left) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e || (match.state !== 'over' && !isHodricsPos(e.pos.x))) {
      racer.left = true;
      if (racer.place === 0) racer.place = match.bottomPlace--;
      if (racer.eliminatedRound === 0) racer.eliminatedRound = match.round;
      ctx.hcMatches.delete(racer.pid);
    }
  }
  if (match.state === 'over') {
    match.timer -= DT;
    if (match.timer <= 0) returnFromHcMatch(ctx, match);
    return;
  }
  const humanPresent = [...match.racers.values()].some((r) => !r.bot && !r.left);
  if (!humanPresent) {
    // Nothing but bots left racing: score it and fold the instance.
    finalizeMatch(ctx, match);
    return;
  }
  if (match.state === 'countdown') {
    const before = Math.ceil(match.timer);
    match.timer -= DT;
    const after = Math.ceil(match.timer);
    if (after < before && after > 0) {
      for (const racer of match.racers.values()) {
        if (!racer.left && racer.eliminatedRound === 0) {
          ctx.emit({ type: 'hcCountdown', seconds: after, pid: racer.pid });
        }
      }
    }
    holdAtRope(ctx, match);
    if (match.timer <= 0) {
      match.state = 'active';
      match.timer = 0;
      for (const racer of match.racers.values()) {
        if (racer.left || racer.eliminatedRound > 0) continue;
        ctx.emit({ type: 'hcStart', pid: racer.pid });
        ctx.emit({
          type: 'log',
          text: 'GO! The Gauntlet is open!',
          color: '#ffd75e',
          pid: racer.pid,
        });
      }
    }
    return;
  }
  if (match.state === 'intermission') {
    const before = match.timer;
    match.timer -= DT;
    // The catapult flight ends in the gallery: one clean teleport for
    // everyone cut this round, once the arc has had its moment.
    if (before > HC_GALLERY_AT && match.timer <= HC_GALLERY_AT) {
      seatGallery(ctx, match);
    }
    if (match.timer <= 0) beginNextRound(ctx, match);
    return;
  }
  match.clock += DT;
  racePhysics(ctx, match);
  const alive = aliveRacers(match);
  const target = hcQualifyTarget(match);
  const finishers = alive.filter((r) => r.finished).length;
  const roundTime = HC_ROUND_TIME[match.round - 1] ?? 120;
  if (finishers >= target || alive.every((r) => r.finished) || match.clock >= roundTime) {
    resolveRound(ctx, match);
  }
}

// Countdown: a soft rope at the yard mouth so nobody false-starts the course.
function holdAtRope(ctx: SimContext, match: HcMatch): void {
  const origin = hodricsOrigin(match.slot);
  const ropeZ = match.course.ropeZ;
  for (const racer of match.racers.values()) {
    if (racer.left || racer.eliminatedRound > 0) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e) continue;
    if (e.pos.z - origin.z > ropeZ) {
      e.pos.z = origin.z + ropeZ;
      e.vx = 0;
      e.vz = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Round resolution: qualification, elimination, the catapult, the rebuild.
// ---------------------------------------------------------------------------

/** Standing order for a round: finishers by time, then progress, then seat. */
function roundStanding(match: HcMatch): HcRacer[] {
  return aliveRacers(match).sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    return b.furthestZ - a.furthestZ || a.seat - b.seat;
  });
}

function resolveRound(ctx: SimContext, match: HcMatch): void {
  const standing = roundStanding(match);
  const target = hcQualifyTarget(match);

  if (match.round >= HC_ROUNDS || standing.length <= 1) {
    finalizeMatch(ctx, match);
    return;
  }

  const origin = hodricsOrigin(match.slot);
  const qualified = standing.slice(0, target);
  const cut = standing.slice(target);
  for (const racer of qualified) {
    ctx.emit({ type: 'hcQualified', round: match.round, pid: racer.pid });
  }
  // Worst standing takes the worst place, counting down the board.
  for (let i = cut.length - 1; i >= 0; i--) {
    const racer = cut[i];
    racer.eliminatedRound = match.round;
    racer.place = match.bottomPlace--;
    if (!racer.bot && !racer.credited) {
      const meta = ctx.players.get(racer.pid);
      if (meta) {
        addHcResult(meta, false, null);
        racer.credited = true;
      }
    }
    // Hodric's catapult: the send-off. The gallery teleport lands mid-flight
    // (seatGallery), so the whole field watches the losers arc skyward.
    const e = ctx.entities.get(racer.pid);
    if (e) {
      const dir = e.pos.x - origin.x >= 0 ? 1 : -1;
      e.vx = dir * 2.5;
      e.vy = HC_YEET_VY;
      e.vz = -3;
      e.onGround = false;
      e.jumping = false;
      e.fallStartY = e.pos.y;
    }
    ctx.emit({ type: 'hcEliminated', place: racer.place, round: match.round, pid: racer.pid });
  }
  match.state = 'intermission';
  match.timer = HC_INTERMISSION;
}

/** Drop everyone eliminated (any round) onto the gallery balcony. */
function seatGallery(ctx: SimContext, match: HcMatch): void {
  const origin = hodricsOrigin(match.slot);
  const g = match.course.gallery;
  const out = [...match.racers.values()].filter((r) => !r.left && r.eliminatedRound > 0);
  for (let i = 0; i < out.length; i++) {
    const e = ctx.entities.get(out[i].pid);
    if (!e) continue;
    const col = i % 4;
    const row = Math.floor(i / 4);
    e.pos = {
      x: origin.x + g.x - 4.5 + col * 3,
      y: g.y,
      z: origin.z + g.z - 3 + row * 3,
    };
    e.prevPos = { ...e.pos };
    e.facing = Math.PI / 2; // face the course
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
    e.jumping = false;
    e.fallStartY = e.pos.y;
    ctx.rebucket(e);
  }
}

/** Rebuild the castle (new course seed) and plate the survivors. */
function beginNextRound(ctx: SimContext, match: HcMatch): void {
  const alive = aliveRacers(match);
  if (alive.length <= 1) {
    finalizeMatch(ctx, match);
    return;
  }
  match.round += 1;
  // A short field can skip ahead: no round should eliminate nobody.
  while (match.round < HC_ROUNDS && alive.length <= (HC_QUALIFY[match.round - 1] ?? 1)) {
    match.round += 1;
  }
  match.courseSeed = hcRoundSeed(match.seedBase, match.round);
  match.course = hcCourseFor(match.courseSeed, match.round - 1);
  setActiveHodricsCourse(match.slot, match.course);
  match.clock = 0;
  match.state = 'countdown';
  match.timer = HC_COUNTDOWN;
  const origin = hodricsOrigin(match.slot);
  for (const racer of alive) {
    const e = ctx.entities.get(racer.pid);
    if (!e) continue;
    racer.checkpoint = 0;
    racer.furthestZ = match.course.checkpoints[0].z;
    racer.finished = false;
    racer.finishTime = 0;
    racer.lastLaunchAt = -99;
    racer.immunity = HC_LAUNCH_IMMUNITY;
    racer.airborne = false;
    placeInArena(ctx, e, origin, hcStartPlate(match.course, racer.seat));
    racer.peakY = e.pos.y;
    ctx.emit({ type: 'hcRoundStart', round: match.round, pid: racer.pid });
    ctx.emit({ type: 'hcCountdown', seconds: HC_COUNTDOWN, pid: racer.pid });
    ctx.emit({
      type: 'log',
      text: 'Lord Hodric rebuilds his gauntlet. New course, same crown!',
      color: '#c9a2ff',
      pid: racer.pid,
    });
  }
  // Spectators hear the new round too.
  for (const racer of match.racers.values()) {
    if (!racer.left && racer.eliminatedRound > 0) {
      ctx.emit({ type: 'hcRoundStart', round: match.round, pid: racer.pid });
    }
  }
}

// ---------------------------------------------------------------------------
// Race physics: platform carry, spinner carry, obstacle launches, falls,
// progress, finish. Runs AFTER the base per-player movement phase each tick,
// so it is the vertical authority for the analytic platforms and the safety
// net under the chasm. Every pose it tests comes from pure time functions.
// ---------------------------------------------------------------------------

function racePhysics(ctx: SimContext, match: HcMatch): void {
  const origin = hodricsOrigin(match.slot);
  const course = match.course;
  const t = ctx.time;
  for (const racer of match.racers.values()) {
    if (racer.left) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e) continue;

    // Spectators: only the safety net (rails make falls near-impossible).
    if (racer.eliminatedRound > 0) {
      if (e.pos.y < HC_KILL_Y) respawnAtCheckpoint(ctx, match, racer, e);
      continue;
    }

    const lx = e.pos.x - origin.x;
    const lz = e.pos.z - origin.z;
    ridePlatforms(course, e, lx, lz, t);
    rideSpinners(course, e, lx, lz);

    if (!racer.finished && t - racer.lastLaunchAt >= racer.immunity) {
      testObstacleHits(ctx, course, racer, e, e.pos.x - origin.x, e.pos.z - origin.z, t);
    }

    // Kill plane: the chasm swallows nobody, it hands them back to the line.
    if (e.pos.y < HC_KILL_Y) {
      respawnAtCheckpoint(ctx, match, racer, e);
      continue;
    }

    // Landing squash-and-rebound: a hard landing pops a small decaying hop
    // (gameshow bounce). The drawspan decks are exempt, ridePlatforms is
    // their vertical authority and a bounce would fight its deck pinning.
    if (!e.onGround) {
      racer.airborne = true;
      if (e.pos.y > racer.peakY) racer.peakY = e.pos.y;
    } else {
      if (racer.airborne) {
        const drop = racer.peakY - e.pos.y;
        const plx = e.pos.x - origin.x;
        const plz = e.pos.z - origin.z;
        if (drop > HC_BOUNCE_MIN_DROP && !ridingPlatform(course, plx, plz, e.pos.y, t)) {
          e.vy = Math.min(HC_BOUNCE_VY_CAP, drop * HC_BOUNCE_FACTOR);
          e.onGround = false;
          e.fallStartY = e.pos.y;
        }
      }
      racer.airborne = !e.onGround;
      racer.peakY = e.pos.y;
    }

    // Progress banks only on solid ground (a hammer yeet is not progress).
    if (e.onGround) {
      const localZ = e.pos.z - origin.z;
      const localX = e.pos.x - origin.x;
      const onCourse =
        hodricsSurfaceAt(course, localX, localZ) !== null ||
        hodricsOnSpinner(course, localX, localZ) !== null ||
        ridingPlatform(course, localX, localZ, e.pos.y, t);
      if (onCourse && localZ > racer.furthestZ) racer.furthestZ = localZ;
      if (onCourse) {
        const nextCp = racer.checkpoint + 1;
        if (nextCp < course.checkpoints.length && localZ >= course.checkpoints[nextCp].z) {
          racer.checkpoint = nextCp;
          ctx.emit({ type: 'hcCheckpoint', index: nextCp, pid: racer.pid });
        }
        if (
          !racer.finished &&
          localZ >= course.finishZ &&
          e.pos.y > course.finishY - 1 &&
          match.state === 'active'
        ) {
          racer.finished = true;
          racer.finishTime = match.clock;
          if (match.round >= HC_ROUNDS) {
            // The final: places count up from the crown.
            racer.place = match.topPlace++;
            ctx.emit({
              type: 'hcFinish',
              place: racer.place,
              timeS: match.clock,
              pid: racer.pid,
            });
            // Credit the finish NOW, not at finalizeMatch: a racer who quits
            // the instant they cross the line would otherwise have their
            // PlayerMeta gone (removePlayer deletes it synchronously) by the
            // time the match ends, silently losing the crown.
            if (!racer.bot && !racer.credited) {
              const meta = ctx.players.get(racer.pid);
              if (meta) {
                addHcResult(meta, racer.place === 1, racer.finishTime);
                racer.credited = true;
              }
            }
          } else {
            // Qualification: in-round order is just for the banner.
            const qualOrder = aliveRacers(match).filter((r) => r.finished).length;
            ctx.emit({
              type: 'hcFinish',
              place: qualOrder,
              timeS: match.clock,
              pid: racer.pid,
            });
          }
        }
      }
    }
  }
}

/** True when a point rides one of the drawspan platforms at deck height. */
function ridingPlatform(course: HcCourse, lx: number, lz: number, y: number, t: number): boolean {
  for (const d of course.drawspans) {
    const px = hcDrawspanX(d, t);
    if (
      Math.abs(lx - px) <= d.halfX &&
      Math.abs(lz - d.zCenter) <= d.halfZ &&
      Math.abs(y - d.y) < 1.0
    ) {
      return true;
    }
  }
  return false;
}

// The drawspan platforms are one of two dynamic floors in the game. The base
// sim only knows the static ground (the chasm below the gap), so this pass is
// their vertical authority: it catches landings, pins riders to the deck, and
// carries them with the platform's analytic delta. A racer the platform
// slides out from under simply stops matching the rect and falls next tick.
function ridePlatforms(course: HcCourse, e: Entity, lx: number, lz: number, t: number): void {
  for (const d of course.drawspans) {
    const px = hcDrawspanX(d, t);
    if (Math.abs(lz - d.zCenter) > d.halfZ || Math.abs(lx - px) > d.halfX) continue;
    const grounded = e.onGround && Math.abs(e.pos.y - d.y) < 0.3;
    const landing = !e.onGround && e.vy <= 0 && e.pos.y >= d.y && e.pos.y <= d.y + 1.0;
    if (!grounded && !landing) continue;
    const dx = px - hcDrawspanX(d, t - DT);
    e.pos.x += dx;
    e.pos.y = d.y;
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
    e.jumping = false;
    e.fallStartY = d.y;
    return;
  }
}

// The other dynamic floor: spinner discs. The disc top is static ground (the
// course ground function knows the circle), but standing on one carries the
// rider around the hub by the disc's angular speed. Pure rotation, no rng.
function rideSpinners(course: HcCourse, e: Entity, lx: number, lz: number): void {
  if (!e.onGround) return;
  const d = hodricsOnSpinner(course, lx, lz);
  if (!d || Math.abs(e.pos.y - d.y) > 0.6) return;
  const relX = lx - d.cx;
  const relZ = lz - d.cz;
  const dth = d.omega * DT;
  const cos = Math.cos(dth);
  const sin = Math.sin(dth);
  const nx = relX * cos - relZ * sin;
  const nz = relX * sin + relZ * cos;
  e.pos.x += nx - relX;
  e.pos.z += nz - relZ;
}

function testObstacleHits(
  ctx: SimContext,
  course: HcCourse,
  racer: HcRacer,
  e: Entity,
  lx: number,
  lz: number,
  t: number,
): void {
  const groundY = e.pos.y;
  const coreY = groundY + HC_BODY_HALF_H;

  // Hammer flails over the bridges: a fat bob on an arm, swinging across x.
  for (const f of course.flails) {
    const bob = hcFlailBob(f, t);
    const dx = lx - bob.x;
    const dz = lz - f.z;
    if (
      Math.hypot(dx, dz) < f.bobR + HC_BODY_R &&
      Math.abs(coreY - bob.y) < f.bobR + HC_BODY_HALF_H
    ) {
      const dir = bob.vx >= 0 ? 1 : -1;
      launch(ctx, racer, e, KNOCK_FLAIL.v * dir, KNOCK_FLAIL.vy, Math.sign(dz) * 2, 'flail');
      return;
    }
  }

  // Log rotors on the courts: a full-diameter beam, jumpable over the top.
  for (const r of course.rotors) {
    if (coreY - HC_BODY_HALF_H > r.y + r.beamTopY) continue; // cleared it airborne
    const a = hcRotorAngle(r, t);
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const relX = lx - r.cx;
    const relZ = lz - r.cz;
    const s = Math.max(-r.r, Math.min(r.r, relX * ux + relZ * uz));
    const dist = Math.hypot(relX - s * ux, relZ - s * uz);
    if (dist < r.beamHalf + HC_BODY_R && Math.abs(s) > 0.8) {
      // Tangential velocity at the contact point, plus a radial shove.
      const tx = -uz * Math.sign(r.omega) * Math.sign(s);
      const tz = ux * Math.sign(r.omega) * Math.sign(s);
      const radLen = Math.max(0.001, Math.hypot(relX, relZ));
      const vx = tx * KNOCK_ROTOR.tangential + (relX / radLen) * KNOCK_ROTOR.radial;
      const vz = tz * KNOCK_ROTOR.tangential + (relZ / radLen) * KNOCK_ROTOR.radial;
      launch(ctx, racer, e, vx, KNOCK_ROTOR.vy, vz, 'log');
      return;
    }
  }

  // Pendulum axes over the wall walks.
  for (const a of course.axes) {
    const head = hcAxeHead(a, t);
    const dx = lx - head.x;
    const dz = lz - a.z;
    if (
      Math.hypot(dx, dz) < a.headR + HC_BODY_R &&
      Math.abs(coreY - head.y) < a.headR + HC_BODY_HALF_H
    ) {
      const dir = head.vx >= 0 ? 1 : -1;
      launch(ctx, racer, e, KNOCK_AXE.v * dir, KNOCK_AXE.vy, Math.sign(dz) * 2, 'axe');
      return;
    }
  }

  // Piston rams shoving across the ledges: a ground-level push toward the
  // open edge; ride it out or time the gap.
  for (const p of course.pushers) {
    if (Math.abs(coreY - (p.y + HC_BODY_HALF_H)) > 1.6) continue;
    const hx = hcPusherX(p, t);
    const dx = lx - hx;
    const dz = lz - p.z;
    if (Math.hypot(dx, dz) < p.headR + HC_BODY_R) {
      launch(ctx, racer, e, -p.side * KNOCK_PISTON.v, KNOCK_PISTON.vy, 0.8, 'piston');
      return;
    }
  }

  // Boulders rolling down the climbs: knocked back downhill.
  for (const lane of course.boulderLanes) {
    for (const b of hcLaneBoulders(lane, t)) {
      const dx = lx - lane.x;
      const dz = lz - b.z;
      if (
        Math.hypot(dx, dz) < lane.r + HC_BODY_R &&
        coreY - HC_BODY_HALF_H < b.y + lane.r &&
        coreY + HC_BODY_HALF_H > b.y - lane.r
      ) {
        const side = dx === 0 ? (racer.seat % 2 === 0 ? 1 : -1) : Math.sign(dx);
        launch(
          ctx,
          racer,
          e,
          side * KNOCK_BOULDER.vx,
          KNOCK_BOULDER.vy,
          KNOCK_BOULDER.vz,
          'boulder',
        );
        return;
      }
    }
  }
}

function launch(
  ctx: SimContext,
  racer: HcRacer,
  e: Entity,
  vx: number,
  vy: number,
  vz: number,
  kind: HcKnockKind,
): void {
  e.vx = vx;
  e.vy = vy;
  e.vz = vz;
  e.onGround = false;
  e.jumping = false;
  e.fallStartY = e.pos.y;
  racer.lastLaunchAt = ctx.time;
  racer.immunity = HC_IMMUNITY[kind];
  racer.peakY = e.pos.y;
  ctx.emit({ type: 'hcKnocked', kind, pid: racer.pid });
}

function respawnAtCheckpoint(ctx: SimContext, match: HcMatch, racer: HcRacer, e: Entity): void {
  const origin = hodricsOrigin(match.slot);
  // Spectators fall back to the gallery, never onto the course.
  const s =
    racer.eliminatedRound > 0
      ? { x: match.course.gallery.x, z: match.course.gallery.z }
      : hcCheckpointSpawn(match.course, racer.checkpoint, racer.seat);
  e.pos = ctx.groundPos(origin.x + s.x, origin.z + s.z);
  e.prevPos = { ...e.pos };
  e.facing = 0;
  e.prevFacing = 0;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
  e.jumping = false;
  e.fallStartY = e.pos.y;
  ctx.rebucket(e);
  racer.falls++;
  racer.lastLaunchAt = ctx.time; // spawn grace shares the immunity window
  racer.immunity = HC_LAUNCH_IMMUNITY;
  racer.airborne = false;
  racer.peakY = e.pos.y;
  ctx.emit({ type: 'hcFall', pid: racer.pid });
}

// ---------------------------------------------------------------------------
// Scoring + return
// ---------------------------------------------------------------------------

/** Assign every remaining place and close the show (podium, then home). */
export function finalizeMatch(ctx: SimContext, match: HcMatch): void {
  // Whoever is still alive and unplaced ranks by this round's standing,
  // worst first off the bottom of the board.
  const open = roundStanding(match).filter((r) => r.place === 0);
  for (let i = open.length - 1; i >= 0; i--) {
    open[i].place = match.bottomPlace--;
  }
  for (const racer of match.racers.values()) {
    if (!racer.bot && !racer.left && !racer.credited) {
      const meta = ctx.players.get(racer.pid);
      if (meta) {
        addHcResult(meta, racer.place === 1, racer.finished ? racer.finishTime : null);
        racer.credited = true;
      }
    }
  }
  const field = [...match.racers.values()]
    .sort((a, b) => a.place - b.place)
    .map((r) => ({
      name: r.name,
      place: r.place,
      bot: r.bot,
      timeS: r.finished ? r.finishTime : null,
    }));
  for (const racer of match.racers.values()) {
    if (racer.left) continue;
    ctx.emit({
      type: 'hcEnd',
      place: racer.place,
      won: racer.place === 1,
      field,
      pid: racer.pid,
    });
  }
  match.state = 'over';
  match.timer = HC_RETURN_DELAY;
}

export function returnFromHcMatch(ctx: SimContext, match: HcMatch): void {
  for (const racer of match.racers.values()) ctx.hcMatches.delete(racer.pid);
  ctx.hcBusySlots.delete(match.slot);
  resetHodricsCourse(match.slot);
  for (const racer of match.racers.values()) {
    const e = ctx.entities.get(racer.pid);
    const ret = match.returns.get(racer.pid);
    if (!e || !ret) continue;
    resetForArena(ctx, e);
    e.pos = ctx.groundPos(ret.x, ret.z);
    e.prevPos = { ...e.pos };
    e.facing = ret.facing;
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
    e.onGround = true;
    ctx.rebucket(e);
    ctx.emit({ type: 'respawn', pid: e.id });
  }
}
