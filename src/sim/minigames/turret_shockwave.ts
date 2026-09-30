// Fire and Fly Shockwave, the half the engine (turret_defense.ts) drives: the
// charge it spends, the ring it starts, the front's radius over time (the one
// curve the render samples too), which bodies the front reaches on a tick and
// the blast it throws them with. The blast itself is the engine's, on the
// shell's falloff and launch rules. Pure: private stateless draws only, no clock.

import { TURRET_SHOCKWAVE, TURRET_WEAPON } from '../content/turret_defense';
import { groundOr, positionAt, type ThrowProbe } from './thrown_body';
import type { TurretBlast, TurretDefenseState, TurretEvent } from './turret_defense';
import { turretChargesLeft } from './turret_defense_plan';
import { TURRET_STREAM } from './turret_defense_rng';

/** A ring rolling out from the tower. */
export interface TurretShockwaveRing {
  /** 1 for a run's first Shockwave, then +1: the key of its throws' draws. */
  id: number;
  startTick: number;
  /** The bodies this ring already threw: each at most once. */
  struck: number[];
}

export type TurretShockwaveRefusal = 'ended' | 'lull' | 'empty' | 'cooldown';

export type TurretShockwaveOutcome =
  | { ok: true; events: TurretEvent[] }
  | { ok: false; reason: TurretShockwaveRefusal; events: TurretEvent[] };

/**
 * The front's distance from the tower's centre `elapsed` ticks after the slam
 * (fractional between ticks): from the wall to the reach at a steady speed,
 * held at the reach after.
 */
export function turretShockwaveFront(elapsed: number): number {
  const { innerRadius, reach, rollTicks } = TURRET_SHOCKWAVE;
  const t = Math.min(1, Math.max(0, elapsed / rollTicks));
  return innerRadius + (reach - innerRadius) * t;
}

/**
 * Spends a charge and starts a ring at `tick`; refused once the run has ended,
 * outside a wave (so a charge is never wasted), with no charge left, or while it rearms.
 */
export function startTurretShockwave(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
): TurretShockwaveOutcome {
  if (state.phase === 'won' || state.phase === 'lost')
    return { ok: false, reason: 'ended', events: [] };
  if (state.phase !== 'wave') return { ok: false, reason: 'lull', events: [] };
  if (!(turretChargesLeft(state).shockwave > 0)) return { ok: false, reason: 'empty', events: [] };
  if (tick < state.shockReadyTick) return { ok: false, reason: 'cooldown', events: [] };
  state.shockReadyTick = tick + TURRET_SHOCKWAVE.rearmTicks;
  state.stats.shockwaves++;
  const ring: TurretShockwaveRing = { id: state.stats.shockwaves, startTick: tick, struck: [] };
  state.shockwave = ring;
  state.rev++;
  return {
    ok: true,
    events: [
      {
        type: 'shockwave',
        id: ring.id,
        x: state.cx,
        y: groundOr(probe, state.cx, state.cz, 0),
        z: state.cz,
        startTick: tick,
        reach: TURRET_SHOCKWAVE.reach,
      },
    ],
  };
}

/**
 * The ids of the living bodies the front reaches at `tick`: inside its radius,
 * feet on or near the ground, not yet thrown by this ring. Corpses never move.
 */
export function turretShockwaveTargets(
  state: TurretDefenseState,
  ring: TurretShockwaveRing,
  tick: number,
  probe: ThrowProbe,
): number[] {
  const front = turretShockwaveFront(tick - ring.startTick);
  const ids: number[] = [];
  for (const m of state.monsters) {
    if (m.hp <= 0 || m.state === 'gone' || ring.struck.includes(m.id)) continue;
    const p = positionAt(m.seg, tick, probe);
    if (Math.hypot(p.x - state.cx, p.z - state.cz) > front) continue;
    if (p.y - groundOr(probe, p.x, p.z, p.y) > TURRET_SHOCKWAVE.groundClearance) continue;
    ids.push(m.id);
  }
  return ids;
}

/** Whether the ring has rolled its whole way by `tick`. */
export function turretShockwaveDone(ring: TurretShockwaveRing, tick: number): boolean {
  return tick - ring.startTick >= TURRET_SHOCKWAVE.rollTicks;
}

/** The ring's blast, centred on the tower (so every throw points outward), on the current wave's shell core damage. */
export function turretShockwaveBlast(
  state: TurretDefenseState,
  ring: TurretShockwaveRing,
  coreDamage: number,
): TurretBlast {
  return {
    x: state.cx,
    z: state.cz,
    radius: TURRET_SHOCKWAVE.falloffRadius,
    core: TURRET_SHOCKWAVE.falloffCore,
    damage: coreDamage * TURRET_SHOCKWAVE.damageScale,
    push: TURRET_WEAPON.push * TURRET_SHOCKWAVE.pushScale,
    pop: TURRET_WEAPON.pop * TURRET_SHOCKWAVE.popScale,
    stream: TURRET_STREAM.shockwaveThrow,
    key: ring.id,
  };
}
