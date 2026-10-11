// The Colossal Bat (a common/rare Buried Hoard cave boss), the authoritative
// half: its dive down a marked lane, its kickable screech, and on a rare map its
// swarm. The numbers are pure and shared with the renderer (hoard_bat_core.ts).
//
// State rides HoardBossState.bat. The dive lane and the screech's reach are cues
// this module owns (it moves the lane while it aims and withdraws both when they
// are done); while it aims and dives the locomotion seam holds it
// (state.caveHeld) and this module moves it. The screech is a cast any interrupt
// stops: its id is in HOARD_ADD_CAST_SCHOOLS, so a kick clears the bat's cast
// like any scripted hoard cast, and the screech is lost for that turn. Draws no
// rng: the swarm comes through the shared boss add spawner.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { riftFx } from './fx';
import { BAT, HOARD_BAT_SWARMLING_TEMPLATE, pointInBatDive } from './hoard_bat_core';
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
import { chargeReach } from './hoard_charge';
import {
  HOARD_CAST_BAT_DIVE,
  HOARD_CAST_BAT_DIVE_AIM,
  HOARD_CAST_SCREECH,
} from './hoard_control_cast_ids';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_BAT_DIVE_ABILITY = 'Plunging Dive';
export const HOARD_BAT_SCREECH_ABILITY = 'Deafening Screech';

export interface HoardBatState {
  diveTimer: number;
  screechTimer: number;
  swarmTimer: number;
  phase: 'idle' | 'aim' | 'dive' | 'recover' | 'screech';
  phaseTimer: number;
  cueId: number;
  targetId: number;
  facing: number;
  reach: number;
  travelled: number;
  origin: { x: number; z: number };
  hitIds: number[];
  casts: number;
}

function batState(state: HoardBossState): HoardBatState {
  state.bat ??= {
    diveTimer: BAT.diveFirstSec,
    screechTimer: BAT.screechFirstSec,
    swarmTimer: BAT.swarmFirstSec,
    phase: 'idle',
    phaseTimer: 0,
    cueId: -1,
    targetId: -1,
    facing: 0,
    reach: 0,
    travelled: 0,
    origin: { x: 0, z: 0 },
    hitIds: [],
    casts: 0,
  };
  return state.bat;
}

export function isBatCue(cue: HoardBossCue): boolean {
  return cue.variant === 'bat-dive' || cue.variant === 'bat-screech';
}

function reachFrom(inst: RiftInstance, from: { x: number; z: number }, facing: number): number {
  return Math.min(BAT.diveMaxYards, chargeReach(inst, from, facing));
}

function end(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  held: HoardBatState,
  emit: CaveEmit,
): void {
  const cue = caveFindCue(state, held.cueId);
  if (cue) caveWithdraw(ctx, inst, state, cue, emit);
  held.cueId = -1;
  held.phase = 'idle';
  state.caveHeld = false;
  caveClearCast(boss, HOARD_CAST_BAT_DIVE_AIM);
  caveClearCast(boss, HOARD_CAST_BAT_DIVE);
  caveClearCast(boss, HOARD_CAST_SCREECH);
}

function screechLands(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  players: readonly Entity[],
): void {
  for (const player of players) {
    if (player.dead) continue;
    const dx = player.pos.x - boss.pos.x;
    const dz = player.pos.z - boss.pos.z;
    if (dx * dx + dz * dz > BAT.screechRadius * BAT.screechRadius) continue;
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, BAT.screechDamageFraction),
      false,
      'nature',
      HOARD_BAT_SCREECH_ABILITY,
      'hit',
      true,
    );
    ctx.applyAura(player, {
      id: `hoard_bat_screech_${boss.id}`,
      name: HOARD_BAT_SCREECH_ABILITY,
      kind: 'slow',
      remaining: BAT.screechSlowSec,
      duration: BAT.screechSlowSec,
      value: BAT.screechSlow,
      sourceId: boss.id,
      school: 'nature',
      encounterOwned: true,
    });
  }
  riftFx(ctx, boss.pos.x, boss.pos.z, 'nature', 'nova');
}

/** Per tick while it is engaged (hoard_boss.ts tickSpecialKit). */
export function tickHoardBat(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: CaveEmit,
): void {
  const held = batState(state);
  const living = players.filter((player) => !player.dead);
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;
  const rare = caveRare(inst);

  if (held.phase !== 'idle') {
    if (living.length === 0 || boss.dead) {
      end(ctx, inst, boss, state, held, emit);
      return;
    }
    held.phaseTimer -= DT;
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (held.phase === 'screech') {
      // Kicked: an interrupt cleared its cast. The screech is lost for this turn.
      if (boss.castingAbility !== HOARD_CAST_SCREECH) {
        riftFx(ctx, boss.pos.x, boss.pos.z, 'nature', 'burst');
        end(ctx, inst, boss, state, held, emit);
        held.screechTimer = BAT.screechEverySec;
        return;
      }
      if (held.phaseTimer > 0) return;
      screechLands(ctx, inst, boss, players);
      end(ctx, inst, boss, state, held, emit);
      held.screechTimer = BAT.screechEverySec;
      return;
    }
    const cue = caveFindCue(state, held.cueId);
    if (held.phase === 'aim') {
      // It keeps turning after its mark for the whole aim; the lane turns with it.
      const mark = ctx.entities.get(held.targetId);
      if (mark && !mark.dead) {
        held.facing = Math.atan2(mark.pos.x - boss.pos.x, mark.pos.z - boss.pos.z);
        held.reach = reachFrom(inst, boss.pos, held.facing);
      }
      boss.facing = held.facing;
      if (cue && cue.kind === 'sweep') {
        const turned =
          Math.abs(cue.facing - held.facing) > 0.02 || Math.abs(cue.radius - held.reach) > 0.5;
        cue.facing = held.facing;
        cue.radius = held.reach;
        cue.x = boss.pos.x;
        cue.z = boss.pos.z;
        // Online clients draw the lane from the events: tell them when it turns.
        if (turned) emit(ctx, inst, cue);
      }
      if (held.phaseTimer > 0) return;
      caveClearCast(boss, HOARD_CAST_BAT_DIVE_AIM);
      const travel = held.reach / BAT.diveSpeed;
      caveCast(boss, HOARD_CAST_BAT_DIVE, Math.max(DT, travel));
      held.phase = 'dive';
      held.origin = { x: boss.pos.x, z: boss.pos.z };
      held.travelled = 0;
      held.hitIds = [];
      return;
    }
    if (held.phase === 'dive') {
      const step = Math.min(BAT.diveSpeed * DT, held.reach - held.travelled);
      held.travelled += step;
      boss.pos.x = held.origin.x + Math.sin(held.facing) * held.travelled;
      boss.pos.z = held.origin.z + Math.cos(held.facing) * held.travelled;
      boss.facing = held.facing;
      ctx.grid.update(boss);
      for (const player of living) {
        if (held.hitIds.includes(player.id)) continue;
        // Hit once it has passed them, only inside the lane it drew.
        if (!pointInBatDive(held.origin, held.facing, held.travelled, player.pos)) continue;
        held.hitIds.push(player.id);
        ctx.dealDamage(
          boss,
          player,
          hoardMechanicDamage(inst, BAT.diveDamageFraction),
          false,
          'physical',
          HOARD_BAT_DIVE_ABILITY,
          'hit',
          true,
        );
        ctx.applyKnockback(boss, player, BAT.diveKnockback);
      }
      if (held.travelled < held.reach - 1e-6) return;
      if (cue) caveWithdraw(ctx, inst, state, cue, emit);
      held.cueId = -1;
      caveClearCast(boss, HOARD_CAST_BAT_DIVE);
      riftFx(ctx, boss.pos.x, boss.pos.z, 'physical', 'burst');
      held.phase = 'recover';
      held.phaseTimer = BAT.diveRecoverSec;
      return;
    }
    // Recovering: it hangs where it stopped.
    if (held.phaseTimer > 0) return;
    end(ctx, inst, boss, state, held, emit);
    held.diveTimer = BAT.diveEverySec;
    return;
  }

  const step = caveStep(inst);
  held.diveTimer -= step;
  held.screechTimer -= step;
  if (rare) held.swarmTimer -= step;
  if (caveBusy(state) || living.length === 0 || boss.castingAbility !== null) return;

  if (held.screechTimer <= 0) {
    const cast = double ? BAT.screechDoubleCastSec : BAT.screechCastSec;
    const cue = caveMark(
      ctx,
      inst,
      state,
      'bat-screech',
      boss.pos.x,
      boss.pos.z,
      BAT.screechRadius,
      cast,
      emit,
    );
    held.cueId = cue.id;
    held.phase = 'screech';
    held.phaseTimer = cast;
    caveCast(boss, HOARD_CAST_SCREECH, cast);
    return;
  }
  if (rare && held.swarmTimer <= 0) {
    held.swarmTimer = BAT.swarmEverySec;
    const flying = boss.summonedIds.filter((id) => {
      const add = ctx.entities.get(id);
      return add && !add.dead && add.templateId === HOARD_BAT_SWARMLING_TEMPLATE;
    }).length;
    const count = Math.min(double ? BAT.swarmDoubleCount : BAT.swarmCount, BAT.swarmCap - flying);
    if (count > 0) ctx.spawnBossAdds(boss, HOARD_BAT_SWARMLING_TEMPLATE, count);
    return;
  }
  if (held.diveTimer <= 0) {
    // Anyone but whoever holds it when it can: the dive is for the room.
    const others = living.filter((player) => player.id !== boss.aggroTargetId);
    const pool = others.length > 0 ? others : living;
    const mark = pool[held.casts % pool.length];
    held.casts++;
    held.targetId = mark.id;
    held.facing = Math.atan2(mark.pos.x - boss.pos.x, mark.pos.z - boss.pos.z);
    held.reach = reachFrom(inst, boss.pos, held.facing);
    const cue = caveSweep(
      ctx,
      inst,
      state,
      'bat-dive',
      boss.pos,
      held.facing,
      held.reach,
      BAT.diveLaneHalfAngle,
      // The lane lives through the aim and the dive; the module withdraws it.
      BAT.diveAimSec + BAT.diveMaxYards / BAT.diveSpeed + 1,
      emit,
    );
    held.cueId = cue.id;
    held.phase = 'aim';
    held.phaseTimer = BAT.diveAimSec;
    state.caveHeld = true;
    caveCast(boss, HOARD_CAST_BAT_DIVE_AIM, BAT.diveAimSec, mark.id);
    boss.facing = held.facing;
  }
}

/** The boss engine asks whether one of its cues lives on: the module ends them. */
export function tickHoardBatCue(cue: HoardBossCue): boolean {
  return cue.remaining > 1e-8;
}

/** Nothing of it outlives the fight (hoard_boss.ts clearState). */
export function clearHoardBat(boss: Entity | undefined, state: HoardBossState): void {
  if (!state.bat) return;
  state.caveHeld = false;
  if (!boss) return;
  caveClearCast(boss, HOARD_CAST_BAT_DIVE_AIM);
  caveClearCast(boss, HOARD_CAST_BAT_DIVE);
  caveClearCast(boss, HOARD_CAST_SCREECH);
}
