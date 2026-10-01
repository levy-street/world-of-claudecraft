// Fire and Fly: the pure turret-defense engine. Private monsters built from real
// templates march on an immobile turret; a ground-aimed cannon damages and throws
// them. The state is plain data (JSON-safe, cloned per revision by a reader); no
// SimContext, no world rng: every draw is a stateless private one.

import {
  TURRET_ARENA,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_PHYSICS,
  TURRET_TIMING,
  TURRET_WEAPON,
} from '../content/turret_defense';
import { deepFreeze } from '../deep_freeze';
import { DT, type PrivateSalt, TICK_RATE, type Vec3 } from '../types';
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
  type SweepResult,
  stillSegment,
  sweepCylinder,
  type ThrowProbe,
  throwDirection,
  velocityAt,
  waterSurfaceOr,
} from './thrown_body';
import { turretArrivalGap, turretArrivalSector } from './turret_arrival';
import {
  lightTurretBarrelByBody,
  lightTurretBarrelsInBlast,
  placeTurretBarrels,
  replanPastTurretBarrel,
  sweepTurretBarrels,
  type TurretBarrel,
  takeDueTurretBarrels,
  turretBarrelBlast,
  turretSpawnBearing,
} from './turret_barrels';
import { resolveTurretBowling } from './turret_bowling';
import { type TurretKind, type TurretPlan, turretChargesLeft } from './turret_defense_plan';
import { TURRET_STREAM, type TurretRunKey, turretDraw, turretRunKey } from './turret_defense_rng';
import {
  burstTurretFrag,
  TURRET_BOMBLETS,
  type TurretBombletSpot,
  type TurretFragBurst,
  turretBombletBlast,
  turretFragBomblets,
} from './turret_fragmentation';
import {
  type TurretMedal,
  type TurretPointsBreakdown,
  type TurretResult,
  turretResult,
} from './turret_result';
import {
  type TurretShockwaveRing,
  turretShockwaveBlast,
  turretShockwaveDone,
  turretShockwaveTargets,
} from './turret_shockwave';

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
  /** Absent on a plain shell; a frag shell bursts into bomblets where a shell would land. */
  weapon?: 'frag';
}

/** A shell kind the cannon fires: the plain shell, or a fragmentation shell (a charge). */
export type TurretShellWeapon = 'shell' | 'frag';

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
  barrelsDetonated: number;
  /** Kills whose killing blow was a barrel's blast. */
  barrelKills: number;
  /** Limited-weapon charges spent: Shockwaves, and fragmentation shells (each also a shot). */
  shockwaves: number;
  frags: number;
}

export interface TurretDefenseState {
  plan: TurretPlan;
  seed: number;
  /** Present when the host keys the draws with its private salt; never on a view. */
  runKey?: TurretRunKey;
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
  /**
   * The intro's and a pause's last tick (the next wave starts on it); once the run has
   * ended, the tick it ended, from which the seat closes TURRET_TIMING.endedSeatTicks later.
   */
  phaseEndTick: number;
  wave: number;
  spawnCursor: number;
  nextSpawnTick: number;
  integrity: number;
  readyTick: number;
  /** The Shockwave rearms on its own clock, apart from the shell's reload. */
  shockReadyTick: number;
  /** The Shockwave ring rolling out, null when none. */
  shockwave: TurretShockwaveRing | null;
  /** Fragmentation shells that burst and still have bomblets to land. */
  frags: TurretFragBurst[];
  /** Unit direction of the last aim, reused when an aim point sits on the center. */
  aimX: number;
  aimZ: number;
  nextShotId: number;
  nextMonsterId: number;
  nextBarrelId: number;
  shots: TurretShot[];
  monsters: TurretMonster[];
  /** The standing explosive barrels, lit ones included, in the order they were placed. */
  barrels: TurretBarrel[];
  stats: TurretStats;
  /** The medal and points, set once the run ends (deep-frozen: views share it). */
  result: TurretResult | null;
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

/** A blast on the field: a shell's, or a barrel's. */
export interface TurretBlast {
  x: number;
  z: number;
  radius: number;
  core: number;
  /** Damage at full strength (the core). */
  damage: number;
  /** Launch speeds of a full-strength hit on mass 1 (yd/s), across and up. */
  push: number;
  pop: number;
  /** The private draw site of each thrown body's deviation: a stream and the blast's own key. */
  stream: number;
  key: number;
}

export interface TurretBarrelSpot {
  id: number;
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
      /** Absent on a plain shell. */
      weapon?: 'frag';
    }
  | { type: 'impact'; shotId: number; x: number; y: number; z: number; hits: TurretHit[] }
  /** A Shockwave's slam at the tower's foot; its front follows turretShockwaveFront from `startTick`. */
  | {
      type: 'shockwave';
      id: number;
      x: number;
      y: number;
      z: number;
      startTick: number;
      reach: number;
    }
  /** The bodies a Shockwave's front reached on this tick, each thrown once. */
  | { type: 'shockwaveHit'; id: number; hits: TurretHit[] }
  /** A frag shell burst over its point (`y` is the burst's height); its bomblets land in turn. */
  | {
      type: 'fragBurst';
      shotId: number;
      x: number;
      y: number;
      z: number;
      bomblets: TurretBombletSpot[];
    }
  | {
      type: 'bomblet';
      shotId: number;
      index: number;
      x: number;
      y: number;
      z: number;
      hits: TurretHit[];
    }
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
  | { type: 'barrelsPlaced'; barrels: TurretBarrelSpot[] }
  | { type: 'barrelLit'; id: number; x: number; y: number; z: number; fuseTicks: number }
  | { type: 'barrelExploded'; id: number; x: number; y: number; z: number; hits: TurretHit[] }
  | { type: 'waveCleared'; wave: number }
  | {
      type: 'ended';
      result: 'won' | 'lost';
      stats: TurretStats;
      medal: TurretMedal | null;
      points: number;
      breakdown: TurretPointsBreakdown;
    };

export type TurretFireRefusal = 'ended' | 'lull' | 'cooldown' | 'invalid' | 'empty';

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
  salt?: PrivateSalt,
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
    integrity: plan.integrity,
    readyTick: startTick,
    shockReadyTick: startTick,
    shockwave: null,
    frags: [],
    aimX: 0,
    aimZ: 1,
    nextShotId: 1,
    nextMonsterId: 1,
    nextBarrelId: 1,
    shots: [],
    monsters: [],
    barrels: [],
    stats: {
      shots: 0,
      hits: 0,
      kills: 0,
      breaches: 0,
      pointsLost: 0,
      longestThrow: 0,
      longestAirtime: 0,
      bowled: 0,
      barrelsDetonated: 0,
      barrelKills: 0,
      shockwaves: 0,
      frags: 0,
    },
    result: null,
    ...(salt ? { runKey: turretRunKey(salt, seed >>> 0) } : {}),
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

/** An aim held inside the weapon's reach band: the point, its unit bearing and its range. */
export interface TurretAim {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  range: number;
}

/**
 * The shot's one clamp, shared by the engine, the reticle and the local shell: the
 * point `x, z` pulled into the weapon's reach band around `cx, cz` along its bearing.
 * A point-blank aim keeps the last bearing `aimX, aimZ`.
 */
export function clampTurretAimInto(
  cx: number,
  cz: number,
  aimX: number,
  aimZ: number,
  x: number,
  z: number,
  out: TurretAim,
): TurretAim {
  const dx = x - cx;
  const dz = z - cz;
  const dist = Math.hypot(dx, dz);
  const dirX = dist > 1e-6 ? dx / dist : aimX;
  const dirZ = dist > 1e-6 ? dz / dist : aimZ;
  const range = Math.min(TURRET_WEAPON.maxRange, Math.max(TURRET_WEAPON.minRange, dist));
  out.dirX = dirX;
  out.dirZ = dirZ;
  out.range = range;
  out.x = cx + dirX * range;
  out.z = cz + dirZ * range;
  return out;
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

/** The current wave's shell core damage, the last wave's once the waves are done. */
function shellCoreDamage(state: TurretDefenseState): number {
  const wave = state.plan.waves[Math.min(state.wave, state.plan.waves.length - 1)];
  return wave ? wave.coreDamage : 0;
}

/**
 * Fires a shell at a ground point; a frag shell also spends a charge (refused as
 * `empty` with none left, and as `lull` outside a wave so a charge is never wasted).
 */
export function fireTurret(
  state: TurretDefenseState,
  tick: number,
  x: number,
  z: number,
  probe: ThrowProbe,
  weapon: TurretShellWeapon = 'shell',
): TurretFireOutcome {
  if (state.phase === 'won' || state.phase === 'lost')
    return { ok: false, reason: 'ended', events: [] };
  const frag = weapon === 'frag';
  if (frag && state.phase !== 'wave') return { ok: false, reason: 'lull', events: [] };
  if (!Number.isFinite(x) || !Number.isFinite(z))
    return { ok: false, reason: 'invalid', events: [] };
  if (frag && !(turretChargesLeft(state).fragmentation > 0))
    return { ok: false, reason: 'empty', events: [] };
  if (tick < state.readyTick) return { ok: false, reason: 'cooldown', events: [] };
  const aim = clampTurretAimInto(state.cx, state.cz, state.aimX, state.aimZ, x, z, {
    x: 0,
    z: 0,
    dirX: 0,
    dirZ: 0,
    range: 0,
  });
  state.aimX = aim.dirX;
  state.aimZ = aim.dirZ;
  const range = aim.range;
  const tx = aim.x;
  const tz = aim.z;
  const flightTicks = turretShellFlightTicks(range);
  const shot: TurretShot = {
    id: state.nextShotId++,
    x: tx,
    z: tz,
    damage: shellCoreDamage(state),
    firedTick: tick,
    impactTick: tick + flightTicks,
    ...(frag ? { weapon: 'frag' as const } : {}),
  };
  state.shots.push(shot);
  state.readyTick = tick + TURRET_WEAPON.cooldownTicks;
  state.stats.shots++;
  if (frag) state.stats.frags++;
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
        ...(frag ? { weapon: 'frag' as const } : {}),
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
    startWave(state, tick, world, events);
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
    landDueBomblets(state, tick, world, events);
    rollShockwave(state, tick, world, events);
    explodeDueBarrels(state, tick, world, events);
  }
  advanceMonsters(state, tick, world, events, false);
  if (state.phase === 'wave') checkWaveCleared(state, tick, events);
  return events;
}

/**
 * The caller's probe plus the cannon tower's own body and the standing barrels
 * as swept obstacles: of every obstacle a move enters, the nearest stops it.
 */
function withTurretBody(state: TurretDefenseState, probe: ThrowProbe): ThrowProbe {
  const top = groundOr(probe, state.cx, state.cz, 0) + TURRET_ARENA.turretHeight;
  return {
    ground: (x, z) => probe.ground(x, z),
    water: (x, z) => probe.water(x, z),
    sweep: (fx, fz, tx, tz, radius, fromY, toY) => {
      let hit: SweepResult = sweepCylinder(
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
      const barrel = sweepTurretBarrels(state.barrels, fx, fz, tx, tz, radius, fromY, toY);
      if (barrel && (!hit.blocked || nearer(barrel, hit, fx, fz))) hit = barrel;
      const world = probe.sweep ? probe.sweep(fx, fz, tx, tz, radius, fromY, toY) : null;
      if (world?.blocked && (!hit.blocked || nearer(world, hit, fx, fz))) hit = world;
      return hit;
    },
  };
}

function nearer(a: SweepResult, b: SweepResult, fx: number, fz: number): boolean {
  return Math.hypot(a.x - fx, a.z - fz) < Math.hypot(b.x - fx, b.z - fz);
}

function startWave(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
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
  const placed = placeTurretBarrels(state, wave.barrels, tick, probe);
  if (placed.length) {
    events.push({
      type: 'barrelsPlaced',
      barrels: placed.map(({ id, x, y, z }) => ({ id, x, y, z })),
    });
  }
}

function spawnDue(state: TurretDefenseState, tick: number, probe: ThrowProbe): void {
  const wave = currentWave(state);
  if (!wave) return;
  while (state.spawnCursor < wave.spawns.length && tick >= state.nextSpawnTick) {
    const index = state.spawnCursor++;
    const kindIndex = wave.spawns[index];
    const kind = state.plan.kinds[kindIndex];
    const id = state.nextMonsterId++;
    const angle = turretSpawnBearing(
      state,
      turretDraw(state, TURRET_STREAM.spawnAngle, id),
      kind.radius,
      turretArrivalSector(state, state.wave, wave.arrival, index),
    );
    const x = state.cx + Math.sin(angle) * TURRET_ARENA.spawnRadius;
    const z = state.cz + Math.cos(angle) * TURRET_ARENA.spawnRadius;
    state.nextSpawnTick = tick + turretArrivalGap(state, wave, index, id);
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
    else if (shot.weapon === 'frag') {
      const burst = burstTurretFrag(shot, state.cx, state.cz, tick, probe);
      state.frags.push(burst.frag);
      events.push(burst.event);
      bump(state);
    } else detonate(state, shot, tick, probe, events);
  }
  state.shots.length = kept;
}

/** Each burst frag's bomblets due by `tick` blast in landing order, each lighting the barrels it reaches. */
function landDueBomblets(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  if (!state.frags.length) return;
  let kept = 0;
  for (const frag of state.frags) {
    const star = turretFragBomblets(frag.x, frag.z, frag.dirX, frag.dirZ, frag.burstTick);
    while (frag.landed < TURRET_BOMBLETS && star[frag.landed].landTick <= tick) {
      const bomblet = star[frag.landed++];
      const blast = turretBombletBlast(frag, bomblet);
      const hits: TurretHit[] = [];
      events.push({
        type: 'bomblet',
        shotId: frag.shotId,
        index: bomblet.index,
        x: bomblet.x,
        y: groundOr(probe, bomblet.x, bomblet.z, 0),
        z: bomblet.z,
        hits,
      });
      blastBodies(state, blast, tick, probe, events, hits);
      if (hits.length && !frag.hit) {
        frag.hit = true;
        state.stats.hits++;
      }
      lightTurretBarrelsInBlast(state, blast.x, blast.z, blast.radius, tick, events);
    }
    if (frag.landed < TURRET_BOMBLETS) state.frags[kept++] = frag;
  }
  state.frags.length = kept;
}

/** The rolling Shockwave throws the bodies its front reached by `tick`, then ends at its reach. */
function rollShockwave(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const ring = state.shockwave;
  if (!ring) return;
  const reached = turretShockwaveTargets(state, ring, tick, probe);
  if (reached.length) {
    const hits: TurretHit[] = [];
    events.push({ type: 'shockwaveHit', id: ring.id, hits });
    const blast = turretShockwaveBlast(state, ring, shellCoreDamage(state));
    blastBodies(state, blast, tick, probe, events, hits, (m) => reached.includes(m.id));
    ring.struck.push(...reached);
  }
  // No bump: the ring is off the view, so its end changes nothing a reader sees.
  if (turretShockwaveDone(ring, tick)) state.shockwave = null;
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
  const blast: TurretBlast = {
    x: shot.x,
    z: shot.z,
    radius: TURRET_WEAPON.blastRadius,
    core: TURRET_WEAPON.blastCore,
    damage: shot.damage,
    push: TURRET_WEAPON.push,
    pop: TURRET_WEAPON.pop,
    stream: TURRET_STREAM.throwDeviation,
    key: shot.id,
  };
  blastBodies(state, blast, tick, probe, events, hits);
  if (hits.length) state.stats.hits++;
  lightTurretBarrelsInBlast(state, shot.x, shot.z, TURRET_WEAPON.blastRadius, tick, events);
}

/** The barrels whose fuse ran out blow, each lighting the ones its blast reaches. */
function explodeDueBarrels(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  for (const barrel of takeDueTurretBarrels(state, tick)) {
    const hits: TurretHit[] = [];
    events.push({
      type: 'barrelExploded',
      id: barrel.id,
      x: barrel.x,
      y: barrel.y,
      z: barrel.z,
      hits,
    });
    const kills = blastBodies(state, turretBarrelBlast(state, barrel), tick, probe, events, hits);
    // The result froze at the win: a barrel still burning then blows for the show only.
    if (state.phase !== 'won') {
      state.stats.barrelsDetonated++;
      state.stats.barrelKills += kills;
    }
    lightTurretBarrelsInBlast(
      state,
      barrel.x,
      barrel.z,
      TURRET_EXPLOSIVE_BARREL.blastRadius,
      tick,
      events,
    );
    replanPastTurretBarrel(state, barrel, tick, probe);
  }
}

/**
 * Damages every living body the blast reaches by its falloff (only those `admits`
 * lets through, when given), throws the ones it hits past a graze, and returns
 * how many it killed. Corpses are never moved.
 */
function blastBodies(
  state: TurretDefenseState,
  blast: TurretBlast,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
  hits: TurretHit[],
  admits?: (m: TurretMonster) => boolean,
): number {
  let kills = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0 || m.state === 'gone' || (admits && !admits(m))) continue;
    const p = positionAt(m.seg, tick, probe);
    const falloff = blastFalloff(
      Math.hypot(p.x - blast.x, p.z - blast.z),
      blast.radius,
      blast.core,
    );
    if (!(falloff > 0)) continue;
    const damage = Math.max(1, Math.round(blast.damage * falloff));
    m.hp = Math.max(0, m.hp - damage);
    hits.push({ id: m.id, falloff, damage, x: p.x, y: p.y, z: p.z });
    if (falloff >= TURRET_WEAPON.grazeFalloff) {
      launch(state, m, blast, falloff, p, tick, probe, events);
    } else if (m.hp <= 0 && m.state !== 'fly' && m.state !== 'skid') {
      // A flight or a slide already ends in rest(), which lays a dead body down.
      rest(state, m, state.plan.kinds[m.kind], tick, p, probe);
    }
    if (m.hp <= 0) {
      state.stats.kills++;
      kills++;
      events.push({ type: 'killed', id: m.id, x: p.x, y: p.y, z: p.z });
    }
  }
  bump(state);
  return kills;
}

function launch(
  state: TurretDefenseState,
  m: TurretMonster,
  blast: TurretBlast,
  falloff: number,
  p: Vec3,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const kind = state.plan.kinds[m.kind];
  const base = throwDirection(
    blast.x,
    blast.z,
    p.x,
    p.z,
    state.cx,
    state.cz,
    TURRET_WEAPON.deadCenter,
  );
  const spread = turretDraw(state, blast.stream, blast.key, m.id) * 2 - 1;
  const dir = rotateDir(base.x, base.z, spread * TURRET_WEAPON.deviation);
  const v = launchVelocity(
    falloff,
    kind.mass,
    dir.x,
    dir.z,
    blast.push,
    blast.pop,
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
      if (m.seg.kind === 'skid' && m.seg.contact === 'wall') {
        const v = velocityAt(m.seg, at);
        lightTurretBarrelByBody(
          state,
          p.x,
          p.z,
          kind.radius,
          Math.hypot(v.x, v.z),
          state.tick,
          events,
        );
      }
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
    lightTurretBarrelByBody(state, p.x, p.z, kind.radius, out.speed, state.tick, events);
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
  end(state, events);
}

function lose(state: TurretDefenseState, events: TurretEvent[]): void {
  state.phase = 'lost';
  state.shots = [];
  state.frags = [];
  state.shockwave = null;
  end(state, events);
}

function end(state: TurretDefenseState, events: TurretEvent[]): void {
  state.phaseEndTick = state.tick;
  const result = deepFreeze(turretResult(state.plan, state));
  state.result = result;
  events.push({
    type: 'ended',
    result: result.won ? 'won' : 'lost',
    stats: { ...state.stats },
    medal: result.medal,
    points: result.points,
    breakdown: { ...result.breakdown },
  });
}

/** A lost session keeps every monster where it stands (mid-air included) for the result view. */
function freeze(state: TurretDefenseState, tick: number, probe: ThrowProbe): void {
  pruneGone(state);
  for (const m of state.monsters) m.seg = stillSegment(tick, 0, positionAt(m.seg, tick, probe));
}
