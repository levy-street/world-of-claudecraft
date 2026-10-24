// Deeprake (a common/rare Buried Hoard cave boss, a giant burrowing mole), the
// authoritative half: his claw rake, his burrow (dig in, tunnel to a circle laid
// under a player, erupt there), and on a rare map the ceiling he roars down.
// The numbers are pure and shared with the renderer (hoard_mole_core.ts).
//
// State rides HoardBossState.mole. The rake is an ordinary sweep the boss engine
// resolves (its spec is registered in hoard_boss_kits.ts); the rocks are ordinary
// marks. The burrow circle belongs to this module: it is his clock underground,
// and he erupts from it when it runs out. While he digs, tunnels and erupts the
// locomotion seam holds him (state.caveHeld), he takes no damage underground,
// and the clips come from the cast ids his visual maps (Burrow, Underground,
// Emerge). Draws no rng.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { riftFx } from './fx';
import {
  type CaveEmit,
  caveBusy,
  caveCast,
  caveClearCast,
  caveFindCue,
  caveMark,
  caveRare,
  caveRing,
  caveSpread,
  caveStep,
  caveSweep,
  caveWithdraw,
} from './hoard_cave_kit';
import {
  HOARD_CAST_BURROW,
  HOARD_CAST_COLLAPSE,
  HOARD_CAST_EMERGE,
  HOARD_CAST_MOLE_RAKE,
  HOARD_CAST_TUNNEL,
} from './hoard_control_cast_ids';
import { MOLE, moleRockCount } from './hoard_mole_core';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_MOLE_ERUPT_ABILITY = 'Eruption';

const MOLE_CASTS = new Set([
  HOARD_CAST_MOLE_RAKE,
  HOARD_CAST_BURROW,
  HOARD_CAST_TUNNEL,
  HOARD_CAST_EMERGE,
  HOARD_CAST_COLLAPSE,
]);

export interface HoardMoleState {
  swipeTimer: number;
  burrowTimer: number;
  rockTimer: number;
  /** A second rock wave still to fall, and when. */
  rockWaveIn: number | null;
  phase: 'idle' | 'burrow' | 'tunnel' | 'emerge';
  phaseTimer: number;
  burrowCueId: number;
  swipeCueId: number;
  /** A rake owed right after an eruption. */
  followUp: boolean;
  casts: number;
}

function moleState(state: HoardBossState): HoardMoleState {
  state.mole ??= {
    swipeTimer: MOLE.swipeFirstSec,
    burrowTimer: MOLE.burrowFirstSec,
    rockTimer: MOLE.rockFirstSec,
    rockWaveIn: null,
    phase: 'idle',
    phaseTimer: 0,
    burrowCueId: -1,
    swipeCueId: -1,
    followUp: false,
    casts: 0,
  };
  return state.mole;
}

export function isMoleCue(cue: HoardBossCue): boolean {
  return cue.variant === 'mole-burrow';
}

function target(boss: Entity, living: readonly Entity[], turn: number): Entity | undefined {
  const tank = living.find((player) => player.id === boss.aggroTargetId);
  // The burrow goes to someone other than whoever holds him when it can.
  const others = living.filter((player) => player !== tank);
  const pool = others.length > 0 ? others : living;
  return pool[turn % Math.max(1, pool.length)];
}

function rake(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMoleState,
  living: readonly Entity[],
  windup: number,
  emit: CaveEmit,
): void {
  const aim = living.find((player) => player.id === boss.aggroTargetId) ?? living[0];
  const facing = aim ? Math.atan2(aim.pos.x - boss.pos.x, aim.pos.z - boss.pos.z) : boss.facing;
  boss.facing = facing;
  const cue = caveSweep(
    ctx,
    inst,
    state,
    'mole-swipe',
    boss.pos,
    facing,
    MOLE.swipeRadius,
    MOLE.swipeHalfAngle,
    windup,
    emit,
  );
  held.swipeCueId = cue.id;
  caveCast(boss, HOARD_CAST_MOLE_RAKE, windup);
}

function collapse(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMoleState,
  living: readonly Entity[],
  emit: CaveEmit,
): void {
  const count = moleRockCount(living.length);
  const start = living.length > 0 ? held.casts % living.length : 0;
  const under = living
    .map((_, i) => living[(start + i) % living.length].pos)
    .slice(0, MOLE.rockUnderPlayers);
  const rings = MOLE.rockRings.flatMap((r, i) => caveRing(boss.pos, r, 10 + i * 4, held.casts * 3));
  const burrow = caveFindCue(state, held.burrowCueId);
  const avoid = burrow ? [{ x: burrow.x, z: burrow.z, r: MOLE.rockAvoidBurrow }] : [];
  held.casts++;
  for (const point of caveSpread([...under, ...rings], count, MOLE.rockSpacing, avoid)) {
    caveMark(
      ctx,
      inst,
      state,
      'mole-rock',
      point.x,
      point.z,
      MOLE.rockRadius,
      MOLE.rockWindupSec,
      emit,
    );
  }
  riftFx(ctx, boss.pos.x, boss.pos.z, 'physical', 'nova');
}

function erupt(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  cue: HoardBossCue,
  players: readonly Entity[],
): void {
  for (const player of players) {
    if (player.dead) continue;
    const dx = player.pos.x - cue.x;
    const dz = player.pos.z - cue.z;
    if (dx * dx + dz * dz > MOLE.eruptRadius * MOLE.eruptRadius) continue;
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, MOLE.eruptDamageFraction),
      false,
      'physical',
      HOARD_MOLE_ERUPT_ABILITY,
      'hit',
      true,
    );
    ctx.applyKnockback(boss, player, MOLE.eruptKnockback);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: cue.x,
    z: cue.z,
    school: 'physical',
    fx: 'nova',
    ability: 'charge',
    radius: MOLE.eruptRadius,
    sourceId: boss.id,
  });
}

/** Per tick while he is engaged (hoard_boss.ts tickSpecialKit). */
export function tickHoardMole(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: CaveEmit,
): void {
  const held = moleState(state);
  const living = players.filter((player) => !player.dead);
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;
  const rare = caveRare(inst);
  const step = caveStep(inst);

  // His cast bars run in real time: wind-ups are never pressed by the rarity
  // (only the time between mechanics is).
  if (MOLE_CASTS.has(boss.castingAbility ?? '')) {
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  }
  // The rake's cast bar lasts exactly as long as its sweep.
  if (held.swipeCueId !== -1 && !caveFindCue(state, held.swipeCueId)) {
    held.swipeCueId = -1;
    caveClearCast(boss, HOARD_CAST_MOLE_RAKE);
  }

  // The burrow owns him from the first shovel to the eruption.
  if (held.phase !== 'idle') {
    held.phaseTimer -= DT;
    if (held.phase === 'burrow' && held.phaseTimer <= 0) {
      caveClearCast(boss, HOARD_CAST_BURROW);
      const victim = target(boss, living, held.casts);
      if (!victim) {
        held.phase = 'emerge';
        held.phaseTimer = MOLE.emergeSec;
        caveCast(boss, HOARD_CAST_EMERGE, MOLE.emergeSec);
        return;
      }
      const tunnel = double ? MOLE.tunnelDoubleSec : MOLE.tunnelSec;
      const cue = caveMark(
        ctx,
        inst,
        state,
        'mole-burrow',
        victim.pos.x,
        victim.pos.z,
        MOLE.eruptRadius,
        tunnel,
        emit,
        victim.id,
      );
      held.burrowCueId = cue.id;
      // Underground: out of reach, and already under the spot he will erupt from.
      boss.damageImmune = true;
      boss.pos.x = cue.x;
      boss.pos.z = cue.z;
      ctx.grid.update(boss);
      caveCast(boss, HOARD_CAST_TUNNEL, tunnel);
      held.phase = 'tunnel';
      held.phaseTimer = tunnel;
      return;
    }
    if (held.phase === 'tunnel' && held.phaseTimer <= 0) {
      caveClearCast(boss, HOARD_CAST_TUNNEL);
      const cue = caveFindCue(state, held.burrowCueId);
      boss.damageImmune = false;
      if (cue) {
        erupt(ctx, inst, boss, cue, players);
        caveWithdraw(ctx, inst, state, cue, emit);
      }
      held.burrowCueId = -1;
      caveCast(boss, HOARD_CAST_EMERGE, MOLE.emergeSec);
      held.phase = 'emerge';
      held.phaseTimer = MOLE.emergeSec;
      held.followUp = rare || double;
      return;
    }
    if (held.phase === 'emerge' && held.phaseTimer <= 0) {
      caveClearCast(boss, HOARD_CAST_EMERGE);
      held.phase = 'idle';
      state.caveHeld = false;
      held.burrowTimer = MOLE.burrowEverySec;
      if (held.followUp && living.length > 0) {
        held.followUp = false;
        rake(ctx, inst, boss, state, held, living, MOLE.swipeFollowWindupSec, emit);
      }
    }
    return;
  }

  held.swipeTimer -= step;
  held.burrowTimer -= step;
  if (rare) held.rockTimer -= step;
  if (held.rockWaveIn !== null) {
    held.rockWaveIn -= step;
    if (held.rockWaveIn <= 0) {
      held.rockWaveIn = null;
      if (living.length > 0) collapse(ctx, inst, boss, state, held, living, emit);
    }
  }
  if (boss.castingAbility === HOARD_CAST_COLLAPSE) {
    if (boss.castRemaining > 0) return;
    caveClearCast(boss, HOARD_CAST_COLLAPSE);
    collapse(ctx, inst, boss, state, held, living, emit);
    if (double) held.rockWaveIn = MOLE.rockSecondWaveSec;
    return;
  }
  if (caveBusy(state) || living.length === 0 || boss.castingAbility !== null) return;

  if (held.burrowTimer <= 0) {
    held.phase = 'burrow';
    held.phaseTimer = MOLE.burrowSec;
    state.caveHeld = true;
    caveCast(boss, HOARD_CAST_BURROW, MOLE.burrowSec);
    riftFx(ctx, boss.pos.x, boss.pos.z, 'physical', 'burst');
    return;
  }
  if (rare && held.rockTimer <= 0) {
    held.rockTimer = MOLE.rockEverySec;
    caveCast(boss, HOARD_CAST_COLLAPSE, MOLE.rockCastSec);
    return;
  }
  if (held.swipeTimer <= 0) {
    held.swipeTimer = MOLE.swipeEverySec;
    rake(ctx, inst, boss, state, held, living, MOLE.swipeWindupSec, emit);
  }
}

/** The boss engine asks whether his burrow circle lives on: the module ends it. */
export function tickHoardMoleCue(cue: HoardBossCue): boolean {
  return cue.variant === 'mole-burrow' ? true : cue.remaining > 1e-8;
}

/** Nothing of his outlives the fight (hoard_boss.ts clearState): he comes up. */
export function clearHoardMole(boss: Entity | undefined, state: HoardBossState): void {
  if (!state.mole) return;
  state.caveHeld = false;
  if (!boss) return;
  boss.damageImmune = false;
  caveClearCast(boss, HOARD_CAST_BURROW);
  caveClearCast(boss, HOARD_CAST_TUNNEL);
  caveClearCast(boss, HOARD_CAST_EMERGE);
  caveClearCast(boss, HOARD_CAST_COLLAPSE);
  caveClearCast(boss, HOARD_CAST_MOLE_RAKE);
}
