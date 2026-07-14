// Protect Yumi!: the 3v3/5v5 maze objective mode (formats 'yumi3'/'yumi5').
// Each team guards a passive 5000 hp cat familiar in the fixed competitive
// maze (src/sim/yumi_maze_layout.ts, its own far-east instance band); every 60
// seconds BOTH cats teleport simultaneously to new maze cells; the first team
// to destroy the enemy cat wins. Downed players bench for a flat 10 seconds
// (fiesta's bench primitive, never the ranked permanent elimination). At 600
// seconds sudden death latches: teleports freeze, cats take an escalating
// damage-taken multiplier plus a growing neutral bleed, and a simultaneous
// bleed kill resolves by pre-pulse hp, then total damage dealt, then the
// per-match stream, so a fought-out bout never draws. (The one draw left in
// the mode is mutual abandonment: both teams fully gone at once resolves as
// winner null in updateArena, with nobody left to see it.)
//
// Architecture: a sibling A-slice next to fiesta. Match state rides the
// ArenaMatch (`match.yumi`), the queues/slot pool/cat index stay on Sim as
// live SimContext views, and arena.ts reaches this module only through ctx
// callbacks (matchmakeYumi / updateYumiActive / yumiPlayerDown /
// yumiCatDamaged / cleanupYumiMatch) while this module imports arena.ts
// helpers directly (the fiesta -> arena direction, never the reverse).
//
// Determinism: teleport picks and the last-resort tiebreak draw from the
// PER-MATCH stream `match.yumi.rng` (fiesta's two-stream rule); nothing here
// touches the shared sim stream, so existing golden traces stay byte-identical.

import { YUMI_TEMPLATE_ID } from '../content/yumi';
import { MOBS, YUMI_MAZE_SLOT_COUNT, yumiMazeOrigin } from '../data';
import { createMob } from '../entity';
import { Rng } from '../rng';
import type { ArenaMatch, ArenaQueueUnit } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, TICK_RATE } from '../types';
import { teleportPoints, YUMI_TELEPORT_MIN_SEP, yumiMazeLayout } from '../yumi_maze_layout';
import * as arenaMod from './arena';
import { fiestaDownEntity } from './fiesta';

export const YUMI_HP = 5000;
export const YUMI_COUNTDOWN = 5; // pre-fight gate, like the ranked arena
export const YUMI_TELEPORT_EVERY = 60; // s between simultaneous relocations
export const YUMI_RESPAWN_SECONDS = 10; // flat player bench timer
export const YUMI_SUDDEN_AT = 600; // s of active play before sudden death
export const YUMI_SUDDEN_STEP = 15; // s per escalation step
export const YUMI_SUDDEN_RAMP = 0.25; // +25% cat damage taken per step
export const YUMI_SUDDEN_BLEED_PCT = 0.01; // of YUMI_HP per pulse, times the step
export const YUMI_SUDDEN_BLEED_EVERY = 2; // s between neutral bleed pulses

export type YumiFormat = 'yumi3' | 'yumi5';

export function yumiTeamSize(fmt: YumiFormat): 3 | 5 {
  return fmt === 'yumi3' ? 3 : 5;
}

export function isYumiCat(e: Entity): boolean {
  return e.kind === 'mob' && e.templateId === YUMI_TEMPLATE_ID;
}

// ---------------------------------------------------------------------------
// Hostility: the cat is a valid HOSTILE target only for the opposite team of
// its live match, and a valid FRIENDLY (heal/shield) target only for its own
// team. Outsiders, benched players, and dead controllers get false both ways.
// Consumed by Sim.isHostileTo / Sim.isFriendlyTo via two one-line arms.
// ---------------------------------------------------------------------------

export function yumiCatHostileTo(ctx: SimContext, attacker: Entity, cat: Entity): boolean {
  const match = ctx.yumiCatMatches.get(cat.id);
  if (!match?.yumi || match.state !== 'active') return false;
  const controller = ctx.pvpController(attacker);
  if (!controller || controller.dead) return false;
  const team = ctx.arenaTeamOf(match, controller.id);
  if (!team) return false;
  if (ctx.arenaIsDown(match, controller.id)) return false;
  const catTeam = match.yumi.yumiA === cat.id ? 'A' : 'B';
  return team !== catTeam;
}

export function yumiCatFriendlyTo(ctx: SimContext, caster: Entity, cat: Entity): boolean {
  const match = ctx.yumiCatMatches.get(cat.id);
  // Healing/shielding the cat during the countdown is fine; 'over' is not.
  if (!match?.yumi || match.state === 'over') return false;
  const controller = ctx.pvpController(caster);
  if (!controller) return false;
  const team = ctx.arenaTeamOf(match, controller.id);
  if (!team) return false;
  const catTeam = match.yumi.yumiA === cat.id ? 'A' : 'B';
  return team === catTeam;
}

// ---------------------------------------------------------------------------
// Queue + matchmaking. Premade units of any size 1..teamSize pool FIFO
// first-fit in join order (join order IS the fairness rule, like the existing
// queues); rating is bookkept on the 2v2 bracket number purely for the queue
// unit shape (yumi is unranked, the number never moves a ladder).
// ---------------------------------------------------------------------------

function yumiQueue(ctx: SimContext, fmt: YumiFormat): ArenaQueueUnit[] {
  return fmt === 'yumi3' ? ctx.arenaQueueYumi3 : ctx.arenaQueueYumi5;
}

export function pruneYumiQueue(ctx: SimContext, fmt: YumiFormat): void {
  const keep = (unit: ArenaQueueUnit) =>
    unit.pids.every((id) => {
      const e = ctx.entities.get(id);
      return !!e && !e.dead && !ctx.arenaMatches.has(id);
    });
  if (fmt === 'yumi3') ctx.arenaQueueYumi3 = ctx.arenaQueueYumi3.filter(keep);
  else ctx.arenaQueueYumi5 = ctx.arenaQueueYumi5.filter(keep);
}

export function freeYumiSlot(ctx: SimContext): number | null {
  for (let i = 0; i < YUMI_MAZE_SLOT_COUNT; i++) {
    if (!ctx.yumiBusySlots.has(i)) return i;
  }
  return null;
}

// FIFO first-fit packing: walk the queue in join order, seat each unit on the
// first team with room (A then B). Returns null until both teams fill. Pure
// and rng-free, so matchmaking never moves any stream.
export function packYumiTeams(
  queue: readonly ArenaQueueUnit[],
  size: number,
): { a: ArenaQueueUnit[]; b: ArenaQueueUnit[] } | null {
  const a: ArenaQueueUnit[] = [];
  const b: ArenaQueueUnit[] = [];
  let na = 0;
  let nb = 0;
  for (const u of queue) {
    if (na + u.pids.length <= size) {
      a.push(u);
      na += u.pids.length;
    } else if (nb + u.pids.length <= size) {
      b.push(u);
      nb += u.pids.length;
    }
    if (na === size && nb === size) return { a, b };
  }
  return null;
}

export function matchmakeYumi(ctx: SimContext): void {
  matchmakeYumiFormat(ctx, 'yumi3');
  matchmakeYumiFormat(ctx, 'yumi5');
}

export function matchmakeYumiFormat(ctx: SimContext, fmt: YumiFormat): void {
  const size = yumiTeamSize(fmt);
  let guard = YUMI_MAZE_SLOT_COUNT + 1;
  while (guard-- > 0) {
    pruneYumiQueue(ctx, fmt);
    if (freeYumiSlot(ctx) === null) return;
    const queue = yumiQueue(ctx, fmt);
    const teams = packYumiTeams(queue, size);
    if (!teams) return;
    for (const unit of [...teams.a, ...teams.b]) {
      const i = queue.indexOf(unit);
      if (i >= 0) queue.splice(i, 1);
    }
    startYumiMatch(
      ctx,
      fmt,
      teams.a.flatMap((u) => u.pids),
      teams.b.flatMap((u) => u.pids),
    );
  }
}

// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------

export function startYumiMatch(
  ctx: SimContext,
  format: YumiFormat,
  teamA: number[],
  teamB: number[],
): void {
  const slot = freeYumiSlot(ctx);
  const allPids = [...teamA, ...teamB];
  const entities = allPids.map((pid) => ctx.entities.get(pid));
  const metas = allPids.map((pid) => ctx.players.get(pid));
  if (slot === null || entities.some((e) => !e) || metas.some((m) => !m)) {
    const queue = yumiQueue(ctx, format);
    const okA = teamA.every((pid) => ctx.entities.get(pid) && !ctx.arenaMatches.has(pid));
    const okB = teamB.every((pid) => ctx.entities.get(pid) && !ctx.arenaMatches.has(pid));
    if (okB) queue.unshift({ pids: teamB, rating: arenaMod.arenaTeamRating(ctx, teamB, '2v2') });
    if (okA) queue.unshift({ pids: teamA, rating: arenaMod.arenaTeamRating(ctx, teamA, '2v2') });
    return;
  }
  ctx.yumiBusySlots.add(slot);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  for (let i = 0; i < allPids.length; i++) {
    const e = entities[i]!;
    returns.set(allPids[i], { x: e.pos.x, z: e.pos.z, facing: e.facing });
  }
  const matchId = ctx.nextArenaMatchId++;
  const layout = yumiMazeLayout();
  const origin = yumiMazeOrigin(slot);

  // Both cats spawn at the same mean participant level so hit tables stay
  // symmetric; hp is the flat objective pool either way (hpPerLevel 0).
  const catLevel = Math.max(
    1,
    Math.round(
      allPids.reduce((s, pid) => s + (ctx.entities.get(pid)?.level ?? 1), 0) / allPids.length,
    ),
  );
  const template = MOBS[YUMI_TEMPLATE_ID];
  const spawnCat = (start: { x: number; z: number }): Entity => {
    const cat = createMob(
      ctx.nextId++,
      template,
      catLevel,
      ctx.groundPos(origin.x + start.x, origin.z + start.z),
    );
    cat.hostile = false; // team hostility comes from yumiCatHostileTo, never the flag
    cat.maxHp = YUMI_HP;
    cat.hp = YUMI_HP;
    ctx.addEntity(cat);
    return cat;
  };
  const catA = spawnCat(layout.yumiStartA);
  const catB = spawnCat(layout.yumiStartB);

  const match: ArenaMatch = {
    id: matchId,
    format,
    teamA,
    teamB,
    slot,
    state: 'countdown',
    timer: YUMI_COUNTDOWN,
    returns,
    ratingA: arenaMod.arenaTeamRating(ctx, teamA, '2v2'),
    ratingB: arenaMod.arenaTeamRating(ctx, teamB, '2v2'),
    defeated: new Set(),
    yumi: {
      teamSize: yumiTeamSize(format),
      yumiA: catA.id,
      yumiB: catB.id,
      nextTeleportAt: YUMI_TELEPORT_EVERY,
      suddenDeath: false,
      respawn: new Map(),
      deaths: new Map(),
      kills: new Map(),
      dmgToYumiA: 0,
      dmgToYumiB: 0,
      lastStatusSecond: -1,
      // Per-match deterministic stream (the fiesta two-stream rule; seeded
      // off the sim clock + this match's own id): teleport picks + the
      // tiebreak coin never touch the shared draw order.
      rng: new Rng((ctx.tickCount * 2654435761 + matchId * 40503) >>> 0),
    },
  };
  for (const pid of allPids) ctx.arenaMatches.set(pid, match);
  ctx.yumiCatMatches.set(catA.id, match);
  ctx.yumiCatMatches.set(catB.id, match);
  arenaMod.placeTeamInArena(ctx, teamA, origin, layout.spawnA);
  arenaMod.placeTeamInArena(ctx, teamB, origin, layout.spawnB);
  for (const e of entities) ctx.resetForArena(e!);
  arenaMod.emitArenaFound(ctx, match);
  for (const mPid of allPids) {
    ctx.emit({ type: 'arenaCountdown', seconds: YUMI_COUNTDOWN, pid: mPid });
    ctx.emit({
      type: 'log',
      text: 'Protect Yumi! Defend your familiar and hunt theirs.',
      color: '#7fd7ff',
      pid: mPid,
    });
  }
}

// Escalation step count for an active timer (0 before sudden death).
function suddenStep(timer: number): number {
  if (timer < YUMI_SUDDEN_AT) return 0;
  return 1 + Math.floor((timer - YUMI_SUDDEN_AT) / YUMI_SUDDEN_STEP);
}

// Damage-taken multiplier on both cats: 1.0 until sudden death, then
// 1 + 0.25 per 15s step (1.25x at 10:00, 1.5x at 10:15, 2x at 10:45, ...).
export function yumiTakenMult(timer: number): number {
  const n = suddenStep(timer);
  return n === 0 ? 1 : 1 + YUMI_SUDDEN_RAMP * n;
}

// Pick two teleport point indexes from the per-match stream: never the same
// point, and at least minSep yards apart when the point set allows it (the
// cats may land close, never overlapping). Always draws EXACTLY two values so
// the per-match draw count is invariant of geometry.
export function pickYumiCells(
  rng: Rng,
  points: readonly { x: number; z: number }[],
  minSep: number,
): { a: number; b: number } {
  const a = Math.floor(rng.next() * points.length);
  const roll = rng.next();
  const minSq = minSep * minSep;
  const ok: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === a) continue;
    const dx = points[i].x - points[a].x;
    const dz = points[i].z - points[a].z;
    if (dx * dx + dz * dz >= minSq) ok.push(i);
  }
  const b =
    ok.length > 0
      ? ok[Math.floor(roll * ok.length)]
      : (a + Math.max(1, points.length >> 1)) % points.length;
  return { a, b };
}

function teleportYumis(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  const pts = teleportPoints(yumiMazeLayout());
  const origin = yumiMazeOrigin(match.slot);
  const picked = pickYumiCells(y.rng, pts, YUMI_TELEPORT_MIN_SEP);
  for (const [catId, idx] of [
    [y.yumiA, picked.a],
    [y.yumiB, picked.b],
  ] as const) {
    const cat = ctx.entities.get(catId);
    if (!cat || cat.dead) continue;
    const fromX = cat.pos.x;
    const fromZ = cat.pos.z;
    const p = pts[idx];
    cat.pos = ctx.groundPos(origin.x + p.x, origin.z + p.z);
    cat.prevPos = { ...cat.pos }; // a teleport, not a walk: no interpolation source
    ctx.rebucket(cat);
    // Personal per participant: an anchor-less world event would broadcast
    // realm-wide (server eventAnchor returns null for it), and only the ten
    // fighters can see the maze anyway.
    for (const mPid of ctx.arenaAllPids(match)) {
      ctx.emit({
        type: 'yumiTeleport',
        catId,
        fromX,
        fromZ,
        toX: cat.pos.x,
        toZ: cat.pos.z,
        pid: mPid,
      });
    }
  }
}

export function updateYumiActive(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  // A member whose entity vanished (disconnect) benches indefinitely; the
  // whole-team-missing forfeit stays in updateArena.
  for (const pid of ctx.arenaAllPids(match)) {
    if (!ctx.entities.get(pid) && !y.respawn.has(pid)) y.respawn.set(pid, Infinity);
  }
  // Sudden death latches once: teleports freeze, the ramp + bleed begin.
  if (!y.suddenDeath && match.timer >= YUMI_SUDDEN_AT) {
    y.suddenDeath = true;
    for (const mPid of ctx.arenaAllPids(match)) ctx.emit({ type: 'yumiSuddenDeath', pid: mPid });
  }
  // Simultaneous relocation, both cats on the same tick.
  if (!y.suddenDeath && match.timer >= y.nextTeleportAt) {
    y.nextTeleportAt += YUMI_TELEPORT_EVERY;
    teleportYumis(ctx, match);
  }
  // Neutral bleed pulse: guarantees an ending; may decide the match.
  if (y.suddenDeath && ctx.tickCount % (YUMI_SUDDEN_BLEED_EVERY * TICK_RATE) === 0) {
    pulseSuddenDeathBleed(ctx, match);
    if (match.state !== 'active') return;
  }
  // Flat 10s respawn countdowns (fiesta's loop shape). A missing entity keeps
  // its bench entry; a reconnected one restarts at the normal timer.
  for (const [pid, t] of [...y.respawn]) {
    const e = ctx.entities.get(pid);
    if (!e) continue;
    if (t === Infinity) {
      y.respawn.set(pid, YUMI_RESPAWN_SECONDS);
      continue;
    }
    const nt = t - DT;
    if (nt <= 0) yumiRevive(ctx, match, e);
    else y.respawn.set(pid, nt);
  }
  // Once-per-second scoreboard heartbeat on whole-second edges (never per tick).
  const sec = Math.floor(match.timer);
  if (sec !== y.lastStatusSecond) {
    y.lastStatusSecond = sec;
    emitYumiStatus(ctx, match);
  }
}

function killYumiCat(ctx: SimContext, match: ArenaMatch, cat: Entity, killer: Entity | null): void {
  cat.hp = 0;
  cat.dead = true;
  ctx.emit({ type: 'death', entityId: cat.id, killerId: killer?.id ?? -1 });
  const catTeam = match.yumi!.yumiA === cat.id ? 'A' : 'B';
  ctx.endArenaMatch(match, catTeam === 'A' ? 'B' : 'A', 'defeat');
}

function bleedCat(ctx: SimContext, match: ArenaMatch, cat: Entity, dmg: number): void {
  if (dmg <= 0) return;
  ctx.emit({
    type: 'damage',
    sourceId: -1,
    targetId: cat.id,
    amount: dmg,
    crit: false,
    school: 'shadow',
    ability: null,
    kind: 'hit',
  });
  cat.hp -= dmg;
  if (cat.hp <= 0) killYumiCat(ctx, match, cat, null);
}

function pulseSuddenDeathBleed(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  const dmg = Math.ceil(YUMI_HP * YUMI_SUDDEN_BLEED_PCT * suddenStep(match.timer));
  const catA = ctx.entities.get(y.yumiA);
  const catB = ctx.entities.get(y.yumiB);
  const hpA = catA && !catA.dead ? catA.hp : 0;
  const hpB = catB && !catB.dead ? catB.hp : 0;
  const dieA = hpA > 0 && hpA <= dmg;
  const dieB = hpB > 0 && hpB <= dmg;
  if (dieA && dieB && catA && catB) {
    // Both would die on this pulse: no draws. Higher pre-pulse hp survives,
    // then the team that dealt more damage to the ENEMY cat, then the
    // per-match stream decides.
    const winner = resolveYumiTiebreak(y.rng, hpA, hpB, y.dmgToYumiA, y.dmgToYumiB);
    bleedCat(ctx, match, winner === 'A' ? catB : catA, winner === 'A' ? hpB : hpA);
    return;
  }
  if (catA && !catA.dead) bleedCat(ctx, match, catA, Math.min(dmg, hpA));
  if (match.state !== 'active') return;
  if (catB && !catB.dead) bleedCat(ctx, match, catB, Math.min(dmg, hpB));
}

// Pure tiebreak resolver (exported for the unit test). dmgToYumiB is damage
// team A dealt (to the enemy cat), so a larger dmgToYumiB favors team A.
export function resolveYumiTiebreak(
  rng: Rng,
  hpA: number,
  hpB: number,
  dmgToYumiA: number,
  dmgToYumiB: number,
): 'A' | 'B' {
  if (hpA !== hpB) return hpA > hpB ? 'A' : 'B';
  if (dmgToYumiA !== dmgToYumiB) return dmgToYumiB > dmgToYumiA ? 'A' : 'B';
  return rng.next() < 0.5 ? 'A' : 'B';
}

// The damage-hub arm for cat targets: owns the clamp, the sudden-death
// taken-multiplier, tiebreak bookkeeping, and win detection. Absorb shields
// and amps already resolved upstream in dealDamage.
export function yumiCatDamaged(
  ctx: SimContext,
  match: ArenaMatch,
  source: Entity | null,
  cat: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
  kind: 'hit' | 'miss' | 'dodge',
  attackAnimationStarted = false,
): void {
  if (match.state !== 'active' || cat.dead) return;
  const y = match.yumi!;
  let dmg = Math.round(amount * yumiTakenMult(match.timer));
  dmg = Math.min(dmg, cat.hp);
  const catTeam = y.yumiA === cat.id ? 'A' : 'B';
  if (catTeam === 'A') y.dmgToYumiA += dmg;
  else y.dmgToYumiB += dmg;
  cat.hp -= dmg;
  ctx.emit({
    type: 'damage',
    sourceId: source?.id ?? -1,
    targetId: cat.id,
    amount: dmg,
    crit,
    school,
    ability,
    kind,
    ...(attackAnimationStarted ? { attackAnimationStarted: true as const } : {}),
  });
  if (source && source.id !== cat.id) ctx.enterCombat(source, cat);
  if (cat.hp <= 0) killYumiCat(ctx, match, cat, source);
}

// Bench a downed fighter for the flat timer (reuses fiesta's clean-bench
// entity strip, imported, not copied).
export function yumiPlayerDown(
  ctx: SimContext,
  match: ArenaMatch,
  victim: Entity,
  killerPid: number | null,
): void {
  const y = match.yumi!;
  if (y.respawn.has(victim.id)) return;
  const killer = killerPid !== null ? (ctx.entities.get(killerPid) ?? null) : null;
  fiestaDownEntity(ctx, victim, killer);
  y.deaths.set(victim.id, (y.deaths.get(victim.id) ?? 0) + 1);
  if (killerPid !== null) {
    y.kills.set(killerPid, (y.kills.get(killerPid) ?? 0) + 1);
    const killerMeta = ctx.players.get(killerPid);
    if (killerMeta) killerMeta.counters.kills++;
  }
  y.respawn.set(victim.id, YUMI_RESPAWN_SECONDS);
  ctx.emit({ type: 'yumiDown', seconds: YUMI_RESPAWN_SECONDS, pid: victim.id });
}

export function yumiRevive(ctx: SimContext, match: ArenaMatch, e: Entity): void {
  const y = match.yumi!;
  y.respawn.delete(e.id);
  const team = ctx.arenaTeamOf(match, e.id);
  if (!team) return;
  const layout = yumiMazeLayout();
  const origin = yumiMazeOrigin(match.slot);
  const cat = ctx.entities.get(team === 'A' ? y.yumiA : y.yumiB);
  let spawn: { x: number; z: number; facing: number };
  if (cat && !cat.dead) {
    // Beside the own cat; groundPos/resolvePosition pushes the offset out of
    // any wall the cat is hugging.
    spawn = { x: cat.pos.x - origin.x + 1.5, z: cat.pos.z - origin.z + 1.5, facing: e.facing };
  } else {
    const spawns = team === 'A' ? layout.spawnA : layout.spawnB;
    const teamPids = team === 'A' ? match.teamA : match.teamB;
    const idx = Math.max(0, teamPids.indexOf(e.id));
    spawn = spawns[idx] ?? spawns[0];
  }
  arenaMod.placeInArena(ctx, e, origin, spawn);
  ctx.readyArenaFighter(e, { clearPrep: true });
  ctx.emit({ type: 'respawn', pid: e.id });
}

function emitYumiStatus(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  const catA = ctx.entities.get(y.yumiA);
  const catB = ctx.entities.get(y.yumiB);
  const hpA = catA && !catA.dead ? catA.hp : 0;
  const hpB = catB && !catB.dead ? catB.hp : 0;
  const teleportIn = y.suddenDeath ? 0 : Math.max(0, Math.ceil(y.nextTeleportAt - match.timer));
  const suddenDeathIn = y.suddenDeath ? 0 : Math.max(0, Math.ceil(YUMI_SUDDEN_AT - match.timer));
  const mult = yumiTakenMult(match.timer);
  for (const mPid of ctx.arenaAllPids(match)) {
    const team = ctx.arenaTeamOf(match, mPid);
    if (!team) continue;
    ctx.emit({
      type: 'yumiStatus',
      myHp: team === 'A' ? hpA : hpB,
      myMax: YUMI_HP,
      enemyHp: team === 'A' ? hpB : hpA,
      enemyMax: YUMI_HP,
      teleportIn,
      suddenDeathIn,
      suddenDeath: y.suddenDeath,
      mult,
      team,
      pid: mPid,
    });
  }
}

// The ArenaInfo.match.yumi presentation snapshot (IWorld YumiMatchInfo shape,
// checked structurally at the arenaInfoFor assignment site; no world_api
// import here, the sim -> world_api type edge is reserved for sim.ts).
// Offline the HUD polls this per frame; online it rides the rate-limited
// arena wire for STRUCTURE while the live per-second numbers ride the
// yumiStatus/yumiDown/yumiTeleport events.
export function yumiMatchInfo(ctx: SimContext, match: ArenaMatch, pid: number, myTeam: 'A' | 'B') {
  const y = match.yumi!;
  const catView = (catId: number) => {
    const cat = ctx.entities.get(catId);
    const alive = !!cat && !cat.dead;
    return {
      entityId: catId,
      hp: alive ? cat.hp : 0,
      maxHp: YUMI_HP,
      x: cat?.pos.x ?? 0,
      z: cat?.pos.z ?? 0,
      alive,
    };
  };
  const scoreboard = (pids: number[]) =>
    pids.map((mPid) => {
      const meta = ctx.players.get(mPid);
      return {
        pid: mPid,
        name: meta?.name ?? '?',
        cls: meta?.cls ?? ('warrior' as const),
        kills: y.kills.get(mPid) ?? 0,
        deaths: y.deaths.get(mPid) ?? 0,
        down: y.respawn.has(mPid),
        me: mPid === pid,
      };
    });
  const active = match.state === 'active';
  const phase =
    match.state === 'over'
      ? ('over' as const)
      : match.state === 'countdown'
        ? ('countdown' as const)
        : y.suddenDeath
          ? ('sudden' as const)
          : ('active' as const);
  const myRespawn = y.respawn.get(pid);
  return {
    team: myTeam,
    size: y.teamSize,
    phase,
    matchElapsed: active ? Math.floor(match.timer) : 0,
    teleportIn:
      active && !y.suddenDeath ? Math.max(0, Math.ceil(y.nextTeleportAt - match.timer)) : 0,
    suddenDeathIn:
      active && !y.suddenDeath ? Math.max(0, Math.ceil(YUMI_SUDDEN_AT - match.timer)) : 0,
    damageTakenMult: yumiTakenMult(active ? match.timer : 0),
    down: y.respawn.has(pid),
    // A disconnected teammate benches at Infinity: show 0 (no ETA) rather
    // than a non-finite number that would not survive JSON.
    respawnIn:
      myRespawn === undefined || myRespawn === Infinity ? 0 : Math.max(0, Math.ceil(myRespawn)),
    yumiA: catView(y.yumiA),
    yumiB: catView(y.yumiB),
    teamA: scoreboard(match.teamA),
    teamB: scoreboard(match.teamB),
  };
}

// Torn down from returnFromArena: drop both cat entities and clear the index.
export function cleanupYumiMatch(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  ctx.yumiCatMatches.delete(y.yumiA);
  ctx.yumiCatMatches.delete(y.yumiB);
  if (ctx.entities.get(y.yumiA)) ctx.dropEntity(y.yumiA);
  if (ctx.entities.get(y.yumiB)) ctx.dropEntity(y.yumiB);
}
