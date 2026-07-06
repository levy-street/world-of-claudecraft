// Hodric's Castle: the Gauntlet, a 10-racer obstacle-course race (Fall Guys
// spirit, classic-MMO body). Queue at the Herald, race the course defined in
// sim/hodrics_layout.ts, first over the finish line takes the crown.
//
// Follows the Ashen Coliseum arena module shape: state lives on Sim (live
// SimContext views), this module holds only functions, and the whole system
// costs zero work and ZERO rng draws while nobody queues or races.
//
// DETERMINISM CONTRACT:
// - Obstacle poses are pure functions of absolute sim time (hodrics_layout);
//   the race physics below reads them, it never advances them.
// - The race itself draws NO randomness at all. The per-match `rng` sub-stream
//   (seeded off tickCount + nextHcMatchId, the fiesta mechanism) exists solely
//   for bot skill variance in social/hodrics_bots.ts and never touches the
//   shared stream, so parity goldens cannot fork.
// - Racers cannot die on the course: there are no damage sources in the band,
//   falls are caught at the kill plane and respawn at the last checkpoint.

import { HC_HERALD, HC_HERALD_ID, HC_HERALD_POS } from '../content/hodrics';
import { DUNGEON_X_THRESHOLD, hodricsOrigin, isHodricsPos } from '../data';
import { createNpc } from '../entity';
import {
  HC_AXES,
  HC_BOULDER_LANES,
  HC_CHECKPOINTS,
  HC_DRAWSPANS,
  HC_FIELD_SIZE,
  HC_FINISH_Z,
  HC_FLAILS,
  HC_KILL_Y,
  HC_ROTORS,
  hcAxeHead,
  hcCheckpointSpawn,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcRotorAngle,
  hcStartPlate,
  hodricsSurfaceAt,
} from '../hodrics_layout';
import { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type HcKnockKind, type PlayerClass } from '../types';
import { arenaDequeue, isArenaQueued, placeInArena, resetForArena } from './arena';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export const HC_COUNTDOWN = 5; // seconds on the start plates before GO
export const HC_RETURN_DELAY = 10; // podium moment on the keep before going home
export const HC_MAX_DURATION = 240; // seconds; stragglers place by progress
export const HC_BOT_BACKFILL_WAIT = 30; // seconds a human waits before bots fill the field
// No level gate: the Gauntlet has no combat, run speed is identical for every
// racer, so a day-one character can race the realm's best on even legs.

// A hit launches the racer on a ballistic arc (the base sim integrates
// airborne velocity with no air control, so a knock is committed, exactly the
// tumbling feel we want). Immunity keeps chained obstacles from stunlocking.
export const HC_LAUNCH_IMMUNITY = 0.9; // seconds of no re-hit after any launch or respawn
const HC_BODY_R = 0.5; // racer body radius (PLAYER_BODY_RADIUS)
const HC_BODY_HALF_H = 0.9; // capsule half height for vertical overlap tests
const HC_ROPE_Z = -86; // countdown holding line at the yard mouth

const KNOCK_FLAIL = { v: 10, vy: 5 };
const KNOCK_AXE = { v: 11, vy: 5.5 };
const KNOCK_ROTOR = { tangential: 8.5, radial: 3, vy: 4.2 };
const KNOCK_BOULDER = { vz: -9.5, vx: 2.5, vy: 4.5 };

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
  checkpoint: number; // last banked HC_CHECKPOINTS index
  furthestZ: number; // monotonic course progress (instance-local z)
  finished: boolean;
  finishTime: number; // race clock seconds at the finish line
  place: number; // 1..N once assigned (finish order, then progress)
  falls: number;
  lastLaunchAt: number; // sim time of the last launch/respawn (immunity)
  left: boolean; // logged out or fled the crag mid-race
}

export interface HcMatch {
  id: number;
  slot: number;
  state: 'countdown' | 'active' | 'over';
  timer: number; // countdown remaining, then aftermath remaining in 'over'
  clock: number; // elapsed active race seconds
  racers: Map<number, HcRacer>;
  returns: Map<number, { x: number; z: number; facing: number }>;
  botPids: number[];
  nextPlace: number;
  /** Bot-variance sub-stream only; the race itself never draws from it. */
  rng: Rng;
}

export interface HcStanding {
  races: number;
  wins: number;
  best: number | null; // fastest personal finish, seconds
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
  for (let i = 0; i < 2; i++) {
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
      furthestZ: HC_CHECKPOINTS[0].z,
      finished: false,
      finishTime: 0,
      place: 0,
      falls: 0,
      lastLaunchAt: -99,
      left: false,
    });
  }
  const match: HcMatch = {
    id: ctx.nextHcMatchId++,
    slot,
    state: 'countdown',
    timer: HC_COUNTDOWN,
    clock: 0,
    racers,
    returns,
    botPids,
    nextPlace: 1,
    // The fiesta per-match sub-stream: one derivation, zero shared draws.
    rng: new Rng((ctx.tickCount * 2654435761 + ctx.nextHcMatchId * 40503) >>> 0),
  };
  for (const pid of pids) ctx.hcMatches.set(pid, match);
  const field = pids.map((pid) => {
    const rc = racers.get(pid)!;
    return { name: rc.name, cls: rc.cls, bot: rc.bot };
  });
  for (let seat = 0; seat < pids.length; seat++) {
    const e = entities[seat]!;
    arenaDequeue(ctx, pids[seat]);
    placeInArena(ctx, e, origin, hcStartPlate(seat));
    resetForArena(ctx, e);
    ctx.emit({ type: 'hcFound', field, pid: pids[seat] });
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
  // Desertion sweep: logged out, or somehow fled the crag mid-race.
  for (const racer of match.racers.values()) {
    if (racer.left || racer.finished) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e || (match.state !== 'over' && !isHodricsPos(e.pos.x))) {
      racer.left = true;
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
    endHcMatch(ctx, match);
    return;
  }
  if (match.state === 'countdown') {
    const before = Math.ceil(match.timer);
    match.timer -= DT;
    const after = Math.ceil(match.timer);
    if (after < before && after > 0) {
      for (const racer of match.racers.values()) {
        if (!racer.left) ctx.emit({ type: 'hcCountdown', seconds: after, pid: racer.pid });
      }
    }
    holdAtRope(ctx, match);
    if (match.timer <= 0) {
      match.state = 'active';
      match.timer = 0;
      for (const racer of match.racers.values()) {
        if (racer.left) continue;
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
  match.clock += DT;
  racePhysics(ctx, match);
  const allDone = [...match.racers.values()].every((r) => r.finished || r.left);
  const humansDone = [...match.racers.values()].every((r) => r.bot || r.finished || r.left);
  if (allDone || humansDone || match.clock >= HC_MAX_DURATION) endHcMatch(ctx, match);
}

// Countdown: a soft rope at the yard mouth so nobody false-starts the bridge.
function holdAtRope(ctx: SimContext, match: HcMatch): void {
  const origin = hodricsOrigin(match.slot);
  for (const racer of match.racers.values()) {
    if (racer.left) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e) continue;
    if (e.pos.z - origin.z > HC_ROPE_Z) {
      e.pos.z = origin.z + HC_ROPE_Z;
      e.vx = 0;
      e.vz = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Race physics: platform carry, obstacle launches, falls, progress, finish.
// Runs AFTER the base per-player movement phase each tick, so it is the
// vertical authority for the analytic platforms and the safety net under the
// chasm. Every pose it tests comes from the layout's pure time functions.
// ---------------------------------------------------------------------------

function racePhysics(ctx: SimContext, match: HcMatch): void {
  const origin = hodricsOrigin(match.slot);
  const t = ctx.time;
  for (const racer of match.racers.values()) {
    if (racer.left) continue;
    const e = ctx.entities.get(racer.pid);
    if (!e) continue;
    ridePlatforms(e, e.pos.x - origin.x, e.pos.z - origin.z, t);

    if (!racer.finished && t - racer.lastLaunchAt >= HC_LAUNCH_IMMUNITY) {
      testObstacleHits(ctx, match, racer, e, e.pos.x - origin.x, e.pos.z - origin.z, t);
    }

    // Kill plane: the chasm swallows nobody, it hands them back to the line.
    if (e.pos.y < HC_KILL_Y) {
      respawnAtCheckpoint(ctx, match, racer, e);
      continue;
    }

    // Progress banks only on solid ground (a flail yeet is not progress).
    if (e.onGround) {
      const localZ = e.pos.z - origin.z;
      const localX = e.pos.x - origin.x;
      const onCourse =
        hodricsSurfaceAt(localX, localZ) !== null || ridingPlatform(localX, localZ, e.pos.y, t);
      if (onCourse && localZ > racer.furthestZ) racer.furthestZ = localZ;
      if (onCourse) {
        const nextCp = racer.checkpoint + 1;
        if (nextCp < HC_CHECKPOINTS.length && localZ >= HC_CHECKPOINTS[nextCp].z) {
          racer.checkpoint = nextCp;
          ctx.emit({ type: 'hcCheckpoint', index: nextCp, pid: racer.pid });
        }
        if (!racer.finished && localZ >= HC_FINISH_Z && e.pos.y > 13) {
          racer.finished = true;
          racer.place = match.nextPlace++;
          racer.finishTime = match.clock;
          ctx.emit({ type: 'hcFinish', place: racer.place, timeS: match.clock, pid: racer.pid });
        }
      }
    }
  }
}

/** True when a point rides one of the Drawspan platforms at deck height. */
function ridingPlatform(lx: number, lz: number, y: number, t: number): boolean {
  for (const d of HC_DRAWSPANS) {
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

// The Drawspan platforms are the one dynamic floor in the game. The base sim
// only knows the static ground (the chasm below the gap), so this pass is
// their vertical authority: it catches landings, pins riders to the deck, and
// carries them with the platform's analytic delta. A racer the platform
// slides out from under simply stops matching the rect and falls next tick.
function ridePlatforms(e: Entity, lx: number, lz: number, t: number): void {
  for (const d of HC_DRAWSPANS) {
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

function testObstacleHits(
  ctx: SimContext,
  match: HcMatch,
  racer: HcRacer,
  e: Entity,
  lx: number,
  lz: number,
  t: number,
): void {
  const groundY = e.pos.y;
  const coreY = groundY + HC_BODY_HALF_H;

  // Flails over the bridge: a sphere on a chain, swinging across x.
  for (const f of HC_FLAILS) {
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

  // Log rotors on the plaza: a full-diameter beam, jumpable over the top.
  for (const r of HC_ROTORS) {
    if (coreY - HC_BODY_HALF_H > r.beamTopY) continue; // cleared it airborne
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

  // Pendulum axes over the wall walk.
  for (const a of HC_AXES) {
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

  // Boulders rolling down the alley: knocked back downhill.
  for (const lane of HC_BOULDER_LANES) {
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
  ctx.emit({ type: 'hcKnocked', kind, pid: racer.pid });
}

function respawnAtCheckpoint(ctx: SimContext, match: HcMatch, racer: HcRacer, e: Entity): void {
  const origin = hodricsOrigin(match.slot);
  const s = hcCheckpointSpawn(racer.checkpoint, racer.seat);
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
  ctx.emit({ type: 'hcFall', pid: racer.pid });
}

// ---------------------------------------------------------------------------
// Scoring + return
// ---------------------------------------------------------------------------

export function endHcMatch(ctx: SimContext, match: HcMatch): void {
  // Unfinished racers place by furthest progress, ties broken by seat.
  const open = [...match.racers.values()]
    .filter((r) => !r.finished)
    .sort((a, b) => b.furthestZ - a.furthestZ || a.seat - b.seat);
  for (const racer of open) racer.place = match.nextPlace++;

  const field = [...match.racers.values()]
    .sort((a, b) => a.place - b.place)
    .map((r) => ({
      name: r.name,
      place: r.place,
      bot: r.bot,
      timeS: r.finished ? r.finishTime : null,
    }));
  for (const racer of match.racers.values()) {
    const meta = ctx.players.get(racer.pid);
    if (meta && !racer.bot && !racer.left) {
      addHcResult(meta, racer.place === 1, racer.finished ? racer.finishTime : null);
    }
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
