// The Voracious Chest (a common/rare Buried Hoard cave boss, a mimic), the
// authoritative half: its bite, its leap at one of the party, and on a rare map
// its cursed coin spit. The numbers are pure and shared with the renderer
// (hoard_mimic_core.ts).
//
// State rides HoardBossState.mimic. The bite is an ordinary sweep the boss engine
// resolves (its spec is registered in hoard_boss_kits.ts) and the coins are
// ordinary marks that leave puddles. The landing circle belongs to this module:
// it is the clock of the crouch and the flight, and the chest lands on it when it
// runs out. While it crouches and flies the locomotion seam holds it
// (state.caveHeld) and this module carries it along the arc. Draws no rng.

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
  caveStep,
  caveSweep,
  caveWithdraw,
} from './hoard_cave_kit';
import {
  HOARD_CAST_COIN_SPIT,
  HOARD_CAST_MIMIC_BITE,
  HOARD_CAST_MIMIC_LEAP,
} from './hoard_control_cast_ids';
import {
  MIMIC,
  mimicCoinCount,
  mimicCoinPoints,
  mimicLeapHeight,
  mimicLeapProgress,
} from './hoard_mimic_core';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_MIMIC_LEAP_ABILITY = 'Crushing Leap';

const MIMIC_CASTS = new Set([HOARD_CAST_MIMIC_BITE, HOARD_CAST_MIMIC_LEAP, HOARD_CAST_COIN_SPIT]);

export interface HoardMimicState {
  biteTimer: number;
  leapTimer: number;
  coinTimer: number;
  phase: 'idle' | 'leap';
  leapCueId: number;
  biteCueId: number;
  from: { x: number; y: number; z: number };
  casts: number;
}

function mimicState(state: HoardBossState): HoardMimicState {
  state.mimic ??= {
    biteTimer: MIMIC.biteFirstSec,
    leapTimer: MIMIC.leapFirstSec,
    coinTimer: MIMIC.coinFirstSec,
    phase: 'idle',
    leapCueId: -1,
    biteCueId: -1,
    from: { x: 0, y: 0, z: 0 },
    casts: 0,
  };
  return state.mimic;
}

export function isMimicCue(cue: HoardBossCue): boolean {
  return cue.variant === 'mimic-leap';
}

function bite(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardMimicState,
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
    'mimic-bite',
    boss.pos,
    facing,
    MIMIC.biteRadius,
    MIMIC.biteHalfAngle,
    windup,
    emit,
  );
  held.biteCueId = cue.id;
  caveCast(boss, HOARD_CAST_MIMIC_BITE, windup);
}

function land(
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
    if (dx * dx + dz * dz > MIMIC.leapRadius * MIMIC.leapRadius) continue;
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, MIMIC.leapDamageFraction),
      false,
      'physical',
      HOARD_MIMIC_LEAP_ABILITY,
      'hit',
      true,
    );
    ctx.applyKnockback(boss, player, MIMIC.leapKnockback);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: cue.x,
    z: cue.z,
    school: 'physical',
    fx: 'nova',
    ability: 'charge',
    radius: MIMIC.leapRadius,
    sourceId: boss.id,
  });
}

/** Per tick while it is engaged (hoard_boss.ts tickSpecialKit). */
export function tickHoardMimic(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: CaveEmit,
): void {
  const held = mimicState(state);
  const living = players.filter((player) => !player.dead);
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;
  const rare = caveRare(inst);

  if (MIMIC_CASTS.has(boss.castingAbility ?? '')) {
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  }
  if (held.biteCueId !== -1 && !caveFindCue(state, held.biteCueId)) {
    held.biteCueId = -1;
    caveClearCast(boss, HOARD_CAST_MIMIC_BITE);
  }

  if (held.phase === 'leap') {
    const cue = caveFindCue(state, held.leapCueId);
    if (!cue || boss.dead) {
      if (cue) caveWithdraw(ctx, inst, state, cue, emit);
      boss.pos.y = ctx.groundPos(boss.pos.x, boss.pos.z).y;
      held.phase = 'idle';
      state.caveHeld = false;
      caveClearCast(boss, HOARD_CAST_MIMIC_LEAP);
      return;
    }
    const progress = mimicLeapProgress(cue.remaining, cue.total);
    boss.pos.x = held.from.x + (cue.x - held.from.x) * progress;
    boss.pos.z = held.from.z + (cue.z - held.from.z) * progress;
    const ground = ctx.groundPos(boss.pos.x, boss.pos.z).y;
    boss.pos.y = ground + mimicLeapHeight(progress);
    boss.facing = Math.atan2(cue.x - held.from.x, cue.z - held.from.z);
    ctx.grid.update(boss);
    if (cue.remaining > 1e-8) return;
    boss.pos.y = ground;
    land(ctx, inst, boss, cue, players);
    caveWithdraw(ctx, inst, state, cue, emit);
    held.leapCueId = -1;
    held.phase = 'idle';
    state.caveHeld = false;
    caveClearCast(boss, HOARD_CAST_MIMIC_LEAP);
    held.leapTimer = MIMIC.leapEverySec;
    // Under pressure it snaps the moment it lands.
    if (double && living.length > 0) {
      bite(ctx, inst, boss, state, held, living, MIMIC.biteComboWindupSec, emit);
    }
    return;
  }

  if (boss.castingAbility === HOARD_CAST_COIN_SPIT) {
    if (boss.castRemaining > 0) return;
    caveClearCast(boss, HOARD_CAST_COIN_SPIT);
    const points = mimicCoinPoints(
      boss.pos,
      boss.facing,
      mimicCoinCount(living.length),
      held.casts,
    );
    held.casts++;
    for (const point of points) {
      caveMark(
        ctx,
        inst,
        state,
        'mimic-coins',
        point.x,
        point.z,
        MIMIC.coinRadius,
        MIMIC.coinWindupSec,
        emit,
      );
    }
    riftFx(ctx, boss.pos.x, boss.pos.z, 'fire', 'burst');
    return;
  }

  const step = caveStep(inst);
  held.biteTimer -= step;
  held.leapTimer -= step;
  if (rare) held.coinTimer -= step;
  if (caveBusy(state) || living.length === 0 || boss.castingAbility !== null) return;

  if (held.leapTimer <= 0) {
    // Whoever stands furthest from it, turn and turn about among the rest.
    const byReach = [...living].sort(
      (a, b) =>
        Math.hypot(b.pos.x - boss.pos.x, b.pos.z - boss.pos.z) -
        Math.hypot(a.pos.x - boss.pos.x, a.pos.z - boss.pos.z),
    );
    const mark = byReach[held.casts % Math.min(2, byReach.length)];
    held.casts++;
    const total = MIMIC.leapCrouchSec + MIMIC.leapFlightSec;
    const cue = caveMark(
      ctx,
      inst,
      state,
      'mimic-leap',
      mark.pos.x,
      mark.pos.z,
      MIMIC.leapRadius,
      total,
      emit,
      mark.id,
    );
    held.leapCueId = cue.id;
    held.from = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z };
    held.phase = 'leap';
    state.caveHeld = true;
    caveCast(boss, HOARD_CAST_MIMIC_LEAP, total, mark.id);
    return;
  }
  if (rare && held.coinTimer <= 0) {
    held.coinTimer = MIMIC.coinEverySec;
    caveCast(boss, HOARD_CAST_COIN_SPIT, MIMIC.coinCastSec);
    return;
  }
  if (held.biteTimer <= 0) {
    held.biteTimer = MIMIC.biteEverySec;
    bite(ctx, inst, boss, state, held, living, MIMIC.biteWindupSec, emit);
  }
}

/** The boss engine asks whether its landing circle lives on: the module ends it. */
export function tickHoardMimicCue(cue: HoardBossCue): boolean {
  return cue.variant === 'mimic-leap' ? true : cue.remaining > 1e-8;
}

/** Nothing of it outlives the fight (hoard_boss.ts clearState): it lands. */
export function clearHoardMimic(
  ctx: SimContext,
  boss: Entity | undefined,
  state: HoardBossState,
): void {
  if (!state.mimic) return;
  state.caveHeld = false;
  if (!boss) return;
  boss.pos.y = ctx.groundPos(boss.pos.x, boss.pos.z).y;
  caveClearCast(boss, HOARD_CAST_MIMIC_LEAP);
  caveClearCast(boss, HOARD_CAST_MIMIC_BITE);
  caveClearCast(boss, HOARD_CAST_COIN_SPIT);
}
