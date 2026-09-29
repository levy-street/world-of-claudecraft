// Fire and Fly: the pure turret-defense engine. Private monsters built from real
// templates march on an immobile turret; a ground-aimed cannon damages and throws
// them. The state is plain data (JSON-safe, cloned per revision by a reader); no
// SimContext, no world rng: every draw is a stateless private one.

import {
  TURRET_ARENA,
  TURRET_PHYSICS,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../content/turret_defense';
import { DT, TICK_RATE, type Vec3 } from '../types';
import {
  blastFalloff,
  type FlySegment,
  groundOr,
  launchVelocity,
  type MotionSegment,
  marchSegment,
  planFlight,
  positionAt,
  resolveFlightEnd,
  rotateDir,
  stillSegment,
  sweepCylinder,
  type ThrowProbe,
  throwDirection,
  velocityAt,
  waterSurfaceOr,
} from './thrown_body';
import { resolveTurretBowling } from './turret_bowling';
import type { TurretKind, TurretPlan } from './turret_defense_plan';
import { TURRET_STREAM, turretDraw } from './turret_defense_rng';

export type TurretPhase = 'intro' | 'wave' | 'between' | 'won' | 'lost';

export type TurretMonsterState =
  | 'march'
  | 'windup'
  | 'fly'
  | 'skid'
  | 'down'
  | 'rise'
  | 'dead'
  | 'gone';

export interface TurretMonster {
  id: number;
  /** Index into plan.kinds. */
  kind: number;
  hp: number;
  maxHp: number;
  /**
   * The action in progress. When the session is lost (`phase === 'lost'` is the
   * frozen flag) every monster holds a still segment and keeps the label it was
   * frozen in, as its pose for the result view.
   */
  state: TurretMonsterState;
  seg: MotionSegment;
  facing: number;
  /** Tick the current airborne spell began (juggles extend it), -1 when grounded. */
  airSince: number;
  throwX: number;
  throwZ: number;
  /** The latest throw has not touched the ground yet (its distance is still unmeasured). */
  throwOpen: boolean;
  /** Ids this body met in its current flight (bowling): each pair knocks at most once per flight. */
  knocked: number[];
}

export interface TurretShot {
  id: number;
  x: number;
  z: number;
  damage: number;
  firedTick: number;
  impactTick: number;
}

export interface TurretStats {
  shots: number;
  hits: number;
  kills: number;
  breaches: number;
  pointsLost: number;
  /** Yards from a launch point to that throw's first ground contact. */
  longestThrow: number;
  /** Seconds from a launch to the first ground contact (juggles extend it). */
  longestAirtime: number;
  /** Grounded monsters knocked over by a flying body. */
  bowled: number;
}

export interface TurretDefenseState {
  plan: TurretPlan;
  seed: number;
  cx: number;
  cz: number;
  startTick: number;
  /**
   * The session clock (last tick processed). It advances on every call and sits
   * outside the revision: a reader never keys a cache on it.
   */
  tick: number;
  /** Bumped by every change of content (spawns, transitions, shots, impacts, phases). */
  rev: number;
  phase: TurretPhase;
  phaseEndTick: number;
  wave: number;
  spawnCursor: number;
  nextSpawnTick: number;
  integrity: number;
  readyTick: number;
  /** Unit direction of the last aim, reused when an aim point sits on the center. */
  aimX: number;
  aimZ: number;
  nextShotId: number;
  nextMonsterId: number;
  shots: TurretShot[];
  monsters: TurretMonster[];
  stats: TurretStats;
}

export interface TurretHit {
  id: number;
  falloff: number;
  damage: number;
  /** Where the struck body stood at the impact tick. */
  x: number;
  y: number;
  z: number;
}

export type TurretEvent =
  | {
      type: 'fired';
      shotId: number;
      fromX: number;
      fromZ: number;
      x: number;
      y: number;
      z: number;
      flightTicks: number;
      impactTick: number;
    }
  | { type: 'impact'; shotId: number; x: number; y: number; z: number; hits: TurretHit[] }
  | {
      type: 'launched';
      id: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
    }
  | {
      type: 'bounce';
      id: number;
      surface: 'ground' | 'wall';
      x: number;
      y: number;
      z: number;
      speed: number;
    }
  | { type: 'landed'; id: number; x: number; y: number; z: number }
  | {
      /** A flying body knocked a grounded one at the struck body's feet; `speed` is the flyer's across. */
      type: 'bowled';
      flyerId: number;
      struckId: number;
      x: number;
      y: number;
      z: number;
      speed: number;
      /** The knock's damage, before the struck body's health floors it at 0. */
      damage: number;
    }
  | { type: 'splash'; id: number; x: number; y: number; z: number }
  | { type: 'killed'; id: number; x: number; y: number; z: number }
  | { type: 'windupStart'; id: number; x: number; z: number }
  | {
      type: 'breach';
      id: number;
      points: number;
      integrity: number;
      x: number;
      y: number;
      z: number;
    }
  | { type: 'vanished'; id: number; x: number; y: number; z: number }
  | { type: 'waveStart'; wave: number; count: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'ended'; result: 'won' | 'lost'; stats: TurretStats };

export type TurretFireRefusal = 'ended' | 'cooldown' | 'invalid';

export type TurretFireOutcome =
  | { ok: true; shot: TurretShot; events: TurretEvent[] }
  | { ok: false; reason: TurretFireRefusal; events: TurretEvent[] };

/** Bounds the transitions one monster may chain inside a single tick. */
const MAX_TRANSITIONS_PER_TICK = 32;

export function createTurretDefense(
  plan: TurretPlan,
  center: { x: number; z: number },
  seed: number,
  startTick: number,
): TurretDefenseState {
  return {
    plan,
    seed: seed >>> 0,
    cx: center.x,
    cz: center.z,
    startTick,
    tick: startTick,
    rev: 0,
    phase: 'intro',
    phaseEndTick: startTick + TURRET_TIMING.introTicks,
    wave: 0,
    spawnCursor: 0,
    nextSpawnTick: startTick,
    integrity: TURRET_TIMING.integrity,
    readyTick: startTick,
    aimX: 0,
    aimZ: 1,
    nextShotId: 1,
    nextMonsterId: 1,
    shots: [],
    monsters: [],
    stats: {
      shots: 0,
      hits: 0,
      kills: 0,
      breaches: 0,
      pointsLost: 0,
      longestThrow: 0,
      longestAirtime: 0,
      bowled: 0,
    },
  };
}

/** Points a completed strike costs: the breach value scaled by remaining health, at least 1. */
export function turretBreachPoints(breachValue: number, hp: number, maxHp: number): number {
  return Math.max(1, Math.ceil((breachValue * hp) / maxHp));
}

/** What stands between the turret and the end of the current wave: the living
 *  monsters plus the wave's unspawned ones. */
export function turretMonstersLeft(state: TurretDefenseState): number {
  const wave = state.phase === 'wave' ? currentWave(state) : undefined;
  let left = wave ? wave.spawns.length - state.spawnCursor : 0;
  for (const m of state.monsters) if (m.hp > 0) left++;
  return left;
}

export function turretStrikeDistance(kind: TurretKind): number {
  return TURRET_ARENA.breachRadius + kind.radius;
}

/** Shell flight in ticks for an aim distance already clamped to the weapon's range. */
export function turretShellFlightTicks(range: number): number {
  const ticks = Math.round((range / TURRET_WEAPON.shellSpeed) * TICK_RATE);
  return Math.min(TURRET_WEAPON.maxFlightTicks, Math.max(TURRET_WEAPON.minFlightTicks, ticks));
}

function bump(state: TurretDefenseState): void {
  state.rev++;
}

// A call, not an inline comparison: the phase changes inside calls TypeScript cannot see through.
function isLost(state: TurretDefenseState): boolean {
  return state.phase === 'lost';
}

function facingToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function currentWave(state: TurretDefenseState): TurretPlan['waves'][number] | undefined {
  return state.plan.waves[state.wave];
}

export function fireTurret(
  state: TurretDefenseState,
  tick: number,
  x: number,
  z: number,
  probe: ThrowProbe,
): TurretFireOutcome {
  if (state.phase === 'won' || state.phase === 'lost')
    return { ok: false, reason: 'ended', events: [] };
  if (!Number.isFinite(x) || !Number.isFinite(z))
    return { ok: false, reason: 'invalid', events: [] };
  if (tick < state.readyTick) return { ok: false, reason: 'cooldown', events: [] };
  const dx = x - state.cx;
  const dz = z - state.cz;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-6) {
    state.aimX = dx / dist;
    state.aimZ = dz / dist;
  }
  const range = Math.min(TURRET_WEAPON.maxRange, Math.max(TURRET_WEAPON.minRange, dist));
  const tx = state.cx + state.aimX * range;
  const tz = state.cz + state.aimZ * range;
  const flightTicks = turretShellFlightTicks(range);
  const wave = state.plan.waves[Math.min(state.wave, state.plan.waves.length - 1)];
  const shot: TurretShot = {
    id: state.nextShotId++,
    x: tx,
    z: tz,
    damage: wave ? wave.coreDamage : 0,
    firedTick: tick,
    impactTick: tick + flightTicks,
  };
  state.shots.push(shot);
  state.readyTick = tick + TURRET_WEAPON.cooldownTicks;
  state.stats.shots++;
  bump(state);
  return {
    ok: true,
    shot: { ...shot },
    events: [
      {
        type: 'fired',
        shotId: shot.id,
        fromX: state.cx,
        fromZ: state.cz,
        x: tx,
        y: groundOr(probe, tx, tz, 0),
        z: tz,
        flightTicks,
        impactTick: shot.impactTick,
      },
    ],
  };
}

/** Advances the session to `tick` (one call per sim tick). Lost sessions stay frozen. */
export function tickTurretDefense(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
): TurretEvent[] {
  const events: TurretEvent[] = [];
  if (!(tick > state.tick) || state.phase === 'lost') return events;
  state.tick = tick;
  const world = withTurretBody(state, probe);
  if ((state.phase === 'intro' || state.phase === 'between') && tick >= state.phaseEndTick) {
    startWave(state, tick, events);
  }
  // Knocks along the segments as they stood, then on the pairs this tick's
  // transitions renewed (a bounce is the lowest, likeliest moment to knock).
  resolveTurretBowling(state, tick - 1, tick, Number.NEGATIVE_INFINITY, world, events);
  if (state.phase === 'wave') spawnDue(state, tick, world);
  // Bodies catch up to this tick before the shells land (a juggle must not add the
  // velocity of a flight that already touched down), but a completing windup waits:
  // a shot landing on the tick a strike would land still saves the turret.
  advanceMonsters(state, tick, world, events, true);
  if (!isLost(state)) {
    resolveTurretBowling(state, tick - 1, tick, tick - 1, world, events);
    resolveImpacts(state, tick, world, events);
  }
  advanceMonsters(state, tick, world, events, false);
  if (state.phase === 'wave') checkWaveCleared(state, tick, events);
  return events;
}

/** The caller's probe plus the cannon tower's own body as a swept obstacle. */
function withTurretBody(state: TurretDefenseState, probe: ThrowProbe): ThrowProbe {
  const top = groundOr(probe, state.cx, state.cz, 0) + TURRET_ARENA.turretHeight;
  return {
    ground: (x, z) => probe.ground(x, z),
    water: (x, z) => probe.water(x, z),
    sweep: (fx, fz, tx, tz, radius, fromY, toY) => {
      const tower = sweepCylinder(
        state.cx,
        state.cz,
        TURRET_ARENA.turretRadius + radius,
        top,
        fx,
        fz,
        tx,
        tz,
        fromY,
        toY,
      );
      const world = probe.sweep ? probe.sweep(fx, fz, tx, tz, radius, fromY, toY) : null;
      if (!world?.blocked) return tower;
      if (!tower.blocked) return world;
      const toTower = Math.hypot(tower.x - fx, tower.z - fz);
      return toTower <= Math.hypot(world.x - fx, world.z - fz) ? tower : world;
    },
  };
}

function startWave(state: TurretDefenseState, tick: number, events: TurretEvent[]): void {
  if (state.phase === 'between') state.wave++;
  const wave = currentWave(state);
  bump(state);
  if (!wave) {
    win(state, events);
    return;
  }
  state.phase = 'wave';
  state.spawnCursor = 0;
  state.nextSpawnTick = tick;
  events.push({ type: 'waveStart', wave: state.wave, count: wave.spawns.length });
}

function spawnDue(state: TurretDefenseState, tick: number, probe: ThrowProbe): void {
  const wave = currentWave(state);
  if (!wave) return;
  while (state.spawnCursor < wave.spawns.length && tick >= state.nextSpawnTick) {
    const kindIndex = wave.spawns[state.spawnCursor++];
    const kind = state.plan.kinds[kindIndex];
    const id = state.nextMonsterId++;
    const angle = turretDraw(state.seed, TURRET_STREAM.spawnAngle, id) * 2 * Math.PI;
    const x = state.cx + Math.sin(angle) * TURRET_ARENA.spawnRadius;
    const z = state.cz + Math.cos(angle) * TURRET_ARENA.spawnRadius;
    const span = wave.gapMaxTicks - wave.gapMinTicks + 1;
    const gap =
      wave.gapMinTicks + Math.floor(turretDraw(state.seed, TURRET_STREAM.spawnGap, id) * span);
    state.nextSpawnTick = tick + gap;
    state.monsters.push({
      id,
      kind: kindIndex,
      hp: kind.maxHp,
      maxHp: kind.maxHp,
      state: 'march',
      seg: marchSegment(
        tick,
        x,
        groundOr(probe, x, z, 0),
        z,
        state.cx,
        state.cz,
        kind.marchSpeed,
        turretStrikeDistance(kind),
      ),
      facing: facingToward(x, z, state.cx, state.cz),
      airSince: -1,
      throwX: x,
      throwZ: z,
      throwOpen: false,
      knocked: [],
    });
    bump(state);
  }
}

function resolveImpacts(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  if (!state.shots.length) return;
  let kept = 0;
  for (const shot of state.shots) {
    if (shot.impactTick > tick) state.shots[kept++] = shot;
    else detonate(state, shot, tick, probe, events);
  }
  state.shots.length = kept;
}

function detonate(
  state: TurretDefenseState,
  shot: TurretShot,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const hits: TurretHit[] = [];
  events.push({
    type: 'impact',
    shotId: shot.id,
    x: shot.x,
    y: groundOr(probe, shot.x, shot.z, 0),
    z: shot.z,
    hits,
  });
  for (const m of state.monsters) {
    if (m.hp <= 0 || m.state === 'gone') continue;
    const p = positionAt(m.seg, tick, probe);
    const falloff = blastFalloff(
      Math.hypot(p.x - shot.x, p.z - shot.z),
      TURRET_WEAPON.blastRadius,
      TURRET_WEAPON.blastCore,
    );
    if (!(falloff > 0)) continue;
    const damage = Math.max(1, Math.round(shot.damage * falloff));
    m.hp = Math.max(0, m.hp - damage);
    hits.push({ id: m.id, falloff, damage, x: p.x, y: p.y, z: p.z });
    launch(state, m, shot, falloff, p, tick, probe, events);
    if (m.hp <= 0) {
      state.stats.kills++;
      events.push({ type: 'killed', id: m.id, x: p.x, y: p.y, z: p.z });
    }
  }
  if (hits.length) state.stats.hits++;
  bump(state);
}

function launch(
  state: TurretDefenseState,
  m: TurretMonster,
  shot: TurretShot,
  falloff: number,
  p: Vec3,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const kind = state.plan.kinds[m.kind];
  const base = throwDirection(
    shot.x,
    shot.z,
    p.x,
    p.z,
    state.cx,
    state.cz,
    TURRET_WEAPON.deadCenter,
  );
  const spread = turretDraw(state.seed, TURRET_STREAM.throwDeviation, shot.id, m.id) * 2 - 1;
  const dir = rotateDir(base.x, base.z, spread * TURRET_WEAPON.deviation);
  const v = launchVelocity(
    falloff,
    kind.mass,
    dir.x,
    dir.z,
    TURRET_WEAPON.push,
    TURRET_WEAPON.pop,
    TURRET_WEAPON.massExponent,
  );
  // Only a body already in motion from a throw carries its velocity into the new
  // one (juggling); a marcher's walk would make a hit's throw depend on its heading.
  if (m.state === 'fly' || m.state === 'skid') {
    const cur = velocityAt(m.seg, tick);
    v.x += cur.x;
    v.y += cur.y;
    v.z += cur.z;
  }
  const horizontal = Math.hypot(v.x, v.z);
  if (horizontal > TURRET_WEAPON.maxLaunchSpeed) {
    v.x *= TURRET_WEAPON.maxLaunchSpeed / horizontal;
    v.z *= TURRET_WEAPON.maxLaunchSpeed / horizontal;
  }
  v.y = Math.min(v.y, TURRET_WEAPON.maxLaunchLift);
  if (m.state !== 'fly') m.knocked = [];
  m.seg = planFlight(tick, p.x, p.y, p.z, v, kind.radius, probe, TURRET_PHYSICS);
  m.state = 'fly';
  if (m.airSince < 0) m.airSince = tick;
  m.throwX = p.x;
  m.throwZ = p.z;
  m.throwOpen = true;
  m.facing = Math.atan2(-dir.x, -dir.z);
  events.push({ type: 'launched', id: m.id, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z });
}

function advanceMonsters(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
  holdWindup: boolean,
): void {
  if (state.phase === 'lost') return;
  for (const m of state.monsters) {
    for (let n = 0; n < MAX_TRANSITIONS_PER_TICK; n++) {
      if (m.state === 'gone' || m.seg.end > tick) break;
      if (holdWindup && m.state === 'windup') break;
      transition(state, m, probe, events);
      bump(state);
      if (isLost(state)) {
        freeze(state, tick, probe);
        return;
      }
    }
  }
  pruneGone(state);
}

function pruneGone(state: TurretDefenseState): void {
  if (state.monsters.some((m) => m.state === 'gone')) {
    state.monsters = state.monsters.filter((m) => m.state !== 'gone');
  }
}

function transition(
  state: TurretDefenseState,
  m: TurretMonster,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const kind = state.plan.kinds[m.kind];
  const at = m.seg.end;
  switch (m.state) {
    case 'march': {
      const p = positionAt(m.seg, at, probe);
      m.state = 'windup';
      m.seg = stillSegment(at, TURRET_TIMING.windupTicks, p);
      m.facing = facingToward(p.x, p.z, state.cx, state.cz);
      events.push({ type: 'windupStart', id: m.id, x: p.x, z: p.z });
      return;
    }
    case 'windup': {
      const p = positionAt(m.seg, at, probe);
      const points = turretBreachPoints(kind.breachValue, m.hp, m.maxHp);
      state.integrity = Math.max(0, state.integrity - points);
      state.stats.breaches++;
      state.stats.pointsLost += points;
      m.state = 'gone';
      events.push({
        type: 'breach',
        id: m.id,
        points,
        integrity: state.integrity,
        x: p.x,
        y: p.y,
        z: p.z,
      });
      if (state.integrity <= 0) lose(state, events);
      return;
    }
    case 'fly':
      if (m.seg.kind === 'fly') endFlight(state, m, m.seg, kind, probe, events);
      return;
    case 'skid': {
      const p = positionAt(m.seg, at, probe);
      if (m.seg.kind === 'skid' && m.seg.contact === 'water') {
        splash(state, m, { x: p.x, y: waterSurfaceOr(probe, p.x, p.z, p.y), z: p.z }, events);
      } else rest(state, m, kind, at, p, probe);
      return;
    }
    case 'down':
      m.state = 'rise';
      m.seg = stillSegment(at, TURRET_TIMING.riseTicks, positionAt(m.seg, at, probe));
      return;
    case 'rise': {
      const p = positionAt(m.seg, at, probe);
      m.state = 'march';
      m.seg = marchSegment(
        at,
        p.x,
        p.y,
        p.z,
        state.cx,
        state.cz,
        kind.marchSpeed,
        turretStrikeDistance(kind),
      );
      m.facing = facingToward(p.x, p.z, state.cx, state.cz);
      return;
    }
    case 'dead':
      m.state = 'gone';
      return;
    case 'gone':
      return;
  }
}

function endFlight(
  state: TurretDefenseState,
  m: TurretMonster,
  seg: FlySegment,
  kind: TurretKind,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const out = resolveFlightEnd(seg, kind.radius, probe, TURRET_PHYSICS);
  const p = { x: out.x, y: out.y, z: out.z };
  if (out.kind === 'wall') {
    m.seg = out.seg;
    events.push({ type: 'bounce', id: m.id, surface: 'wall', ...p, speed: out.speed });
    return;
  }
  if (out.kind === 'void') {
    m.state = 'gone';
    events.push({ type: 'vanished', id: m.id, ...p });
    return;
  }
  touchGround(state, m, p.x, p.z, seg.end);
  switch (out.kind) {
    case 'bounce':
      m.seg = out.seg;
      events.push({ type: 'bounce', id: m.id, surface: 'ground', ...p, speed: out.speed });
      return;
    case 'splash':
      splash(state, m, p, events);
      return;
    case 'land':
      events.push({ type: 'landed', id: m.id, ...p });
      if (out.skid) {
        m.state = 'skid';
        m.seg = out.skid;
      } else rest(state, m, kind, seg.end, p, probe);
      return;
  }
}

function touchGround(
  state: TurretDefenseState,
  m: TurretMonster,
  x: number,
  z: number,
  at: number,
): void {
  if (m.throwOpen) {
    state.stats.longestThrow = Math.max(
      state.stats.longestThrow,
      Math.hypot(x - m.throwX, z - m.throwZ),
    );
    m.throwOpen = false;
  }
  if (m.airSince >= 0) {
    state.stats.longestAirtime = Math.max(state.stats.longestAirtime, (at - m.airSince) * DT);
    m.airSince = -1;
  }
}

function rest(
  state: TurretDefenseState,
  m: TurretMonster,
  kind: TurretKind,
  at: number,
  landed: Vec3,
  probe: ThrowProbe,
): void {
  const p = outsideStrikeRadius(state, kind, landed, probe);
  if (m.hp <= 0) {
    m.state = 'dead';
    m.seg = stillSegment(at, TURRET_TIMING.corpseTicks, p);
  } else {
    m.state = 'down';
    m.seg = stillSegment(at, TURRET_TIMING.downTicks, p);
  }
}

/** A body never rests inside the strike radius (the tower's footprint lies within it). */
function outsideStrikeRadius(
  state: TurretDefenseState,
  kind: TurretKind,
  p: Vec3,
  probe: ThrowProbe,
): Vec3 {
  const dx = p.x - state.cx;
  const dz = p.z - state.cz;
  const d = Math.hypot(dx, dz);
  const reach = turretStrikeDistance(kind);
  if (d >= reach) return p;
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 1;
  const x = state.cx + ux * reach;
  const z = state.cz + uz * reach;
  return { x, y: groundOr(probe, x, z, p.y), z };
}

function splash(state: TurretDefenseState, m: TurretMonster, p: Vec3, events: TurretEvent[]): void {
  events.push({ type: 'splash', id: m.id, x: p.x, y: p.y, z: p.z });
  if (m.hp > 0) {
    m.hp = 0;
    state.stats.kills++;
    events.push({ type: 'killed', id: m.id, x: p.x, y: p.y, z: p.z });
  }
  m.state = 'gone';
}

function checkWaveCleared(state: TurretDefenseState, tick: number, events: TurretEvent[]): void {
  const wave = currentWave(state);
  if (wave && state.spawnCursor < wave.spawns.length) return;
  if (state.monsters.some((m) => m.hp > 0)) return;
  events.push({ type: 'waveCleared', wave: state.wave });
  bump(state);
  if (state.wave >= state.plan.waves.length - 1) {
    win(state, events);
    return;
  }
  state.phase = 'between';
  state.phaseEndTick = tick + TURRET_TIMING.betweenTicks;
}

function win(state: TurretDefenseState, events: TurretEvent[]): void {
  state.phase = 'won';
  events.push({ type: 'ended', result: 'won', stats: { ...state.stats } });
}

function lose(state: TurretDefenseState, events: TurretEvent[]): void {
  state.phase = 'lost';
  state.shots = [];
  events.push({ type: 'ended', result: 'lost', stats: { ...state.stats } });
}

/** A lost session keeps every monster where it stands (mid-air included) for the result view. */
function freeze(state: TurretDefenseState, tick: number, probe: ThrowProbe): void {
  pruneGone(state);
  for (const m of state.monsters) m.seg = stillSegment(tick, 0, positionAt(m.seg, tick, probe));
}
